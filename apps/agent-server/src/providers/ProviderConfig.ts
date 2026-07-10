import type { ProviderSelectionSnapshot } from "./ProviderRuntimeSelection.js";

export type OpenAIChatCompatibleConfig = {
  profileId: string;
  providerId: string;
  modelId: string;
  modelDisplayName: string;
  endpoint: string;
  endpointOrigin: string;
  apiKey: string | null;
  timeoutMs: number;
  maxOutputTokens?: number;
  reasoningPreset: "off" | "low" | "medium" | "high" | "max";
  reasoningAdapterId?: string;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;
const MIN_OUTPUT_TOKENS = 1;
const MAX_OUTPUT_TOKENS = 16_384;

export function openAIConfigFromSnapshot(snapshot: ProviderSelectionSnapshot, env: NodeJS.ProcessEnv = process.env): OpenAIChatCompatibleConfig {
  return {
    profileId: snapshot.profileId,
    providerId: snapshot.providerId,
    modelId: snapshot.modelId,
    modelDisplayName: snapshot.modelDisplayName,
    endpoint: chatCompletionsEndpoint(snapshot.profile.baseUrl),
    endpointOrigin: snapshot.endpointOrigin ?? new URL(snapshot.profile.baseUrl).origin,
    apiKey: snapshot.apiKeyEnvName && env[snapshot.apiKeyEnvName]?.trim() ? env[snapshot.apiKeyEnvName] as string : null,
    timeoutMs: parseTimeout(env.PKOS_LLM_TIMEOUT_MS),
    maxOutputTokens: snapshot.model.maxOutputTokens ?? parseOptionalInteger(env.PKOS_LLM_MAX_OUTPUT_TOKENS, MIN_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS),
    reasoningPreset: snapshot.reasoningPreset,
    reasoningAdapterId: snapshot.model.reasoningControl.kind === "preset" ? snapshot.model.reasoningControl.adapterId : undefined,
  };
}

function chatCompletionsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return `${normalized}/chat/completions`;
}

function parseTimeout(value: string | undefined): number {
  return parseOptionalInteger(value, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;
}

function parseOptionalInteger(value: string | undefined, min: number, max: number): number | undefined {
  if (!value || !value.trim() || !/^[0-9]+$/.test(value.trim())) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(min, Math.min(max, parsed));
}
