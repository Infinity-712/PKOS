import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

import type { AgentDatabase } from "../db/connection.js";
import { createAgentEvent } from "../events/AgentEvent.js";
import { EventStore } from "../events/EventStore.js";
import { sendJson } from "../server/chatRoutes.js";
import { ToolExecutor } from "../tools/ToolExecutor.js";
import { ToolInputError, type RegisteredToolDefinition, type ToolExecutionContext } from "../tools/ToolTypes.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import type { WritebackResult } from "../writeback/WritebackTypes.js";
import { ActionRequestStore, ActionResolutionError, resultFromActionRow, type ActionResolution } from "./ActionRequestStore.js";

type ActionRouteDeps = {
  db: AgentDatabase;
  registry: ToolRegistry;
  executor: ToolExecutor;
  events: EventStore;
};

type ActionConfig = {
  actionName: string;
  toolName: string;
  pathname: string;
  allowedFields: Set<string>;
  normalize(input: Record<string, unknown>): ActionRequest;
};

type ActionRequest = {
  requestId: string;
  sessionId?: string;
  sourceMessageId?: string;
  toolInput: Record<string, unknown>;
};

type ActionPrepared = {
  config: ActionConfig;
  requestId: string;
  sessionId?: string;
  sourceMessageId?: string;
  validatedInput: unknown;
  payloadSha256: string;
};

const MAX_BODY_BYTES = 64 * 1024;
const MAX_REQUEST_ID_CHARS = 128;
const MAX_REFERENCE_CHARS = 128;
const MAX_CONTENT_CHARS = 16 * 1024;
const MAX_NOTE_CHARS = 8 * 1024;
const MAX_TAGS = 20;
const MAX_TAG_CHARS = 64;
const MAX_METADATA_JSON_CHARS = 4096;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const RESOLUTIONS = new Set(["confirmed_written", "confirmed_not_written", "abandoned"]);

const ACTIONS: ActionConfig[] = [
  {
    actionName: "inbox-append",
    toolName: "pkos.inbox.append",
    pathname: "/api/actions/inbox-append",
    allowedFields: new Set(["requestId", "sessionId", "sourceMessageId", "captureType", "content", "source", "status", "tags", "metadata"]),
    normalize: normalizeInboxAppend,
  },
  {
    actionName: "state-append",
    toolName: "pkos.state.append",
    pathname: "/api/actions/state-append",
    allowedFields: new Set(["requestId", "sessionId", "sourceMessageId", "energy", "mood", "body", "context", "mode", "risk", "source", "note"]),
    normalize: normalizeStateAppend,
  },
];

export async function handleActionRoutes(req: IncomingMessage, res: ServerResponse, deps: ActionRouteDeps): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const store = new ActionRequestStore(deps.db);

  if (url.pathname === "/api/actions/requests") {
    if (req.method !== "GET") {
      sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "route not found" } });
      return true;
    }
    const status = url.searchParams.get("status") ?? undefined;
    const before = url.searchParams.get("before") ?? undefined;
    const limit = parseLimit(url.searchParams.get("limit"));
    sendJson(res, 200, { ok: true, requests: store.list({ status, before, limit }) });
    return true;
  }

  const detailMatch = /^\/api\/actions\/requests\/([^/]+)$/.exec(url.pathname);
  if (detailMatch && req.method === "GET") {
    const requestId = decodeURIComponent(detailMatch[1]);
    const request = store.getView(requestId);
    if (!request) {
      sendJson(res, 404, { ok: false, error: { code: "not_found", message: "action request not found" } });
      return true;
    }
    sendJson(res, 200, { ok: true, request });
    return true;
  }

  const resolveMatch = /^\/api\/actions\/requests\/([^/]+)\/resolve$/.exec(url.pathname);
  if (resolveMatch && req.method === "POST") {
    const requestId = decodeURIComponent(resolveMatch[1]);
    try {
      const body = await readJsonObject(req);
      const input = normalizeResolution(requestId, body);
      const resolved = store.resolve(input);
      deps.events.record(
        createAgentEvent({
          type: "action_request_resolved",
          severity: "info",
          payload: {
            requestId,
            actionName: resolved.request.actionName,
            resolution: resolved.resolution.resolution,
            resolvedBy: resolved.resolution.resolved_by,
            reasonChars: resolved.resolution.reason.length,
          },
        }),
      );
      sendJson(res, 200, {
        ok: true,
        requestId,
        resolution: resolved.resolution.resolution,
        status: resolved.request.storedStatus,
        message: resolved.result.message,
        request: resolved.request,
      });
      return true;
    } catch (error) {
      const payload = errorPayload(error);
      sendJson(res, statusForError(payload.code), { ok: false, requestId, error: payload });
      return true;
    }
  }

  const config = ACTIONS.find((item) => item.pathname === url.pathname);
  if (!config) {
    return false;
  }

  if (req.method !== "POST") {
    sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "route not found" } });
    return true;
  }

  let prepared: ActionPrepared;
  try {
    const body = await readJsonObject(req);
    prepared = prepareAction(config, body, deps.registry);
  } catch (error) {
    const payload = errorPayload(error);
    sendJson(res, 400, { ok: false, error: payload });
    return true;
  }

  const begin = store.begin(config.actionName, prepared.requestId, prepared.payloadSha256);

  if (begin.kind === "conflict") {
    sendJson(res, 409, {
      ok: false,
      requestId: prepared.requestId,
      replayed: false,
      error: {
        code: "idempotency_conflict",
        message: "requestId was already used with a different action payload",
      },
    });
    return true;
  }

  if (begin.kind === "in_progress") {
    sendJson(res, 409, {
      ok: false,
      requestId: prepared.requestId,
      replayed: false,
      error: {
        code: "request_in_progress",
        message: "requestId is already running",
      },
    });
    return true;
  }

  if (begin.kind === "indeterminate") {
    sendJson(res, 409, {
      ok: false,
      requestId: prepared.requestId,
      replayed: false,
      error: {
        code: "request_indeterminate",
        message: "The previous process ended before the write outcome was committed. Human verification is required.",
      },
    });
    return true;
  }

  if (begin.kind === "replay") {
    const result = resultFromActionRow(begin.row);
    if (!result) {
      sendJson(res, 500, {
        ok: false,
        requestId: prepared.requestId,
        replayed: true,
        error: { code: "action_result_missing", message: "stored action result is missing" },
      });
      return true;
    }
    sendJson(res, statusForResult(result), {
      ok: result.status === "written",
      requestId: prepared.requestId,
      replayed: true,
      result,
    });
    return true;
  }

  const context: ToolExecutionContext = {
    sessionId: prepared.sessionId,
    sourceMessageId: prepared.sourceMessageId,
    requestedBy: "user_explicit",
    confirmed: true,
  };
  const { toolCallId, result } = await deps.executor.executeWithAudit(config.toolName, prepared.validatedInput, context);
  store.finish(prepared.requestId, toolCallId, result);

  sendJson(res, statusForResult(result), {
    ok: result.status === "written",
    requestId: prepared.requestId,
    replayed: false,
    result,
  });
  return true;
}

