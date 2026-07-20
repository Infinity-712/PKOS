import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type ServiceCapabilityManifest = {
  schemaVersion: string;
  service: {
    name: string;
    version: string;
    apiContractVersion: string;
  };
  database: {
    requiredSchemaVersion: number;
  };
  capabilities: string[];
};

export type ServiceSourceState = {
  revision: string;
  dirty: boolean;
};

export type ServiceIdentity = {
  name: string;
  version: string;
  apiContractVersion: string;
  buildFingerprint: string;
  sourceRevision: string;
  dirty: boolean;
  capabilities: string[];
  manifestFingerprint: string;
  requiredDatabaseSchemaVersion: number;
};

export function loadServiceCapabilityManifest(path = serviceCapabilityManifestPath()): ServiceCapabilityManifest {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return validateServiceCapabilityManifest(parsed);
}

export function buildServiceIdentity(sourceState = readServiceSourceState(), manifest = loadServiceCapabilityManifest()): ServiceIdentity {
  const normalized = normalizeServiceCapabilityManifest(manifest);
  return {
    name: normalized.service.name,
    version: normalized.service.version,
    apiContractVersion: normalized.service.apiContractVersion,
    buildFingerprint: serviceBuildFingerprint(normalized, sourceState),
    sourceRevision: sourceState.revision,
    dirty: sourceState.dirty,
    capabilities: normalized.capabilities,
    manifestFingerprint: serviceManifestFingerprint(normalized),
    requiredDatabaseSchemaVersion: normalized.database.requiredSchemaVersion,
  };
}

export function canonicalizeServiceCapabilityManifest(manifest: ServiceCapabilityManifest): string {
  return stableJson(normalizeServiceCapabilityManifest(manifest));
}

export function serviceManifestFingerprint(manifest: ServiceCapabilityManifest): string {
  return shortSha256(canonicalizeServiceCapabilityManifest(manifest));
}

export function serviceBuildFingerprint(manifest: ServiceCapabilityManifest, sourceState: ServiceSourceState): string {
  const sourceRevision = `${sourceState.revision}${sourceState.dirty ? "+dirty" : ""}`;
  return shortSha256(`${canonicalizeServiceCapabilityManifest(manifest)}\n${sourceRevision}`);
}

export function databaseCompatible(actualSchemaVersion: number, requiredSchemaVersion: number): boolean {
  return actualSchemaVersion >= requiredSchemaVersion;
}

export function serviceCapabilityManifestPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "service-capabilities.json");
}

export function normalizeServiceCapabilityManifest(manifest: ServiceCapabilityManifest): ServiceCapabilityManifest {
  const validated = validateServiceCapabilityManifest(manifest);
  return {
    schemaVersion: validated.schemaVersion,
    service: {
      name: validated.service.name,
      version: validated.service.version,
      apiContractVersion: validated.service.apiContractVersion,
    },
    database: {
      requiredSchemaVersion: validated.database.requiredSchemaVersion,
    },
    capabilities: [...validated.capabilities].sort(),
  };
}

export function readServiceSourceState(): ServiceSourceState {
  const envRevision = process.env.PKOS_BUILD_REVISION?.trim();
  const envDirty = process.env.PKOS_BUILD_DIRTY?.trim().toLowerCase();
  const revision = envRevision || gitOutput(["rev-parse", "HEAD"]) || "unknown";
  const dirty = envDirty === "true" ? true : envDirty === "false" ? false : gitDirty();
  return { revision, dirty };
}

function validateServiceCapabilityManifest(value: unknown): ServiceCapabilityManifest {
  if (!isRecord(value)) {
    throw new Error("service capability manifest must be an object");
  }
  if (typeof value.schemaVersion !== "string" || value.schemaVersion.trim() === "") {
    throw new Error("service capability manifest schemaVersion is required");
  }
  if (!isRecord(value.service)) {
    throw new Error("service capability manifest service is required");
  }
  if (value.service.name !== "pkos-agent-server") {
    throw new Error("service capability manifest service.name must be pkos-agent-server");
  }
  if (typeof value.service.version !== "string" || value.service.version.trim() === "") {
    throw new Error("service capability manifest service.version is required");
  }
  if (typeof value.service.apiContractVersion !== "string" || value.service.apiContractVersion.trim() === "") {
    throw new Error("service capability manifest service.apiContractVersion is required");
  }
  const requiredSchemaVersion = isRecord(value.database) ? value.database.requiredSchemaVersion : undefined;
  if (!Number.isInteger(requiredSchemaVersion) || (requiredSchemaVersion as number) < 1) {
    throw new Error("service capability manifest database.requiredSchemaVersion must be a positive integer");
  }
  if (!Array.isArray(value.capabilities) || value.capabilities.length === 0) {
    throw new Error("service capability manifest capabilities must be a non-empty array");
  }
  const capabilities = value.capabilities.map((capability) => {
    if (typeof capability !== "string" || capability.trim() === "") {
      throw new Error("service capability manifest capabilities must be non-empty strings");
    }
    return capability.trim();
  });
  const unique = new Set(capabilities);
  if (unique.size !== capabilities.length) {
    throw new Error("service capability manifest capabilities must be unique");
  }
  return {
    schemaVersion: value.schemaVersion.trim(),
    service: {
      name: value.service.name,
      version: value.service.version.trim(),
      apiContractVersion: value.service.apiContractVersion.trim(),
    },
    database: {
      requiredSchemaVersion: requiredSchemaVersion as number,
    },
    capabilities,
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error(`unsupported manifest value: ${String(value)}`);
}

function gitOutput(args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".."), ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function gitDirty(): boolean {
  const output = gitOutput(["status", "--porcelain"]);
  return output !== null && output.length > 0;
}

function shortSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
