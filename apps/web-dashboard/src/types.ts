export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export type HealthResponse = {
  ok: boolean;
  service: string;
  mode: string;
};

export type WritebackStatus = "written" | "blocked" | "error";

export type WritebackResult = {
  status: WritebackStatus;
  operation: string;
  message?: string;
  errorCode?: string;
  target?: string;
  recordId?: string;
};

export type ApiErrorPayload = {
  code: string;
  message: string;
};

export type ActionSubmitResponse = {
  ok: boolean;
  requestId: string;
  replayed: boolean;
  result?: WritebackResult;
  error?: ApiErrorPayload;
};

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

export type StateTimelineItem = {
  id: string;
  source: string;
  energy: string;
  mood: string;
  body: string;
  context: string;
  mode: string;
  risk: JsonObject;
  note: string | null;
  createdAt: string;
  stale: boolean;
};

export type StateTimelineResponse = {
  current: StateTimelineItem | null;
  items: StateTimelineItem[];
  count: number;
  filters: JsonObject;
};
