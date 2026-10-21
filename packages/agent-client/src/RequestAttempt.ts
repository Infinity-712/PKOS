import type { ActionSubmitResponse, JsonObject } from "./types.js";

export type CaptureActionName =
  | "inbox-append"
  | "state-append"
  | "inbox-review-archive"
  | "inbox-review-restore"
  | "task-create"
  | "task-transition"
  | "reminder-create"
  | "reminder-acknowledge"
  | "reminder-cancel"
  | "reminder-reschedule"
  | "pkos.review.rating"
  | "pkos.review.rating_batch"
  | "pkos.review.correction"
  | "pkos.object.create"
  | "pkos.object.update"
  | "pkos.object.delete";

export type ActionAttemptStatus =
  | "draft"
  | "submitting"
  | "written"
  | "replayed"
  | "invalid_input"
  | "conflict"
  | "request_in_progress"
  | "request_indeterminate"
  | "permission_denied"
  | "cli_failed"
  | "timeout"
  | "network_unknown";

export type FrozenActionPayload = {
  actionName: CaptureActionName;
  endpoint: string;
  requestId: string;
  body: JsonObject;
};

export type RequestAttemptState = {
  requestId: string | null;
  frozenPayload: FrozenActionPayload | null;
  status: ActionAttemptStatus;
  lastResponse: JsonObject | null;
  lastError: string | null;
};

export type ActionDraft = {
  actionName: CaptureActionName;
  body: JsonObject;
};

export const EMPTY_ATTEMPT: RequestAttemptState = {
  requestId: null,
  frozenPayload: null,
  status: "draft",
  lastResponse: null,
  lastError: null,
};

export function startOrReuseAttempt(
  current: RequestAttemptState,
  draft: ActionDraft,
  createRequestId: () => string,
): RequestAttemptState {
  if (current.frozenPayload) {
    return { ...current, status: "submitting", lastError: null };
  }
  const requestId = createRequestId();
  const frozenPayload = freezeDraftPayload(draft, requestId);
  return {
    requestId,
    frozenPayload,
    status: "submitting",
    lastResponse: null,
    lastError: null,
  };
}

export function applySubmitResponse(current: RequestAttemptState, response: ActionSubmitResponse): RequestAttemptState {
  const status = statusFromSubmitResponse(response);
  return {
    ...current,
    status,
    lastResponse: jsonObjectFromSubmitResponse(response),
    lastError: response.error?.message ?? null,
  };
}

export function applySubmitError(current: RequestAttemptState, error: { code: string; message: string }): RequestAttemptState {
  return {
    ...current,
    status: statusFromErrorCode(error.code),
    lastError: error.message,
    lastResponse: { error: { code: error.code, message: error.message } },
  };
}

export function resetAttempt(): RequestAttemptState {
  return EMPTY_ATTEMPT;
}

export function isSuccessfulAttempt(status: ActionAttemptStatus): boolean {
  return status === "written" || status === "replayed";
}

function freezeDraftPayload(draft: ActionDraft, requestId: string): FrozenActionPayload {
  const endpoint = endpointForAction(draft);
  return {
    actionName: draft.actionName,
    endpoint,
    requestId,
    body: { ...draft.body, requestId },
  };
}

