import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAgentDatabase, type AgentDatabase } from "../db/connection.js";
import { createAgentHttpServer } from "../server/httpServer.js";
import { createDefaultToolRegistry } from "../tools/ToolRegistry.js";

type JsonRecord = Record<string, unknown>;
type TaskListPayload = {
  count?: number;
  items?: Array<{
    id?: string;
    title?: string;
    description?: string | null;
    status?: string;
    priority?: string;
    dueAt?: string | null;
    latestReason?: string | null;
  }>;
  error?: { code?: string; message?: string };
};
type TaskDetailPayload = {
  task?: { id?: string; title?: string; description?: string | null; status?: string; priority?: string; dueAt?: string | null; latestReason?: string | null };
  error?: { code?: string; message?: string };
};
type ActionPayload = {
  ok?: boolean;
  requestId?: string;
  replayed?: boolean;
  result?: { status?: string; operation?: string; recordId?: string; target?: string; errorCode?: string; message?: string };
  error?: { code?: string; message?: string };
};

const TITLE_SECRET = "TASK_API_FULL_TITLE_SHOULD_NOT_REACH_AUDIT";
const DESCRIPTION_SECRET = "TASK_API_FULL_DESCRIPTION_SHOULD_NOT_REACH_AUDIT";
const REASON_SECRET = "TASK_API_FULL_REASON_SHOULD_NOT_REACH_AUDIT";
const CHINESE_TITLE = "完成 PKOS v0.7 人工验收";
const CHINESE_DESCRIPTION = "验证任务 authority、状态转换、幂等和确定性重建";
const CHINESE_REASON = "开始人工验收";

const dataRoot = mkdtempSync(join(tmpdir(), "pkos-task-api-smoke-"));
const originalDataRoot = process.env.PKOS_DATA_ROOT;
const originalDbPath = process.env.PKOS_AGENT_DB_PATH;
const originalPythonBin = process.env.PKOS_PYTHON_BIN;
const originalStaleMs = process.env.PKOS_ACTION_RUNNING_STALE_MS;

process.env.PKOS_DATA_ROOT = dataRoot;
process.env.PKOS_ACTION_RUNNING_STALE_MS = "1";
delete process.env.PKOS_AGENT_DB_PATH;

let db = openAgentDatabase();
let server = createAgentHttpServer({ db });

