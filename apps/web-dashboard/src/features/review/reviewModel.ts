import { formatDateTime, type JsonObject, type RequestAttemptState } from "@pkos/agent-client";

export const REVIEW_RATING_LABELS = [
  { value: 1, text: "Again / 重来" },
  { value: 2, text: "Hard / 困难" },
  { value: 3, text: "Good / 记得" },
  { value: 4, text: "Easy / 轻松" },
  { value: 5, text: "Perfect / 完全记住" },
];

export type ReviewQueueFilters = {
  now?: string;
  limit?: string;
  objectId?: string;
};

export type ReviewRatingInput = {
  objectId: string;
  rating: number | null;
  reviewedAt: string;
  actor: string;
};

export type ReviewCorrectionInput = {
  targetEventId: string;
  correctedRating: number | null;
  reason: string;
  actor: string;
};

export type ReviewActionDraft = {
  actionName: "pkos.review.rating" | "pkos.review.correction";
  endpoint: "/api/pkos/review/ratings" | "/api/pkos/review/corrections";
  body: JsonObject;
};

export function buildReviewQueueQuery(filters: ReviewQueueFilters): string {
  const params = new URLSearchParams();
  if (filters.now?.trim()) {
    params.set("now", filters.now.trim());
  }
  if (filters.limit?.trim()) {
    params.set("limit", filters.limit.trim());
  }
  return params.toString();
}

export function createReviewRatingDraft(input: ReviewRatingInput): ReviewActionDraft {
  return {
    actionName: "pkos.review.rating",
    endpoint: "/api/pkos/review/ratings",
    body: {
      objectId: input.objectId,
      rating: input.rating,
      reviewedAt: input.reviewedAt,
      actor: input.actor,
      confirmed: true,
    },
  };
}

export function createReviewCorrectionDraft(input: ReviewCorrectionInput): ReviewActionDraft {
  return {
    actionName: "pkos.review.correction",
    endpoint: "/api/pkos/review/corrections",
    body: {
      targetEventId: input.targetEventId,
      correctedRating: input.correctedRating,
      reason: input.reason,
      actor: input.actor,
      confirmed: true,
    },
  };
}

export function startOrReuseReviewAttempt(
  current: RequestAttemptState,
  draft: ReviewActionDraft,
  createRequestId: () => string,
): RequestAttemptState {
  if (current.frozenPayload) {
    return { ...current, status: "submitting", lastError: null };
  }
  const requestId = createRequestId();
  return {
    requestId,
    frozenPayload: {
      actionName: draft.actionName as RequestAttemptState["frozenPayload"] extends infer T
        ? T extends { actionName: infer A }
          ? A
          : never
        : never,
      endpoint: draft.endpoint,
      requestId,
      body: { ...draft.body, requestId },
    },
    status: "submitting",
    lastResponse: null,
    lastError: null,
  };
}

export function canSubmitReviewRating(input: { objectId: string; rating: number | null; submitting: boolean }): boolean {
  return Boolean(input.objectId.trim()) && typeof input.rating === "number" && Number.isInteger(input.rating) &&
    input.rating >= 1 && input.rating <= 5 && !input.submitting;
}

export function canSubmitReviewCorrection(input: { targetEventId: string; reason: string; submitting: boolean }): boolean {
  return Boolean(input.targetEventId.trim()) && Boolean(input.reason.trim()) && !input.submitting;
}

export function nextReviewResultText(input: { rating: number; dueAt: string; intervalDays: number; easeFactor: number }): string {
  return `rating ${input.rating}, next review ${formatDateTime(input.dueAt)}, interval ${input.intervalDays} days, ease ${input.easeFactor}`;
}

export function reviewContentChangedText(changed: boolean): string | null {
  if (!changed) {
    return null;
  }
  return "This object changed after the last review. Scheduling was not reset automatically.";
}
