import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { resolveAgentPaths, type AgentPaths } from "../../config/paths.js";
import { builtinProviderProfileIds } from "./BuiltinProviderProfiles.js";
import { hasReasoningAdapter } from "./ReasoningAdapterRegistry.js";
import {
  ProviderProfileConfigError,
  type ProviderModelProfile,
  type ProviderProfile,
  type ProviderProfileConfigFile,
  type ReasoningControl,
  type ReasoningPreset,
} from "./ProviderProfileTypes.js";

const FORBIDDEN_KEYS = new Set([
  "apiKey",
  "authorization",
  "headers",
  "bearerToken",
  "secret",
  "password",
  "extraBody",
  "requestTemplate",
  "command",
  "executable",
]);

const REASONING_PRESETS = new Set(["off", "low", "medium", "high", "max"]);
const PROTOCOLS = new Set(["dry-run", "openai-chat-completions"]);

export function providerProfilesConfigPath(paths: AgentPaths = resolveAgentPaths()): string {
  return join(paths.dataRoot, "runtime", "agent", "provider_profiles.json");
}

export function readUserProviderProfileConfig(paths: AgentPaths = resolveAgentPaths()): ProviderProfileConfigFile {
  const path = providerProfilesConfigPath(paths);
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return validateProviderProfileConfig(parsed, { requireHttps: true, allowDryRun: false });
  } catch (error) {
    if (isMissingFile(error)) {
      return { schemaVersion: "0.6", profiles: [] };
    }
    throw error;
  }
}

