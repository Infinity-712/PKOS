import {
  isActionSubmitResponse,
  isHealthResponse,
  isRecord,
  isStateTimelineResponse,
} from "@pkos/agent-client";
import type {
  ActionRequestDetailResponse,
  ActionRequestListResponse,
  ActionRequestView,
  ActionResolution,
  ActionResolutionResponse,
  AuditEventView,
  AuditEventsResponse,
  InboxReviewListResponse,
  WritebackResult,
} from "../types.js";

export { asJsonObject, isActionSubmitResponse, isHealthResponse, isRecord, isStateTimelineResponse } from "@pkos/agent-client";

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

export function isInboxReviewListResponse(value: unknown): value is InboxReviewListResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isInboxReviewItem) &&
    typeof value.count === "number" &&
    typeof value.generatedAt === "string" &&
    isRecord(value.filters)
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

function isInboxReviewItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.captureType === "string" &&
    typeof value.content === "string" &&
    typeof value.source === "string" &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string") &&
    typeof value.createdAt === "string" &&
    typeof value.effectiveStatus === "string" &&
    (value.latestAction === null || isLatestInboxReviewAction(value.latestAction))
  );
}

function isLatestInboxReviewAction(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.status === "string" &&
    typeof value.reason === "string" &&
    typeof value.createdAt === "string"
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