function endpointForAction(draft: ActionDraft): string {
  if (draft.actionName === "inbox-append") {
    return "/api/actions/inbox-append";
  }
  if (draft.actionName === "state-append") {
    return "/api/actions/state-append";
  }
  if (draft.actionName === "inbox-review-archive" && typeof draft.body.itemId === "string") {
    return `/api/pkos/inbox-review/${encodeURIComponent(draft.body.itemId)}/archive`;
  }
  if (draft.actionName === "inbox-review-restore" && typeof draft.body.itemId === "string") {
    return `/api/pkos/inbox-review/${encodeURIComponent(draft.body.itemId)}/restore`;
  }
  if (draft.actionName === "task-create") {
    return "/api/pkos/tasks";
  }
  if (draft.actionName === "task-transition" && typeof draft.body.taskId === "string") {
    return `/api/pkos/tasks/${encodeURIComponent(draft.body.taskId)}/transition`;
  }
  if (draft.actionName === "reminder-create") {
    return "/api/pkos/reminders";
  }
  if (draft.actionName === "reminder-acknowledge" && typeof draft.body.reminderId === "string") {
    return `/api/pkos/reminders/${encodeURIComponent(draft.body.reminderId)}/acknowledge`;
  }
  if (draft.actionName === "reminder-cancel" && typeof draft.body.reminderId === "string") {
    return `/api/pkos/reminders/${encodeURIComponent(draft.body.reminderId)}/cancel`;
  }
  if (draft.actionName === "reminder-reschedule" && typeof draft.body.reminderId === "string") {
    return `/api/pkos/reminders/${encodeURIComponent(draft.body.reminderId)}/reschedule`;
  }
  if (draft.actionName === "pkos.review.rating") {
    return "/api/pkos/review/ratings";
  }
  if (draft.actionName === "pkos.review.rating_batch") {
    return "/api/pkos/review/ratings:batch";
  }
  if (draft.actionName === "pkos.review.correction") {
    return "/api/pkos/review/corrections";
  }
  if (draft.actionName === "pkos.object.create") {
    return "/api/pkos/objects";
  }
  if (draft.actionName === "pkos.object.update" && typeof draft.body.objectId === "string") {
    return `/api/pkos/objects/${encodeURIComponent(draft.body.objectId)}`;
  }
  if (draft.actionName === "pkos.object.delete" && typeof draft.body.objectId === "string") {
    return `/api/pkos/objects/${encodeURIComponent(draft.body.objectId)}/delete`;
  }
  return "/api/actions/invalid";
}

function statusFromSubmitResponse(response: ActionSubmitResponse): ActionAttemptStatus {
  if (response.replayed) {
    return "replayed";
  }
  if (response.result?.status === "written") {
    return "written";
  }
  if (response.error) {
    return statusFromErrorCode(response.error.code);
  }
  if (response.result?.errorCode) {
    return statusFromErrorCode(response.result.errorCode);
  }
  return "cli_failed";
}

function statusFromErrorCode(code: string): ActionAttemptStatus {
  if (code === "network_unknown") {
    return "network_unknown";
  }
  if (
    code === "invalid_input" ||
    code === "invalid_json" ||
    code === "body_too_large" ||
    code === "invalid_transition" ||
    code === "invalid_status" ||
    code === "invalid_due_at" ||
    code === "invalid_remind_at" ||
    code === "invalid_reviewed_at" ||
    code === "invalid_rating" ||
    code === "invalid_priority" ||
    code === "invalid_title" ||
    code === "invalid_reason" ||
    code === "invalid_note" ||
    code === "task_not_found" ||
    code === "invalid_task_reference" ||
    code === "reminder_not_found" ||
    code === "object_not_found" ||
    code === "object_not_reviewable" ||
    code === "target_event_not_found" ||
    code === "correction_target_not_latest" ||
    code === "invalid_items_json" ||
    code === "no_successful_review_items" ||
    code === "invalid_object_id" ||
    code === "invalid_object_type" ||
    code === "object_id_type_mismatch" ||
    code === "object_id_exists" ||
    code === "object_id_tombstoned" ||
    code === "schema_validation_failed" ||
    code === "unknown_field" ||
    code === "immutable_field" ||
    code === "invalid_revision" ||
    code === "typed_object_id_mismatch" ||
    code === "deletion_blocked" ||
    code === "data_root_not_git" ||
    code === "data_root_git_root_mismatch" ||
    code === "unsafe_object_location" ||
    code === "object_path_collision"
  ) {
    return "invalid_input";
  }
  if (code === "idempotency_conflict" || code === "object_revision_conflict" || code === "data_root_dirty") {
    return "conflict";
  }
  if (code === "request_in_progress") {
    return "request_in_progress";
  }
  if (code === "request_indeterminate") {
    return "request_indeterminate";
  }
  if (code === "permission_denied" || code === "confirmation_required") {
    return "permission_denied";
  }
  if (code === "timeout") {
    return "timeout";
  }
  return "cli_failed";
}

function jsonObjectFromSubmitResponse(response: ActionSubmitResponse): JsonObject {
  const result = response.result ? ({ ...response.result } as JsonObject) : null;
  const error = response.error ? ({ ...response.error } as JsonObject) : null;
  return {
    ok: response.ok,
    requestId: response.requestId,
    replayed: response.replayed,
    ...(result ? { result } : {}),
    ...(error ? { error } : {}),
  };
}
