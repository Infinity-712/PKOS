import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { resolveAgentPaths, type AgentPaths } from "../config/paths.js";
import { openAgentDatabase, type AgentDatabase } from "../db/connection.js";
import { createAgentHttpServer } from "../server/httpServer.js";

type CountRow = { count: number };
type UserVersionRow = { user_version: number };
type ActionRequestRow = {
  request_id: string;
  action_name: string;
  payload_sha256: string;
  status: string;
  tool_call_id: string | null;
  result_json: string | null;
  error_json: string | null;
};
type HttpPayload = {
  requestId?: string;
  replayed?: boolean;
  result?: {
    status?: string;
    operation?: string;
    recordId?: string;
    target?: string;
    errorCode?: string;
    message?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
};

const INBOX_SECRET = "ACTION_API_FULL_INBOX_CONTENT_SHOULD_NOT_APPEAR_IN_AUDIT";
const STATE_SECRET = "ACTION_API_FULL_STATE_NOTE_SHOULD_NOT_APPEAR_IN_AUDIT";

const root = mkdtempSync(join(tmpdir(), "pkos-agent-action-api-smoke-"));
const originalDataRoot = process.env.PKOS_DATA_ROOT;
const originalDbPath = process.env.PKOS_AGENT_DB_PATH;
const originalPythonBin = process.env.PKOS_PYTHON_BIN;
const coreRoot = resolveAgentPaths().coreRoot;

try {
  testFreshMigration();
  testExistingDatabaseMigration();
  await testActionApiSuccessReplayAndSafety();
  await testCliFailureReplay();
  console.log("ACTION_API_SMOKE_OK");
} finally {
  restoreEnv();
  safeRemoveRoot(root);
}

function testFreshMigration(): void {
  const env = useDataRoot("fresh-migration");
  const db = openAgentDatabase(env);
  try {
    assertUserVersion(db, 5);
    for (const table of ["chat_sessions", "chat_messages", "generations", "agent_events", "tool_calls", "action_requests", "action_request_resolutions"]) {
      assert(tableExists(db, table), `fresh database missing table ${table}`);
    }
  } finally {
    db.close();
  }
}

function testExistingDatabaseMigration(): void {
  const env = useDataRoot("existing-migration");
  mkdirSync(dirname(env.agentDbPath), { recursive: true });
  const legacy = new DatabaseSync(env.agentDbPath);
  try {
    legacy.exec(readFileSync(join(coreRoot, "apps", "agent-server", "src", "db", "migrations", "0001_initial.sql"), "utf8"));
    legacy.exec(readFileSync(join(coreRoot, "apps", "agent-server", "src", "db", "migrations", "0002_action_requests.sql"), "utf8"));
    legacy.exec(readFileSync(join(coreRoot, "apps", "agent-server", "src", "db", "migrations", "0003_action_request_resolutions.sql"), "utf8"));
    legacy.exec("PRAGMA user_version = 3");
    legacy
      .prepare("INSERT INTO chat_sessions (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("legacy-session", "Legacy", "active", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    legacy
      .prepare("INSERT INTO chat_messages (id, session_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, NULL, ?)")
      .run("legacy-message", "legacy-session", "user", "legacy content", "2026-07-01T00:00:01.000Z");
    assertUserVersion(legacy, 3);
  } finally {
    legacy.close();
  }

  const migrated = openAgentDatabase(env);
  try {
    assertUserVersion(migrated, 5);
    assert(tableExists(migrated, "action_requests"), "existing database did not get action_requests");
    assert(tableExists(migrated, "action_request_resolutions"), "existing database did not get action_request_resolutions");
    const row = migrated.prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE id = ?").get("legacy-message") as CountRow;
    assert(row.count === 1, "existing migration lost chat message data");
  } finally {
    migrated.close();
  }
}

async function testActionApiSuccessReplayAndSafety(): Promise<void> {
  const env = useDataRoot("action-success");
  const inboxPath = join(env.dataRoot, "inbox", "items.jsonl");
  const statePath = join(env.dataRoot, "state", "snapshots.jsonl");
  const originalInbox = JSON.stringify({ id: "existing-inbox", content: "existing" }) + "\n";
  const originalState = JSON.stringify({ id: "existing-state", energy: "unknown" }) + "\n";
  writeFile(inboxPath, originalInbox);
  writeFile(statePath, originalState);

  const db = openAgentDatabase(env);
  const server = createAgentHttpServer({ db });
  try {
    const baseUrl = await listen(server);
    const inboxPayload = {
      metadata: { smoke: true },
      requestId: "req-inbox-action-1",
      tags: ["api", "smoke"],
      sourceMessageId: "msg-inbox-action-1",
      source: "manual",
      content: INBOX_SECRET,
      captureType: "note",
    };
    const inbox = await postJson(baseUrl, "/api/actions/inbox-append", inboxPayload);
    assert(inbox.status === 200, `inbox action expected 200, got ${inbox.status}`);
    assert(inbox.payload.replayed === false, "inbox first response was replayed");
    assert(inbox.payload.result?.status === "written", "inbox action did not report written");
    assert(readLines(inboxPath).length === 2, "inbox action did not append exactly one row");
    assert(readFile(inboxPath).startsWith(originalInbox), "inbox action modified existing row");
    const inboxToolCalls = countToolCalls(db, "pkos.inbox.append");

    const inboxReplay = await postJson(baseUrl, "/api/actions/inbox-append", {
      requestId: "req-inbox-action-1",
      captureType: "note",
      content: INBOX_SECRET,
      source: "manual",
      sourceMessageId: "msg-inbox-action-1",
      tags: ["api", "smoke"],
      metadata: { smoke: true },
    });
    assert(inboxReplay.status === 200, `inbox replay expected 200, got ${inboxReplay.status}`);
    assert(inboxReplay.payload.replayed === true, "inbox replay was not marked replayed");
    assert(readLines(inboxPath).length === 2, "inbox replay appended a duplicate row");
    assert(countToolCalls(db, "pkos.inbox.append") === inboxToolCalls, "inbox replay executed ToolExecutor again");

    const statePayload = {
      requestId: "req-state-action-1",
      sourceMessageId: "msg-state-action-1",
      energy: "low",
      mood: "anxious",
      body: "tired",
      context: "home",
      mode: "recovery",
      risk: { shortVideo: "low", rumination: "medium", overload: "low" },
      source: "manual",
      note: STATE_SECRET,
    };
    const state = await postJson(baseUrl, "/api/actions/state-append", statePayload);
    assert(state.status === 200, `state action expected 200, got ${state.status}`);
    assert(state.payload.result?.status === "written", "state action did not report written");
    assert(readLines(statePath).length === 2, "state action did not append exactly one row");
    const stateToolCalls = countToolCalls(db, "pkos.state.append");
    const stateReplay = await postJson(baseUrl, "/api/actions/state-append", statePayload);
    assert(stateReplay.status === 200, `state replay expected 200, got ${stateReplay.status}`);
    assert(stateReplay.payload.replayed === true, "state replay was not marked replayed");
    assert(readLines(statePath).length === 2, "state replay appended a duplicate row");
    assert(countToolCalls(db, "pkos.state.append") === stateToolCalls, "state replay executed ToolExecutor again");

    const conflict = await postJson(baseUrl, "/api/actions/inbox-append", {
      ...inboxPayload,
      content: "different content with same request id",
    });
    assert(conflict.status === 409, `conflict expected 409, got ${conflict.status}`);
    assert(conflict.payload.error?.code === "idempotency_conflict", "conflict error code mismatch");
    assert(readLines(inboxPath).length === 2, "conflict changed inbox file");

    const invalid = await postJson(baseUrl, "/api/actions/inbox-append", {
      requestId: "req-invalid-action-1",
      captureType: "not-real",
      content: "invalid must not run python",
      source: "manual",
    });
    assert(invalid.status === 400, `invalid input expected 400, got ${invalid.status}`);
    assert(countActionRequests(db, "req-invalid-action-1") === 0, "invalid input created action_request");
    assert(readLines(inboxPath).length === 2, "invalid input changed inbox file");

    const override = await postJson(baseUrl, "/api/actions/inbox-append", {
      ...inboxPayload,
      requestId: "req-override-action-1",
      toolName: "pkos.objects.write",
      command: "objects-write",
      executable: "python",
    });
    assert(override.status === 400, `override attempt expected 400, got ${override.status}`);
    assert(readLines(inboxPath).length === 2, "override attempt changed inbox file");

    const nonJson = await postRaw(baseUrl, "/api/actions/inbox-append", "not-json", "text/plain");
    assert(nonJson.status === 400, `non-json expected 400, got ${nonJson.status}`);

    const concurrentPayload = {
      requestId: "req-concurrent-action-1",
      captureType: "note",
      content: "concurrent append should happen once",
      source: "manual",
    };
    const beforeConcurrentRows = readLines(inboxPath).length;
    const beforeConcurrentToolCalls = countToolCalls(db, "pkos.inbox.append");
    const concurrent = await Promise.all([
      postJson(baseUrl, "/api/actions/inbox-append", concurrentPayload),
      postJson(baseUrl, "/api/actions/inbox-append", concurrentPayload),
    ]);
    assert(readLines(inboxPath).length === beforeConcurrentRows + 1, "concurrent request appended more than once");
    assert(countToolCalls(db, "pkos.inbox.append") === beforeConcurrentToolCalls + 1, "concurrent request executed tool more than once");
    assert(
      concurrent.filter((item) => item.status === 200 && item.payload.replayed !== true).length === 1,
      "concurrent request did not have exactly one original success",
    );

    const actionRow = getActionRequest(db, "req-inbox-action-1");
    assert(actionRow.status === "completed", "action request did not complete");
    assert(actionRow.tool_call_id, "action request missing tool_call_id");
    assert(actionRow.result_json && actionRow.result_json.indexOf(INBOX_SECRET) === -1, "action result leaked full inbox content");

    insertRunningAction(db, "req-running-action-1", actionRow.payload_sha256, "inbox-append");
    const beforeRunningRows = readLines(inboxPath).length;
    const running = await postJson(baseUrl, "/api/actions/inbox-append", {
      ...inboxPayload,
      requestId: "req-running-action-1",
    });
    assert(running.status === 409, `running request expected 409, got ${running.status}`);
    assert(running.payload.error?.code === "request_in_progress", "running request error code mismatch");
    assert(readLines(inboxPath).length === beforeRunningRows, "running request changed inbox file");

    const auditBlob = readAuditBlob(db);
    assert(auditBlob.indexOf(INBOX_SECRET) === -1, "audit leaked full inbox content");
    assert(auditBlob.indexOf(STATE_SECRET) === -1, "audit leaked full state note");
    assert(auditBlob.indexOf(sha256(INBOX_SECRET)) !== -1, "audit missing inbox content hash");
    assert(auditBlob.indexOf(sha256(STATE_SECRET)) !== -1, "audit missing state note hash");
  } finally {
    await closeServer(server);
    db.close();
  }
}

async function testCliFailureReplay(): Promise<void> {
  const env = useDataRoot("cli-failure");
  const inboxPath = join(env.dataRoot, "inbox", "items.jsonl");
  writeFile(inboxPath, "");
  process.env.PKOS_PYTHON_BIN = join(env.dataRoot, "missing-python-bin");
  const db = openAgentDatabase(env);
  const server = createAgentHttpServer({ db });
  try {
    const baseUrl = await listen(server);
    const payload = {
      requestId: "req-cli-failure-1",
      captureType: "note",
      content: "CLI failure should not be written",
      source: "manual",
    };
    const failed = await postJson(baseUrl, "/api/actions/inbox-append", payload);
    assert(failed.status === 500, `CLI failure expected 500, got ${failed.status}`);
    assert(failed.payload.result?.status === "error", "CLI failure did not return error result");
    assert(failed.payload.result?.errorCode === "cli_failed", "CLI failure error code mismatch");
    assert(readLines(inboxPath).length === 0, "CLI failure changed inbox file");
    const toolCalls = countToolCalls(db, "pkos.inbox.append");
    process.env.PKOS_PYTHON_BIN = originalPythonBin;
    const replay = await postJson(baseUrl, "/api/actions/inbox-append", payload);
    assert(replay.status === 500, `CLI failure replay expected 500, got ${replay.status}`);
    assert(replay.payload.replayed === true, "CLI failure replay not marked replayed");
    assert(countToolCalls(db, "pkos.inbox.append") === toolCalls, "failed replay re-executed tool");
  } finally {
    await closeServer(server);
    db.close();
    process.env.PKOS_PYTHON_BIN = originalPythonBin;
  }
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

async function postJson(baseUrl: string, path: string, payload: unknown): Promise<{ status: number; payload: HttpPayload }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return {
    status: response.status,
    payload: (await response.json()) as HttpPayload,
  };
}

async function postRaw(baseUrl: string, path: string, body: string, contentType: string): Promise<{ status: number; payload: HttpPayload }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
  return {
    status: response.status,
    payload: (await response.json()) as HttpPayload,
  };
}

function tableExists(db: AgentDatabase, table: string): boolean {
  const row = db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as CountRow;
  return row.count === 1;
}

function assertUserVersion(db: AgentDatabase, expected: number): void {
  const row = db.prepare("PRAGMA user_version").get() as UserVersionRow;
  assert(row.user_version === expected, `expected user_version ${expected}, got ${row.user_version}`);
}

function countToolCalls(db: AgentDatabase, toolName: string): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM tool_calls WHERE tool_name = ?").get(toolName) as CountRow;
  return row.count;
}

