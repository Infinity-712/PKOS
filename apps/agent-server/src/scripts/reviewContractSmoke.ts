import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { handleActionRoutes } from "../actions/ActionRoutes.js";
import { runMigrations } from "../db/MigrationRunner.js";
import { EventStore } from "../events/EventStore.js";
import { handleReviewRoutes } from "../pkos/ReviewRoutes.js";
import { handleCorsPreflight } from "../server/cors.js";
import { createDefaultToolRegistry } from "../tools/ToolRegistry.js";
import { ToolExecutor } from "../tools/ToolExecutor.js";
import { reviewCorrectionTool, reviewRatingBatchTool, reviewRatingTool } from "../tools/builtin/reviewFlow.js";
import type { CliProcessRunResult } from "../writeback/CliProcessRunner.js";
import { PkosCliClient } from "../writeback/PkosCliClient.js";
import { WritebackRouter } from "../writeback/WritebackRouter.js";

const ratingInput = { requestId: "rate-1", objectId: "fact.one", rating: 4, reviewedAt: "2026-07-20T00:00:00Z", actor: "human" };
const invalidRatings: unknown[] = ["4", "4garbage", "3.9", [5], {}, null, true, 0, 6, 3.5];
const success = { objectId: "fact.one", requestId: "batch-1:one", status: "written", eventId: "event-1" };
const failure = { objectId: "fact.missing", requestId: "batch-1:missing", code: "object_not_found" };

function cliWith(payload: unknown, exitCode = 0, overrides: Partial<CliProcessRunResult> = {}) {
  let calls = 0;
  const cli = new PkosCliClient({
    paths: { coreRoot: process.cwd(), dataRoot: "unused-test-root", agentRuntimeDir: "unused-test-root", agentDbPath: ":memory:" },
    runner: { async run() {
      calls += 1;
      return { stdout: JSON.stringify(payload), stderr: "", exitCode, signal: null, timedOut: false, stdoutTruncated: false, stderrTruncated: false, ...overrides };
    } },
  });
  return { cli, calls: () => calls };
}

