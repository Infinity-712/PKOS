import type {
  ActionSubmitResponse,
  AbortGenerationResponse,
  AgentEvent,
  AgentEventSeverity,
  AgentEventType,
  ApiErrorPayload,
  ChatSession,
  ChatMessageListResponse,
  ChatSessionListResponse,
  CreateChatSessionResponse,
  HealthResponse,
  RuntimeInfoResponse,
  RuntimeReminderNotificationsResponse,
  JsonObject,
  ProviderProfilesResponse,
  ProviderStatusResponse,
  ReasoningPreset,
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
  "provider_selection_changed",
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
  return (
    isRecord(value) &&
    typeof value.ok === "boolean" &&
    typeof value.service === "string" &&
    typeof value.mode === "string" &&
    (value.runtimeFingerprint === undefined || typeof value.runtimeFingerprint === "string") &&
    (value.profileName === undefined || typeof value.profileName === "string") &&
    (value.serviceVersion === undefined || typeof value.serviceVersion === "string") &&
    (value.serviceBuildFingerprint === undefined || isShortSha(value.serviceBuildFingerprint)) &&
    (value.apiContractVersion === undefined || typeof value.apiContractVersion === "string") &&
    (value.databaseSchemaVersion === undefined || typeof value.databaseSchemaVersion === "number") &&
    (value.databaseRequiredSchemaVersion === undefined || typeof value.databaseRequiredSchemaVersion === "number") &&
    (value.databaseCompatible === undefined || typeof value.databaseCompatible === "boolean")
  );
}

export function isRuntimeInfoResponse(value: unknown): value is RuntimeInfoResponse {
  if (!isRecord(value)) {
    return false;
  }
  if (!hasOnlyKeys(value, ["service", "profileName", "runtimeFingerprint", "dataRoot", "database", "process", "provider"])) {
    return false;
  }
  return (
    isServiceIdentityResponse(value.service) &&
    typeof value.profileName === "string" &&
    typeof value.runtimeFingerprint === "string" &&
    isRecord(value.dataRoot) &&
    hasOnlyKeys(value.dataRoot, ["label", "fingerprint"]) &&
    typeof value.dataRoot.label === "string" &&
    typeof value.dataRoot.fingerprint === "string" &&
    isRecord(value.database) &&
    hasOnlyKeys(value.database, ["exists", "schemaVersion", "requiredSchemaVersion", "compatible"]) &&
    typeof value.database.exists === "boolean" &&
    typeof value.database.schemaVersion === "number" &&
    typeof value.database.requiredSchemaVersion === "number" &&
    typeof value.database.compatible === "boolean" &&
    isRecord(value.process) &&
    hasOnlyKeys(value.process, ["startedAt", "pid"]) &&
    typeof value.process.startedAt === "string" &&
    typeof value.process.pid === "number" &&
    isRecord(value.provider) &&
    hasOnlyKeys(value.provider, ["profileId", "modelId", "reasoningPreset", "keyConfigured"]) &&
    typeof value.provider.profileId === "string" &&
    (typeof value.provider.modelId === "string" || value.provider.modelId === null) &&
    typeof value.provider.reasoningPreset === "string" &&
    typeof value.provider.keyConfigured === "boolean"
  );
}

function isServiceIdentityResponse(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (!hasOnlyKeys(value, ["name", "version", "apiContractVersion", "buildFingerprint", "sourceRevision", "dirty", "capabilities", "manifestFingerprint"])) {
    return false;
  }
  return (
    value.name === "pkos-agent-server" &&
    typeof value.version === "string" &&
    typeof value.apiContractVersion === "string" &&
    isShortSha(value.buildFingerprint) &&
    typeof value.sourceRevision === "string" &&
    typeof value.dirty === "boolean" &&
    Array.isArray(value.capabilities) &&
    value.capabilities.every((capability) => typeof capability === "string" && capability.length > 0) &&
    new Set(value.capabilities).size === value.capabilities.length &&
    isShortSha(value.manifestFingerprint)
  );
}

export function isCreateChatSessionResponse(value: unknown): value is CreateChatSessionResponse {
  return isRecord(value) && value.ok === true && isChatSession(value.session);
}

export function isChatSessionListResponse(value: unknown): value is ChatSessionListResponse {
  return isRecord(value) && value.ok === true && Array.isArray(value.sessions) && value.sessions.every(isChatSession);
}

export function isChatMessageListResponse(value: unknown): value is ChatMessageListResponse {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    Array.isArray(value.items) &&
    value.items.every(isChatMessage) &&
    (value.nextBefore === null || typeof value.nextBefore === "string")
  );
}

