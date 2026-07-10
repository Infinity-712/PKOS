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
  created_at: string;
  updated_at: string;
};
type HttpPayload = {
  requestId?: string;
  replayed?: boolean;
  status?: string;
  storedStatus?: string;
  effectiveStatus?: string;
  stale?: boolean;
  request?: Record<string, unknown>;
  requests?: Record<string, unknown>[];
  resolution?: string;
  result?: {
    status?: string;
    operation?: string;
    recordId?: string;
    errorCode?: string;
    message?: string;
  };
  error?: {
    code?: string;
    errorCode?: string;
    message?: string;
  };
};

const INBOX_SECRET = "ACTION_RECOVERY_FULL_INBOX_CONTENT_SHOULD_NOT_APPEAR";
const STATE_SECRET = "ACTION_RECOVERY_FULL_STATE_NOTE_SHOULD_NOT_APPEAR";
const RESOLUTION_REASON = "I checked the append-only vault manually and resolved this action.";

const root = mkdtempSync(join(tmpdir(), "pkos-agent-action-recovery-smoke-"));
const originalDataRoot = process.env.PKOS_DATA_ROOT;
const originalDbPath = process.env.PKOS_AGENT_DB_PATH;
const originalStaleMs = process.env.PKOS_ACTION_RUNNING_STALE_MS;
const coreRoot = resolveAgentPaths().coreRoot;

try {
  process.env.PKOS_ACTION_RUNNING_STALE_MS = "1000";
  testFreshMigration();
  testVersionTwoMigration();
  await testRunningAndIndeterminateApi();
  console.log("ACTION_RECOVERY_SMOKE_OK");
} finally {
  restoreEnv();
  rmSync(root, { recursive: true, force: true });
}

function testFreshMigration(): void {
  const env = useDataRoot("fresh-v3");
  const db = openAgentDatabase(env);
  try {
    assertUserVersion(db, 5);
    assert(tableExists(db, "action_request_resolutions"), "fresh DB missing action_request_resolutions");
  } finally {
    db.close();
  }
}

