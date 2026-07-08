import type {
  ActionRequestDetailResponse,
  ActionRequestListResponse,
  ActionRequestView,
  ActionResolution,
  ActionResolutionResponse,
  ActionSubmitResponse,
  AuditEventView,
  AuditEventsResponse,
  HealthResponse,
  JsonObject,
  WritebackResult,
} from "../types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function asJsonObject(value: unknown): JsonObject | null {
  if (!isRecord(value)) {
    return null;
  }
  return value as JsonObject;
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    isRecord(value) &&
    typeof value.ok === "boolean" &&
    typeof value.service === "string" &&
    typeof value.mode === "string"
  );
}

export function isActionSubmitResponse(value: unknown): value is ActionSubmitResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean" || typeof value.requestId !== "string" || typeof value.replayed !== "boolean") {
    return false;
  }
  return (value.result === undefined || isWritebackResult(value.result)) && (value.error === undefined || isApiErrorPayload(value.error));
}

export function isActionRequestListResponse(value: unknown): value is ActionRequestListResponse {
  return isRecord(value) && value.ok === true && Array.isArray(value.requests) && value.requests.every(isActionRequestView);
}

export function isActionRequestDetailResponse(value: unknown): value is ActionRequestDetailResponse {
  return isRecord(value) && value.ok === true && isActionRequestView(value.request);
}

export function isActionResolutionResponse(value: unknown): value is ActionResolutionResponse {
  return (
    isRecord(value) &&
    value.ok === true &&
    typeof value.requestId === "string" &&
    isActionResolution(value.resolution) &&
    typeof value.status === "string" &&
    typeof value.message === "string" &&
    isActionRequestView(value.request)
  );
}

export function isAuditEventsResponse(value: unknown): value is AuditEventsResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isAuditEventView) &&
    (typeof value.nextBefore === "string" || value.nextBefore === null)
  );
}

function isActionRequestView(value: unknown): value is ActionRequestView {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.requestId === "string" &&
    typeof value.actionName === "string" &&
    typeof value.payloadSha256 === "string" &&
    typeof value.storedStatus === "string" &&
    typeof value.effectiveStatus === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.stale === "boolean" &&
    (value.toolCallId === undefined || typeof value.toolCallId === "string") &&
    (value.result === undefined || isWritebackResult(value.result)) &&
    (value.error === undefined || isWritebackResult(value.error)) &&
    (value.resolution === undefined || isResolutionView(value.resolution))
  );
}

function isResolutionView(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isActionResolution(value.resolution) &&
    typeof value.resolvedBy === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.reasonChars === "number"
  );
}

function isActionResolution(value: unknown): value is ActionResolution {
  return value === "confirmed_written" || value === "confirmed_not_written" || value === "abandoned";
}

function isAuditEventView(value: unknown): value is AuditEventView {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.ts === "string" &&
    typeof value.type === "string" &&
    typeof value.severity === "string" &&
    (value.sessionId === undefined || typeof value.sessionId === "string") &&
    (value.generationId === undefined || typeof value.generationId === "string") &&
    isRecord(value.payloadSummary)
  );
}

function isWritebackResult(value: unknown): value is WritebackResult {
  return (
    isRecord(value) &&
    typeof value.status === "string" &&
    typeof value.operation === "string" &&
    (value.message === undefined || typeof value.message === "string") &&
    (value.errorCode === undefined || typeof value.errorCode === "string") &&
    (value.target === undefined || typeof value.target === "string") &&
    (value.recordId === undefined || typeof value.recordId === "string")
  );
}

function isApiErrorPayload(value: unknown): boolean {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string";
}