async function withRoutes(cli: PkosCliClient, check: (base: string) => Promise<void>) {
  const db = new DatabaseSync(":memory:");
  runMigrations(db, fileURLToPath(new URL("../db/migrations", import.meta.url)));
  const registry = createDefaultToolRegistry();
  const events = new EventStore(db);
  const executor = new ToolExecutor(db, registry, new WritebackRouter(cli), events);
  const server = createServer(async (req, res) => {
    try {
      if (handleCorsPreflight(req, res)) return;
      if (await handleReviewRoutes(req, res, { cli })) return;
      if (await handleActionRoutes(req, res, { db, registry, executor, events })) return;
      res.writeHead(404).end();
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    await check(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  }
}

async function post(base: string, path: string, body: unknown) {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, payload: await response.json() as Record<string, any> };
}

test("review tools reject nonnumeric and nonintegral grades", () => {
  for (const rating of invalidRatings) {
    assert.throws(() => reviewRatingTool.validateInput({ ...ratingInput, rating }), `accepted rating ${JSON.stringify(rating)}`);
    assert.throws(() => reviewRatingBatchTool.validateInput({ requestId: "b", reviewedAt: ratingInput.reviewedAt, items: [{ objectId: "fact.one", rating }] }));
    if (rating !== null) assert.throws(() => reviewCorrectionTool.validateInput({ requestId: "c", targetEventId: "e", correctedRating: rating, reason: "test" }));
  }
  for (const rating of [1, 2, 3, 4, 5]) assert.equal(reviewRatingTool.validateInput({ ...ratingInput, rating }).rating, rating);
  assert.equal(reviewCorrectionTool.validateInput({ requestId: "c", targetEventId: "e", correctedRating: null, reason: "undo" }).correctedRating, null);
});

test("HTTP rejects malformed grades before invoking the CLI", async () => {
  const fake = cliWith({ ok: true, status: "written" });
  await withRoutes(fake.cli, async (base) => {
    for (const [index, rating] of invalidRatings.entries()) {
      const bodies: Array<[string, Record<string, unknown>]> = [
        ["ratings", { ...ratingInput, rating }],
        ["ratings:batch", { items: [{ objectId: "fact.one", rating }], reviewedAt: ratingInput.reviewedAt }],
      ];
      if (rating !== null) bodies.push(["corrections", { targetEventId: "event-1", correctedRating: rating, reason: "test" }]);
      for (const [route, body] of bodies) {
        const response = await post(base, `/api/pkos/review/${route}`, { ...body, confirmed: true, requestId: `${route}-${index}` });
        assert.equal(response.status, 400, `${route} accepted ${JSON.stringify(rating)}`);
        assert.equal(response.payload.error.code, "invalid_rating");
      }
    }
  });
  assert.equal(fake.calls(), 0);
});

test("review domain errors survive nonzero CLI exits and HTTP mapping", async () => {
  const fake = cliWith({ ok: false, error: { code: "object_not_found", message: "object not found" } }, 1);
  await withRoutes(fake.cli, async (base) => {
    const read = await fetch(`${base}/api/pkos/review/items/fact.missing`);
    assert.equal(read.status, 404);
    assert.equal((await read.json() as any).error.code, "object_not_found");
    const write = await post(base, "/api/pkos/review/ratings", { ...ratingInput, confirmed: true });
    assert.equal(write.status, 400);
    assert.equal(write.payload.result.errorCode, "object_not_found");
  });
  const correction = cliWith({ ok: false, error: { code: "correction_target_not_latest", message: "latest rating only" } }, 1);
  const result = await correction.cli.reviewCorrect({ requestId: "c", targetEventId: "old", correctedRating: null, reason: "undo", actor: "human" });
  assert.equal(result.errorCode, "correction_target_not_latest");
});

test("review recovery-required remains an actionable HTTP conflict", async () => {
  const fake = cliWith({ ok: false, error: { code: "review_recovery_required", message: "human recovery required" } }, 1);
  await withRoutes(fake.cli, async (base) => {
    const write = await post(base, "/api/pkos/review/ratings", { ...ratingInput, confirmed: true });
    assert.equal(write.status, 409);
    assert.equal(write.payload.result.errorCode, "review_recovery_required");
  });
});

for (const code of ["review_time_regression", "data_root_git_required"]) test(`review closeout policy ${code} remains actionable`, async () => {
  const fake = cliWith({ ok: false, error: { code, message: "Review policy rejected the write" } }, 1);
  await withRoutes(fake.cli, async (base) => {
    const write = await post(base, "/api/pkos/review/ratings", { ...ratingInput, confirmed: true });
    assert.equal(write.status, 409);
    assert.equal(write.payload.result.errorCode, code);
  });
});

test("review process failures take precedence over potentially incomplete JSON", async () => {
  const failures: Partial<CliProcessRunResult>[] = [{ timedOut: true }, { stdoutTruncated: true }, { stderrTruncated: true }, { spawnError: { message: "test" } }, { exitCode: null, signal: "SIGTERM" }];
  for (const override of failures) {
    const fake = cliWith({ ok: false, error: { code: "object_not_found", message: "not reliable" } }, 1, override);
    const result = await fake.cli.reviewRate(ratingInput);
    assert.equal(result.errorCode, "timedOut" in override ? "timeout" : "cli_failed");
  }
});

for (const allFailed of [false, true]) test(`batch outcomes survive HTTP and replay (allFailed=${allFailed})`, async () => {
  const items = allFailed ? [] : [success];
  const fake = cliWith({ ok: true, status: allFailed ? "failed" : "written", batchRequestId: "batch-1", items, failures: [{ ...failure, message: "DO_NOT_LEAK_PATH_OR_CONTENT", extra: "secret" }] });
  await withRoutes(fake.cli, async (base) => {
    const body = { requestId: "batch-1", confirmed: true, items: [{ objectId: "fact.one", rating: 4 }], reviewedAt: ratingInput.reviewedAt };
    const first = await post(base, "/api/pkos/review/ratings:batch", body);
    assert.equal(first.status, allFailed ? 400 : 200);
    assert.deepEqual(first.payload.result.reviewBatch, { items, failures: [failure] });
    assert(!JSON.stringify(first.payload).includes("DO_NOT_LEAK"));
    const replay = await post(base, "/api/pkos/review/ratings:batch", body);
    assert.equal(replay.payload.replayed, true);
    assert.deepEqual(replay.payload.result, first.payload.result);
  });
  assert.equal(fake.calls(), 1);
});

test("batch outcomes reject unbounded CLI data", async () => {
  const fake = cliWith({ ok: true, status: "written", items: Array.from({ length: 101 }, () => success), failures: [] });
  const result = await fake.cli.reviewRateBatch({ requestId: "batch-1", items: [{ objectId: "fact.one", rating: 4 }], reviewedAt: ratingInput.reviewedAt, actor: "human" });
  assert.equal(result.errorCode, "cli_failed");
});

test("allowed browser and desktop origins can preflight PUT", async () => {
  await withRoutes(cliWith({}).cli, async (base) => {
    for (const origin of ["http://127.0.0.1:5173", "pkos-desktop://app"]) {
      const response = await fetch(`${base}/api/pkos/objects/fact.one`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "Content-Type" } });
      assert.equal(response.status, 204);
      assert(response.headers.get("access-control-allow-methods")?.split(",").includes("PUT"));
    }
    const rejected = await fetch(`${base}/api/pkos/objects/fact.one`, { method: "OPTIONS", headers: { Origin: "https://example.com", "Access-Control-Request-Method": "PUT" } });
    assert.equal(rejected.status, 403);
  });
});

test("object authority failures preserve validation and conflict statuses", async () => {
  for (const [code, status] of [["invalid_status_transition", 400], ["unsafe_projection_path", 400], ["object_log_invalid", 409], ["object_transaction_incomplete", 409], ["data_root_busy", 409]] as const) {
    const fake = cliWith({ ok: false, error: { code, message: code } }, 1);
    await withRoutes(fake.cli, async (base) => {
      const result = await post(base, "/api/pkos/objects", { requestId: code, confirmed: true, object: { id: "fact.test", type: "fact" } });
      assert.equal(result.status, status, code);
      assert.equal(result.payload.result.errorCode, code);
    });
  }
});
