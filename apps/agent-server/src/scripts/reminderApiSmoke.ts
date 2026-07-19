import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAgentDatabase, type AgentDatabase } from "../db/connection.js";
import { createAgentHttpServer } from "../server/httpServer.js";
import { PkosCliClient } from "../writeback/PkosCliClient.js";
import type { CliProcessRunInput, CliProcessRunResult } from "../writeback/CliProcessRunner.js";

type JsonRecord = Record<string, unknown>;
type ActionPayload = {
  ok?: boolean;
  requestId?: string;
  replayed?: boolean;
  result?: { status?: string; operation?: string; recordId?: string; target?: string; errorCode?: string; message?: string };
  error?: { code?: string; message?: string };
};
type ReminderListPayload = {
  ok?: boolean;
  count?: number;
  items?: Array<{
    id?: string;
    title?: string;
    description?: string | null;
    remindAt?: string;
    taskId?: string | null;
    source?: string;
    status?: string;
  }>;
  error?: { code?: string; message?: string };
};
type ReminderDetailPayload = {
  ok?: boolean;
  reminder?: {
    id?: string;
    title?: string;
    description?: string | null;
    remindAt?: string;
    taskId?: string | null;
    source?: string;
    status?: string;
  };
  error?: { code?: string; message?: string };
};
type TaskListPayload = { items?: Array<{ id?: string; title?: string }> };

const TITLE_SECRET = "REMINDER_API_FULL_TITLE_SHOULD_NOT_REACH_AUDIT";
const DESCRIPTION_SECRET = "REMINDER_API_FULL_DESCRIPTION_SHOULD_NOT_REACH_AUDIT";
const REASON_SECRET = "REMINDER_API_FULL_REASON_SHOULD_NOT_REACH_AUDIT";
const CHINESE_TITLE = "喝水提醒";
const CHINESE_DESCRIPTION = "提醒我收尾 PKOS 提醒验收";
const CHINESE_REASON = "已经手动确认";

