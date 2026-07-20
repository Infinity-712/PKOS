import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { openAgentDatabase } from "../db/connection.js";
import { createAgentHttpServer } from "../server/httpServer.js";
import { buildRuntimeIdentity, createHealthPayload, createRuntimeInfoPayload } from "../runtime/RuntimeIdentity.js";
import {
  buildServiceIdentity,
  canonicalizeServiceCapabilityManifest,
  serviceBuildFingerprint,
  serviceManifestFingerprint,
  type ServiceCapabilityManifest,
} from "../runtime/ServiceIdentity.js";

type RuntimeInfoPayload = {
  service?: {
    name?: string;
    version?: string;
    apiContractVersion?: string;
    buildFingerprint?: string;
    sourceRevision?: string;
    dirty?: boolean;
    capabilities?: string[];
  };
  runtimeFingerprint?: string;
  dataRoot?: { label?: string; fingerprint?: string };
  database?: { exists?: boolean; schemaVersion?: number; requiredSchemaVersion?: number; compatible?: boolean };
  provider?: { keyConfigured?: boolean };
};

type HealthPayload = {
  ok?: boolean;
  service?: string;
  serviceVersion?: string;
  serviceBuildFingerprint?: string;
  apiContractVersion?: string;
  databaseSchemaVersion?: number;
  databaseRequiredSchemaVersion?: number;
  databaseCompatible?: boolean;
};

const baseManifest: ServiceCapabilityManifest = {
  schemaVersion: "0.7-service-identity",
  service: {
    name: "pkos-agent-server",
    version: "0.7-service-identity",
    apiContractVersion: "0.7",
  },
  database: {
    requiredSchemaVersion: 6,
  },
  capabilities: [
    "runtime-info.v1",
    "health.v1",
    "reminder.authority.write",
    "task.authority.read",
  ],
};

const orderedManifest: ServiceCapabilityManifest = {
  ...baseManifest,
  capabilities: [...baseManifest.capabilities].reverse(),
};
assert(
  canonicalizeServiceCapabilityManifest(baseManifest) === canonicalizeServiceCapabilityManifest(orderedManifest),
  "capability manifest canonicalization was order-dependent",
);
assert(
  serviceManifestFingerprint(baseManifest) === serviceManifestFingerprint(orderedManifest),
  "capability order changed manifest fingerprint",
);
assert(
  serviceBuildFingerprint(baseManifest, { revision: "rev-a", dirty: false }) ===
    serviceBuildFingerprint(orderedManifest, { revision: "rev-a", dirty: false }),
  "capability order changed service build fingerprint",
);
assert(
  serviceBuildFingerprint(baseManifest, { revision: "rev-a", dirty: false }) !==
    serviceBuildFingerprint({ ...baseManifest, capabilities: [...baseManifest.capabilities, "state-timeline.read"] }, { revision: "rev-a", dirty: false }),
  "capability add/remove did not change service build fingerprint",
);
assert(
  serviceBuildFingerprint(baseManifest, { revision: "rev-a", dirty: false }) !==
    serviceBuildFingerprint({ ...baseManifest, service: { ...baseManifest.service, version: "0.7-next" } }, { revision: "rev-a", dirty: false }),
  "service version did not change service build fingerprint",
);
assert(
  serviceBuildFingerprint(baseManifest, { revision: "rev-a", dirty: false }) !== serviceBuildFingerprint(baseManifest, { revision: "rev-b", dirty: false }),
  "source revision did not change service build fingerprint",
);
assert(
  serviceBuildFingerprint(baseManifest, { revision: "rev-a", dirty: false }) !== serviceBuildFingerprint(baseManifest, { revision: "rev-a", dirty: true }),
  "dirty source state did not change service build fingerprint",
);

const root = mkdtempSync(join(tmpdir(), "pkos-service-identity-smoke-"));
const originalDataRoot = process.env.PKOS_DATA_ROOT;
const originalCoreRoot = process.env.PKOS_CORE_ROOT;
const originalDbPath = process.env.PKOS_AGENT_DB_PATH;
const originalKey = process.env.DEEPSEEK_API_KEY;
const originalRevision = process.env.PKOS_BUILD_REVISION;
const originalDirty = process.env.PKOS_BUILD_DIRTY;

