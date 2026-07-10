import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

import type { AgentDatabase } from "../db/connection.js";
import { ContextBuilder } from "../context/ContextBuilder.js";
import { nowIso } from "../events/AgentEvent.js";
import { AgentRunner, providerSelectionErrorToProviderError } from "../runtime/AgentRunner.js";
import { ProviderError, type ReasoningPreset } from "../providers/ProviderTypes.js";

export type ChatRouteDeps = {
  db: AgentDatabase;
  runner: AgentRunner;
  contextBuilder: ContextBuilder;
};

type ChatSessionRow = {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type ChatMessageRow = {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  metadata_json: string | null;
  created_at: string;
};

type ChatMessageHistoryItem = {
  id: string;
  role: "user" | "assistant";
  content: string;
  generationId: string | null;
  status: "completed" | "failed" | "aborted";
  createdAt: string;
  updatedAt: string;
};

type ChatMessageListOptions = {
  limit: number;
  before: string | null;
};

export async function handleChatRoutes(req: IncomingMessage, res: ServerResponse, deps: ChatRouteDeps): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (req.method === "POST" && url.pathname === "/api/chat/sessions") {
    const body = await readJsonBody(req);
    const session = createSession(deps.db, typeof body.title === "string" ? body.title : undefined);
    sendJson(res, 201, { ok: true, session });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/chat/sessions") {
    sendJson(res, 200, { ok: true, sessions: listSessions(deps.db) });
    return true;
  }

  const messagesMatch = /^\/api\/chat\/sessions\/([^/]+)\/messages$/.exec(url.pathname);
  if (req.method === "GET" && messagesMatch) {
    const sessionId = decodeURIComponent(messagesMatch[1]);
    const options = parseMessageListOptions(url);
    if (!options.ok) {
      sendJson(res, 400, { ok: false, error: { code: "INVALID_QUERY", message: options.message } });
      return true;
    }
    if (!sessionId || !sessionExists(deps.db, sessionId)) {
      sendJson(res, 404, { ok: false, error: { code: "SESSION_NOT_FOUND", message: "session not found" } });
      return true;
    }
    const items = listMessages(deps.db, sessionId, options.value);
    sendJson(res, 200, {
      sessionId,
      items,
      nextBefore: items.length === options.value.limit && items[0] ? items[0].createdAt : null,
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/chat/provider-status") {
    sendJson(res, 200, deps.runner.getProviderStatus());
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/chat/provider-profiles") {
    sendJson(res, 200, deps.runner.getProviderProfiles());
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/chat/provider-selection") {
    const body = await readJsonBody(req);
    if (typeof body.profileId !== "string" || typeof body.modelId !== "string" || !isReasoningPreset(body.reasoningPreset)) {
      sendJson(res, 400, { ok: false, error: { code: "invalid_provider_selection", message: "profileId, modelId, and reasoningPreset are required" } });
      return true;
    }
    if (hasForbiddenProviderSelectionFields(body)) {
      sendJson(res, 400, { ok: false, error: { code: "invalid_provider_selection", message: "provider selection accepts only profileId, modelId, and reasoningPreset" } });
      return true;
    }
    try {
      const status = deps.runner.setProviderSelection({
        profileId: body.profileId,
        modelId: body.modelId,
        reasoningPreset: body.reasoningPreset,
        requestedBy: "desktop",
      });
      sendJson(res, 200, status);
    } catch (error) {
      const providerError = providerSelectionErrorToProviderError(error);
      const safeError = providerError ?? error;
      const payload = errorPayload(safeError);
      sendJson(res, statusForError(payload.code, safeError), { ok: false, error: payload });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/context/")) {
    const sessionId = decodeURIComponent(url.pathname.slice("/api/context/".length));
    if (!sessionId || !sessionExists(deps.db, sessionId)) {
      sendJson(res, 404, { ok: false, error: { code: "SESSION_NOT_FOUND", message: "session not found" } });
      return true;
    }
    sendJson(res, 200, { ok: true, context: deps.contextBuilder.build(sessionId) });
    return true;
  }

  const abortMatch = /^\/api\/chat\/generations\/([^/]+)\/abort$/.exec(url.pathname);
  if (req.method === "POST" && abortMatch) {
    const generationId = decodeURIComponent(abortMatch[1]);
    const result = deps.runner.abortGeneration(generationId);
    if (result.status === "not_found") {
      sendJson(res, 404, { ok: false, error: { code: "generation_not_found", message: "generation not found" } });
      return true;
    }
    if (result.status === "terminal") {
      sendJson(res, 409, { ok: false, generationId, status: result.generation?.status, error: { code: "terminal_generation", message: "generation is already terminal" } });
      return true;
    }
    sendJson(res, result.generation?.status === "aborted" ? 202 : 200, {
      ok: true,
      generationId,
      status: result.generation?.status ?? "aborted",
      message: "abort requested; remote provider may have already processed part of the request",
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/chat/send") {
    const body = await readJsonBody(req);
    if (typeof body.sessionId !== "string" || !body.sessionId.trim()) {
      sendJson(res, 400, { ok: false, error: { code: "INVALID_SESSION_ID", message: "sessionId is required" } });
      return true;
    }
    if (typeof body.message !== "string" || !body.message.trim()) {
      sendJson(res, 400, { ok: false, error: { code: "INVALID_MESSAGE", message: "message is required" } });
      return true;
    }
    const allowExternalProvider = body.allowExternalProvider === true;
    try {
      deps.runner.preflight({ allowExternalProvider });
    } catch (error) {
      const payload = errorPayload(error);
      sendJson(res, statusForError(payload.code, error), { ok: false, error: payload });
      return true;
    }

    const stream = url.searchParams.get("stream") !== "false";
    if (!stream) {
      try {
        const result = await deps.runner.run({ sessionId: body.sessionId, message: body.message, allowExternalProvider });
        sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        const payload = errorPayload(error);
        sendJson(res, statusForError(payload.code, error), { ok: false, error: payload });
      }
      return true;
    }

    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) {
        controller.abort(new Error("client_stream_closed"));
      }
    });
    try {
      await deps.runner.run({
        sessionId: body.sessionId,
        message: body.message,
        allowExternalProvider,
        signal: controller.signal,
        onEvent: (event) => {
          res.write(JSON.stringify(event) + "\n");
        },
      });
    } catch (error) {
      res.write(JSON.stringify({ ok: false, error: errorPayload(error) }) + "\n");
    } finally {
      res.end();
    }
    return true;
  }

  return false;
}

export function createSession(db: AgentDatabase, title = "New session"): ChatSessionRow {
  const ts = nowIso();
  const session = {
    id: randomUUID(),
    title,
    status: "active",
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO chat_sessions
      (id, title, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(session.id, session.title, session.status, session.created_at, session.updated_at);
  return session;
}

export function listSessions(db: AgentDatabase): ChatSessionRow[] {
  return db
    .prepare("SELECT id, title, status, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC, id DESC")
    .all() as ChatSessionRow[];
}

export function listMessages(db: AgentDatabase, sessionId: string, options: ChatMessageListOptions = { limit: 100, before: null }): ChatMessageHistoryItem[] {
  const params: Array<string | number> = [sessionId];
  let where = "WHERE session_id = ? AND role IN ('user', 'assistant')";
  if (options.before) {
    where += " AND created_at < ?";
    params.push(options.before);
  }
  params.push(options.limit);
  const rows = db
    .prepare(`SELECT id, session_id, role, content, metadata_json, created_at FROM chat_messages ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...params) as ChatMessageRow[];
  const generationStatuses = generationStatusMap(db, sessionId);
  return rows.reverse().map((row) => {
    const metadata = parseMetadata(row.metadata_json);
    const generationId = metadata && typeof metadata.generationId === "string" ? metadata.generationId : null;
    return {
    id: row.id,
    role: row.role,
    content: row.content,
      generationId,
      status: messageStatus(row.role, generationId ? generationStatuses.get(generationId) : undefined),
      createdAt: row.created_at,
      updatedAt: row.created_at,
    };
  });
}

export function sessionExists(db: AgentDatabase, sessionId: string): boolean {
  const row = db.prepare("SELECT id FROM chat_sessions WHERE id = ?").get(sessionId) as { id: string } | undefined;
  return Boolean(row);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function parseMessageListOptions(url: URL): { ok: true; value: ChatMessageListOptions } | { ok: false; message: string } {
  for (const key of url.searchParams.keys()) {
    if (key !== "limit" && key !== "before") {
      return { ok: false, message: "messages accepts only limit and before query parameters" };
    }
  }
  const limitParam = url.searchParams.get("limit");
  let limit = 100;
  if (limitParam !== null) {
    if (!/^[1-9][0-9]*$/.test(limitParam)) {
      return { ok: false, message: "limit must be an integer between 1 and 200" };
    }
    limit = Number(limitParam);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      return { ok: false, message: "limit must be an integer between 1 and 200" };
    }
  }
  const beforeParam = url.searchParams.get("before");
  if (beforeParam !== null && (!beforeParam.trim() || Number.isNaN(Date.parse(beforeParam)))) {
    return { ok: false, message: "before must be an ISO timestamp" };
  }
  return { ok: true, value: { limit, before: beforeParam } };
}

function generationStatusMap(db: AgentDatabase, sessionId: string): Map<string, string> {
  const rows = db.prepare("SELECT id, status FROM generations WHERE session_id = ?").all(sessionId) as Array<{ id: string; status: string }>;
  return new Map(rows.map((row) => [row.id, row.status]));
}

function messageStatus(role: "user" | "assistant", generationStatus: string | undefined): "completed" | "failed" | "aborted" {
  if (role !== "assistant") {
    return "completed";
  }
  if (generationStatus === "failed" || generationStatus === "aborted") {
    return generationStatus;
  }
  return "completed";
}

function errorPayload(error: unknown): { code: string; message: string } {
  if (error instanceof ProviderError) {
    return { code: error.code, message: safeProviderErrorMessage(error.code) };
  }
  if (error instanceof Error) {
    return { code: error.name || "AGENT_RUNTIME_ERROR", message: error.message };
  }
  return { code: "AGENT_RUNTIME_ERROR", message: String(error) };
}

function statusForError(code: string, error: unknown): number {
  if (error instanceof ProviderError) {
    return error.httpStatus;
  }
  if (code === "SESSION_NOT_FOUND") {
    return 404;
  }
  return 500;
}

function safeProviderErrorMessage(code: string): string {
  if (code === "external_provider_consent_required") {
    return "external provider consent is required for this request";
  }
  if (code === "provider_not_configured") {
    return "provider is not configured";
  }
  if (code === "provider_aborted") {
    return "provider request was aborted";
  }
  return "provider request failed";
}

function hasForbiddenProviderSelectionFields(body: Record<string, unknown>): boolean {
  for (const key of Object.keys(body)) {
    if (key !== "profileId" && key !== "modelId" && key !== "reasoningPreset") {
      return true;
    }
  }
  return false;
}

function isReasoningPreset(value: unknown): value is ReasoningPreset {
  return value === "off" || value === "low" || value === "medium" || value === "high" || value === "max";
}
