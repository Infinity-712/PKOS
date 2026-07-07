import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

import type { AgentDatabase } from "../db/connection.js";
import { ContextBuilder } from "../context/ContextBuilder.js";
import { nowIso } from "../events/AgentEvent.js";
import { AgentRunner } from "../runtime/AgentRunner.js";

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

  if (req.method === "GET" && url.pathname.startsWith("/api/context/")) {
    const sessionId = decodeURIComponent(url.pathname.slice("/api/context/".length));
    if (!sessionId || !sessionExists(deps.db, sessionId)) {
      sendJson(res, 404, { ok: false, error: { code: "SESSION_NOT_FOUND", message: "session not found" } });
      return true;
    }
    sendJson(res, 200, { ok: true, context: deps.contextBuilder.build(sessionId) });
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

    const stream = url.searchParams.get("stream") !== "false";
    if (!stream) {
      try {
        const result = await deps.runner.run({ sessionId: body.sessionId, message: body.message });
        sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: errorPayload(error) });
      }
      return true;
    }

    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    try {
      await deps.runner.run({
        sessionId: body.sessionId,
        message: body.message,
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

function errorPayload(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    return { code: error.name || "AGENT_RUNTIME_ERROR", message: error.message };
  }
  return { code: "AGENT_RUNTIME_ERROR", message: String(error) };
}