try {
  process.env.PKOS_BUILD_REVISION = "service-smoke-revision";
  process.env.PKOS_BUILD_DIRTY = "false";
  const coreRoot = join(root, "Core Root");
  const dataRootA = join(root, "Data Root A");
  const dataRootB = join(root, "Data Root B");
  process.env.PKOS_CORE_ROOT = coreRoot;
  process.env.PKOS_DATA_ROOT = dataRootA;
  delete process.env.PKOS_AGENT_DB_PATH;
  process.env.DEEPSEEK_API_KEY = "SECRET_SHOULD_NOT_LEAK";

  const dbPathA = join(dataRootA, "runtime", "agent", "agent.sqlite");
  const db = openAgentDatabase();
  const serviceIdentity = buildServiceIdentity({ revision: "service-smoke-revision", dirty: false });
  try {
    const identity = buildRuntimeIdentity({
      profileName: "local-main",
      paths: { coreRoot, dataRoot: dataRootA, agentRuntimeDir: join(dataRootA, "runtime", "agent"), agentDbPath: dbPathA },
      processId: 1234,
      startedAt: "2026-07-10T00:00:00.000Z",
    });
    const payload = createRuntimeInfoPayload(identity, db, {
      selection: { profileId: "deepseek-official", modelId: "deepseek-v4-pro", reasoningPreset: "high", keyConfigured: true },
    });
    const serialized = JSON.stringify(payload);
    assert(payload.service.name === "pkos-agent-server", "runtime-info service name mismatch");
    assert(payload.service.version === serviceIdentity.version, "runtime-info service version mismatch");
    assert(payload.service.apiContractVersion === serviceIdentity.apiContractVersion, "runtime-info API contract mismatch");
    assert(payload.service.buildFingerprint === serviceIdentity.buildFingerprint, "runtime-info service build fingerprint mismatch");
    assert(payload.service.capabilities.includes("reminder.authority.write"), "runtime-info missing reminder authority capability");
    assert(payload.service.capabilities.includes("runtime-info.v1"), "runtime-info missing runtime-info capability");
    assert(payload.database.requiredSchemaVersion === 6, "runtime-info required schema version mismatch");
    assert(payload.database.schemaVersion === 6 && payload.database.compatible === true, "schema 6 should be compatible");
    assert(payload.dataRoot.label === basename(dataRootA), "runtime-info data label missing");
    assert(!serialized.includes(coreRoot), "runtime-info leaked absolute coreRoot");
    assert(!serialized.includes(dataRootA), "runtime-info leaked absolute dataRoot");
    assert(!serialized.includes(dbPathA), "runtime-info leaked absolute DB path");
    assert(!serialized.includes("SECRET_SHOULD_NOT_LEAK"), "runtime-info leaked API key value");
    assert(!serialized.includes("apiKey"), "runtime-info leaked apiKey-shaped field");

    const changedRuntimeIdentity = buildRuntimeIdentity({
      profileName: "local-main",
      paths: {
        coreRoot,
        dataRoot: dataRootB,
        agentRuntimeDir: join(dataRootB, "runtime", "agent"),
        agentDbPath: join(dataRootB, "runtime", "agent", "agent.sqlite"),
      },
      processId: 1234,
      startedAt: "2026-07-10T00:00:00.000Z",
    });
    const changedRuntimePayload = createRuntimeInfoPayload(changedRuntimeIdentity, db, {});
    assert(changedRuntimePayload.service.buildFingerprint === payload.service.buildFingerprint, "runtime data root changed service build fingerprint");
    const changedProviderPayload = createRuntimeInfoPayload(identity, db, {
      selection: { profileId: "custom-local", modelId: "other-model", reasoningPreset: "off", keyConfigured: false },
    });
    assert(changedProviderPayload.service.buildFingerprint === payload.service.buildFingerprint, "provider selection changed service build fingerprint");

    const db5 = new DatabaseSync(join(root, "schema5.sqlite"));
    try {
      db5.exec("PRAGMA user_version = 5");
      const schema5Payload = createRuntimeInfoPayload(identity, db5, {});
      assert(schema5Payload.database.schemaVersion === 5, "schema 5 payload did not expose actual version");
      assert(schema5Payload.database.requiredSchemaVersion === 6, "schema 5 payload did not expose required version");
      assert(schema5Payload.database.compatible === false, "schema 5 should be incompatible");
      const schema5Health = createHealthPayload(identity, db5);
      assert(schema5Health.ok === false && schema5Health.databaseCompatible === false, "health did not mark schema 5 incompatible");
    } finally {
      db5.close();
    }

    const health = createHealthPayload(identity, db) as HealthPayload;
    assert(health.ok === true, "health should be ok for schema 6");
    assert(health.service === "pkos-agent-server", "health service mismatch");
    assert(health.serviceVersion === serviceIdentity.version, "health service version missing");
    assert(health.serviceBuildFingerprint === serviceIdentity.buildFingerprint, "health service build fingerprint missing");
    assert(health.apiContractVersion === serviceIdentity.apiContractVersion, "health API contract missing");
    assert(health.databaseSchemaVersion === 6 && health.databaseRequiredSchemaVersion === 6, "health schema compatibility fields missing");

    const server = createAgentHttpServer({ db });
    try {
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("server did not bind");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const runtimeInfo = (await (await fetch(`${baseUrl}/api/runtime-info`)).json()) as RuntimeInfoPayload;
      assert(runtimeInfo.service?.buildFingerprint === serviceIdentity.buildFingerprint, "runtime-info route missing service build fingerprint");
      assert(runtimeInfo.database?.compatible === true, "runtime-info route did not report compatible DB");
      assert(!JSON.stringify(runtimeInfo).includes(dataRootA), "runtime-info route leaked absolute paths");
      const healthRoute = (await (await fetch(`${baseUrl}/health`)).json()) as HealthPayload;
      assert(healthRoute.serviceBuildFingerprint === runtimeInfo.service?.buildFingerprint, "health route build fingerprint mismatch");
      assert(healthRoute.databaseCompatible === true, "health route did not expose DB compatibility");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  } finally {
    db.close();
  }

  assert(existsSync(join(root, "Data Root A", "runtime", "agent", "agent.sqlite")), "smoke DB was not created");
  console.log("SERVICE_IDENTITY_SMOKE_OK");
} finally {
  restoreEnv();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function restoreEnv(): void {
  if (originalDataRoot === undefined) delete process.env.PKOS_DATA_ROOT;
  else process.env.PKOS_DATA_ROOT = originalDataRoot;
  if (originalCoreRoot === undefined) delete process.env.PKOS_CORE_ROOT;
  else process.env.PKOS_CORE_ROOT = originalCoreRoot;
  if (originalDbPath === undefined) delete process.env.PKOS_AGENT_DB_PATH;
  else process.env.PKOS_AGENT_DB_PATH = originalDbPath;
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalKey;
  if (originalRevision === undefined) delete process.env.PKOS_BUILD_REVISION;
  else process.env.PKOS_BUILD_REVISION = originalRevision;
  if (originalDirty === undefined) delete process.env.PKOS_BUILD_DIRTY;
  else process.env.PKOS_BUILD_DIRTY = originalDirty;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