try {
  let baseUrl = await listen(server);

  const empty = await getJson<TaskListPayload>(baseUrl, "/api/pkos/tasks");
  assert(empty.status === 200, `empty task list expected 200, got ${empty.status}`);
  assert(empty.payload.count === 0 && empty.payload.items?.length === 0, "empty task list was not empty");
  assert(!createDefaultToolRegistry().get("pkos.task.note"), "task note tool is still registered");

  const createPayload = {
    requestId: "task-api-create-1",
    confirmed: true,
    title: TITLE_SECRET,
    description: DESCRIPTION_SECRET,
    source: "web",
    tags: ["alpha", "api"],
    priority: "high",
    dueAt: "2026-07-12T03:04:05+00:00",
  };
  const created = await postJson<ActionPayload>(baseUrl, "/api/pkos/tasks", createPayload);
  assert(created.status === 200, `task create expected 200, got ${created.status}`);
  assert(created.payload.ok === true && created.payload.result?.status === "written", "task create did not return written result");
  assert(actionRequestStatus(db, "task-api-create-1") === "completed", "task create action_request did not complete");

  const itemsPath = join(dataRoot, "tasks", "items.jsonl");
  const actionsPath = join(dataRoot, "tasks", "actions.jsonl");
  assert(lineCount(itemsPath) === 1, "task create did not append exactly one item");
  assert(lineCount(actionsPath) === 0, "task create appended an action unexpectedly");
  const taskId = readFirstTaskId(itemsPath);
  assert(taskId, "task id missing from task item log");

  const listed = await getJson<TaskListPayload>(baseUrl, "/api/pkos/tasks?status=open&priority=high&tag=alpha&limit=20");
  assert(listed.status === 200, `filtered task list expected 200, got ${listed.status}`);
  assert(listed.payload.count === 1 && listed.payload.items?.[0]?.id === taskId, "task list filters failed");
  assert(listed.payload.items?.[0]?.dueAt === "2026-07-12T03:04:05Z", "task list did not normalize dueAt");

  const detail = await getJson<TaskDetailPayload>(baseUrl, `/api/pkos/tasks/${encodeURIComponent(taskId)}`);
  assert(detail.status === 200, `task detail expected 200, got ${detail.status}`);
  assert(detail.payload.task?.title === TITLE_SECRET, "task detail did not return local title");

  const replay = await postJson<ActionPayload>(baseUrl, "/api/pkos/tasks", createPayload);
  assert(replay.status === 200, `task create replay expected 200, got ${replay.status}`);
  assert(replay.payload.replayed === true, "task create replay was not marked replayed");
  assert(lineCount(itemsPath) === 1, "task create replay appended duplicate item");

  const conflict = await postJson<ActionPayload>(baseUrl, "/api/pkos/tasks", { ...createPayload, title: "different title" });
  assert(conflict.status === 409, `task create conflict expected 409, got ${conflict.status}`);
  assert(conflict.payload.error?.code === "idempotency_conflict", "wrong task create conflict code");
  assert(lineCount(itemsPath) === 1, "task create conflict changed authority log");

  const noConfirm = await postJson<ActionPayload>(baseUrl, "/api/pkos/tasks", {
    ...createPayload,
    requestId: "task-api-no-confirm",
    confirmed: false,
  });
  assert(noConfirm.status === 403, `missing confirmation expected 403, got ${noConfirm.status}`);
  assert(lineCount(itemsPath) === 1, "missing confirmation wrote task item");

  const noteEndpoint = await postJson<ActionPayload>(baseUrl, `/api/pkos/tasks/${encodeURIComponent(taskId)}/notes`, {
    requestId: "task-api-note-removed",
    confirmed: true,
    note: "note endpoint should be removed",
  });
  assert(noteEndpoint.status === 404, `task note endpoint expected 404, got ${noteEndpoint.status}`);
  assert(lineCount(actionsPath) === 0, "removed note endpoint wrote task action");

  const transitioned = await postJson<ActionPayload>(baseUrl, `/api/pkos/tasks/${encodeURIComponent(taskId)}/transition`, {
    requestId: "task-api-transition-1",
    confirmed: true,
    targetStatus: "in_progress",
    reason: REASON_SECRET,
  });
  assert(transitioned.status === 200, `transition expected 200, got ${transitioned.status}`);
  assert(transitioned.payload.result?.status === "written", "transition did not return written");
  assert(lineCount(actionsPath) === 1, "transition did not append one action");

  const transitionReplay = await postJson<ActionPayload>(baseUrl, `/api/pkos/tasks/${encodeURIComponent(taskId)}/transition`, {
    requestId: "task-api-transition-1",
    confirmed: true,
    targetStatus: "in_progress",
    reason: REASON_SECRET,
  });
  assert(transitionReplay.status === 200, `transition replay expected 200, got ${transitionReplay.status}`);
  assert(transitionReplay.payload.replayed === true, "transition replay was not marked replayed");
  assert(lineCount(actionsPath) === 1, "transition replay appended duplicate action");

  const invalidTransition = await postJson<ActionPayload>(baseUrl, `/api/pkos/tasks/${encodeURIComponent(taskId)}/transition`, {
    requestId: "task-api-invalid-transition",
    confirmed: true,
    targetStatus: "open",
    reason: "same target becomes no-op after separate check",
  });
  assert(invalidTransition.status === 200, `same-state transition should be no-op 200, got ${invalidTransition.status}`);
  assert(lineCount(actionsPath) === 2, "in_progress -> open should append a valid reopen action");

  const done = await postJson<ActionPayload>(baseUrl, `/api/pkos/tasks/${encodeURIComponent(taskId)}/transition`, {
    requestId: "task-api-done",
    confirmed: true,
    targetStatus: "done",
    reason: "done manually",
  });
  assert(done.status === 200, `done transition expected 200, got ${done.status}`);
  const invalidFromDone = await postJson<ActionPayload>(baseUrl, `/api/pkos/tasks/${encodeURIComponent(taskId)}/transition`, {
    requestId: "task-api-invalid-from-done",
    confirmed: true,
    targetStatus: "cancelled",
    reason: "invalid after done",
  });
  assert(invalidFromDone.status === 400, `invalid transition expected 400, got ${invalidFromDone.status}`);
  assert(invalidFromDone.payload.result?.errorCode === "invalid_transition", "invalid transition error code mismatch");

  seedStaleRunning(db, taskId);
  const indeterminate = await postJson<ActionPayload>(baseUrl, `/api/pkos/tasks/${encodeURIComponent(taskId)}/transition`, {
    requestId: "task-api-stale-running",
    confirmed: true,
    targetStatus: "open",
    reason: "stale transition",
  });
  assert(indeterminate.status === 409, `stale running expected 409, got ${indeterminate.status}`);
  assert(indeterminate.payload.error?.code === "request_indeterminate", "stale running did not become indeterminate");

  const chineseCreate = await postJson<ActionPayload>(baseUrl, "/api/pkos/tasks", {
    requestId: "task-api-unicode-create",
    confirmed: true,
    title: CHINESE_TITLE,
    description: CHINESE_DESCRIPTION,
    source: "web",
    tags: ["unicode"],
    priority: "normal",
    dueAt: "2026-07-15T10:00:00.000Z",
  });
  assert(chineseCreate.status === 200, `Chinese task create expected 200, got ${chineseCreate.status}`);
  const chineseTaskId = chineseCreate.payload.result?.recordId ?? "";
  assert(chineseTaskId, "Chinese task id missing");
  const chineseTransition = await postJson<ActionPayload>(baseUrl, `/api/pkos/tasks/${encodeURIComponent(chineseTaskId)}/transition`, {
    requestId: "task-api-unicode-transition",
    confirmed: true,
    targetStatus: "in_progress",
    reason: CHINESE_REASON,
  });
  assert(chineseTransition.status === 200, `Chinese transition expected 200, got ${chineseTransition.status}`);
  const rawChineseList = await getRawJson<TaskListPayload>(baseUrl, "/api/pkos/tasks?limit=50");
  assert(rawChineseList.status === 200, `raw Chinese task list expected 200, got ${rawChineseList.status}`);
  assert(rawChineseList.contentType.toLowerCase().includes("application/json; charset=utf-8"), "task API Content-Type did not include UTF-8 charset");
  assert(rawChineseList.text.includes(CHINESE_TITLE), "raw task API text missing Chinese title");
  assert(rawChineseList.text.includes(CHINESE_DESCRIPTION), "raw task API text missing Chinese description");
  assert(rawChineseList.text.includes(CHINESE_REASON), "raw task API text missing Chinese transition reason");
  assert(!rawChineseList.text.includes("锟") && !rawChineseList.text.includes("�"), "raw task API text contains replacement mojibake");
  const rawChineseItem = rawChineseList.payload.items?.find((item) => item.id === chineseTaskId);
  assert(rawChineseItem?.title === CHINESE_TITLE, "raw task API payload changed Chinese title");
  assert(rawChineseItem.description === CHINESE_DESCRIPTION, "raw task API payload changed Chinese description");
  assert(rawChineseItem.latestReason === CHINESE_REASON, "raw task API payload changed Chinese transition reason");
  const chineseDetail = await getJson<TaskDetailPayload>(baseUrl, `/api/pkos/tasks/${encodeURIComponent(chineseTaskId)}`);
  assert(chineseDetail.payload.task?.title === CHINESE_TITLE, "Chinese API detail title did not roundtrip");
  assert(chineseDetail.payload.task?.description === CHINESE_DESCRIPTION, "Chinese API detail description did not roundtrip");
  assert(chineseDetail.payload.task?.latestReason === CHINESE_REASON, "Chinese API detail reason did not roundtrip");
  const authorityText = readFileSync(itemsPath, "utf8") + readFileSync(actionsPath, "utf8") + readFileSync(join(dataRoot, "runtime", "tasks", "current.json"), "utf8");
  assert(authorityText.includes(CHINESE_TITLE), "items/current authority missing Chinese title");
  assert(authorityText.includes(CHINESE_DESCRIPTION), "items/current authority missing Chinese description");
  assert(authorityText.includes(CHINESE_REASON), "actions/current authority missing Chinese reason");
  assert(!authorityText.includes("锟") && !authorityText.includes("�"), "authority contains mojibake replacement text");
  assert(chineseDetail.payload.task?.dueAt === "2026-07-15T10:00:00Z", "Chinese task dueAt was not stored as UTC");

  const sqliteAudit = auditBlob(db);
  assert(sqliteAudit.indexOf(TITLE_SECRET) === -1, "SQLite audit leaked task title");
  assert(sqliteAudit.indexOf(DESCRIPTION_SECRET) === -1, "SQLite audit leaked task description");
  assert(sqliteAudit.indexOf(REASON_SECRET) === -1, "SQLite audit leaked transition reason");
  assert(sqliteAudit.indexOf(CHINESE_TITLE) === -1, "SQLite audit leaked Chinese task title");
  assert(sqliteAudit.indexOf(CHINESE_DESCRIPTION) === -1, "SQLite audit leaked Chinese task description");
  assert(sqliteAudit.indexOf(CHINESE_REASON) === -1, "SQLite audit leaked Chinese transition reason");
  assert(sqliteAudit.indexOf(sha256(TITLE_SECRET)) !== -1, "SQLite audit missing title hash");
  assert(sqliteAudit.indexOf(sha256(DESCRIPTION_SECRET)) !== -1, "SQLite audit missing description hash");
  assert(sqliteAudit.indexOf(sha256(REASON_SECRET)) !== -1, "SQLite audit missing reason hash");

  await closeServer(server);
  db.close();
  db = openAgentDatabase();
  server = createAgentHttpServer({ db });
  baseUrl = await listen(server);
  rmIfExists(join(dataRoot, "runtime", "tasks", "current.json"));
  const afterRestart = await getJson<TaskListPayload>(baseUrl, "/api/pkos/tasks");
  assert(afterRestart.status === 200 && afterRestart.payload.items?.some((item) => item.id === taskId), "restart did not rebuild task current view");
  const afterRestartChinese = afterRestart.payload.items?.find((item) => item.id === chineseTaskId);
  assert(afterRestartChinese?.title === CHINESE_TITLE, "restart changed Chinese task title");
  assert(afterRestartChinese.description === CHINESE_DESCRIPTION, "restart changed Chinese task description");
  assert(afterRestartChinese.latestReason === CHINESE_REASON, "restart changed Chinese latest reason");

  const runtimeInfo = await getJson<JsonRecord>(baseUrl, "/api/runtime-info");
  assert(runtimeInfo.status === 200 && typeof runtimeInfo.payload.runtimeFingerprint === "string", "runtime-info missing fingerprint");
  assert(existsSync(join(dataRoot, "tasks", "items.jsonl")), "task authority logs are not under PKOS_DATA_ROOT");

  await closeServer(server);
  db.close();
  process.env.PKOS_PYTHON_BIN = join(dataRoot, "missing-python");
  db = openAgentDatabase();
  server = createAgentHttpServer({ db });
  baseUrl = await listen(server);
  const cliFailure = await postJson<ActionPayload>(baseUrl, "/api/pkos/tasks", {
    ...createPayload,
    requestId: "task-api-cli-failure",
    title: "CLI failure should not write",
  });
  assert(cliFailure.status === 500, `CLI failure expected 500, got ${cliFailure.status}`);
  assert(cliFailure.payload.result?.errorCode === "cli_failed", "CLI failure error code mismatch");

  console.log("TASK_UNICODE_ROUNDTRIP_OK");
  console.log("TASK_API_SMOKE_OK");
} finally {
  await closeServer(server);
  db.close();
  restoreEnv();
  rmSync(dataRoot, { recursive: true, force: true });
}

