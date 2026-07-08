import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAgentDatabase, type AgentDatabase } from "../db/connection.js";
import { createAgentHttpServer } from "../server/httpServer.js";

type JsonRecord = Record<string, unknown>;

type InboxReviewListPayload = {
  items?: Array<{
    id?: string;
    captureType?: string;
    content?: string;
    source?: string;
    tags?: string[];
    createdAt?: string;
    effectiveStatus?: string;
    latestAction?: {
      status?: string;
      reason?: string;
      createdAt?: string;
    } | null;
  }>;
  error?: { code?: string; message?: string };
};

type ActionPayload = {
  ok?: boolean;
  requestId?: string;
  replayed?: boolean;
  result?: { status?: string; operation?: string; errorCode?: string; target?: string; message?: string };
  error?: { code?: string; message?: string };
};

const CONTENT_SECRET = "INBOX_REVIEW_FULL_CONTENT_SHOULD_NOT_REACH_AUDIT";
const dataRoot = mkdtempSync(join(tmpdir(), "pkos-inbox-review-api-smoke-"));
process.env.PKOS_DATA_ROOT = dataRoot;
process.env.PKOS_ACTION_RUNNING_STALE_MS = "1";
delete process.env.PKOS_AGENT_DB_PATH;

const db = openAgentDatabase();
const server = createAgentHttpServer({ db });

try {
  seedInbox(dataRoot);
  const inboxPath = join(dataRoot, "inbox", "items.jsonl");
  const inboxBefore = readFileSync(inboxPath, "utf8");
  const baseUrl = await listen(server);

  const allItems = await getJson<InboxReviewListPayload>(baseUrl, "/api/pkos/inbox-review?limit=10");
  assert(allItems.status === 200, `list expected 200, got ${allItems.status}`);
  assert(allItems.payload.items?.length === 3, "list did not return seeded items");
  const first = allItems.payload.items?.find((item) => item.id === "inbox.review.1");
  assert(first?.captureType === "note", "list did not normalize captureType");
  assert(first.content === CONTENT_SECRET, "review list should expose content to local dashboard");

  const filtered = await getJson<InboxReviewListPayload>(baseUrl, "/api/pkos/inbox-review?status=unprocessed&source=moonlolo&tag=alpha&limit=1");
  assert(filtered.status === 200, `filtered list expected 200, got ${filtered.status}`);
  assert(filtered.payload.items?.length === 1 && filtered.payload.items[0]?.id === "inbox.review.1", "list filters failed");

  const invalidQuery = await getJson<InboxReviewListPayload>(baseUrl, "/api/pkos/inbox-review?command=mark");
  assert(invalidQuery.status === 400, "unknown query must be rejected");

  const archive = await postJson<ActionPayload>(baseUrl, "/api/pkos/inbox-review/inbox.review.1/archive", {
    requestId: "request-archive-1",
    reason: "done reviewing",
    confirmed: true,
  });
  assert(archive.status === 200, `archive expected 200, got ${archive.status}`);
  assert(archive.payload.ok === true, "archive was not ok");
  assert(archive.payload.result?.status === "written", "archive did not return written result");
  assert(actionRequestStatus(db, "request-archive-1") === "completed", "archive action_request was not completed");
  assert(rowCount(db, "tool_calls") > 0, "archive did not create tool audit rows");
  assert(rowCount(db, "agent_events") > 0, "archive did not create event audit rows");
  assert(readFileSync(inboxPath, "utf8") === inboxBefore, "archive mutated inbox/items.jsonl");

  const actionLogPath = join(dataRoot, "review", "logs", "inbox_review_actions.jsonl");
  assert(actionLineCount(actionLogPath) === 1, "archive did not append exactly one review action");

  const archived = await getJson<InboxReviewListPayload>(baseUrl, "/api/pkos/inbox-review?status=archived");
  assert(archived.payload.items?.some((item) => item.id === "inbox.review.1"), "archived item missing after archive");

  const replay = await postJson<ActionPayload>(baseUrl, "/api/pkos/inbox-review/inbox.review.1/archive", {
    requestId: "request-archive-1",
    reason: "done reviewing",
    confirmed: true,
  });
  assert(replay.status === 200, `archive replay expected 200, got ${replay.status}`);
  assert(replay.payload.replayed === true, "archive replay was not reported");
  assert(actionLineCount(actionLogPath) === 1, "archive replay appended a duplicate review action");

  const restore = await postJson<ActionPayload>(baseUrl, "/api/pkos/inbox-review/inbox.review.1/restore", {
    requestId: "request-restore-1",
    reason: "needs another look",
    confirmed: true,
  });
  assert(restore.status === 200, `restore expected 200, got ${restore.status}`);
  assert(restore.payload.result?.status === "written", "restore did not return written result");
  assert(readFileSync(inboxPath, "utf8") === inboxBefore, "restore mutated inbox/items.jsonl");
  assert(actionLineCount(actionLogPath) === 2, "restore did not append a second review action");

  const restored = await getJson<InboxReviewListPayload>(baseUrl, "/api/pkos/inbox-review?status=unprocessed");
  assert(restored.payload.items?.some((item) => item.id === "inbox.review.1"), "restored item missing from unprocessed list");

  const convertedAttempt = await postJson<ActionPayload>(baseUrl, "/api/pkos/inbox-review/inbox.review.2/archive", {
    requestId: "request-converted-attempt",
    reason: "bad",
    confirmed: true,
    status: "converted",
    toolName: "pkos.inbox_review.converted",
    command: "mark",
  });
  assert(convertedAttempt.status === 400, `converted override expected 400, got ${convertedAttempt.status}`);
  assert(actionLineCount(actionLogPath) === 2, "converted override produced a review action");

  const missingConfirmation = await postJson<ActionPayload>(baseUrl, "/api/pkos/inbox-review/inbox.review.1/archive", {
    requestId: "request-no-confirm",
    reason: "missing confirm",
  });
  assert(missingConfirmation.status === 403, `missing confirmation expected 403, got ${missingConfirmation.status}`);
  assert(actionLineCount(actionLogPath) === 2, "missing confirmation produced a review action");

  const invalidId = await postJson<ActionPayload>(baseUrl, "/api/pkos/inbox-review/inbox.missing/archive", {
    requestId: "request-missing",
    reason: "missing",
    confirmed: true,
  });
  assert(invalidId.status === 500, `invalid inbox id expected 500 from CLI failure, got ${invalidId.status}`);
  assert(invalidId.payload.result?.status !== "written", "invalid inbox id returned written");
  assert(actionLineCount(actionLogPath) === 2, "invalid inbox id produced a review action");

  const conflict = await postJson<ActionPayload>(baseUrl, "/api/pkos/inbox-review/inbox.review.1/archive", {
    requestId: "request-archive-1",
    reason: "different reason",
    confirmed: true,
  });
  assert(conflict.status === 409, `idempotency conflict expected 409, got ${conflict.status}`);
  assert(conflict.payload.error?.code === "idempotency_conflict", "wrong conflict code");

  seedStaleRunning(db);
  const indeterminate = await postJson<ActionPayload>(baseUrl, "/api/pkos/inbox-review/inbox.review.1/archive", {
    requestId: "request-stale-running",
    reason: "stale",
    confirmed: true,
  });
  assert(indeterminate.status === 409, `stale running expected 409, got ${indeterminate.status}`);
  assert(indeterminate.payload.error?.code === "request_indeterminate", "stale running did not map to indeterminate");
  assert(actionLineCount(actionLogPath) === 2, "indeterminate request produced a review action");

  const audit = await getJson<JsonRecord>(baseUrl, "/api/audit/events?limit=200");
  assert(JSON.stringify(audit.payload).indexOf(CONTENT_SECRET) === -1, "Audit API leaked inbox content");

  const sqliteAudit = auditBlob(db);
  assert(sqliteAudit.indexOf(CONTENT_SECRET) === -1, "SQLite audit tables stored inbox content");
  assert(sqliteAudit.indexOf("done reviewing") === -1, "SQLite audit tables stored full reason");
  assert(sqliteAudit.indexOf("needs another look") === -1, "SQLite audit tables stored full restore reason");

  console.log("INBOX_REVIEW_API_SMOKE_OK");
} finally {
  await closeServer(server);
  db.close();
  rmSync(dataRoot, { recursive: true, force: true });
}

