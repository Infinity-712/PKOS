import type { ModelId, ProviderId, ProviderProfileId, ProviderProtocol, ReasoningPreset } from "../ProviderTypes.js";

export type { ModelId, ProviderId, ProviderProfileId, ProviderProtocol, ReasoningPreset };

export type ReasoningControl =
  | {
      kind: "fixed";
      defaultPreset: "off";
    }
  | {
      kind: "preset";
      adapterId: string;
      supportedPresets: ReasoningPreset[];
      defaultPreset: ReasoningPreset;
    };

export type ProviderModelProfile = {
  id: ModelId;
  displayName: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  reasoningControl: ReasoningControl;
};

export type ProviderProfile = {
  id: ProviderProfileId;
  providerId: ProviderId;
  displayName: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKeyEnv?: string;
  external: boolean;
  enabled: boolean;
  models: ProviderModelProfile[];
};

export type ProviderProfileConfigFile = {
  schemaVersion: "0.6";
  profiles: ProviderProfile[];
};

export type ProviderProfileSummary = {
  profileId: ProviderProfileId;
  providerId: ProviderId;
  displayName: string;
  protocol: ProviderProtocol;
  enabled: boolean;
  external: boolean;
  endpointOrigin?: string;
  apiKeyEnvName?: string;
  keyConfigured: boolean;
  models: Array<{
    modelId: ModelId;
    displayName: string;
    contextWindow?: number;
    maxOutputTokens?: number;
    reasoningPresets: ReasoningPreset[];
    defaultReasoningPreset: ReasoningPreset;
    reasoningFixed: boolean;
  }>;
};

export type ProviderProfileErrorCode =
  | "invalid_provider_config"
  | "duplicate_provider_profile"
  | "builtin_profile_id_reserved"
  | "duplicate_provider_model"
  | "unknown_provider_protocol"
  | "unknown_reasoning_adapter"
  | "plaintext_api_key_not_allowed"
  | "invalid_provider_url";

export class ProviderProfileConfigError extends Error {
  constructor(
    readonly code: ProviderProfileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProviderProfileConfigError";
  }
}
