import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EMPTY_ATTEMPT,
  applySubmitResponse,
  isSuccessfulAttempt,
  resetAttempt,
} from "../features/actions/requestAttempt.js";
import {
  REVIEW_RATING_LABELS,
  buildReviewQueueQuery,
  canSubmitReviewCorrection,
  canSubmitReviewRating,
  createReviewCorrectionDraft,
  createReviewRatingDraft,
  nextReviewResultText,
  reviewContentChangedText,
  startOrReuseReviewAttempt,
} from "../features/review/reviewModel.js";
import { isReviewQueueResponse } from "../lib/guards.js";
import { formatDateTime } from "@pkos/agent-client";

const queueQuery = buildReviewQueueQuery({ now: "2026-07-20T00:00:00Z", limit: "20", objectId: "DO_NOT_PUT_OBJECT_ID_IN_QUEUE" });
assert(queueQuery === "now=2026-07-20T00%3A00%3A00Z&limit=20", "review queue query builder failed");
assert(queueQuery.indexOf("DO_NOT_PUT_OBJECT_ID_IN_QUEUE") === -1, "queue query leaked object id");

const labels = REVIEW_RATING_LABELS.map((label) => label.text).join(" | ");
assert(labels.includes("Again") && labels.includes("重来"), "Again bilingual label missing");
assert(labels.includes("Perfect") && labels.includes("完全记住"), "Perfect bilingual label missing");

const ratingDraft = createReviewRatingDraft({
  objectId: "fact.review.one",
  rating: 4,
  reviewedAt: "2026-07-20T00:00:00Z",
  actor: "human",
});
assert(ratingDraft.actionName === "pkos.review.rating", "rating action name changed");
assert(ratingDraft.endpoint === "/api/pkos/review/ratings", "rating endpoint was not fixed");
assert(ratingDraft.body.confirmed === true, "rating action was not explicit-confirmed by UI button");
assert(ratingDraft.body.objectId === "fact.review.one", "rating draft did not keep object id");

const firstAttempt = startOrReuseReviewAttempt(EMPTY_ATTEMPT, ratingDraft, () => "review-rating-request-1");
assert(firstAttempt.requestId === "review-rating-request-1", "review rating did not create requestId");
assert(firstAttempt.frozenPayload?.body.rating === 4, "review rating did not freeze rating");
const retryAttempt = startOrReuseReviewAttempt(
  firstAttempt,
  createReviewRatingDraft({
    objectId: "fact.review.one",
    rating: 2,
    reviewedAt: "2026-07-20T00:00:00Z",
    actor: "human",
  }),
  () => "review-rating-request-2",
);
assert(retryAttempt.requestId === "review-rating-request-1", "review retry changed requestId");
assert(retryAttempt.frozenPayload?.body.rating === 4, "review retry changed frozen rating");

assert(canSubmitReviewRating({ objectId: "fact.review.one", rating: 4, submitting: false }), "valid rating was not submittable");
assert(!canSubmitReviewRating({ objectId: "fact.review.one", rating: null, submitting: false }), "empty rating was submittable");
assert(!canSubmitReviewRating({ objectId: "fact.review.one", rating: 4, submitting: true }), "duplicate submit was allowed while submitting");
for (const rating of [0, 6, 3.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert(!canSubmitReviewRating({ objectId: "fact.review.one", rating, submitting: false }), `invalid rating ${rating} was submittable`);
}

const written = applySubmitResponse(retryAttempt, {
  ok: true,
  requestId: "review-rating-request-1",
  replayed: false,
  result: { status: "written", operation: "pkos.review.rating" },
});
assert(isSuccessfulAttempt(written.status), "written review rating was not successful");
assert(resetAttempt().status === "draft", "review attempt reset changed");

const correctionDraft = createReviewCorrectionDraft({
  targetEventId: "review_20260720_abc",
  correctedRating: 2,
  reason: "wrong button",
  actor: "human",
});
assert(correctionDraft.actionName === "pkos.review.correction", "correction action name changed");
assert(correctionDraft.endpoint === "/api/pkos/review/corrections", "correction endpoint was not fixed");
assert(correctionDraft.body.confirmed === true, "correction action was not explicit-confirmed by UI button");
assert(canSubmitReviewCorrection({ targetEventId: "review_20260720_abc", reason: "wrong", submitting: false }), "valid correction was not submittable");
assert(!canSubmitReviewCorrection({ targetEventId: "review_20260720_abc", reason: "", submitting: false }), "blank correction reason was submittable");

assert(formatDateTime("2026-07-20T00:00:00Z") === "2026-07-20 08:00:00", "shared Beijing time formatter regressed");
assert(nextReviewResultText({ rating: 4, dueAt: "2026-07-25T00:00:00Z", intervalDays: 5, easeFactor: 2.55 }).includes("2026-07-25 08:00:00"), "next due result did not use Beijing time");
assert((reviewContentChangedText(true) ?? "").includes("changed after the last review"), "content changed warning text missing");
assert(reviewContentChangedText(false) === null, "unchanged content produced warning");

assert(
  isReviewQueueResponse({
    ok: true,
    generatedAt: "2026-07-20T00:00:00Z",
    evaluatedAt: "2026-07-20T00:00:00Z",
    due: [],
    upcoming: [],
    counts: { due: 0, overdue: 0, upcoming: 0, legacyWarning: 0, contentChanged: 0, orphaned: 0 },
    source: {},
  }),
  "review queue response guard rejected valid payload",
);

const reviewPageSource = source("pages/ReviewPage.tsx");
assert(reviewPageSource.includes("Show answer"), "Review page does not hide answer behind Show answer");
assert(reviewPageSource.includes("Undo last rating"), "Review page does not expose correction undo affordance");
assert(reviewPageSource.includes("contentChangedSinceLastReview"), "Review page does not show content changed warning");
const forbiddenStorage = "local" + "Storage";
assert(reviewPageSource.indexOf(forbiddenStorage) === -1, "Review page used browser storage as authority/cache");
assert(reviewPageSource.indexOf("streak") === -1 && reviewPageSource.indexOf("gamification") === -1, "Review page added gamification language");

console.log("REVIEW_WEB_SMOKE_OK");

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), "src", relativePath), "utf8");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
