import type { AgentDatabase } from "../db/connection.js";
import { nowIso } from "../events/AgentEvent.js";
import type { ModelId, ProviderConnectionState, ProviderProfileId, ReasoningPreset } from "./ProviderTypes.js";
import { DRY_RUN_MODEL_ID, DRY_RUN_PROFILE_ID } from "./registry/BuiltinProviderProfiles.js";
import { ProviderProfileRegistry } from "./registry/ProviderProfileRegistry.js";
import type { ProviderModelProfile, ProviderProfile } from "./registry/ProviderProfileTypes.js";

export type ProviderSelectionSnapshot = {
  profileId: ProviderProfileId;
  providerId: string;
  providerDisplayName: string;
  protocol: "dry-run" | "openai-chat-completions";
  modelId: ModelId;
  modelDisplayName: string;
  reasoningPreset: ReasoningPreset;
  external: boolean;
  enabled: boolean;
  configured: boolean;
  connectionState: ProviderConnectionState;
  endpointOrigin?: string;
  apiKeyEnvName?: string;
  keyConfigured: boolean;
  warning?: string;
  profile: ProviderProfile;
  model: ProviderModelProfile;
};

export type ProviderConnectionRecord = {
  state: ProviderConnectionState;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
};

type SelectionRow = {
  profile_id: string;
  model_id: string;
  reasoning_preset: ReasoningPreset;
};

type ConnectionRow = {
  status: ProviderConnectionState;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error_code: string | null;
};

export class ProviderRuntimeSelectionStore {
  constructor(
    private readonly db: AgentDatabase,
    private readonly registry: ProviderProfileRegistry,
  ) {}

  getActiveSnapshot(): ProviderSelectionSnapshot {
    const row = this.db.prepare("SELECT profile_id, model_id, reasoning_preset FROM provider_runtime_selection WHERE id = 'active'").get() as SelectionRow | undefined;
    if (!row) {
      return this.dryRunSnapshot();
    }
    const selected = this.registry.getModel(row.profile_id, row.model_id);
    if (!selected) {
      return this.dryRunSnapshot("invalid_saved_provider_selection");
    }
    const presets = this.registry.reasoningPresets(selected.model);
    if (!presets.includes(row.reasoning_preset)) {
      return this.dryRunSnapshot("invalid_saved_reasoning_preset");
    }
    return this.snapshotFor(selected.profile, selected.model, row.reasoning_preset);
  }