function testVersionTwoMigration(): void {
  const env = useDataRoot("version-two-to-three");
  mkdirSync(dirname(env.agentDbPath), { recursive: true });
  const legacy = new DatabaseSync(env.agentDbPath);
  try {
    legacy.exec(readFileSync(join(coreRoot, "apps", "agent-server", "src", "db", "migrations", "0001_initial.sql"), "utf8"));
    legacy.exec(readFileSync(join(coreRoot, "apps", "agent-server", "src", "db", "migrations", "0002_action_requests.sql"), "utf8"));
    legacy.exec("PRAGMA user_version = 2");
    legacy
      .prepare(
        `INSERT INTO action_requests
          (request_id, action_name, payload_sha256, status, tool_call_id, result_json, error_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
      )
      .run("legacy-action", "inbox-append", "legacy-hash", "running", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
  } finally {
    legacy.close();
  }

  const migrated = openAgentDatabase(env);
  try {
    assertUserVersion(migrated, 5);
    assert(tableExists(migrated, "action_request_resolutions"), "version 2 DB did not get resolutions table");
    const row = migrated.prepare("SELECT COUNT(*) AS count FROM action_requests WHERE request_id = ?").get("legacy-action") as CountRow;
    assert(row.count === 1, "version 2 migration lost action request data");
  } finally {
    migrated.close();
  }
}

async function testRunningAndIndeterminateApi(): Promise<void> {
  const env = useDataRoot("recovery-api");
  const inboxPath = join(env.dataRoot, "inbox", "items.jsonl");
  const statePath = join(env.dataRoot, "state", "snapshots.jsonl");
  writeFile(inboxPath, "");
  writeFile(statePath, "");

  const db = openAgentDatabase(env);
  const server = createAgentHttpServer({ db });
  try {
    const baseUrl = await listen(server);
    const freshPayload = inboxPayload("req-fresh-running", INBOX_SECRET);
    const freshHash = inboxPayloadHash(freshPayload);
    insertAction(db, "req-fresh-running", "inbox-append", freshHash, "running", nowIso());

    const freshRetry = await postJson(baseUrl, "/api/actions/inbox-append", freshPayload);
    assert(freshRetry.status === 409, `fresh running expected 409, got ${freshRetry.status}`);
    assert(freshRetry.payload.error?.code === "request_in_progress", "fresh running error code mismatch");

    const freshResolve = await postJson(baseUrl, "/api/actions/requests/req-fresh-running/resolve", {
      resolution: "abandoned",
      reason: RESOLUTION_REASON,
      resolvedBy: "local_user",
    });
    assert(freshResolve.status === 409, `fresh running resolve expected 409, got ${freshResolve.status}`);
    assert(freshResolve.payload.error?.code === "invalid_resolution_state", "fresh running resolve code mismatch");

    const stalePayload = inboxPayload("req-stale-written", INBOX_SECRET);
    const staleHash = inboxPayloadHash(stalePayload);
    insertAction(db, "req-stale-written", "inbox-append", staleHash, "running", staleIso());
    const rowsBeforeStaleRetry = readLines(inboxPath).length;
    const staleRetry = await postJson(baseUrl, "/api/actions/inbox-append", stalePayload);
    assert(staleRetry.status === 409, `stale running expected 409, got ${staleRetry.status}`);
    assert(staleRetry.payload.error?.code === "request_indeterminate", "stale running error code mismatch");
    assert(readLines(inboxPath).length === rowsBeforeStaleRetry, "stale retry changed inbox file");

    const detail = await getJson(baseUrl, "/api/actions/requests/req-stale-written");
    assert(detail.status === 200, `detail expected 200, got ${detail.status}`);
    assert(detail.payload.request?.storedStatus === "running", "detail storedStatus mismatch");
    assert(detail.payload.request?.effectiveStatus === "indeterminate", "detail effectiveStatus mismatch");
    assert(detail.payload.request?.stale === true, "detail stale flag mismatch");

    const list = await getJson(baseUrl, "/api/actions/requests?status=indeterminate&limit=10");
    assert(list.status === 200, `list expected 200, got ${list.status}`);
    assert((list.payload.requests ?? []).some((item) => item.requestId === "req-stale-written"), "list missing indeterminate request");
    assert(JSON.stringify(list.payload).indexOf(INBOX_SECRET) === -1, "list leaked full inbox content");

    const confirmed = await postJson(baseUrl, "/api/actions/requests/req-stale-written/resolve", {
      resolution: "confirmed_written",
      reason: RESOLUTION_REASON,
      resolvedBy: "local_user",
    });
    assert(confirmed.status === 200, `confirmed_written expected 200, got ${confirmed.status}`);
    assert(confirmed.payload.status === "completed", "confirmed_written did not complete action");
    assert(getAction(db, "req-stale-written").status === "completed", "confirmed_written did not update stored status");
    assert(countResolutions(db, "req-stale-written") === 1, "confirmed_written did not append exactly one resolution");
    assert(readLines(inboxPath).length === rowsBeforeStaleRetry, "confirmed_written changed vault");

    const replayAfterResolve = await postJson(baseUrl, "/api/actions/inbox-append", stalePayload);
    assert(replayAfterResolve.status === 200, `replay after confirmed_written expected 200, got ${replayAfterResolve.status}`);
    assert(replayAfterResolve.payload.replayed === true, "replay after resolution not marked replay");
    assert(replayAfterResolve.payload.result?.status === "written", "replay after confirmed_written not written");
    assert(countToolCalls(db, "pkos.inbox.append") === 0, "resolution replay executed Python/tool unexpectedly");

    const duplicate = await postJson(baseUrl, "/api/actions/requests/req-stale-written/resolve", {
      resolution: "abandoned",
      reason: RESOLUTION_REASON,
      resolvedBy: "local_user",
    });
    assert(duplicate.status === 409, `duplicate resolve expected 409, got ${duplicate.status}`);
    assert(duplicate.payload.error?.code === "already_resolved", "duplicate resolve code mismatch");
    assert(countResolutions(db, "req-stale-written") === 1, "duplicate resolve appended another row");

    const concurrentPayload = inboxPayload("req-concurrent-resolve", "concurrent indeterminate");
    insertAction(db, "req-concurrent-resolve", "inbox-append", inboxPayloadHash(concurrentPayload), "running", staleIso());
    const concurrent = await Promise.all([
      postJson(baseUrl, "/api/actions/requests/req-concurrent-resolve/resolve", {
        resolution: "confirmed_not_written",
        reason: RESOLUTION_REASON,
        resolvedBy: "local_user",
      }),
      postJson(baseUrl, "/api/actions/requests/req-concurrent-resolve/resolve", {
        resolution: "abandoned",
        reason: RESOLUTION_REASON,
        resolvedBy: "local_user",
      }),
    ]);
    assert(concurrent.filter((item) => item.status === 200).length === 1, "concurrent resolve did not have exactly one success");
    assert(countResolutions(db, "req-concurrent-resolve") === 1, "concurrent resolve appended more than one row");

    const notWrittenPayload = statePayload("req-not-written", STATE_SECRET);
    insertAction(db, "req-not-written", "state-append", statePayloadHash(notWrittenPayload), "running", staleIso());
    const notWritten = await postJson(baseUrl, "/api/actions/requests/req-not-written/resolve", {
      resolution: "confirmed_not_written",
      reason: RESOLUTION_REASON,
      resolvedBy: "local_user",
    });
    assert(notWritten.status === 200, `confirmed_not_written expected 200, got ${notWritten.status}`);
    assert(getAction(db, "req-not-written").status === "failed", "confirmed_not_written did not fail action");
    const notWrittenReplay = await postJson(baseUrl, "/api/actions/state-append", notWrittenPayload);
    assert(notWrittenReplay.status === 500, `not written replay expected 500, got ${notWrittenReplay.status}`);
    assert(notWrittenReplay.payload.replayed === true, "not written replay not marked replay");
    assert(notWrittenReplay.payload.result?.errorCode === "human_verified_not_written", "not written replay error code mismatch");

    const abandonedPayload = inboxPayload("req-abandoned", "abandoned content");
    insertAction(db, "req-abandoned", "inbox-append", inboxPayloadHash(abandonedPayload), "running", staleIso());
    const abandoned = await postJson(baseUrl, "/api/actions/requests/req-abandoned/resolve", {
      resolution: "abandoned",
      reason: RESOLUTION_REASON,
      resolvedBy: "local_user",
    });
    assert(abandoned.status === 200, `abandoned expected 200, got ${abandoned.status}`);
    const abandonedAction = getAction(db, "req-abandoned");
    assert(abandonedAction.status === "failed", "abandoned did not fail action");
    assert((abandonedAction.error_json ?? "").indexOf("human_abandoned_indeterminate") !== -1, "abandoned error code missing");

    const completedResolve = await postJson(baseUrl, "/api/actions/requests/req-stale-written/resolve", {
      resolution: "confirmed_written",
      reason: RESOLUTION_REASON,
      resolvedBy: "local_user",
    });
    assert(completedResolve.status === 409, `completed resolve expected 409, got ${completedResolve.status}`);
    assert(completedResolve.payload.error?.code === "already_resolved", "resolved request did not return already_resolved");

    insertAction(db, "req-completed-no-resolution", "inbox-append", "completed-hash", "completed", nowIso());
    const completedNoResolution = await postJson(baseUrl, "/api/actions/requests/req-completed-no-resolution/resolve", {
      resolution: "confirmed_written",
      reason: RESOLUTION_REASON,
      resolvedBy: "local_user",
    });
    assert(completedNoResolution.status === 409, `completed no-resolution expected 409, got ${completedNoResolution.status}`);
    assert(completedNoResolution.payload.error?.code === "invalid_resolution_state", "completed no-resolution code mismatch");

    insertAction(db, "req-failed-no-resolution", "inbox-append", "failed-hash", "failed", nowIso());
    const failedNoResolution = await postJson(baseUrl, "/api/actions/requests/req-failed-no-resolution/resolve", {
      resolution: "abandoned",
      reason: RESOLUTION_REASON,
      resolvedBy: "local_user",
    });
    assert(failedNoResolution.status === 409, `failed no-resolution expected 409, got ${failedNoResolution.status}`);
    assert(failedNoResolution.payload.error?.code === "invalid_resolution_state", "failed no-resolution code mismatch");

    const conflict = await postJson(baseUrl, "/api/actions/inbox-append", {
      ...stalePayload,
      content: "different content must conflict first",
    });
    assert(conflict.status === 409, `stale different payload expected 409, got ${conflict.status}`);
    assert(conflict.payload.error?.code === "idempotency_conflict", "stale conflict priority mismatch");

    const auditBlob = readAuditBlob(db);
    assert(auditBlob.indexOf(INBOX_SECRET) === -1, "audit leaked full inbox content");
    assert(auditBlob.indexOf(STATE_SECRET) === -1, "audit leaked full state note");
    const eventsBlob = JSON.stringify(db.prepare("SELECT * FROM agent_events").all());
    assert(eventsBlob.indexOf(RESOLUTION_REASON) === -1, "resolution event leaked full reason");
    const resolutionBlob = JSON.stringify(db.prepare("SELECT * FROM action_request_resolutions").all());
    assert(resolutionBlob.indexOf(RESOLUTION_REASON) !== -1, "resolution table did not store reason");
    assert(resolutionBlob.indexOf(INBOX_SECRET) === -1, "resolution table leaked action content");
  } finally {
    await closeServer(server);
    db.close();
  }
}

function inboxPayload(requestId: string, content: string): Record<string, unknown> {
  return {
    requestId,
    captureType: "note",
    content,
    source: "manual",
  };
}

function statePayload(requestId: string, note: string): Record<string, unknown> {
  return {
    requestId,
    energy: "low",
    mood: "anxious",
    body: "tired",
    context: "home",
    mode: "recovery",
    risk: { shortVideo: "low", rumination: "medium", overload: "low" },
    source: "manual",
    note,
  };
}

function inboxPayloadHash(payload: Record<string, unknown>): string {
  return actionPayloadHash("inbox-append", {
    captureType: payload.captureType,
    content: payload.content,
    source: payload.source,
    status: "unprocessed",
    tags: [],
    metadata: {},
  });
}

function statePayloadHash(payload: Record<string, unknown>): string {
  return actionPayloadHash("state-append", {
    energy: payload.energy,
    mood: payload.mood,
    body: payload.body,
    context: payload.context,
    mode: payload.mode,
    risk: payload.risk,
    source: payload.source,
    note: payload.note,
  });
}

function actionPayloadHash(actionName: string, toolInput: Record<string, unknown>): string {
  return sha256(stableStringify({ actionName, toolInput }));
}

function insertAction(
  db: AgentDatabase,
  requestId: string,
  actionName: string,
  payloadSha256: string,
  status: string,
  updatedAt: string,
): void {
  db.prepare(
    `INSERT INTO action_requests
      (request_id, action_name, payload_sha256, status, tool_call_id, result_json, error_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
  ).run(requestId, actionName, payloadSha256, status, updatedAt, updatedAt);
}

function getAction(db: AgentDatabase, requestId: string): ActionRequestRow {
  const row = db.prepare("SELECT * FROM action_requests WHERE request_id = ?").get(requestId) as ActionRequestRow | undefined;
  if (!row) {
    throw new Error(`missing action ${requestId}`);
  }
  return row;
}

function countResolutions(db: AgentDatabase, requestId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM action_request_resolutions WHERE request_id = ?").get(requestId) as CountRow;
  return row.count;
}

function countToolCalls(db: AgentDatabase, toolName: string): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM tool_calls WHERE tool_name = ?").get(toolName) as CountRow;
  return row.count;
}

function tableExists(db: AgentDatabase, table: string): boolean {
  const row = db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as CountRow;
  return row.count === 1;
}

function assertUserVersion(db: AgentDatabase, expected: number): void {
  const row = db.prepare("PRAGMA user_version").get() as UserVersionRow;
  assert(row.user_version === expected, `expected user_version ${expected}, got ${row.user_version}`);
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

async function getJson(baseUrl: string, path: string): Promise<{ status: number; payload: HttpPayload }> {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    status: response.status,
    payload: (await response.json()) as HttpPayload,
  };
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

function readAuditBlob(db: AgentDatabase): string {
  const actionRequests = db.prepare("SELECT * FROM action_requests ORDER BY created_at, request_id").all();
  const resolutions = db.prepare("SELECT * FROM action_request_resolutions ORDER BY created_at, request_id").all();
  const toolCalls = db.prepare("SELECT * FROM tool_calls ORDER BY created_at, id").all();
  const events = db.prepare("SELECT * FROM agent_events ORDER BY ts, id").all();
  return JSON.stringify({ actionRequests, resolutions, toolCalls, events });
}

function staleIso(): string {
  return "2026-01-01T00:00:00.000Z";
}

function nowIso(): string {
  return new Date().toISOString();
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
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      const child = sortValue(input[key]);
      if (child !== undefined) {
        result[key] = child;
      }
    }
    return result;
  }
  return value;
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
  if (originalStaleMs === undefined) {
    delete process.env.PKOS_ACTION_RUNNING_STALE_MS;
  } else {
    process.env.PKOS_ACTION_RUNNING_STALE_MS = originalStaleMs;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
