import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

import type { AgentPaths } from "../config/paths.js";
import type { AgentDatabase } from "../db/connection.js";

export type RuntimeFingerprintInput = {
  coreRoot: string;
  dataRoot: string;
  agentDbPath: string;
};

export type RuntimeIdentity = RuntimeFingerprintInput & {
  profileName: string;
  runtimeFingerprint: string;
  dataRootFingerprint: string;
  processStartedAt: string;
  processId: number;
};

export type RuntimeInfoProviderStatus = {
  selection?: {
    profileId?: string;
    modelId?: string | null;
    reasoningPreset?: string;
    keyConfigured?: boolean;
  };
};

export type RuntimeInfoPayload = {
  service: "pkos-agent-server";
  profileName: string;
  runtimeFingerprint: string;
  dataRoot: {
    label: string;
    fingerprint: string;
  };
  database: {
    exists: boolean;
    schemaVersion: number;
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

export function normalizeRuntimePath(path: string): string {
  let normalized = resolve(path).replace(/\\/g, "/");
  while (normalized.length > 3 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function runtimeFingerprint(input: RuntimeFingerprintInput): string {
  return sha256([normalizeRuntimePath(input.coreRoot), normalizeRuntimePath(input.dataRoot), normalizeRuntimePath(input.agentDbPath)].join("\n"));
}

export function dataRootFingerprint(dataRoot: string): string {
  return sha256(normalizeRuntimePath(dataRoot));
}

export function buildRuntimeIdentity(input: {
  profileName?: string;
  paths: AgentPaths;
  processId?: number;
  startedAt?: string;
}): RuntimeIdentity {
  const profileName = input.profileName?.trim() || process.env.PKOS_RUNTIME_PROFILE_NAME?.trim() || "direct";
  return {
    profileName,
    coreRoot: input.paths.coreRoot,
    dataRoot: input.paths.dataRoot,
    agentDbPath: input.paths.agentDbPath,
    runtimeFingerprint: runtimeFingerprint(input.paths),
    dataRootFingerprint: dataRootFingerprint(input.paths.dataRoot),
    processStartedAt: input.startedAt ?? new Date().toISOString(),
    processId: input.processId ?? process.pid,
  };
}

export function createRuntimeInfoPayload(
  identity: RuntimeIdentity,
  db: AgentDatabase,
  providerStatus: RuntimeInfoProviderStatus = {},
): RuntimeInfoPayload {
  const selection = providerStatus.selection ?? {};
  return {
    service: "pkos-agent-server",
    profileName: identity.profileName,
    runtimeFingerprint: shortFingerprint(identity.runtimeFingerprint),
    dataRoot: {
      label: basename(identity.dataRoot) || "data-root",
      fingerprint: shortFingerprint(identity.dataRootFingerprint),
    },
    database: {
      exists: existsSync(identity.agentDbPath),
      schemaVersion: schemaVersion(db),
    },
    process: {
      startedAt: identity.processStartedAt,
      pid: identity.processId,
    },
    provider: {
      profileId: typeof selection.profileId === "string" ? selection.profileId : "unknown",
      modelId: typeof selection.modelId === "string" ? selection.modelId : null,
      reasoningPreset: typeof selection.reasoningPreset === "string" ? selection.reasoningPreset : "unknown",
      keyConfigured: selection.keyConfigured === true,
    },
  };
}

export function createHealthPayload(identity: RuntimeIdentity): {
  ok: true;
  service: "pkos-agent-server";
  mode: "dry-run";
  runtimeFingerprint: string;
  profileName: string;
} {
  return {
    ok: true,
    service: "pkos-agent-server",
    mode: "dry-run",
    runtimeFingerprint: shortFingerprint(identity.runtimeFingerprint),
    profileName: identity.profileName,
  };
}

export function logRuntimeStartup(input: {
  identity: RuntimeIdentity;
  db: AgentDatabase;
  host: string;
  port: number;
  providerStatus: RuntimeInfoProviderStatus;
  dbExistedAtStartup?: boolean;
}): void {
  const payload = createRuntimeInfoPayload(input.identity, input.db, input.providerStatus);
  console.log(`[pkos-runtime] core_root ${input.identity.coreRoot}`);
  console.log(`[pkos-runtime] data_root ${input.identity.dataRoot}`);
  console.log(`[pkos-runtime] agent_db ${input.identity.agentDbPath}`);
  console.log(`[pkos-runtime] profile ${input.identity.profileName}`);
  console.log(`[pkos-runtime] fingerprint ${payload.runtimeFingerprint}`);
  console.log(`[pkos-runtime] agent_server http://${input.host}:${input.port}`);
  console.log(`[pkos-runtime] provider ${payload.provider.profileId}/${payload.provider.modelId ?? "none"}/${payload.provider.reasoningPreset}`);
  console.log(`[pkos-runtime] key_configured ${payload.provider.keyConfigured}`);
  console.log(`[pkos-runtime] existing_db ${input.dbExistedAtStartup ?? payload.database.exists}`);
  console.log(`[pkos-runtime] migration_version ${payload.database.schemaVersion}`);
}

function schemaVersion(db: AgentDatabase): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}

function shortFingerprint(value: string): string {
  return value.slice(0, 16);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