  setActiveSelection(input: { profileId: ProviderProfileId; modelId: ModelId; reasoningPreset: ReasoningPreset }): { previous: ProviderSelectionSnapshot; next: ProviderSelectionSnapshot } {
    const previous = this.getActiveSnapshot();
    const selected = this.registry.getModel(input.profileId, input.modelId);
    if (!selected) {
      const profile = this.registry.getProfile(input.profileId);
      throw new ProviderSelectionError(profile ? "unknown_provider_model" : "unknown_provider_profile");
    }
    if (!selected.profile.enabled) {
      throw new ProviderSelectionError("provider_profile_disabled");
    }
    const presets = this.registry.reasoningPresets(selected.model);
    if (!presets.includes(input.reasoningPreset)) {
      throw new ProviderSelectionError("unsupported_reasoning_preset");
    }
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO provider_runtime_selection (id, profile_id, model_id, reasoning_preset, updated_at)
         VALUES ('active', ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           profile_id = excluded.profile_id,
           model_id = excluded.model_id,
           reasoning_preset = excluded.reasoning_preset,
           updated_at = excluded.updated_at`,
      )
      .run(input.profileId, input.modelId, input.reasoningPreset, ts);
    return { previous, next: this.getActiveSnapshot() };
  }

  getConnectionRecord(snapshot: ProviderSelectionSnapshot): ProviderConnectionRecord {
    if (snapshot.protocol === "dry-run") {
      return { state: "dry_run", lastAttemptAt: null, lastSuccessAt: null, lastErrorCode: null };
    }
    if (!snapshot.enabled) {
      return { state: "disabled", lastAttemptAt: null, lastSuccessAt: null, lastErrorCode: "provider_profile_disabled" };
    }
    if (!snapshot.configured) {
      return { state: "unconfigured", lastAttemptAt: null, lastSuccessAt: null, lastErrorCode: "provider_not_configured" };
    }
    const row = this.db
      .prepare(
        `SELECT status, last_attempt_at, last_success_at, last_error_code
         FROM provider_connection_status
         WHERE profile_id = ? AND model_id = ? AND reasoning_preset = ?`,
      )
      .get(snapshot.profileId, snapshot.modelId, snapshot.reasoningPreset) as ConnectionRow | undefined;
    if (!row) {
      return { state: "configured_unverified", lastAttemptAt: null, lastSuccessAt: null, lastErrorCode: null };
    }
    return {
      state: row.status,
      lastAttemptAt: row.last_attempt_at,
      lastSuccessAt: row.last_success_at,
      lastErrorCode: row.last_error_code,
    };
  }

  markAttempt(snapshot: ProviderSelectionSnapshot): void {
    if (!snapshot.external) {
      return;
    }
    const ts = nowIso();
    this.upsertConnection(snapshot, "configured_unverified", ts, null, null);
  }

  markConnected(snapshot: ProviderSelectionSnapshot): void {
    if (!snapshot.external) {
      return;
    }
    const ts = nowIso();
    this.upsertConnection(snapshot, "connected", ts, ts, null);
  }

  markError(snapshot: ProviderSelectionSnapshot, errorCode: string): void {
    if (!snapshot.external) {
      return;
    }
    const ts = nowIso();
    this.upsertConnection(snapshot, "error", ts, null, errorCode);
  }

  private snapshotFor(profile: ProviderProfile, model: ProviderModelProfile, reasoningPreset: ReasoningPreset, warning?: string): ProviderSelectionSnapshot {
    const keyConfigured = profile.external ? this.registry.keyConfigured(profile) : true;
    const enabled = profile.enabled;
    const configured = !profile.external || (enabled && keyConfigured && Boolean(profile.baseUrl));
    const connectionState: ProviderConnectionState = profile.protocol === "dry-run" ? "dry_run" : !enabled ? "disabled" : !configured ? "unconfigured" : "configured_unverified";
    return {
      profileId: profile.id,
      providerId: profile.providerId,
      providerDisplayName: profile.displayName,
      protocol: profile.protocol,
      modelId: model.id,
      modelDisplayName: model.displayName,
      reasoningPreset,
      external: profile.external,
      enabled,
      configured,
      connectionState,
      endpointOrigin: this.registry.endpointOrigin(profile),
      apiKeyEnvName: profile.apiKeyEnv,
      keyConfigured,
      warning,
      profile,
      model,
    };
  }

  private dryRunSnapshot(warning?: string): ProviderSelectionSnapshot {
    const selected = this.registry.getModel(DRY_RUN_PROFILE_ID, DRY_RUN_MODEL_ID);
    if (!selected) {
      throw new Error("built-in dry-run profile is missing");
    }
    return this.snapshotFor(selected.profile, selected.model, "off", warning);
  }

  private upsertConnection(snapshot: ProviderSelectionSnapshot, status: ProviderConnectionState, attemptAt: string | null, successAt: string | null, errorCode: string | null): void {
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO provider_connection_status
          (profile_id, model_id, reasoning_preset, status, last_attempt_at, last_success_at, last_error_code, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(profile_id, model_id, reasoning_preset) DO UPDATE SET
           status = excluded.status,
           last_attempt_at = COALESCE(excluded.last_attempt_at, provider_connection_status.last_attempt_at),
           last_success_at = COALESCE(excluded.last_success_at, provider_connection_status.last_success_at),
           last_error_code = excluded.last_error_code,
           updated_at = excluded.updated_at`,
      )
      .run(snapshot.profileId, snapshot.modelId, snapshot.reasoningPreset, status, attemptAt, successAt, errorCode, ts);
  }
}

export class ProviderSelectionError extends Error {
  constructor(readonly code: "unknown_provider_profile" | "unknown_provider_model" | "unsupported_reasoning_preset" | "provider_profile_disabled" | "invalid_provider_selection") {
    super(code);
    this.name = "ProviderSelectionError";
  }
}