function normalizeResolution(requestId: string, input: Record<string, unknown>): {
  requestId: string;
  resolution: ActionResolution;
  reason: string;
  resolvedBy: string;
} {
  assertNoForbiddenKeys(input);
  const allowed = new Set(["resolution", "reason", "resolvedBy"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new ActionInputError("invalid_input", `field is not allowed for resolve: ${key}`);
    }
  }
  const resolution = limitedString(input.resolution, "resolution", { required: true, maxChars: 64 });
  if (!RESOLUTIONS.has(resolution)) {
    throw new ActionInputError("invalid_input", "resolution is not allowed");
  }
  return {
    requestId,
    resolution: resolution as ActionResolution,
    reason: limitedString(input.reason, "reason", { required: true, maxChars: 4096 }),
    resolvedBy: limitedString(input.resolvedBy, "resolvedBy", { required: true, maxChars: 128 }),
  };
}

function prepareAction(config: ActionConfig, body: Record<string, unknown>, registry: ToolRegistry): ActionPrepared {
  assertNoForbiddenKeys(body);
  for (const key of Object.keys(body)) {
    if (!config.allowedFields.has(key)) {
      throw new ActionInputError("invalid_input", `field is not allowed for ${config.actionName}: ${key}`);
    }
  }
  const normalized = config.normalize(body);
  const tool = registry.get(config.toolName);
  if (!tool) {
    throw new ActionInputError("unknown_tool", `configured tool is missing: ${config.toolName}`);
  }
  const validatedInput = tool.validateInput(normalized.toolInput);
  const payloadSha256 = sha256(stableStringify({
    actionName: config.actionName,
    sessionId: normalized.sessionId,
    sourceMessageId: normalized.sourceMessageId,
    toolInput: validatedInput,
  }));
  return {
    config,
    requestId: normalized.requestId,
    sessionId: normalized.sessionId,
    sourceMessageId: normalized.sourceMessageId,
    validatedInput,
    payloadSha256,
  };
}

function normalizeInboxAppend(input: Record<string, unknown>): ActionRequest {
  return {
    ...normalizeBase(input),
    toolInput: {
      captureType: input.captureType,
      content: limitedString(input.content, "content", { required: true, maxChars: MAX_CONTENT_CHARS }),
      source: input.source,
      status: input.status,
      tags: normalizeTags(input.tags),
      metadata: normalizeMetadata(input.metadata),
    },
  };
}

function normalizeStateAppend(input: Record<string, unknown>): ActionRequest {
  return {
    ...normalizeBase(input),
    toolInput: {
      energy: input.energy,
      mood: input.mood,
      body: input.body,
      context: input.context,
      mode: input.mode,
      risk: normalizeRisk(input.risk),
      source: input.source,
      note: limitedString(input.note, "note", { required: false, maxChars: MAX_NOTE_CHARS }),
    },
  };
}