const dataRoot = mkdtempSync(join(tmpdir(), "pkos-reminder-api-smoke-"));
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
  const itemsPath = join(dataRoot, "reminders", "items.jsonl");
  const actionsPath = join(dataRoot, "reminders", "actions.jsonl");

  const empty = await getJson<ReminderListPayload>(baseUrl, "/api/pkos/reminders");
  assert(empty.status === 200, `empty reminder list expected 200, got ${empty.status}`);
  assert(empty.payload.count === 0 && empty.payload.items?.length === 0, "empty reminder list was not empty");

  const createPayload = {
    requestId: "reminder-api-create-1",
    confirmed: true,
    title: TITLE_SECRET,
    description: DESCRIPTION_SECRET,
    remindAt: "2026-07-12T03:04:05+08:00",
    source: "web",
  };
  const created = await postJson<ActionPayload>(baseUrl, "/api/pkos/reminders", createPayload);
  assert(created.status === 200, `reminder create expected 200, got ${created.status}`);
  assert(created.payload.ok === true && created.payload.result?.status === "written", "reminder create did not return written");
  assert(lineCount(itemsPath) === 1, "reminder create did not append exactly one item");
  assert(lineCount(actionsPath) === 0, "reminder create appended an action unexpectedly");
  const reminderId = created.payload.result?.recordId ?? "";
  assert(reminderId, "reminder id missing from create result");

  const listed = await getJson<ReminderListPayload>(baseUrl, "/api/pkos/reminders?status=scheduled&source=web&limit=20");
  assert(listed.status === 200, `filtered reminder list expected 200, got ${listed.status}`);
  assert(listed.payload.count === 1 && listed.payload.items?.[0]?.id === reminderId, "reminder list filters failed");
  assert(listed.payload.items?.[0]?.remindAt === "2026-07-11T19:04:05Z", "reminder list did not normalize remindAt to UTC");

  const detail = await getJson<ReminderDetailPayload>(baseUrl, `/api/pkos/reminders/${encodeURIComponent(reminderId)}`);
  assert(detail.status === 200, `reminder detail expected 200, got ${detail.status}`);
  assert(detail.payload.reminder?.title === TITLE_SECRET, "reminder detail did not return title");

  const replay = await postJson<ActionPayload>(baseUrl, "/api/pkos/reminders", createPayload);
  assert(replay.status === 200, `reminder create replay expected 200, got ${replay.status}`);
  assert(replay.payload.replayed === true, "reminder create replay was not marked replayed");
  assert(lineCount(itemsPath) === 1, "reminder create replay appended duplicate item");

  const webShaped = await postJson<ActionPayload>(baseUrl, "/api/pkos/reminders", {
    requestId: "reminder-api-web-shaped-blank-task",
    confirmed: true,
    title: "Web shaped blank task reminder",
    description: "",
    remindAt: "2026-07-14T18:00:00.000Z",
    source: "web",
    taskId: "",
  });
  assert(webShaped.status === 200, `web-shaped reminder create expected 200, got ${webShaped.status}`);
  assert(webShaped.payload.ok === true && webShaped.payload.result?.status === "written", "web-shaped reminder create did not return written");
  assert(lineCount(itemsPath) === 2, "web-shaped reminder create did not append exactly one item");
  const webShapedId = webShaped.payload.result?.recordId ?? "";
  const webShapedDetail = await getJson<ReminderDetailPayload>(baseUrl, `/api/pkos/reminders/${encodeURIComponent(webShapedId)}`);
  assert(webShapedDetail.status === 200, `web-shaped reminder detail expected 200, got ${webShapedDetail.status}`);
  assert(webShapedDetail.payload.reminder?.remindAt === "2026-07-14T18:00:00Z", "web-shaped reminder did not store expected UTC remindAt");
  assert(webShapedDetail.payload.reminder?.taskId === null, "web-shaped blank taskId was not stored as null");

  const localTime = await postJson<ActionPayload>(baseUrl, "/api/pkos/reminders", {
    requestId: "reminder-api-local-time-rejected",
    confirmed: true,
    title: "Local time should be rejected",
    remindAt: "2026-07-15 02:00",
    source: "web",
    taskId: "",
  });
  assert(localTime.status === 400, `timezone-less reminder create expected 400, got ${localTime.status}`);
  assert(localTime.payload.error?.code === "invalid_remind_at", "timezone-less reminder did not return invalid_remind_at");
  assert(lineCount(itemsPath) === 2, "timezone-less reminder create changed item log");

  const conflict = await postJson<ActionPayload>(baseUrl, "/api/pkos/reminders", { ...createPayload, title: "different title" });
  assert(conflict.status === 409, `reminder create conflict expected 409, got ${conflict.status}`);
  assert(conflict.payload.error?.code === "idempotency_conflict", "wrong reminder create conflict code");
  assert(lineCount(itemsPath) === 2, "reminder create conflict changed authority log");

  const noConfirm = await postJson<ActionPayload>(baseUrl, "/api/pkos/reminders", {
    ...createPayload,
    requestId: "reminder-api-no-confirm",
    confirmed: false,
  });
  assert(noConfirm.status === 403, `missing confirmation expected 403, got ${noConfirm.status}`);
  assert(lineCount(itemsPath) === 2, "missing confirmation wrote reminder item");

  const taskCreated = await postJson<ActionPayload>(baseUrl, "/api/pkos/tasks", {
    requestId: "reminder-api-task-create",
    confirmed: true,
    title: "Task with reminder",
    source: "web",
    priority: "normal",
  });
  assert(taskCreated.status === 200, `task create expected 200, got ${taskCreated.status}`);
  const tasks = await getJson<TaskListPayload>(baseUrl, "/api/pkos/tasks");
  const taskId = tasks.payload.items?.find((item) => item.title === "Task with reminder")?.id ?? "";
  assert(taskId, "task id missing for reminder task link");

  const linked = await postJson<ActionPayload>(baseUrl, "/api/pkos/reminders", {
    requestId: "reminder-api-linked",
    confirmed: true,
    title: "Task reminder",
    remindAt: "2026-07-13T00:00:00Z",
    source: "web",
    taskId,
  });
  assert(linked.status === 200, `linked reminder create expected 200, got ${linked.status}`);
  assert(lineCount(itemsPath) === 3, "linked reminder did not append item");

  const invalidTask = await postJson<ActionPayload>(baseUrl, "/api/pkos/reminders", {
    requestId: "reminder-api-invalid-task",
    confirmed: true,
    title: "Invalid task reminder",
    remindAt: "2026-07-13T00:00:00Z",
    source: "web",
    taskId: "task_missing",
  });
  assert(invalidTask.status === 400, `invalid task expected 400, got ${invalidTask.status}`);
  assert(invalidTask.payload.result?.errorCode === "task_not_found", "invalid task error code mismatch");
  assert(lineCount(itemsPath) === 3, "invalid task reminder changed item log");

  const rescheduled = await postJson<ActionPayload>(baseUrl, `/api/pkos/reminders/${encodeURIComponent(reminderId)}/reschedule`, {
    requestId: "reminder-api-reschedule",
    confirmed: true,
    remindAt: "2026-07-15T10:00:00+08:00",
    reason: REASON_SECRET,
  });
  assert(rescheduled.status === 200, `reschedule expected 200, got ${rescheduled.status}`);
  assert(lineCount(actionsPath) === 1, "reschedule did not append one action");

  const afterReschedule = await getJson<ReminderDetailPayload>(baseUrl, `/api/pkos/reminders/${encodeURIComponent(reminderId)}`);
  assert(afterReschedule.payload.reminder?.remindAt === "2026-07-15T02:00:00Z", "reschedule did not update effective remindAt");

  const acknowledged = await postJson<ActionPayload>(baseUrl, `/api/pkos/reminders/${encodeURIComponent(reminderId)}/acknowledge`, {
    requestId: "reminder-api-ack",
    confirmed: true,
    reason: CHINESE_REASON,
  });
  assert(acknowledged.status === 200, `acknowledge expected 200, got ${acknowledged.status}`);
  assert(lineCount(actionsPath) === 2, "acknowledge did not append one action");
  const afterAck = await getJson<ReminderDetailPayload>(baseUrl, `/api/pkos/reminders/${encodeURIComponent(reminderId)}`);
  assert(afterAck.payload.reminder?.status === "acknowledged", "acknowledge did not change effective status");

  const cancelled = await postJson<ActionPayload>(baseUrl, `/api/pkos/reminders/${encodeURIComponent(linked.payload.result?.recordId ?? "")}/cancel`, {
    requestId: "reminder-api-cancel",
    confirmed: true,
    reason: "no longer needed",
  });
  assert(cancelled.status === 200, `cancel expected 200, got ${cancelled.status}`);

  const invalidReminder = await postJson<ActionPayload>(baseUrl, "/api/pkos/reminders/reminder_missing/acknowledge", {
    requestId: "reminder-api-missing",
    confirmed: true,
    reason: "missing",
  });
  assert(invalidReminder.status === 400, `missing reminder expected 400, got ${invalidReminder.status}`);
  assert(invalidReminder.payload.result?.errorCode === "reminder_not_found", "missing reminder error code mismatch");

  const unicodeCreate = await postJson<ActionPayload>(baseUrl, "/api/pkos/reminders", {
    requestId: "reminder-api-unicode-create",
    confirmed: true,
    title: CHINESE_TITLE,
    description: CHINESE_DESCRIPTION,
    remindAt: "2026-07-16T08:00:00+08:00",
    source: "web",
  });
  assert(unicodeCreate.status === 200, `Chinese reminder create expected 200, got ${unicodeCreate.status}`);
  const unicodeId = unicodeCreate.payload.result?.recordId ?? "";
  const rawChinese = await getRawJson<ReminderListPayload>(baseUrl, "/api/pkos/reminders?limit=50");
  assert(rawChinese.status === 200, `raw Chinese reminder list expected 200, got ${rawChinese.status}`);
  assert(rawChinese.contentType.toLowerCase().includes("application/json; charset=utf-8"), "reminder API Content-Type did not include UTF-8 charset");
  assert(rawChinese.text.includes(CHINESE_TITLE), "raw reminder API text missing Chinese title");
  assert(rawChinese.text.includes(CHINESE_DESCRIPTION), "raw reminder API text missing Chinese description");
  const unicodeItem = rawChinese.payload.items?.find((item) => item.id === unicodeId);
  assert(unicodeItem?.title === CHINESE_TITLE, "Chinese reminder title did not roundtrip");
  assert(unicodeItem.description === CHINESE_DESCRIPTION, "Chinese reminder description did not roundtrip");

  const sqliteAudit = auditBlob(db);
  assert(sqliteAudit.indexOf(TITLE_SECRET) === -1, "SQLite audit leaked reminder title");
  assert(sqliteAudit.indexOf(DESCRIPTION_SECRET) === -1, "SQLite audit leaked reminder description");
  assert(sqliteAudit.indexOf(REASON_SECRET) === -1, "SQLite audit leaked reminder reason");
  assert(sqliteAudit.indexOf(CHINESE_TITLE) === -1, "SQLite audit leaked Chinese reminder title");
  assert(sqliteAudit.indexOf(CHINESE_DESCRIPTION) === -1, "SQLite audit leaked Chinese reminder description");
  assert(sqliteAudit.indexOf(CHINESE_REASON) === -1, "SQLite audit leaked Chinese reminder reason");
  assert(sqliteAudit.indexOf(sha256(TITLE_SECRET)) !== -1, "SQLite audit missing reminder title hash");
  assert(sqliteAudit.indexOf(sha256(DESCRIPTION_SECRET)) !== -1, "SQLite audit missing reminder description hash");
  assert(sqliteAudit.indexOf(sha256(REASON_SECRET)) !== -1, "SQLite audit missing reminder reason hash");

  await closeServer(server);
  db.close();
  db = openAgentDatabase();
  server = createAgentHttpServer({ db });
  baseUrl = await listen(server);
  rmSync(join(dataRoot, "runtime", "reminders", "current.json"), { force: true });
  const afterRestart = await getJson<ReminderListPayload>(baseUrl, "/api/pkos/reminders");
  assert(afterRestart.status === 200 && afterRestart.payload.items?.some((item) => item.id === unicodeId), "restart did not rebuild reminder current view");

  await closeServer(server);
  db.close();
  process.env.PKOS_PYTHON_BIN = join(dataRoot, "missing-python");
  db = openAgentDatabase();
  server = createAgentHttpServer({ db });
  baseUrl = await listen(server);
  const beforeCliFailure = lineCount(itemsPath);
  const cliFailure = await postJson<ActionPayload>(baseUrl, "/api/pkos/reminders", {
    requestId: "reminder-api-cli-failure",
    confirmed: true,
    title: "CLI failure should not write",
    remindAt: "2026-07-20T00:00:00Z",
    source: "web",
  });
  assert(cliFailure.status === 500, `CLI failure expected 500, got ${cliFailure.status}`);
  assert(cliFailure.payload.result?.errorCode === "cli_failed", "CLI failure error code mismatch");
  assert(lineCount(itemsPath) === beforeCliFailure, "CLI failure changed reminder authority log");

  await runCliBoundarySmoke(dataRoot);

  console.log("REMINDER_CREATE_E2E_OK");
  console.log("REMINDER_API_SMOKE_OK");
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
  if (!existsSync(path)) {
    return 0;
  }
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim()).length;
}