function seedInbox(root: string): void {
  const items = [
    {
      schema_version: "0.5-alpha",
      id: "inbox.review.1",
      type: "inbox_item",
      capture_type: "note",
      content: CONTENT_SECRET,
      source: "moonlolo",
      status: "unprocessed",
      tags: ["alpha", "review"],
      metadata: {},
      created_at: "2026-07-01T00:00:00Z",
    },
    {
      schema_version: "0.5-alpha",
      id: "inbox.review.2",
      type: "inbox_item",
      capture_type: "thought",
      content: "converted historical item",
      source: "manual",
      status: "converted",
      tags: ["beta"],
      metadata: {},
      created_at: "2026-07-01T00:01:00Z",
    },
    {
      schema_version: "0.5-alpha",
      id: "inbox.review.3",
      type: "inbox_item",
      capture_type: "writing",
      content: "third item",
      source: "manual",
      status: "archived",
      tags: ["alpha"],
      metadata: {},
      created_at: "2026-07-01T00:02:00Z",
    },
  ];
  const path = join(root, "inbox", "items.jsonl");
  mkdirSync(join(root, "inbox"), { recursive: true });
  writeFileSync(path, items.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
}

function seedStaleRunning(database: AgentDatabase): void {
  database
    .prepare(
      `INSERT INTO action_requests
        (request_id, action_name, payload_sha256, status, tool_call_id, result_json, error_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
    )
    .run(
      "request-stale-running",
      "pkos.inbox_review.archive",
      actionPayloadHash("pkos.inbox_review.archive", { inboxId: "inbox.review.1", reason: "stale" }),
      "running",
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    );
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
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function getJson<T>(baseUrl: string, path: string): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    status: response.status,
    payload: (await response.json()) as T,
  };
}

async function postJson<T>(baseUrl: string, path: string, body: JsonRecord): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    payload: (await response.json()) as T,
  };
}

function actionLineCount(path: string): number {
  try {
    return readFileSync(path, "utf8").split("\n").filter((line) => line.trim()).length;
  } catch {
    return 0;
  }
}

function actionPayloadHash(actionName: string, toolInput: JsonRecord): string {
  return createHash("sha256").update(stableStringify({ actionName, toolInput }), "utf8").digest("hex");
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

function auditBlob(database: AgentDatabase): string {
  const toolCalls = database.prepare("SELECT input_json, output_json, error_json FROM tool_calls").all() as JsonRecord[];
  const events = database.prepare("SELECT payload_json FROM agent_events").all() as JsonRecord[];
  const actions = database.prepare("SELECT result_json, error_json FROM action_requests").all() as JsonRecord[];
  return JSON.stringify({ toolCalls, events, actions });
}

function actionRequestStatus(database: AgentDatabase, requestId: string): string {
  const row = database.prepare("SELECT status FROM action_requests WHERE request_id = ?").get(requestId) as { status?: string } | undefined;
  return row?.status ?? "";
}

function rowCount(database: AgentDatabase, tableName: "tool_calls" | "agent_events"): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count?: number } | undefined;
  return row?.count ?? 0;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