function normalizeBase(input: Record<string, unknown>): Omit<ActionRequest, "toolInput"> {
  const requestId = limitedString(input.requestId, "requestId", { required: true, maxChars: MAX_REQUEST_ID_CHARS });
  return {
    requestId,
    sessionId: limitedString(input.sessionId, "sessionId", { required: false, maxChars: MAX_REFERENCE_CHARS }),
    sourceMessageId: limitedString(input.sourceMessageId, "sourceMessageId", { required: false, maxChars: MAX_REFERENCE_CHARS }),
  };
}

function normalizeRisk(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isPlainRecord(value)) {
    throw new ActionInputError("invalid_input", "risk must be an object");
  }
  assertNoForbiddenKeys(value);
  const allowed = new Set(["shortVideo", "rumination", "overload"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ActionInputError("invalid_input", `field is not allowed for risk: ${key}`);
    }
  }
  return {
    shortVideo: value.shortVideo,
    rumination: value.rumination,
    overload: value.overload,
  };
}

function normalizeTags(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ActionInputError("invalid_input", "tags must be an array of strings");
  }
  if (value.length > MAX_TAGS) {
    throw new ActionInputError("invalid_input", `tags must contain at most ${MAX_TAGS} items`);
  }
  return value.map((item) => {
    if (item.length > MAX_TAG_CHARS) {
      throw new ActionInputError("invalid_input", `tags must be at most ${MAX_TAG_CHARS} characters each`);
    }
    return item;
  });
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isPlainRecord(value)) {
    throw new ActionInputError("invalid_input", "metadata must be an object");
  }
  assertNoForbiddenKeys(value);
  const json = JSON.stringify(value);
  if (json.length > MAX_METADATA_JSON_CHARS) {
    throw new ActionInputError("invalid_input", `metadata must be at most ${MAX_METADATA_JSON_CHARS} JSON characters`);
  }
  return value;
}

function limitedString(value: unknown, field: string, options: { required: true; maxChars: number }): string;
function limitedString(value: unknown, field: string, options: { required: false; maxChars: number }): string | undefined;
function limitedString(
  value: unknown,
  field: string,
  options: { required: true; maxChars: number } | { required: false; maxChars: number },
): string | undefined {
  if (value === undefined || value === null) {
    if (options.required) {
      throw new ActionInputError("invalid_input", `${field} is required`);
    }
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ActionInputError("invalid_input", `${field} must be a string`);
  }
  const trimmed = field === "content" || field === "note" ? value : value.trim();
  if (options.required && !trimmed) {
    throw new ActionInputError("invalid_input", `${field} must not be empty`);
  }
  if (trimmed.length > options.maxChars) {
    throw new ActionInputError("invalid_input", `${field} must be at most ${options.maxChars} characters`);
  }
  return trimmed || undefined;
}

async function readJsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = req.headers["content-type"];
  if (typeof contentType !== "string" || !contentType.toLowerCase().includes("application/json")) {
    throw new ActionInputError("invalid_json", "request body must be application/json");
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) {
      throw new ActionInputError("body_too_large", `request body must be at most ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(buffer);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ActionInputError("invalid_json", "request body must be valid JSON");
  }
  if (!isPlainRecord(parsed)) {
    throw new ActionInputError("invalid_json", "request body must be a JSON object");
  }
  return parsed;
}

function statusForResult(result: WritebackResult): number {
  if (result.status === "written") {
    return 200;
  }
  if (result.errorCode === "permission_denied" || result.errorCode === "confirmation_required" || result.status === "blocked") {
    return 403;
  }
  if (result.errorCode === "invalid_input") {
    return 400;
  }
  if (result.errorCode === "timeout") {
    return 504;
  }
  return 500;
}

function statusForError(code: string): number {
  if (code === "not_found") {
    return 404;
  }
  if (code === "already_resolved" || code === "invalid_resolution_state") {
    return 409;
  }
  return 400;
}

function errorPayload(error: unknown): { code: string; message: string } {
  if (error instanceof ActionResolutionError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof ActionInputError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof ToolInputError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: "invalid_input", message: error.message };
  }
  return { code: "invalid_input", message: String(error) };
}

function parseLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(1, Math.min(parsed, 200));
}

function assertNoForbiddenKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoForbiddenKeys(item);
    }
    return;
  }
  if (!isPlainRecord(value)) {
    return;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new ActionInputError("invalid_input", `field is not allowed: ${key}`);
    }
    assertNoForbiddenKeys(value[key]);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (isPlainRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = sortValue(value[key]);
      if (child !== undefined) {
        result[key] = child;
      }
    }
    return result;
  }
  return value;
}

class ActionInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ActionInputError";
  }
}
