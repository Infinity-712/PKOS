import {
  startOrReuseAttempt,
  type ActionDraft,
  type RequestAttemptState,
} from "../actions/requestAttempt.js";

export type InboxReviewActionKind = "archive" | "restore";

export type InboxReviewFilters = {
  status: string;
  source: string;
  tag: string;
  limit: string;
};

export type InboxReviewActionInput = {
  itemId: string;
  action: InboxReviewActionKind;
  reason: string;
  confirmed: boolean;
};

export type InboxReviewItemStatusInput = {
  id: string;
  effectiveStatus: string;
};

export function buildInboxReviewQuery(filters: InboxReviewFilters): string {
  const params = new URLSearchParams();
  const status = filters.status.trim();
  const source = filters.source.trim();
  const tag = filters.tag.trim();
  const limit = filters.limit.trim();
  if (status) {
    params.set("status", status);
  }
  if (source) {
    params.set("source", source);
  }
  if (tag) {
    params.set("tag", tag);
  }
  if (limit) {
    params.set("limit", limit);
  }
  return params.toString();
}

export function inboxReviewMutationForItem(item: InboxReviewItemStatusInput): InboxReviewActionKind | null {
  if (item.effectiveStatus === "unprocessed") {
    return "archive";
  }
  if (item.effectiveStatus === "archived") {
    return "restore";
  }
  return null;
}

export function createInboxReviewActionDraft(input: InboxReviewActionInput): ActionDraft {
  return {
    actionName: input.action === "archive" ? "inbox-review-archive" : "inbox-review-restore",
    body: {
      itemId: input.itemId,
      reason: input.reason.trim(),
      confirmed: input.confirmed,
    },
  };
}

export function startOrReuseInboxReviewAttempt(
  current: RequestAttemptState,
  draft: ActionDraft,
  createRequestId: () => string,
): RequestAttemptState {
  const next = startOrReuseAttempt(current, draft, createRequestId);
  if (!next.frozenPayload) {
    return next;
  }
  const { itemId, ...body } = next.frozenPayload.body;
  return {
    ...next,
    frozenPayload: {
      ...next.frozenPayload,
      body,
    },
  };
}

export function canSubmitInboxReviewAction(input: InboxReviewActionInput): boolean {
  return Boolean(input.itemId.trim() && input.reason.trim() && input.confirmed && (input.action === "archive" || input.action === "restore"));
}
