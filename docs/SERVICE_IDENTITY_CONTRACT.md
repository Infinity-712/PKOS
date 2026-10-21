# Service Identity Contract

> Status: v0.7.x MVP. This contract describes local Agent Server build identity only; it does not add new business capabilities.

## Purpose

`runtimeFingerprint` identifies the running data/runtime instance:

- normalized `coreRoot`
- normalized `dataRoot`
- normalized Agent SQLite path

It intentionally does not identify the Agent Server source build. A stale Agent Server can therefore share the same runtime fingerprint while missing newer routes, migrations, API fields, or capability declarations.

The Service Identity MVP adds a separate build and API capability identity so local startup can refuse unsafe reuse.

## Manifest

The source manifest lives at:

```text
apps/agent-server/service-capabilities.json
```

It declares:

- service name and version;
- API contract version;
- required SQLite schema version;
- supported API capabilities.

The v0.8-beta Object Authority slice adds the `object-authority-v1`
capability. A running Agent Server missing this capability must be treated as a
stale build for Web object editing.

Capabilities are sorted before fingerprinting, so declaration order is not meaningful. Adding, removing, or renaming a capability changes the service build fingerprint.

## Build Fingerprint

The build fingerprint is:

```text
sha256(canonical_service_manifest + "\n" + source_revision_with_dirty_marker)[0:16]
```

`source_revision_with_dirty_marker` is:

- `PKOS_BUILD_REVISION` when set, otherwise `git rev-parse HEAD`, otherwise `unknown`;
- suffixed with `+dirty` when `PKOS_BUILD_DIRTY=true` or when `git status --porcelain` is non-empty.

The fingerprint must not include:

- `PKOS_DATA_ROOT`;
- provider profile selection;
- model selection;
- API key values;
- chat messages or prompts;
- runtime SQLite contents.

Known MVP limitation: the dirty marker is boolean. It detects that source changed, but does not encode the exact diff.

## Runtime Info

`GET /api/runtime-info` is read-only and returns bounded identity metadata:

```json
{
  "service": {
    "name": "pkos-agent-server",
    "version": "0.7-service-identity",
    "apiContractVersion": "0.7",
    "buildFingerprint": "0123456789abcdef",
    "sourceRevision": "git-or-env-revision",
    "dirty": false,
    "capabilities": ["health.v1", "runtime-info.v1"],
    "manifestFingerprint": "fedcba9876543210"
  },
  "runtimeFingerprint": "...",
  "database": {
    "schemaVersion": 6,
    "requiredSchemaVersion": 6,
    "compatible": true
  }
}
```

The response must not include absolute `coreRoot`, absolute `dataRoot`, DB paths, API keys, environment dumps, prompts, raw context, inbox content, state notes, or provider raw responses.

## Health

`GET /health` remains lightweight, but now includes:

- `serviceVersion`
- `serviceBuildFingerprint`
- `apiContractVersion`
- `databaseSchemaVersion`
- `databaseRequiredSchemaVersion`
- `databaseCompatible`

Provider configuration does not make health false. A schema older than the manifest's required schema makes `ok=false`.

## Local Runtime Reuse

`scripts/local-runtime.ps1 start` may reuse an existing listener only when all of the following match:

- runtime fingerprint;
- service name;
- API contract version;
- service build fingerprint;
- all manifest capabilities are present;
- database schema is compatible.

Both current source identity and the running service must also be clean. If
either reports `dirty=true`, automatic reuse is refused even when HEAD, runtime,
build fingerprint, and capabilities match. The script returns
`AGENT_SERVER_DIRTY_REUSE_REFUSED` with an explicit-restart instruction; it does
not stop the existing process. Runtime mismatches retain their existing error;
missing or foreign service identities still fail the existing identity checks.

An unoccupied port may start a new Agent Server from dirty source. Successful
startup displays the source dirty state. Its readiness check still verifies the
full runtime/build/API/schema/capability identity, without applying the reuse-only
dirty restriction. No source-set fingerprint is introduced.

If runtime differs, the script returns `AGENT_SERVER_RUNTIME_MISMATCH`.

If runtime matches but service/build/capability/schema does not match, the script
returns `AGENT_SERVER_BUILD_MISMATCH`, unless a recognized Agent Server was already
refused by the dirty-reuse policy above.

The script does not auto-kill unknown or stale processes. Stop and inspect them manually.

## Verification

The local runtime smoke uses temporary profile/data/core directories and loads
the actual script functions without executing the production dispatcher. Network
and process boundaries use synthetic fixtures; only synchronous PowerShell test
children are launched. It never moves the real runtime profile, opens a real DB,
binds a port, or calls a model. Each child removes only its own temporary directory.
This verifies orchestration and identity decisions, not real server boot or HTTP
transport. The Agent Server identity smokes below are separate checks.

```powershell
npm run service-identity-smoke --prefix apps/agent-server
npm run runtime-identity-smoke --prefix apps/agent-server
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-runtime.smoke.ps1
```
