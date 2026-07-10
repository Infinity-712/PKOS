import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { resolveAgentPaths, type AgentPaths } from "../config/paths.js";
import { openAgentDatabase, type AgentDatabase } from "../db/connection.js";
import { createAgentHttpServer } from "../server/httpServer.js";

type CountRow = { count: number };
type HistoryPayload = {
  sessionId?: string;
  items?: Array<{
    id?: string;
    role?: string;
    content?: string;
    generationId?: string | null;
    status?: string;
    createdAt?: string;
    updatedAt?: string;
  }>;
  nextBefore?: string | null;
  error?: { code?: string; message?: string };
};

const root = mkdtempSync(join(tmpdir(), "pkos-chat-history-smoke-"));
const originalDataRoot = process.env.PKOS_DATA_ROOT;
const originalDbPath = process.env.PKOS_AGENT_DB_PATH;
const coreRoot = resolveAgentPaths().coreRoot;

try {
  await testChatHistoryReadOnlyApi();
  console.log("CHAT_HISTORY_SMOKE_OK");
} finally {
  restoreEnv();
  safeRemoveRoot(root);
}

async function testChatHistoryReadOnlyApi(): Promise<void> {
  const env = useDataRoot("history");
  const db = openAgentDatabase(env);
  seedChatHistory(db);
  const beforeCounts = counts(db);
  const server = createAgentHttpServer({ db });
  try {
    const baseUrl = await listen(server);
    const sessionA = await getJson(baseUrl, "/api/chat/sessions/session-a/messages");
    assert(sessionA.status === 200, `session A history expected 200, got ${sessionA.status}`);
    assert(sessionA.payload.sessionId === "session-a", "history returned wrong session id");
    assert(sessionA.payload.items?.length === 4, "history did not return all visible session A messages");
    assert(sessionA.payload.items?.map((item) => item.id).join(",") === "a-user-1,a-assistant-1,a-user-2,a-assistant-malformed", "history is not createdAt ascending");
    assert(sessionA.payload.items?.every((item) => item.status === "completed"), "persisted messages must be completed");
    assert(sessionA.payload.items?.[1]?.generationId === "generation-a", "assistant generationId was not exposed");
    assert(sessionA.payload.items?.[3]?.generationId === null, "malformed metadata should degrade generationId to null");
    assert(sessionA.payload.items?.[1]?.updatedAt === sessionA.payload.items?.[1]?.createdAt, "updatedAt should mirror chat_messages.created_at");
    assert(JSON.stringify(sessionA.payload).indexOf("SECRET_REASONING_SHOULD_NOT_LEAK") === -1, "history leaked reasoning/provider metadata");
    assert(JSON.stringify(sessionA.payload).indexOf("SYSTEM_INTERNAL_SHOULD_NOT_DISPLAY") === -1, "history returned non-display role content");

    const sessionB = await getJson(baseUrl, "/api/chat/sessions/session-b/messages");
    assert(sessionB.status === 200, `session B history expected 200, got ${sessionB.status}`);
    assert(sessionB.payload.items?.length === 1, "history leaked cross-session messages");
    assert(sessionB.payload.items?.[0]?.content === "B_ONLY", "session B content mismatch");

    const limited = await getJson(baseUrl, "/api/chat/sessions/session-a/messages?limit=1");
    assert(limited.status === 200, `limited history expected 200, got ${limited.status}`);
    assert(limited.payload.items?.length === 1, "limit was not applied");
    assert(limited.payload.nextBefore === limited.payload.items?.[0]?.createdAt, "limit response missing nextBefore");

    const older = await getJson(baseUrl, `/api/chat/sessions/session-a/messages?limit=2&before=${encodeURIComponent("2026-07-09T16:00:02.000Z")}`);
    assert(older.status === 200, `before history expected 200, got ${older.status}`);
    assert(older.payload.items?.map((item) => item.id).join(",") === "a-user-1,a-assistant-1", "before query did not page older messages");

    const missing = await getJson(baseUrl, "/api/chat/sessions/missing/messages");
    assert(missing.status === 404, `missing session expected 404, got ${missing.status}`);
    const invalidLimit = await getJson(baseUrl, "/api/chat/sessions/session-a/messages?limit=201");
    assert(invalidLimit.status === 400, `invalid limit expected 400, got ${invalidLimit.status}`);
    const invalidBefore = await getJson(baseUrl, "/api/chat/sessions/session-a/messages?before=not-a-date");
    assert(invalidBefore.status === 400, `invalid before expected 400, got ${invalidBefore.status}`);
    const unknownQuery = await getJson(baseUrl, "/api/chat/sessions/session-a/messages?debug=1");
    assert(unknownQuery.status === 400, `unknown query expected 400, got ${unknownQuery.status}`);
    assertCounts(db, beforeCounts, "history API changed database rows");
  } finally {
    await closeServer(server);
    db.close();
  }

  const reopened = openAgentDatabase(env);
  const reopenedServer = createAgentHttpServer({ db: reopened });
  try {
    const baseUrl = await listen(reopenedServer);
    const persisted = await getJson(baseUrl, "/api/chat/sessions/session-a/messages");
    assert(persisted.status === 200, `reopened history expected 200, got ${persisted.status}`);
    assert(persisted.payload.items?.length === 4, "history did not persist after reopening SQLite");
  } finally {
    await closeServer(reopenedServer);
    reopened.close();
  }
}

