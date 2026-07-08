import type { ActionSubmitResponse, JsonObject } from "../../types.js";

export type CaptureActionName = "inbox-append" | "state-append";

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
  const endpoint = draft.actionName === "inbox-append" ? "/api/actions/inbox-append" : "/api/actions/state-append";
  return {
    actionName: draft.actionName,
    endpoint,
    requestId,
    body: { ...draft.body, requestId },
  };
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
  if (code === "invalid_input" || code === "invalid_json" || code === "body_too_large") {
    return "invalid_input";
  }
  if (code === "idempotency_conflict") {
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
