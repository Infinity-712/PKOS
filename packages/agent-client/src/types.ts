export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export type HealthResponse = {
  ok: boolean;
  service: string;
  mode: string;
  runtimeFingerprint?: string;
  profileName?: string;
  serviceVersion?: string;
  serviceBuildFingerprint?: string;
  apiContractVersion?: string;
  databaseSchemaVersion?: number;
  databaseRequiredSchemaVersion?: number;
  databaseCompatible?: boolean;
};

export type ServiceIdentityResponse = {
  name: "pkos-agent-server";
  version: string;
  apiContractVersion: string;
  buildFingerprint: string;
  sourceRevision: string;
  dirty: boolean;
  capabilities: string[];
  manifestFingerprint: string;
};

export type RuntimeInfoResponse = {
  service: ServiceIdentityResponse;
  profileName: string;
  runtimeFingerprint: string;
  dataRoot: {
    label: string;
    fingerprint: string;
  };
  database: {
    exists: boolean;
    schemaVersion: number;
    requiredSchemaVersion: number;
    compatible: boolean;
  };
  process: {
    startedAt: string;
    pid: number;
  };
  provider: {
    profileId: string;
    modelId: string | null;
    reasoningPreset: string;
    keyConfigured: boolean;
  };
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

export type ChatMessageStatus = "completed" | "failed" | "aborted";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  generationId: string | null;
  status: ChatMessageStatus;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessageListResponse = {
  sessionId: string;
  items: ChatMessage[];
  nextBefore: string | null;
};

export type GetSessionMessagesOptions = {
  limit?: number;
  before?: string;
};

export type ProviderProtocol = "dry-run" | "openai-chat-completions";
export type ProviderConnectionState = "dry_run" | "unconfigured" | "configured_unverified" | "connected" | "error" | "disabled";
export type ReasoningPreset = "off" | "low" | "medium" | "high" | "max";

export type ProviderProfileSummary = {
  profileId: string;
  providerId: string;
  displayName: string;
  protocol: ProviderProtocol;
  enabled: boolean;
  external: boolean;
  endpointOrigin?: string;
  apiKeyEnvName?: string;
  keyConfigured: boolean;
  models: Array<{
    modelId: string;
    displayName: string;
    contextWindow?: number;
    maxOutputTokens?: number;
    reasoningPresets: ReasoningPreset[];
    defaultReasoningPreset: ReasoningPreset;
    reasoningFixed: boolean;
  }>;
};

export type ProviderProfilesResponse = {
  items: ProviderProfileSummary[];
};

export type ProviderStatusResponse = {
  selection: {
    profileId: string;
    providerId: string;
    providerDisplayName: string;
    protocol: ProviderProtocol;
    modelId: string;
    modelDisplayName: string;
    reasoningPreset: ReasoningPreset;
    external: boolean;
    endpointOrigin?: string;
    apiKeyEnvName?: string;
    keyConfigured?: boolean;
    warning?: string;
  };
  connection: {
    state: ProviderConnectionState;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastErrorCode: string | null;
  };
  consentRequired: boolean;
  configured: boolean;
  capabilities: {
    streaming: true;
    textGeneration: true;
    toolCallingEnabled: false;
    reasoningPresets: ReasoningPreset[];
  };
  provider: ProviderProtocol;
  model: string | null;
  dataEgress: "none" | "configured-endpoint";
  toolsEnabled: false;
  readOnly: true;
  errorCode?: "provider_not_configured" | "provider_profile_disabled";
};

export type SetProviderSelectionInput = {
  profileId: string;
  modelId: string;
  reasoningPreset: ReasoningPreset;
};

export type AbortGenerationResponse = {
  ok: boolean;
  generationId: string;
  status: "running" | "completed" | "failed" | "aborted";
  message?: string;
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
  | "action_request_resolved"
  | "provider_selection_changed";

export type AgentEventSeverity = "debug" | "info" | "warn" | "error";

export type ContentDeltaPayload = {
  delta: string;
  partialLength?: number;
};

export type AgentEventBase<TType extends AgentEventType = AgentEventType, TPayload = unknown> = {
  id: string;
  ts: string;
  sessionId?: string;
  generationId?: string;
  type: TType;
  payload: TPayload;
  severity: AgentEventSeverity;
};

export type ContentDeltaAgentEvent = AgentEventBase<"content_delta", ContentDeltaPayload>;
export type AgentEvent = ContentDeltaAgentEvent | AgentEventBase<Exclude<AgentEventType, "content_delta">, unknown>;

export type WritebackStatus = "written" | "blocked" | "error";

export type ReviewBatchOutcome = {
  items: Array<{ objectId: string; requestId: string; status: "written" | "replayed"; eventId: string }>;
  failures: Array<{ objectId: string; requestId: string; code: string }>;
};

export type WritebackResult = {
  status: WritebackStatus;
  operation: string;
  message?: string;
  errorCode?: string;
  target?: string;
  recordId?: string;
  commitHash?: string;
  changedFiles?: string[];
  fileRevisionSha256?: string;
  objectContentSha256?: string;
  reviewBatch?: ReviewBatchOutcome;
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

export type RuntimeReminderNotification = {
  id: string;
  reminderId: string;
  remindAt: string;
  runtimeFingerprint: string;
  deliveryChannel: string;
  deliveryState: string;
  firstSeenAt: string;
  lastAttemptAt: string;
  attemptCount: number;
  acknowledgedInRuntimeAt: string | null;
  errorCode: string | null;
};

export type RuntimeReminderNotificationsResponse = {
  ok: boolean;
  generatedAt: string;
  evaluatedAt: string;
  count: number;
  notifications: RuntimeReminderNotification[];
};

export type RuntimeReminderNotificationFilters = {
  now?: string;
  limit?: number;
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

export type SendChatMessageInput = {
  sessionId: string;
  message: string;
  allowExternalProvider?: boolean;
};

export type ObjectKind = "fact" | "claim" | "skill" | "creative";

export type ObjectIdContract = {
  minLength: number;
  maxLength: number;
  pattern: string;
  humanReadablePattern: string;
  example: string;
  prefixRequirement: "must_start_with_type_dot";
};

export type ObjectTypeContract = {
  type: ObjectKind;
  editableFields: string[];
  requiredFields: string[];
  statusEnum: string[];
  fieldTypes: JsonObject;
  srsEligible: boolean;
  immutableFields: string[];
  supportedSupplementarySections: string[];
  objectId: ObjectIdContract;
};

export type ObjectTypeContractResponse = {
  ok: boolean;
  schemaVersion: string;
  types: ObjectTypeContract[];
};

export type ObjectListItem = {
  id: string;
  type: ObjectKind;
  status: string;
  title: string;
  summary: string;
  updatedAt: string;
  fileRevisionSha256: string;
  objectContentSha256: string;
  srsEligible: boolean;
  contentChangedSinceLastReview: boolean;
  location: string;
};

export type ObjectListResponse = {
  ok: boolean;
  schemaVersion: string;
  generatedAt: string;
  count: number;
  totalCount: number;
  filters: JsonObject;
  items: ObjectListItem[];
  source: JsonObject;
  dataRootFingerprint: string;
};

export type ObjectDetailResponse = {
  ok: boolean;
  schemaVersion: string;
  object: JsonObject;
  location: string;
  fileRevisionSha256: string;
  objectContentSha256: string;
  srsEligible: boolean;
  contentChangedSinceLastReview: boolean;
  reviewSummary: JsonObject | null;
  editableFields: string[];
  immutableFields: string[];
  additionalFields: string[];
  dataRootFingerprint: string;
};

export type ObjectRenderSection = {
  id: string;
  title: string;
  kind: "list" | "object" | "text";
  items: JsonValue[];
};

export type ObjectRenderView = {
  ok: boolean;
  schemaVersion: string;
  objectId: string;
  objectType: ObjectKind;
  fileRevisionSha256: string;
  dataRootFingerprint: string;
  body: string;
  sections: ObjectRenderSection[];
  metadata: JsonObject;
  objectContentSha256: string;
};

export type ObjectListFilters = {
  type?: ObjectKind;
  status?: string;
  q?: string;
  limit?: number;
};

export type ObjectCreateRequest = JsonObject & {
  requestId: string;
  confirmed: boolean;
  actor: string;
  object: JsonObject;
};

export type ObjectUpdateRequest = JsonObject & {
  requestId: string;
  confirmed: boolean;
  actor: string;
  baseRevision: string;
  patch: JsonObject;
};

export type ObjectDeletePreflightRequest = JsonObject & {
  baseRevision?: string;
};

export type ObjectDeletePreflight = {
  ok: boolean;
  schemaVersion: string;
  objectId: string;
  objectType: ObjectKind;
  fileRevisionSha256: string;
  objectContentSha256: string;
  reviewEventCount: number;
  objectReferences: JsonObject[];
  publishReferences: JsonObject[];
  taskReferences: JsonObject[];
  reminderReferences: JsonObject[];
  digestReferences: JsonObject[];
  tombstoneExists: boolean;
  blockers: JsonObject[];
  warnings: JsonObject[];
  referenceCoverage: JsonObject[];
  canDelete: boolean;
  dataRootFingerprint: string;
};

export type ObjectDeleteRequest = JsonObject & {
  requestId: string;
  confirmed: boolean;
  actor: string;
  typedObjectId: string;
  baseRevision: string;
  reason: string;
};
