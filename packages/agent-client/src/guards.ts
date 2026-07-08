import type {
  ActionSubmitResponse,
  AgentEvent,
  AgentEventSeverity,
  AgentEventType,
  ApiErrorPayload,
  ChatSession,
  ChatSessionListResponse,
  CreateChatSessionResponse,
  HealthResponse,
  JsonObject,
  StateTimelineResponse,
  WritebackResult,
} from "./types.js";

const AGENT_EVENT_TYPES = new Set<AgentEventType>([
  "generation_started",
  "content_delta",
  "generation_completed",
  "generation_aborted",
  "generation_failed",
  "tool_call_started",
  "tool_call_completed",
  "tool_call_failed",
  "writeback_requested",
  "writeback_written",
  "writeback_blocked",
  "review_candidate_created",
  "scheduler_run",
  "context_built",
  "action_request_resolved",
]);

const SEVERITIES = new Set<AgentEventSeverity>(["debug", "info", "warn", "error"]);

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
  return isRecord(value) && typeof value.ok === "boolean" && typeof value.service === "string" && typeof value.mode === "string";
}

export function isCreateChatSessionResponse(value: unknown): value is CreateChatSessionResponse {
  return isRecord(value) && value.ok === true && isChatSession(value.session);
}

export function isChatSessionListResponse(value: unknown): value is ChatSessionListResponse {
  return isRecord(value) && value.ok === true && Array.isArray(value.sessions) && value.sessions.every(isChatSession);
}

export function isAgentEvent(value: unknown): value is AgentEvent {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.ts === "string" &&
    typeof value.type === "string" &&
    AGENT_EVENT_TYPES.has(value.type as AgentEventType) &&
    typeof value.severity === "string" &&
    SEVERITIES.has(value.severity as AgentEventSeverity) &&
    (value.sessionId === undefined || typeof value.sessionId === "string") &&
    (value.generationId === undefined || typeof value.generationId === "string")
  );
}

export function isActionSubmitResponse(value: unknown): value is ActionSubmitResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean" || typeof value.requestId !== "string" || typeof value.replayed !== "boolean") {
    return false;
  }
  return (value.result === undefined || isWritebackResult(value.result)) && (value.error === undefined || isApiErrorPayload(value.error));
}

export function isStateTimelineResponse(value: unknown): value is StateTimelineResponse {
  return (
    isRecord(value) &&
    (value.current === null || isStateTimelineItem(value.current)) &&
    Array.isArray(value.items) &&
    value.items.every(isStateTimelineItem) &&
    typeof value.count === "number" &&
    isRecord(value.filters)
  );
}

export function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string";
}

function isChatSession(value: unknown): value is ChatSession {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (typeof value.title === "string" || value.title === null) &&
    typeof value.status === "string" &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string"
  );
}

function isStateTimelineItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.source === "string" &&
    typeof value.energy === "string" &&
    typeof value.mood === "string" &&
    typeof value.body === "string" &&
    typeof value.context === "string" &&
    typeof value.mode === "string" &&
    isRecord(value.risk) &&
    (value.note === null || typeof value.note === "string") &&
    typeof value.createdAt === "string" &&
    typeof value.stale === "boolean"
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
