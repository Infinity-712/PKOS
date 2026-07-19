import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAgentDatabase, type AgentDatabase } from "../db/connection.js";
import { createAgentHttpServer } from "../server/httpServer.js";

type JsonRecord = Record<string, unknown>;
type ActionPayload = {
  ok?: boolean;
  result?: { status?: string; recordId?: string; errorCode?: string };
};
type RuntimeNotificationPayload = {
  ok?: boolean;
  count?: number;
  notifications?: Array<{
    reminderId?: string;
    remindAt?: string;
    deliveryState?: string;
    attemptCount?: number;
  }>;
  error?: { code?: string; message?: string };
};

const dataRoot = mkdtempSync(join(tmpdir(), "pkos-reminder-scheduler-smoke-"));
const originalDataRoot = process.env.PKOS_DATA_ROOT;
const originalDbPath = process.env.PKOS_AGENT_DB_PATH;

process.env.PKOS_DATA_ROOT = dataRoot;
delete process.env.PKOS_AGENT_DB_PATH;

let db = openAgentDatabase();
let server = createAgentHttpServer({ db });

try {
  let baseUrl = await listen(server);
  const itemsPath = join(dataRoot, "reminders", "items.jsonl");
  const actionsPath = join(dataRoot, "reminders", "actions.jsonl");

  const created = await postJson<ActionPayload>(baseUrl, "/api/pkos/reminders", {
    requestId: "reminder-scheduler-create",
    confirmed: true,
    title: "Due reminder",
    description: "Runtime should surface this without editing authority.",
    remindAt: "2026-07-13T00:00:00Z",
    source: "web",
  });
  assert(created.status === 200, `create due reminder expected 200, got ${created.status}`);
  const reminderId = created.payload.result?.recordId ?? "";
  assert(reminderId, "created reminder id missing");
  const authorityItemsBeforeScan = lineCount(itemsPath);
  const authorityActionsBeforeScan = lineCount(actionsPath);

  const first = await getJson<RuntimeNotificationPayload>(baseUrl, "/api/runtime/reminder-notifications?now=2026-07-13T00:05:00Z");
  assert(first.status === 200, `first notification scan expected 200, got ${first.status}`);
  assert(first.payload.count === 1, "first notification scan did not return one due reminder");
  assert(first.payload.notifications?.[0]?.reminderId === reminderId, "first notification reminder id mismatch");
  assert(first.payload.notifications?.[0]?.deliveryState === "pending", "first notification state mismatch");
  assert(lineCount(itemsPath) === authorityItemsBeforeScan, "scheduler scan changed reminder item authority log");
  assert(lineCount(actionsPath) === authorityActionsBeforeScan, "scheduler scan changed reminder action authority log");
  assert(runtimeAttemptCount(db, reminderId) === 1, "scheduler did not create one runtime attempt");

  const second = await getJson<RuntimeNotificationPayload>(baseUrl, "/api/runtime/reminder-notifications?now=2026-07-13T00:06:00Z");
  assert(second.status === 200 && second.payload.count === 1, "second notification scan lost due reminder");
  assert(runtimeAttemptCount(db, reminderId) === 1, "duplicate scheduler scan inserted duplicate runtime attempt");

  assert(schedulerRunCount(db) >= 2, "scheduler_run events were not recorded");

  await closeServer(server);
  db.close();
  db = openAgentDatabase();
  server = createAgentHttpServer({ db });
  baseUrl = await listen(server);
  const afterRestart = await getJson<RuntimeNotificationPayload>(baseUrl, "/api/runtime/reminder-notifications?now=2026-07-13T00:07:00Z");
  assert(afterRestart.status === 200 && afterRestart.payload.count === 1, "restart did not preserve notification");
  assert(runtimeAttemptCount(db, reminderId) === 1, "restart inserted duplicate runtime attempt");

  await closeServer(server);
  db.close();
  rmSync(join(dataRoot, "runtime", "agent", "agent.sqlite"), { force: true });
  db = openAgentDatabase();
  server = createAgentHttpServer({ db });
  baseUrl = await listen(server);
  const afterDbLoss = await getJson<RuntimeNotificationPayload>(baseUrl, "/api/runtime/reminder-notifications?now=2026-07-13T00:08:00Z");
  assert(afterDbLoss.status === 200 && afterDbLoss.payload.count === 1, "SQLite runtime loss did not rediscover due reminder from authority");
  assert(runtimeAttemptCount(db, reminderId) === 1, "SQLite runtime recovery did not create one attempt");

  const ack = await postJson<ActionPayload>(baseUrl, `/api/pkos/reminders/${encodeURIComponent(reminderId)}/acknowledge`, {
    requestId: "reminder-scheduler-ack",
    confirmed: true,
    reason: "seen in runtime notification panel",
  });
  assert(ack.status === 200, `acknowledge due reminder expected 200, got ${ack.status}`);

  const afterAck = await getJson<RuntimeNotificationPayload>(baseUrl, "/api/runtime/reminder-notifications?now=2026-07-13T00:09:00Z");
  assert(afterAck.status === 200, `after ack notification scan expected 200, got ${afterAck.status}`);
  assert(afterAck.payload.count === 0, "acknowledged reminder stayed visible as pending runtime notification");

  console.log("REMINDER_SCHEDULER_SMOKE_OK");
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

function runtimeAttemptCount(database: AgentDatabase, reminderId: string): number {
  const row = database.prepare("SELECT COUNT(*) AS count FROM reminder_delivery_attempts WHERE reminder_id = ?").get(reminderId) as { count?: number };
  return row.count ?? 0;
}

function schedulerRunCount(database: AgentDatabase): number {
  const rows = database.prepare("SELECT payload_json FROM agent_events WHERE type = 'scheduler_run'").all() as Array<{ payload_json: string }>;
  return rows.filter((row) => row.payload_json.includes("reminder_scheduler")).length;
}

function restoreEnv(): void {
  restore("PKOS_DATA_ROOT", originalDataRoot);
  restore("PKOS_AGENT_DB_PATH", originalDbPath);
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