function auditBlob(database: AgentDatabase): string {
  const toolCalls = database.prepare("SELECT input_json, output_json, error_json FROM tool_calls").all() as JsonRecord[];
  const events = database.prepare("SELECT payload_json FROM agent_events").all() as JsonRecord[];
  const actions = database.prepare("SELECT result_json, error_json FROM action_requests").all() as JsonRecord[];
  return JSON.stringify({ toolCalls, events, actions });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function runCliBoundarySmoke(tempRoot: string): Promise<void> {
  const capturedInputs: CliProcessRunInput[] = [];
  const successRunner = {
    async run(input: CliProcessRunInput): Promise<CliProcessRunResult> {
      capturedInputs.push(input);
      return {
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify({
          ok: true,
          status: "created",
          item: { id: "reminder.cli.argv" },
          reminder: { id: "reminder.cli.argv" },
        }),
        stderr: "",
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    },
  };
  const cli = new PkosCliClient({
    paths: {
      coreRoot: process.cwd(),
      dataRoot: tempRoot,
      agentRuntimeDir: join(tempRoot, "runtime", "agent"),
      agentDbPath: join(tempRoot, "runtime", "agent", "agent.sqlite"),
    },
    runner: successRunner,
  });
  const result = await cli.reminderCreate({
    requestId: "reminder-cli-argv",
    title: "argv title",
    description: "",
    remindAt: "2026-07-14T18:00:00.000Z",
    taskId: null,
    source: "web",
    createdBy: "human",
  });
  assert(result.status === "written", "fake CLI reminder create did not return written");
  const captured = capturedInputs[0];
  assert(captured !== undefined, "fake CLI runner was not called");
  assert(captured.args.includes("reminder-create"), "CLI argv did not include reminder-create");
  assert(captured.args.includes("--remind-at"), "CLI argv did not use --remind-at");
  assert(captured.args.includes("--request-id"), "CLI argv did not use --request-id");
  assert(captured.args.indexOf("--task-id") === -1, "CLI argv included --task-id for null taskId");
  assert(captured.env.PYTHONUTF8 === "1", "CLI env did not force PYTHONUTF8");
  assert(captured.env.PYTHONIOENCODING === "utf-8", "CLI env did not force UTF-8 stdio");

  let lostResponseRuns = 0;
  const lostResponseCli = new PkosCliClient({
    paths: {
      coreRoot: process.cwd(),
      dataRoot: tempRoot,
      agentRuntimeDir: join(tempRoot, "runtime", "agent"),
      agentDbPath: join(tempRoot, "runtime", "agent", "agent.sqlite"),
    },
    runner: {
      async run(): Promise<CliProcessRunResult> {
        lostResponseRuns += 1;
        if (lostResponseRuns === 1) {
          return {
            exitCode: 0,
            signal: null,
            stdout: "not-json-after-authority-write",
            stderr: "TRACEBACK_SHOULD_NOT_REACH_RESULT",
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
          };
        }
        return {
          exitCode: 0,
          signal: null,
          stdout: JSON.stringify({
            ok: true,
            status: "replayed",
            item: { id: "reminder.cli.lost-response" },
            reminder: { id: "reminder.cli.lost-response" },
          }),
          stderr: "",
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      },
    },
  });
  const lostResponse = await lostResponseCli.reminderCreate({
    requestId: "reminder-cli-lost-response",
    title: "lost response title",
    description: "",
    remindAt: "2026-07-14T18:00:00.000Z",
    taskId: null,
    source: "web",
    createdBy: "human",
  });
  assert(lostResponse.status === "written", "lost response retry did not converge to written");
  assert(lostResponse.recordId === "reminder.cli.lost-response", "lost response retry did not return replayed reminder id");
  assert(lostResponseRuns === 2, "lost response retry did not reuse the same CLI request exactly once");

  const invalidJsonCli = new PkosCliClient({
    paths: {
      coreRoot: process.cwd(),
      dataRoot: tempRoot,
      agentRuntimeDir: join(tempRoot, "runtime", "agent"),
      agentDbPath: join(tempRoot, "runtime", "agent", "agent.sqlite"),
    },
    runner: {
      async run(): Promise<CliProcessRunResult> {
        return {
          exitCode: 0,
          signal: null,
          stdout: "not-json",
          stderr: "TRACEBACK_SHOULD_NOT_REACH_RESULT",
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      },
    },
  });
  const invalidJson = await invalidJsonCli.reminderCreate({
    requestId: "reminder-cli-invalid-json",
    title: "invalid json title",
    description: "",
    remindAt: "2026-07-14T18:00:00.000Z",
    taskId: null,
    source: "web",
    createdBy: "human",
  });
  assert(invalidJson.status === "error", "invalid JSON CLI result did not return error");
  assert(invalidJson.errorCode === "cli_invalid_json", "invalid JSON CLI result did not expose cli_invalid_json");
  assert(!invalidJson.message.includes("TRACEBACK_SHOULD_NOT_REACH_RESULT"), "invalid JSON CLI result leaked stderr");

  const nonzeroCli = new PkosCliClient({
    paths: {
      coreRoot: process.cwd(),
      dataRoot: tempRoot,
      agentRuntimeDir: join(tempRoot, "runtime", "agent"),
      agentDbPath: join(tempRoot, "runtime", "agent", "agent.sqlite"),
    },
    runner: {
      async run(): Promise<CliProcessRunResult> {
        return {
          exitCode: 2,
          signal: null,
          stdout: "",
          stderr: "TRACEBACK_SHOULD_NOT_REACH_RESULT",
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      },
    },
  });
  const nonzero = await nonzeroCli.reminderCreate({
    requestId: "reminder-cli-nonzero",
    title: "nonzero title",
    description: "",
    remindAt: "2026-07-14T18:00:00.000Z",
    taskId: null,
    source: "web",
    createdBy: "human",
  });
  assert(nonzero.status === "error", "nonzero CLI result did not return error");
  assert(nonzero.errorCode === "cli_exit_nonzero", "nonzero CLI result did not expose cli_exit_nonzero");
  assert(!nonzero.message.includes("TRACEBACK_SHOULD_NOT_REACH_RESULT"), "nonzero CLI result leaked stderr");
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
