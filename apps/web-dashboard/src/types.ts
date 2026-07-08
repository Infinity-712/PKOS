import type { JsonObject, WritebackResult } from "@pkos/agent-client";

export type {
  ActionSubmitResponse,
  AgentEvent,
  ApiErrorPayload,
  ChatSession,
  ChatSessionListResponse,
  CreateChatSessionResponse,
  HealthResponse,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  StateTimelineItem,
  StateTimelineResponse,
  WritebackResult,
  WritebackStatus,
} from "@pkos/agent-client";

export type ActionStoredStatus = "running" | "completed" | "failed" | "indeterminate";
export type ActionEffectiveStatus = ActionStoredStatus;
export type ActionResolution = "confirmed_written" | "confirmed_not_written" | "abandoned";

export type ActionRequestView = {
  requestId: string;
  actionName: string;
  payloadSha256: string;
  storedStatus: ActionStoredStatus;
  effectiveStatus: ActionEffectiveStatus;
  toolCallId?: string;
  result?: WritebackResult;
  error?: WritebackResult;
  createdAt: string;
  updatedAt: string;
  stale: boolean;
  resolution?: {
    id: string;
    resolution: ActionResolution;
    resolvedBy: string;
    createdAt: string;
    reasonChars: number;
  };
};

export type ActionRequestListResponse = {
  ok: boolean;
  requests: ActionRequestView[];
};

export type ActionRequestDetailResponse = {
  ok: boolean;
  request: ActionRequestView;
};

export type ActionResolutionResponse = {
  ok: boolean;
  requestId: string;
  resolution: ActionResolution;
  status: ActionStoredStatus;
  message: string;
  request: ActionRequestView;
};

export type AuditEventView = {
  id: string;
  ts: string;
  type: string;
  severity: string;
  sessionId?: string;
  generationId?: string;
  payloadSummary: JsonObject;
};

export type AuditEventsResponse = {
  items: AuditEventView[];
  nextBefore: string | null;
};

export type InboxReviewItem = {
  id: string;
  captureType: string;
  content: string;
  source: string;
  tags: string[];
  createdAt: string;
  effectiveStatus: string;
  latestAction: {
    status: string;
    reason: string;
    createdAt: string;
  } | null;
};

export type InboxReviewListResponse = {
  items: InboxReviewItem[];
  count: number;
  generatedAt: string;
  filters: JsonObject;
};
