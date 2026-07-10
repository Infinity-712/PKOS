import { URL } from "node:url";

import { resolveAgentPaths, type AgentPaths } from "../../config/paths.js";
import type { ModelId, ProviderProfileId, ReasoningPreset } from "../ProviderTypes.js";
import { builtinProviderProfileIds, builtinProviderProfiles } from "./BuiltinProviderProfiles.js";
import { readUserProviderProfileConfig } from "./ProviderProfileConfigLoader.js";
import {
  ProviderProfileConfigError,
  type ProviderModelProfile,
  type ProviderProfile,
  type ProviderProfileSummary,
} from "./ProviderProfileTypes.js";

export class ProviderProfileRegistry {
  constructor(
    private readonly paths: AgentPaths = resolveAgentPaths(),
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  listProfiles(): ProviderProfile[] {
    const builtins = builtinProviderProfiles();
    const reservedIds = builtinProviderProfileIds();
    const userProfiles = readUserProviderProfileConfig(this.paths).profiles;
    for (const profile of userProfiles) {
      if (reservedIds.has(profile.id)) {
        throw new ProviderProfileConfigError("builtin_profile_id_reserved", `built-in provider profile id is reserved: ${profile.id}`);
      }
    }
    const profiles = [...builtins, ...userProfiles];
    const seen = new Set<string>();
    for (const profile of profiles) {
      if (seen.has(profile.id)) {
        throw new ProviderProfileConfigError("duplicate_provider_profile", `duplicate provider profile: ${profile.id}`);
      }
      seen.add(profile.id);
    }
    return profiles;
  }

  getProfile(profileId: ProviderProfileId): ProviderProfile | null {
    return this.listProfiles().find((profile) => profile.id === profileId) ?? null;
  }

  getModel(profileId: ProviderProfileId, modelId: ModelId): { profile: ProviderProfile; model: ProviderModelProfile } | null {
    const profile = this.getProfile(profileId);
    const model = profile?.models.find((candidate) => candidate.id === modelId);
    return profile && model ? { profile, model } : null;
  }

  summaries(): ProviderProfileSummary[] {
    return this.listProfiles().map((profile) => this.summary(profile));
  }

  keyConfigured(profile: ProviderProfile): boolean {
    return Boolean(profile.apiKeyEnv && this.env[profile.apiKeyEnv]?.trim());
  }

  endpointOrigin(profile: ProviderProfile): string | undefined {
    if (!profile.baseUrl) {
      return undefined;
    }
    try {
      return new URL(profile.baseUrl).origin;
    } catch {
      return undefined;
    }
  }

  reasoningPresets(model: ProviderModelProfile): ReasoningPreset[] {
    return model.reasoningControl.kind === "fixed" ? [model.reasoningControl.defaultPreset] : [...model.reasoningControl.supportedPresets];
  }

  defaultReasoningPreset(model: ProviderModelProfile): ReasoningPreset {
    return model.reasoningControl.defaultPreset;
  }

  private summary(profile: ProviderProfile): ProviderProfileSummary {
    return {
      profileId: profile.id,
      providerId: profile.providerId,
      displayName: profile.displayName,
      protocol: profile.protocol,
      enabled: profile.enabled,
      external: profile.external,
      endpointOrigin: this.endpointOrigin(profile),
      apiKeyEnvName: profile.apiKeyEnv,
      keyConfigured: profile.external ? this.keyConfigured(profile) : true,
      models: profile.models.map((model) => ({
        modelId: model.id,
        displayName: model.displayName,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        reasoningPresets: this.reasoningPresets(model),
        defaultReasoningPreset: this.defaultReasoningPreset(model),
        reasoningFixed: model.reasoningControl.kind === "fixed",
      })),
    };
  }
}
