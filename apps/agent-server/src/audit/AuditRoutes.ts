import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

import type { AgentDatabase } from "../db/connection.js";
import { sendJson } from "../server/chatRoutes.js";

type AuditRouteDeps = {
  db: AgentDatabase;
};

type AuditRow = {
  id: string;
  ts: string;
  type: string;
  severity: string;
  session_id: string | null;
  generation_id: string | null;
  payload_json: string;
};

type AuditEventView = {
  id: string;
  ts: string;
  type: string;
  severity: string;
  sessionId?: string;
  generationId?: string;
  payloadSummary: Record<string, unknown>;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_FILTER_CHARS = 128;
const ALLOWED_QUERY_KEYS = new Set(["type", "severity", "sessionId", "generationId", "limit", "before"]);

export async function handleAuditRoutes(req: IncomingMessage, res: ServerResponse, deps: AuditRouteDeps): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/api/audit/events") {
    return false;
  }

  if (req.method !== "GET") {
    sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "route not found" } });
    return true;
  }

  try {
    const query = parseAuditQuery(url);
    const rows = listAuditRows(deps.db, query);
    const items = rows.map(rowToAuditEventView);
    sendJson(res, 200, {
      items,
      nextBefore: items.length === query.limit ? items[items.length - 1]?.ts : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: { code: "INVALID_QUERY", message } });
  }
  return true;
}

function parseAuditQuery(url: URL): {
  type?: string;
  severity?: string;
  sessionId?: string;
  generationId?: string;
  before?: string;
  limit: number;
} {
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      throw new Error(`unknown query parameter: ${key}`);
    }
    if (url.searchParams.getAll(key).length > 1) {
      throw new Error(`query parameter may appear once: ${key}`);
    }
  }

  const limit = parseLimit(url.searchParams.get("limit"));
  const before = parseBefore(url.searchParams.get("before"));
  return {
    type: parseFilter(url.searchParams.get("type"), "type"),
    severity: parseFilter(url.searchParams.get("severity"), "severity"),
    sessionId: parseFilter(url.searchParams.get("sessionId"), "sessionId"),
    generationId: parseFilter(url.searchParams.get("generationId"), "generationId"),
    before,
    limit,
  };
}

function parseLimit(value: string | null): number {
  if (value === null) {
    return DEFAULT_LIMIT;
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("limit must be an integer");
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < 1 || parsed > MAX_LIMIT) {
    throw new Error(`limit must be between 1 and ${MAX_LIMIT}`);
  }
  return parsed;
}

function parseBefore(value: string | null): string | undefined {
  if (value === null || value === "") {
    return undefined;
  }
  if (Number.isNaN(Date.parse(value))) {
    throw new Error("before must be an ISO timestamp");
  }
  return value;
}

function parseFilter(value: string | null, name: string): string | undefined {
  if (value === null || value === "") {
    return undefined;
  }
  if (value.length > MAX_FILTER_CHARS) {
    throw new Error(`${name} is too long`);
  }
  return value;
}

function listAuditRows(
  db: AgentDatabase,
  query: {
    type?: string;
    severity?: string;
    sessionId?: string;
    generationId?: string;
    before?: string;
    limit: number;
  },
): AuditRow[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (query.type) {
    clauses.push("type = ?");
    params.push(query.type);
  }
  if (query.severity) {
    clauses.push("severity = ?");
    params.push(query.severity);
  }
  if (query.sessionId) {
    clauses.push("session_id = ?");
    params.push(query.sessionId);
  }
  if (query.generationId) {
    clauses.push("generation_id = ?");
    params.push(query.generationId);
  }
  if (query.before) {
    clauses.push("ts < ?");
    params.push(query.before);
  }

  params.push(query.limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare(
      `SELECT id, ts, type, severity, session_id, generation_id, payload_json
       FROM agent_events
       ${where}
       ORDER BY ts DESC, id DESC
       LIMIT ?`,
    )
    .all(...params) as AuditRow[];
}

function rowToAuditEventView(row: AuditRow): AuditEventView {
  return {
    id: row.id,
    ts: row.ts,
    type: row.type,
    severity: row.severity,
    sessionId: row.session_id ?? undefined,
    generationId: row.generation_id ?? undefined,
    payloadSummary: summarizePayload(row.type, parsePayload(row.payload_json)),
  };
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function summarizePayload(type: string, payload: Record<string, unknown>): Record<string, unknown> {
  if (type === "generation_started" || type === "generation_completed" || type === "generation_failed" || type === "generation_aborted") {
    return compactObject({
      status: stringValue(payload.status),
      errorCode: errorCode(payload),
    });
  }
  if (type === "content_delta") {
    return { deltaChars: numberValue(payload.deltaChars) ?? stringValue(payload.delta)?.length ?? 0 };
  }
  if (type === "context_built") {
    const warnings = payload.warnings;
    return compactObject({
      itemCount: numberValue(payload.itemCount),
      usedChars: numberValue(payload.usedChars),
      truncated: booleanValue(payload.truncated),
      warningCount: numberValue(payload.warningCount) ?? (Array.isArray(warnings) ? warnings.length : undefined),
      sourceCounts: numericRecord(payload.sourceCounts),
    });
  }
  if (type === "tool_call_started" || type === "tool_call_completed" || type === "tool_call_failed") {
    const inputSummary = recordValue(payload.inputSummary);
    const outputSummary = recordValue(payload.outputSummary);
    const error = recordValue(payload.error);
    return compactObject({
      toolName: stringValue(payload.toolName),
      status: stringValue(payload.status),
      operation: stringValue(payload.operation) ?? stringValue(inputSummary.operation) ?? stringValue(outputSummary.operation),
      contentChars: numberValue(payload.contentChars) ?? numberValue(inputSummary.contentChars) ?? numberValue(inputSummary.contentLength),
      noteChars: numberValue(payload.noteChars) ?? numberValue(inputSummary.noteChars) ?? numberValue(inputSummary.noteLength),
      contentSha256: stringValue(payload.contentSha256) ?? stringValue(inputSummary.contentSha256),
      noteSha256: stringValue(payload.noteSha256) ?? stringValue(inputSummary.noteSha256),
      errorCode: errorCode(payload) ?? stringValue(error.code),
    });
  }
  if (type === "writeback_requested" || type === "writeback_written" || type === "writeback_blocked") {
    const result = recordValue(payload.result);
    return compactObject({
      operation: stringValue(payload.operation) ?? stringValue(result.operation),
      status: stringValue(payload.status) ?? stringValue(result.status),
      target: stringValue(payload.target) ?? stringValue(result.target),
      errorCode: errorCode(payload) ?? errorCode(result),
    });
  }
  if (type === "action_request_resolved") {
    return compactObject({
      requestId: stringValue(payload.requestId),
      actionName: stringValue(payload.actionName),
      resolution: stringValue(payload.resolution),
      resolvedBy: stringValue(payload.resolvedBy),
      reasonChars: numberValue(payload.reasonChars) ?? stringValue(payload.reason)?.length,
    });
  }
  return {};
}

function errorCode(payload: Record<string, unknown>): string | undefined {
  const direct = stringValue(payload.errorCode) ?? stringValue(payload.code);
  if (direct) {
    return direct;
  }
  const error = recordValue(payload.error);
  return stringValue(error.code) ?? stringValue(error.errorCode) ?? stringValue(error.name);
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) {
      result[key] = child;
    }
  }
  return result;
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function numericRecord(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: Record<string, number> = {};
  for (const [key, child] of Object.entries(value)) {
    const numeric = numberValue(child);
    if (numeric !== undefined) {
      result[key] = numeric;
    }
  }
  return result;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
