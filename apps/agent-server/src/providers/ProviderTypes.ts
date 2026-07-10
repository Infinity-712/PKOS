export type ProviderId = string;
export type ProviderProfileId = string;
export type ModelId = string;

export type ProviderProtocol = "dry-run" | "openai-chat-completions";
export type ProviderName = ProviderProtocol;

export type ReasoningPreset = "off" | "low" | "medium" | "high" | "max";

export type ProviderMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ProviderRequest = {
  generationId: string;
  messages: ProviderMessage[];
  signal: AbortSignal;
};

export type ProviderDelta =
  | { type: "content_delta"; text: string }
  | {
      type: "completed";
      finishReason?: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
      };
    };

export type AgentProvider = {
  readonly protocol: ProviderProtocol;
  readonly providerId: ProviderId;
  readonly profileId: ProviderProfileId;
  readonly modelId: ModelId;
  readonly reasoningPreset: ReasoningPreset;
  readonly dataEgress: "none" | "configured-endpoint";
  stream(request: ProviderRequest): AsyncIterable<ProviderDelta>;
};

export type ProviderConnectionState = "dry_run" | "unconfigured" | "configured_unverified" | "connected" | "error" | "disabled";

export type ProviderStatus = {
  selection: {
    profileId: ProviderProfileId;
    providerId: ProviderId;
    providerDisplayName: string;
    protocol: ProviderProtocol;
    modelId: ModelId;
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
  // Backward-compatible summary fields for older local callers.
  provider: ProviderProtocol;
  model: string | null;
  dataEgress: "none" | "configured-endpoint";
  toolsEnabled: false;
  readOnly: true;
  errorCode?: "provider_not_configured" | "provider_profile_disabled";
};

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly httpStatus = 502,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export type ProviderErrorCode =
  | "provider_not_configured"
  | "external_provider_consent_required"
  | "unknown_provider_profile"
  | "unknown_provider_model"
  | "unsupported_reasoning_preset"
  | "provider_profile_disabled"
  | "invalid_provider_selection"
  | "provider_auth_failed"
  | "provider_rate_limited"
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_invalid_response"
  | "provider_stream_error"
  | "provider_output_too_large"
  | "unsupported_provider_tool_output"
  | "provider_aborted"
  | "unknown_provider_error";
