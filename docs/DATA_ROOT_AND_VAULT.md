# Data Root and Vault

> Status: v0.5 foundation. `PKOS_DATA_ROOT` separates private operational data from the public-safe PKOS core repository.

## Definitions

**Core root** is the PKOS code repository. It contains:

- `tools/`
- `docs/`
- `tools/schema/`
- `AGENTS.md`
- `README.md`
- `site-private/` dashboard source
- demo-safe fixtures

**Data root** is the selected private data location. It contains:

- `objects/`
- `review/`
- `digests/`
- `raw_vault/`
- `inbox/`
- `state/`
- `runtime/`

If `PKOS_DATA_ROOT` is unset, data root defaults to core root. If it is set, supported CLI commands read and write data under that path while still loading code, docs, and schema from core root.

## Public Core / Private Vault

Recommended long-term layout:

```text
pkos-core   # public-safe repository: code, docs, schema, dashboard source
pkos-vault  # private vault: real objects, review logs, inbox/state logs, runtime caches
```

Do not commit real `inbox/*.jsonl`, `state/*.jsonl`, or `runtime/*.json` files to `pkos-core`.

## Server Example

```bash
mkdir -p /home/infinity/apps/pkos-core
mkdir -p /home/infinity/data/pkos-vault

cd /home/infinity/apps/pkos-core

PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos paths --json
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos doctor --json
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos gen-flow
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos export-agent-context --print
```

## Local Development

Using the core repo as data root is allowed for local development:

```bash
python -m tools.pkos paths
python -m tools.pkos doctor
python -m tools.pkos validate
python -m tools.pkos gen-flow
```

Using a separate local vault:

```bash
PKOS_DATA_ROOT=/home/infinity/dev/pkos-vault python -m tools.pkos paths --json
PKOS_DATA_ROOT=/home/infinity/dev/pkos-vault python -m tools.pkos inbox-append --capture-type note --content "local test" --json
```

## Windows PowerShell

```powershell
$env:PKOS_DATA_ROOT="E:\Creation\PKOS-Vault"
python -m tools.pkos paths --json
python -m tools.pkos doctor --json
python -m tools.pkos state-append --energy low --mood calm --body tired --source moonlolo --json
Remove-Item Env:\PKOS_DATA_ROOT
```

CLI override has priority over the environment variable:

```powershell
python -m tools.pkos --data-root "E:\Creation\PKOS-Vault" paths --json
```

## Public vs Private

Public-safe:

- tools and source code;
- schema files;
- governance docs;
- demo fixtures;
- dashboard source files.

Private:

- real knowledge objects;
- real review logs;
- raw vault captures;
- inbox and state logs;
- runtime context packs;
- personal digests.

## Runtime Caches

`runtime/` is derived cache. It can be deleted and rebuilt with:

```bash
python -m tools.pkos gen-flow
python -m tools.pkos export-agent-context
```

`runtime/agent_context.json` and `runtime/flow/*.json` should not be treated as authority.

## Inbox and State Logs

`inbox/items.jsonl` and `state/snapshots.jsonl` are local operational logs.

They are append-only in normal use, but they are still private data. In a public-core workflow, they belong in `pkos-vault`, not in the public-safe core repository.

## Large Files

Large binary files should not enter Git by default. Future asset handling should use a separate `pkos-assets` or an `asset_index` design.