function seedChatHistory(db: AgentDatabase): void {
  db.prepare("INSERT INTO chat_sessions (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    "session-a",
    "Session A",
    "active",
    "2026-07-09T16:00:00.000Z",
    "2026-07-09T16:00:03.000Z",
  );
  db.prepare("INSERT INTO chat_sessions (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    "session-b",
    "Session B",
    "active",
    "2026-07-09T17:00:00.000Z",
    "2026-07-09T17:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO generations
      (id, session_id, status, partial_content, provider_name, model_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("generation-a", "session-a", "completed", "A_ASSISTANT", "provider", "model", "2026-07-09T16:00:01.000Z", "2026-07-09T16:00:02.000Z");
  const insert = db.prepare("INSERT INTO chat_messages (id, session_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  insert.run("a-user-1", "session-a", "user", "A_USER_1", null, "2026-07-09T16:00:00.000Z");
  insert.run(
    "a-assistant-1",
    "session-a",
    "assistant",
    "A_ASSISTANT",
    JSON.stringify({ generationId: "generation-a", reasoning_content: "SECRET_REASONING_SHOULD_NOT_LEAK" }),
    "2026-07-09T16:00:01.000Z",
  );
  insert.run("a-user-2", "session-a", "user", "A_USER_2", null, "2026-07-09T16:00:02.000Z");
  insert.run("a-system-1", "session-a", "system", "SYSTEM_INTERNAL_SHOULD_NOT_DISPLAY", null, "2026-07-09T16:00:03.000Z");
  insert.run("a-assistant-malformed", "session-a", "assistant", "A_ASSISTANT_MALFORMED", "{not-json", "2026-07-09T16:00:04.000Z");
  insert.run("b-user-1", "session-b", "user", "B_ONLY", null, "2026-07-09T17:00:00.000Z");
}

function useDataRoot(name: string): AgentPaths {
  const dataRoot = join(root, name);
  const agentDbPath = join(dataRoot, "runtime", "agent", "agent.sqlite");
  process.env.PKOS_DATA_ROOT = dataRoot;
  delete process.env.PKOS_AGENT_DB_PATH;
  return {
    coreRoot,
    dataRoot,
    agentRuntimeDir: dirname(agentDbPath),
    agentDbPath,
  };
}

async function listen(server: ReturnType<typeof createAgentHttpServer>): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: ReturnType<typeof createAgentHttpServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function getJson(baseUrl: string, path: string): Promise<{ status: number; payload: HistoryPayload }> {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    status: response.status,
    payload: (await response.json()) as HistoryPayload,
  };
}

function counts(db: AgentDatabase): Record<string, number> {
  return {
    chat_messages: countRows(db, "chat_messages"),
    agent_events: countRows(db, "agent_events"),
    generations: countRows(db, "generations"),
  };
}

function assertCounts(db: AgentDatabase, expected: Record<string, number>, message: string): void {
  const actual = counts(db);
  assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}

function countRows(db: AgentDatabase, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as CountRow;
  return row.count;
}

function restoreEnv(): void {
  if (originalDataRoot === undefined) {
    delete process.env.PKOS_DATA_ROOT;
  } else {
    process.env.PKOS_DATA_ROOT = originalDataRoot;
  }
  if (originalDbPath === undefined) {
    delete process.env.PKOS_AGENT_DB_PATH;
  } else {
    process.env.PKOS_AGENT_DB_PATH = originalDbPath;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function safeRemoveRoot(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EPERM") {
      return;
    }
    throw error;
  }
}