async function listen(serverToListen: ReturnType<typeof createAgentHttpServer>): Promise<string> {
  await new Promise<void>((resolve) => {
    serverToListen.listen(0, "127.0.0.1", resolve);
  });
  const address = serverToListen.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(serverToClose: ReturnType<typeof createAgentHttpServer>): Promise<void> {
  if (!serverToClose.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    serverToClose.close((error) => (error ? reject(error) : resolve()));
  });
}

async function getJson<T>(baseUrl: string, path: string): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, payload: (await response.json()) as T };
}

async function getRawJson<T>(baseUrl: string, path: string): Promise<{ status: number; contentType: string; text: string; payload: T }> {
  const response = await fetch(`${baseUrl}${path}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    text,
    payload: JSON.parse(text) as T,
  };
}

async function postJson<T>(baseUrl: string, path: string, body: JsonRecord): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: (await response.json()) as T };
}

function lineCount(path: string): number {
  try {
    return readFileSync(path, "utf8").split("\n").filter((line) => line.trim()).length;
  } catch {
    return 0;
  }
}

function readFirstTaskId(path: string): string {
  const line = readFileSync(path, "utf8").split("\n").find((item) => item.trim());
  if (!line) {
    return "";
  }
  const item = JSON.parse(line) as { id?: string };
  return item.id ?? "";
}

function actionRequestStatus(database: AgentDatabase, requestId: string): string {
  const row = database.prepare("SELECT status FROM action_requests WHERE request_id = ?").get(requestId) as { status?: string } | undefined;
  return row?.status ?? "";
}

function seedStaleRunning(database: AgentDatabase, taskId: string): void {
  database
    .prepare(
      `INSERT INTO action_requests
        (request_id, action_name, payload_sha256, status, tool_call_id, result_json, error_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
    )
    .run(
      "task-api-stale-running",
      "pkos.task.transition",
      actionPayloadHash("pkos.task.transition", {
        requestId: "task-api-stale-running",
        taskId,
        targetStatus: "open",
        reason: "stale transition",
        createdBy: "human",
      }),
      "running",
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    );
}

function actionPayloadHash(actionName: string, toolInput: JsonRecord): string {
  return createHash("sha256").update(stableStringify({ actionName, toolInput }), "utf8").digest("hex");
}

function auditBlob(database: AgentDatabase): string {
  const toolCalls = database.prepare("SELECT input_json, output_json, error_json FROM tool_calls").all() as JsonRecord[];
  const events = database.prepare("SELECT payload_json FROM agent_events").all() as JsonRecord[];
  const actions = database.prepare("SELECT result_json, error_json FROM action_requests").all() as JsonRecord[];
  return JSON.stringify({ toolCalls, events, actions });
}

function rmIfExists(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // best effort
  }
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
    const record = value as JsonRecord;
    const result: JsonRecord = {};
    for (const key of Object.keys(record).sort()) {
      const child = sortValue(record[key]);
      if (child !== undefined) {
        result[key] = child as JsonRecord[string];
      }
    }
    return result;
  }
  return value;
}

function restoreEnv(): void {
  restore("PKOS_DATA_ROOT", originalDataRoot);
  restore("PKOS_AGENT_DB_PATH", originalDbPath);
  restore("PKOS_PYTHON_BIN", originalPythonBin);
  restore("PKOS_ACTION_RUNNING_STALE_MS", originalStaleMs);
}

function restore(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