function countActionRequests(db: AgentDatabase, requestId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM action_requests WHERE request_id = ?").get(requestId) as CountRow;
  return row.count;
}

function getActionRequest(db: AgentDatabase, requestId: string): ActionRequestRow {
  const row = db.prepare("SELECT * FROM action_requests WHERE request_id = ?").get(requestId) as ActionRequestRow | undefined;
  if (!row) {
    throw new Error(`missing action request ${requestId}`);
  }
  return row;
}

function insertRunningAction(db: AgentDatabase, requestId: string, payloadSha256: string, actionName: string): void {
  db.prepare(
    `INSERT INTO action_requests
      (request_id, action_name, payload_sha256, status, tool_call_id, result_json, error_json, created_at, updated_at)
     VALUES (?, ?, ?, 'running', NULL, NULL, NULL, ?, ?)`,
  ).run(requestId, actionName, payloadSha256, new Date().toISOString(), new Date().toISOString());
}

function readAuditBlob(db: AgentDatabase): string {
  const actionRequests = db.prepare("SELECT * FROM action_requests ORDER BY created_at, request_id").all();
  const toolCalls = db.prepare("SELECT * FROM tool_calls ORDER BY created_at, id").all();
  const events = db.prepare("SELECT * FROM agent_events ORDER BY ts, id").all();
  return JSON.stringify({ actionRequests, toolCalls, events });
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function readFile(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function readLines(path: string): string[] {
  return readFile(path)
    .split("\n")
    .filter((line) => line.length > 0);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
  if (originalPythonBin === undefined) {
    delete process.env.PKOS_PYTHON_BIN;
  } else {
    process.env.PKOS_PYTHON_BIN = originalPythonBin;
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