export function writeUserProviderProfileConfig(config: ProviderProfileConfigFile, paths: AgentPaths = resolveAgentPaths()): void {
  const validated = validateProviderProfileConfig(config, { requireHttps: true, allowDryRun: false });
  const path = providerProfilesConfigPath(paths);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function validateProviderProfileConfig(value: unknown, options: { requireHttps: boolean; allowDryRun: boolean }): ProviderProfileConfigFile {
  rejectForbiddenKeys(value);
  if (!isRecord(value) || value.schemaVersion !== "0.6" || !Array.isArray(value.profiles)) {
    throw new ProviderProfileConfigError("invalid_provider_config", "provider config must have schemaVersion=0.6 and profiles[]");
  }

  const seenProfiles = new Set<string>();
  const reservedIds = builtinProviderProfileIds();
  const profiles = value.profiles.map((profile) => parseProfile(profile, options));
  for (const profile of profiles) {
    if (reservedIds.has(profile.id)) {
      throw new ProviderProfileConfigError("builtin_profile_id_reserved", `built-in provider profile id is reserved: ${profile.id}`);
    }
    if (seenProfiles.has(profile.id)) {
      throw new ProviderProfileConfigError("duplicate_provider_profile", `duplicate provider profile: ${profile.id}`);
    }
    seenProfiles.add(profile.id);
  }
  return { schemaVersion: "0.6", profiles };
}

function parseProfile(value: unknown, options: { requireHttps: boolean; allowDryRun: boolean }): ProviderProfile {
  if (!isRecord(value)) {
    throw new ProviderProfileConfigError("invalid_provider_config", "provider profile must be an object");
  }
  const id = boundedString(value.id, "id");
  const providerId = boundedString(value.providerId, "providerId");
  const displayName = boundedString(value.displayName, "displayName");
  const protocol = boundedString(value.protocol, "protocol");
  if (!PROTOCOLS.has(protocol)) {
    throw new ProviderProfileConfigError("unknown_provider_protocol", `unknown provider protocol: ${protocol}`);
  }
  if (protocol === "dry-run" && !options.allowDryRun) {
    throw new ProviderProfileConfigError("invalid_provider_config", "user config must not redefine dry-run profile");
  }
  const baseUrl = typeof value.baseUrl === "string" ? validateBaseUrl(value.baseUrl, options.requireHttps, protocol) : "";
  const apiKeyEnv = value.apiKeyEnv === undefined ? undefined : validateEnvName(value.apiKeyEnv);
  const external = typeof value.external === "boolean" ? value.external : protocol !== "dry-run";
  const enabled = typeof value.enabled === "boolean" ? value.enabled : true;
  if (!Array.isArray(value.models) || value.models.length === 0) {
    throw new ProviderProfileConfigError("invalid_provider_config", "provider profile requires at least one model");
  }
  const seenModels = new Set<string>();
  const models = value.models.map(parseModel);
  for (const model of models) {
    if (seenModels.has(model.id)) {
      throw new ProviderProfileConfigError("duplicate_provider_model", `duplicate provider model: ${model.id}`);
    }
    seenModels.add(model.id);
  }
  return { id, providerId, displayName, protocol: protocol as ProviderProfile["protocol"], baseUrl, apiKeyEnv, external, enabled, models };
}

function parseModel(value: unknown): ProviderModelProfile {
  if (!isRecord(value)) {
    throw new ProviderProfileConfigError("invalid_provider_config", "provider model must be an object");
  }
  const id = boundedString(value.id, "model.id");
  const displayName = boundedString(value.displayName, "model.displayName");
  const contextWindow = optionalPositiveInteger(value.contextWindow, "contextWindow");
  const maxOutputTokens = optionalPositiveInteger(value.maxOutputTokens, "maxOutputTokens");
  const reasoningControl = parseReasoningControl(value.reasoningControl);
  return { id, displayName, contextWindow, maxOutputTokens, reasoningControl };
}

function parseReasoningControl(value: unknown): ReasoningControl {
  if (!isRecord(value)) {
    throw new ProviderProfileConfigError("invalid_provider_config", "reasoningControl must be an object");
  }
  if (value.kind === "fixed") {
    if (value.defaultPreset !== "off") {
      throw new ProviderProfileConfigError("invalid_provider_config", "fixed reasoning must default to off");
    }
    return { kind: "fixed", defaultPreset: "off" };
  }
  if (value.kind === "preset") {
    const adapterId = boundedString(value.adapterId, "reasoningControl.adapterId");
    if (!hasReasoningAdapter(adapterId)) {
      throw new ProviderProfileConfigError("unknown_reasoning_adapter", `unknown reasoning adapter: ${adapterId}`);
    }
    if (!Array.isArray(value.supportedPresets) || value.supportedPresets.length === 0) {
      throw new ProviderProfileConfigError("invalid_provider_config", "preset reasoning requires supportedPresets");
    }
    const supportedPresets = value.supportedPresets.map((item) => parseReasoningPreset(item));
    const defaultPreset = parseReasoningPreset(value.defaultPreset);
    if (!supportedPresets.includes(defaultPreset)) {
      throw new ProviderProfileConfigError("invalid_provider_config", "default reasoning preset must be supported");
    }
    return { kind: "preset", adapterId, supportedPresets, defaultPreset };
  }
  throw new ProviderProfileConfigError("invalid_provider_config", "unknown reasoningControl kind");
}

function validateBaseUrl(value: string, requireHttps: boolean, protocol: string): string {
  if (protocol === "dry-run") {
    return "";
  }
  try {
    const url = new URL(value);
    if (requireHttps && url.protocol !== "https:") {
      throw new ProviderProfileConfigError("invalid_provider_url", "provider baseUrl must use https");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new ProviderProfileConfigError("invalid_provider_url", "provider baseUrl must use http or https");
    }
    if (url.username || url.password || url.hash || url.search) {
      throw new ProviderProfileConfigError("invalid_provider_url", "provider baseUrl must not include credentials, query, or fragment");
    }
    if (url.pathname.split("/").includes("..")) {
      throw new ProviderProfileConfigError("invalid_provider_url", "provider baseUrl must not include path traversal");
    }
    return url.toString().replace(/\/$/, "");
  } catch (error) {
    if (error instanceof ProviderProfileConfigError) {
      throw error;
    }
    throw new ProviderProfileConfigError("invalid_provider_url", "provider baseUrl must be a valid URL");
  }
}

function validateEnvName(value: unknown): string {
  const name = boundedString(value, "apiKeyEnv");
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
    throw new ProviderProfileConfigError("invalid_provider_config", "apiKeyEnv must be an environment variable name");
  }
  return name;
}

function rejectForbiddenKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      rejectForbiddenKeys(item);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      if (key === "apiKey") {
        throw new ProviderProfileConfigError("plaintext_api_key_not_allowed", "plaintext apiKey is not allowed; use apiKeyEnv");
      }
      throw new ProviderProfileConfigError("plaintext_api_key_not_allowed", `forbidden provider config key: ${key}`);
    }
    rejectForbiddenKeys(child);
  }
}

function boundedString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 160) {
    throw new ProviderProfileConfigError("invalid_provider_config", `${name} must be a bounded non-empty string`);
  }
  return value.trim();
}

function optionalPositiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > 1_000_000) {
    throw new ProviderProfileConfigError("invalid_provider_config", `${name} must be a positive integer`);
  }
  return value;
}

function parseReasoningPreset(value: unknown): ReasoningPreset {
  if (typeof value !== "string" || !REASONING_PRESETS.has(value)) {
    throw new ProviderProfileConfigError("invalid_provider_config", "unsupported reasoning preset value");
  }
  return value as ReasoningPreset;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}
