import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { openAgentDatabase } from "../db/connection.js";
import { createAgentHttpServer } from "../server/httpServer.js";
import {
  buildRuntimeIdentity,
  createRuntimeInfoPayload,
  dataRootFingerprint,
  normalizeRuntimePath,
  runtimeFingerprint,
} from "../runtime/RuntimeIdentity.js";

type RuntimeInfoPayload = {
  service?: string;
  profileName?: string;
  runtimeFingerprint?: string;
  dataRoot?: { label?: string; fingerprint?: string };
  database?: { exists?: boolean; schemaVersion?: number };
  process?: { startedAt?: string; pid?: number };
  provider?: { profileId?: string; modelId?: string; reasoningPreset?: string; keyConfigured?: boolean };
};
type HealthPayload = { ok?: boolean; service?: string; runtimeFingerprint?: string; profileName?: string };

const root = mkdtempSync(join(tmpdir(), "pkos-runtime-identity-smoke-"));
const originalDataRoot = process.env.PKOS_DATA_ROOT;
const originalCoreRoot = process.env.PKOS_CORE_ROOT;
const originalDbPath = process.env.PKOS_AGENT_DB_PATH;
const originalKey = process.env.DEEPSEEK_API_KEY;

try {
  const coreRoot = join(root, "Core Root");
  const dataRootA = join(root, "Data Root A");
  const dataRootB = join(root, "Data Root B");
  process.env.PKOS_CORE_ROOT = coreRoot;
  process.env.PKOS_DATA_ROOT = dataRootA;
  delete process.env.PKOS_AGENT_DB_PATH;

  const dbPathA = join(dataRootA, "runtime", "agent", "agent.sqlite");
  const dbPathAAlt = join(dataRootA, "runtime", "agent", "agent-alt.sqlite");

  assert(normalizeRuntimePath(`${coreRoot}\\`) === normalizeRuntimePath(coreRoot), "same path with trailing slash/backslash should normalize identically");
  assert(normalizeRuntimePath(coreRoot.toUpperCase()) === normalizeRuntimePath(coreRoot.toLowerCase()), "Windows path case normalization should be stable");
  const fpA = runtimeFingerprint({ coreRoot, dataRoot: dataRootA, agentDbPath: dbPathA });
  assert(fpA === runtimeFingerprint({ coreRoot: `${coreRoot}\\`, dataRoot: `${dataRootA}\\`, agentDbPath: dbPathA }), "same runtime paths produced different fingerprints");
  assert(fpA !== runtimeFingerprint({ coreRoot, dataRoot: dataRootB, agentDbPath: join(dataRootB, "runtime", "agent", "agent.sqlite") }), "different dataRoot did not change fingerprint");
  assert(fpA !== runtimeFingerprint({ coreRoot, dataRoot: dataRootA, agentDbPath: dbPathAAlt }), "different DB path did not change fingerprint");
  process.env.DEEPSEEK_API_KEY = "first-secret-value";
  const withKeyA = runtimeFingerprint({ coreRoot, dataRoot: dataRootA, agentDbPath: dbPathA });
  process.env.DEEPSEEK_API_KEY = "second-secret-value";
  assert(withKeyA === runtimeFingerprint({ coreRoot, dataRoot: dataRootA, agentDbPath: dbPathA }), "API key changed runtime fingerprint");

  const db = openAgentDatabase();
  const server = createAgentHttpServer({ db });
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
    assert(payload.runtimeFingerprint === fpA.slice(0, 16), "runtime-info fingerprint did not use short stable runtime fingerprint");
    const changedProviderPayload = createRuntimeInfoPayload(identity, db, {
      selection: { profileId: "custom-local", modelId: "other-model", reasoningPreset: "off", keyConfigured: false },
    });
    assert(changedProviderPayload.runtimeFingerprint === payload.runtimeFingerprint, "provider selection changed runtime fingerprint");
    assert(payload.dataRoot.label === basename(dataRootA), "runtime-info did not expose data label");
    assert(payload.dataRoot.fingerprint === dataRootFingerprint(dataRootA).slice(0, 16), "runtime-info data fingerprint mismatch");
    assert(payload.database.exists === true && payload.database.schemaVersion >= 1, "runtime-info database state missing");
    assert(!serialized.includes(coreRoot), "runtime-info leaked absolute coreRoot");
    assert(!serialized.includes(dataRootA), "runtime-info leaked absolute dataRoot");
    assert(!serialized.includes(dbPathA), "runtime-info leaked absolute DB path");
    assert(!serialized.includes("second-secret-value"), "runtime-info leaked API key value");

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("server did not bind");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const runtimeInfo = (await (await fetch(`${baseUrl}/api/runtime-info`)).json()) as RuntimeInfoPayload;
    assert(runtimeInfo.service === "pkos-agent-server", "runtime-info route service mismatch");
    assert(typeof runtimeInfo.runtimeFingerprint === "string" && runtimeInfo.runtimeFingerprint.length >= 12, "runtime-info route missing fingerprint");
    assert(!JSON.stringify(runtimeInfo).includes(dataRootA), "runtime-info route leaked absolute paths");
    assert(!JSON.stringify(runtimeInfo).includes("second-secret-value"), "runtime-info route leaked key");
    const health = (await (await fetch(`${baseUrl}/health`)).json()) as HealthPayload;
    assert(health.ok === true && health.runtimeFingerprint === runtimeInfo.runtimeFingerprint, "health did not include lightweight runtime identity");
    assert(health.profileName === runtimeInfo.profileName, "health profileName mismatch");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    db.close();
  }

  console.log("RUNTIME_IDENTITY_SMOKE_OK");
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
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