export function isProviderStatusResponse(value: unknown): value is ProviderStatusResponse {
  return (
    isRecord(value) &&
    isProviderProtocol(value.provider) &&
    isRecord(value.selection) &&
    typeof value.selection.profileId === "string" &&
    typeof value.selection.providerId === "string" &&
    typeof value.selection.providerDisplayName === "string" &&
    isProviderProtocol(value.selection.protocol) &&
    typeof value.selection.modelId === "string" &&
    typeof value.selection.modelDisplayName === "string" &&
    isReasoningPreset(value.selection.reasoningPreset) &&
    typeof value.selection.external === "boolean" &&
    (value.selection.endpointOrigin === undefined || typeof value.selection.endpointOrigin === "string") &&
    (value.selection.apiKeyEnvName === undefined || typeof value.selection.apiKeyEnvName === "string") &&
    (value.selection.keyConfigured === undefined || typeof value.selection.keyConfigured === "boolean") &&
    isRecord(value.connection) &&
    isProviderConnectionState(value.connection.state) &&
    (typeof value.connection.lastAttemptAt === "string" || value.connection.lastAttemptAt === null) &&
    (typeof value.connection.lastSuccessAt === "string" || value.connection.lastSuccessAt === null) &&
    (typeof value.connection.lastErrorCode === "string" || value.connection.lastErrorCode === null) &&
    typeof value.consentRequired === "boolean" &&
    typeof value.configured === "boolean" &&
    isRecord(value.capabilities) &&
    value.capabilities.streaming === true &&
    value.capabilities.textGeneration === true &&
    value.capabilities.toolCallingEnabled === false &&
    Array.isArray(value.capabilities.reasoningPresets) &&
    value.capabilities.reasoningPresets.every(isReasoningPreset) &&
    (typeof value.model === "string" || value.model === null) &&
    (value.dataEgress === "none" || value.dataEgress === "configured-endpoint") &&
    value.toolsEnabled === false &&
    value.readOnly === true &&
    (value.errorCode === undefined || value.errorCode === "provider_not_configured" || value.errorCode === "provider_profile_disabled")
  );
}

export function isProviderProfilesResponse(value: unknown): value is ProviderProfilesResponse {
  return isRecord(value) && Array.isArray(value.items) && value.items.every(isProviderProfileSummary);
}

export function isAbortGenerationResponse(value: unknown): value is AbortGenerationResponse {
  return (
    isRecord(value) &&
    typeof value.ok === "boolean" &&
    typeof value.generationId === "string" &&
    (value.status === "running" || value.status === "completed" || value.status === "failed" || value.status === "aborted") &&
    (value.message === undefined || typeof value.message === "string")
  );
}

export function isAgentEvent(value: unknown): value is AgentEvent {
  if (
    !(
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.ts === "string" &&
    typeof value.type === "string" &&
    AGENT_EVENT_TYPES.has(value.type as AgentEventType) &&
    typeof value.severity === "string" &&
    SEVERITIES.has(value.severity as AgentEventSeverity) &&
    (value.sessionId === undefined || typeof value.sessionId === "string") &&
      (value.generationId === undefined || typeof value.generationId === "string") &&
      "payload" in value
    )
  ) {
    return false;
  }
  if (value.type === "content_delta") {
    return isContentDeltaPayload(value.payload);
  }
  return true;
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

export function isRuntimeReminderNotificationsResponse(value: unknown): value is RuntimeReminderNotificationsResponse {
  return (
    isRecord(value) &&
    value.ok === true &&
    typeof value.generatedAt === "string" &&
    typeof value.evaluatedAt === "string" &&
    typeof value.count === "number" &&
    Array.isArray(value.notifications) &&
    value.notifications.every(isRuntimeReminderNotification)
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

function isChatMessage(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string" &&
    (typeof value.generationId === "string" || value.generationId === null) &&
    (value.status === "completed" || value.status === "failed" || value.status === "aborted") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isProviderProfileSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.profileId === "string" &&
    typeof value.providerId === "string" &&
    typeof value.displayName === "string" &&
    isProviderProtocol(value.protocol) &&
    typeof value.enabled === "boolean" &&
    typeof value.external === "boolean" &&
    (value.endpointOrigin === undefined || typeof value.endpointOrigin === "string") &&
    (value.apiKeyEnvName === undefined || typeof value.apiKeyEnvName === "string") &&
    typeof value.keyConfigured === "boolean" &&
    Array.isArray(value.models) &&
    value.models.every(isProviderModelSummary)
  );
}

function isProviderModelSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.modelId === "string" &&
    typeof value.displayName === "string" &&
    (value.contextWindow === undefined || typeof value.contextWindow === "number") &&
    (value.maxOutputTokens === undefined || typeof value.maxOutputTokens === "number") &&
    Array.isArray(value.reasoningPresets) &&
    value.reasoningPresets.every(isReasoningPreset) &&
    isReasoningPreset(value.defaultReasoningPreset) &&
    typeof value.reasoningFixed === "boolean"
  );
}

function isProviderProtocol(value: unknown): boolean {
  return value === "dry-run" || value === "openai-chat-completions";
}

function isProviderConnectionState(value: unknown): boolean {
  return value === "dry_run" || value === "unconfigured" || value === "configured_unverified" || value === "connected" || value === "error" || value === "disabled";
}

function isReasoningPreset(value: unknown): value is ReasoningPreset {
  return value === "off" || value === "low" || value === "medium" || value === "high" || value === "max";
}

function isContentDeltaPayload(value: unknown): boolean {
  if (!isRecord(value) || typeof value.delta !== "string") {
    return false;
  }
  for (const key of Object.keys(value)) {
    if (key !== "delta" && key !== "partialLength") {
      return false;
    }
  }
  return value.partialLength === undefined || typeof value.partialLength === "number";
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

function isRuntimeReminderNotification(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.reminderId === "string" &&
    typeof value.remindAt === "string" &&
    typeof value.runtimeFingerprint === "string" &&
    typeof value.deliveryChannel === "string" &&
    typeof value.deliveryState === "string" &&
    typeof value.firstSeenAt === "string" &&
    typeof value.lastAttemptAt === "string" &&
    typeof value.attemptCount === "number" &&
    (typeof value.acknowledgedInRuntimeAt === "string" || value.acknowledgedInRuntimeAt === null) &&
    (typeof value.errorCode === "string" || value.errorCode === null)
  );
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function isShortSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{12,16}$/i.test(value);
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
