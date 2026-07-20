import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAgentDatabase, type AgentDatabase } from "../db/connection.js";
import { createAgentHttpServer } from "../server/httpServer.js";

type JsonRecord = Record<string, unknown>;

const OBJECT_SECRET = "REVIEW_API_OBJECT_CONTENT_SHOULD_NOT_REACH_AUDIT";
const CORRECTION_REASON_SECRET = "REVIEW_API_CORRECTION_REASON_SHOULD_NOT_REACH_AUDIT";
const dataRoot = mkdtempSync(join(tmpdir(), "pkos-review-api-smoke-"));
process.env.PKOS_DATA_ROOT = dataRoot;
process.env.PKOS_ACTION_RUNNING_STALE_MS = "1";
delete process.env.PKOS_AGENT_DB_PATH;

const db = openAgentDatabase();
const server = createAgentHttpServer({ db });

try {
  seedObjects(dataRoot);
  const baseUrl = await listen(server);
  const logPath = join(dataRoot, "review", "logs", "2026-07-20.jsonl");

  const status = await getJson<JsonRecord>(baseUrl, "/api/pkos/review/status?now=2026-07-20T00:00:00Z");
  assert(status.status === 200, `status expected 200, got ${status.status}`);
  assert(status.payload.ok === true, "review status did not return ok");

  const queue = await getJson<JsonRecord>(baseUrl, "/api/pkos/review/queue?now=2026-07-20T00:00:00Z&limit=10");
  assert(queue.status === 200, `queue expected 200, got ${queue.status}`);
  assert(Array.isArray(queue.payload.due), "queue did not return due array");
  assert(JSON.stringify(queue.payload).indexOf(OBJECT_SECRET) === -1, "queue leaked object content");

  const item = await getJson<JsonRecord>(baseUrl, "/api/pkos/review/items/fact.api.one");
  assert(item.status === 200, `item expected 200, got ${item.status}`);
  assert(item.payload.item && typeof item.payload.item === "object", "item endpoint did not return item");

  const historyBefore = await getJson<JsonRecord>(baseUrl, "/api/pkos/review/items/fact.api.one/history");
  assert(historyBefore.status === 200, `history expected 200, got ${historyBefore.status}`);
  assert(Array.isArray(historyBefore.payload.events), "history did not return events");

  const noConfirm = await postJson<JsonRecord>(baseUrl, "/api/pkos/review/ratings", {
    requestId: "review-api-no-confirm",
    objectId: "fact.api.one",
    rating: 4,
    reviewedAt: "2026-07-20T00:00:00Z",
    actor: "human",
  });
  assert(noConfirm.status === 403, `missing confirmation expected 403, got ${noConfirm.status}`);
  assert(lineCount(logPath) === 0, "missing confirmation appended review authority log");

  const rate = await postJson<JsonRecord>(baseUrl, "/api/pkos/review/ratings", {
    requestId: "review-api-rate-1",
    objectId: "fact.api.one",
    rating: 4,
    reviewedAt: "2026-07-20T00:00:00Z",
    actor: "human",
    confirmed: true,
  });
  assert(rate.status === 200, `rating expected 200, got ${rate.status}`);
  assert(rate.payload.ok === true, "rating action did not return ok");
  assert((rate.payload.result as JsonRecord | undefined)?.status === "written", "rating action was not written");
  assert(lineCount(logPath) === 1, "rating did not append exactly one review event");

  const replay = await postJson<JsonRecord>(baseUrl, "/api/pkos/review/ratings", {
    requestId: "review-api-rate-1",
    objectId: "fact.api.one",
    rating: 4,
    reviewedAt: "2026-07-20T00:00:00Z",
    actor: "human",
    confirmed: true,
  });
  assert(replay.status === 200, `rating replay expected 200, got ${replay.status}`);
  assert(replay.payload.replayed === true, "rating replay was not reported by action_requests");
  assert(lineCount(logPath) === 1, "rating replay appended duplicate event");

  const conflict = await postJson<JsonRecord>(baseUrl, "/api/pkos/review/ratings", {
    requestId: "review-api-rate-1",
    objectId: "fact.api.one",
    rating: 2,
    reviewedAt: "2026-07-20T00:00:00Z",
    actor: "human",
    confirmed: true,
  });
  assert(conflict.status === 409, `rating conflict expected 409, got ${conflict.status}`);
  assert((conflict.payload.error as JsonRecord | undefined)?.code === "idempotency_conflict", "wrong rating conflict code");

  const batch = await postJson<JsonRecord>(baseUrl, "/api/pkos/review/ratings:batch", {
    requestId: "review-api-batch-1",
    items: [
      { objectId: "fact.api.batch", rating: 3 },
      { objectId: "fact.api.missing", rating: 5 },
    ],
    reviewedAt: "2026-07-20T01:00:00Z",
    actor: "human",
    confirmed: true,
  });
  assert(batch.status === 200, `batch expected 200, got ${batch.status}`);
  assert(lineCount(logPath) === 2, "batch did not append one successful item event");
  const batchReplay = await postJson<JsonRecord>(baseUrl, "/api/pkos/review/ratings:batch", {
    requestId: "review-api-batch-1",
    items: [
      { objectId: "fact.api.batch", rating: 3 },
      { objectId: "fact.api.missing", rating: 5 },
    ],
    reviewedAt: "2026-07-20T01:00:00Z",
    actor: "human",
    confirmed: true,
  });
  assert(batchReplay.status === 200, `batch replay expected 200, got ${batchReplay.status}`);
  assert(batchReplay.payload.replayed === true, "batch replay was not reported");
  assert(lineCount(logPath) === 2, "batch replay appended duplicate event");

  const historyAfter = await getJson<JsonRecord>(baseUrl, "/api/pkos/review/items/fact.api.one/history");
  const eventId = ((historyAfter.payload.events as JsonRecord[]) || []).find((event) => event.type === "review_rating")?.id;
  assert(typeof eventId === "string", "history did not expose review rating event id");

  const correction = await postJson<JsonRecord>(baseUrl, "/api/pkos/review/corrections", {
    requestId: "review-api-correction-1",
    targetEventId: eventId,
    correctedRating: 2,
    reason: CORRECTION_REASON_SECRET,
    actor: "human",
    confirmed: true,
  });
  assert(correction.status === 200, `correction expected 200, got ${correction.status}`);
  assert(lineCount(logPath) === 3, "correction did not append authority event");

  const invalid = await postJson<JsonRecord>(baseUrl, "/api/pkos/review/ratings", {
    requestId: "review-api-invalid-object",
    objectId: "fact.api.missing",
    rating: 4,
    reviewedAt: "2026-07-20T00:00:00Z",
    actor: "human",
    confirmed: true,
  });
  assert(invalid.status >= 400, "invalid object write unexpectedly succeeded");
  assert(lineCount(logPath) === 3, "invalid object appended authority event");

  seedStaleRunning(db);
  const indeterminate = await postJson<JsonRecord>(baseUrl, "/api/pkos/review/ratings", {
    requestId: "review-api-stale-running",
    objectId: "fact.api.one",
    rating: 4,
    reviewedAt: "2026-07-20T00:00:00Z",
    actor: "human",
    confirmed: true,
  });
  assert(indeterminate.status === 409, `stale running expected 409, got ${indeterminate.status}`);
  assert((indeterminate.payload.error as JsonRecord | undefined)?.code === "request_indeterminate", "stale running did not become indeterminate");

  const audit = await getJson<JsonRecord>(baseUrl, "/api/audit/events?limit=200");
  assert(JSON.stringify(audit.payload).indexOf(OBJECT_SECRET) === -1, "Audit API leaked object content");
  assert(JSON.stringify(audit.payload).indexOf(CORRECTION_REASON_SECRET) === -1, "Audit API leaked full correction reason");
  const sqliteAudit = auditBlob(db);
  assert(sqliteAudit.indexOf(OBJECT_SECRET) === -1, "SQLite audit tables stored object content");
  assert(sqliteAudit.indexOf(CORRECTION_REASON_SECRET) === -1, "SQLite audit tables stored correction reason");

  console.log("REVIEW_API_SMOKE_OK");
} finally {
  await closeServer(server);
  db.close();
  rmSync(dataRoot, { recursive: true, force: true });
}

