export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export type HealthResponse = {
  ok: boolean;
  service: string;
  mode: string;
};

export type HealthDiagnosticsResponse = {
  health: HealthResponse;
  requestUrl: string;
  status: number;
  responseType: string;
  contentType: string | null;
  receivedOrigin: string | null;
};

export type ChatSession = {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type CreateChatSessionResponse = {
  ok: boolean;
  session: ChatSession;
};

export type ChatSessionListResponse = {
  ok: boolean;
  sessions: ChatSession[];
};

export type AgentEventType =
  | "generation_started"
  | "content_delta"
  | "generation_completed"
  | "generation_aborted"
  | "generation_failed"
  | "tool_call_started"
  | "tool_call_completed"
  | "tool_call_failed"
  | "writeback_requested"
  | "writeback_written"
  | "writeback_blocked"
  | "review_candidate_created"
  | "scheduler_run"
  | "context_built"
  | "action_request_resolved";

export type AgentEventSeverity = "debug" | "info" | "warn" | "error";

export type AgentEvent = {
  id: string;
  ts: string;
  sessionId?: string;
  generationId?: string;
  type: AgentEventType;
  payload: unknown;
  severity: AgentEventSeverity;
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

export type InboxAppendRequest = JsonObject & {
  requestId: string;
  captureType: string;
  content: string;
  source: string;
  status: string;
  tags: string[];
  metadata: JsonObject;
};

export type StateAppendRequest = JsonObject & {
  requestId: string;
  energy: string;
  mood: string;
  body: string;
  context: string;
  mode: string;
  risk: JsonObject;
  source: string;
  note?: string;
};

export type StateTimelineFilters = {
  energy?: string;
  mood?: string;
  mode?: string;
  limit?: number;
};