function seedObjects(root: string): void {
  writeObject(root, "fact.api.one", "REVIEW_API_OBJECT_CONTENT_SHOULD_NOT_REACH_AUDIT");
  writeObject(root, "fact.api.batch", "batch content");
}

function writeObject(root: string, id: string, content: string): void {
  const dir = join(root, "objects", "fact");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id.replace(/\./g, "_")}.yaml`),
    [
      `id: ${id}`,
      "type: fact",
      "status: trusted",
      `title: "${id}"`,
      'summary: "seed"',
      `content: "${content}"`,
      "source:",
      '  - "seed"',
      "anchors:",
      '  - "anchor"',
      'created_at: "2026-01-01T00:00:00Z"',
      'updated_at: "2026-01-01T00:00:00Z"',
      "tags: []",
      "srs:",
      '  due_at: "2026-01-01T00:00:00Z"',
      "  interval_days: 2",
      "  ease: 2.5",
      '  last_reviewed_at: ""',
      "",
    ].join("\n"),
    "utf8",
  );
}

function seedStaleRunning(database: AgentDatabase): void {
  database
    .prepare(
      `INSERT INTO action_requests
        (request_id, action_name, payload_sha256, status, tool_call_id, result_json, error_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
    )
    .run(
      "review-api-stale-running",
      "pkos.review.rating",
      actionPayloadHash("pkos.review.rating", {
        requestId: "review-api-stale-running",
        objectId: "fact.api.one",
        rating: 4,
        reviewedAt: "2026-07-20T00:00:00.000Z",
        actor: "human",
      }),
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

function lineCount(path: string): number {
  try {
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim()).length;
  } catch {
    return 0;
  }
}

function actionPayloadHash(actionName: string, toolInput: JsonRecord): string {
  return stableSha256({
    actionName,
    toolInput,
  });
}

function auditBlob(database: AgentDatabase): string {
  const toolRows = database.prepare("SELECT input_json, output_json, error_json FROM tool_calls").all() as JsonRecord[];
  const eventRows = database.prepare("SELECT payload_json FROM agent_events").all() as JsonRecord[];
  return JSON.stringify({ toolRows, eventRows });
}

function stableSha256(value: unknown): string {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
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
        result[key] = child;
      }
    }
    return result;
  }
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
