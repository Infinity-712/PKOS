# PKOS Server Deployment

> Status: deployment pack only. This document does not modify Moonlolo, OpenClaw, or any server repository.

## Recommended Server Layout

```text
/home/infinity/apps/pkos-core
/home/infinity/data/pkos-vault
/home/infinity/apps/moonlolo-reminder
```

- `pkos-core` contains the PKOS code repository, docs, schema, dashboard source, scripts, and integration templates.
- `pkos-vault` contains private data such as real objects, review logs, inbox/state logs, digests, raw captures, and runtime caches.
- `moonlolo-reminder` remains a separate application. PKOS does not modify it directly.

## Prerequisites

- Ubuntu 22.04.
- Python 3.
- Git.
- Node.js provided by the existing Moonlolo/OpenClaw environment.
- PKOS core repository cloned into `/home/infinity/apps/pkos-core`.
- `PKOS_DATA_ROOT` points to the private vault.

Use the actual PKOS remote URL for your environment. The repository may be public or private; this document does not assume either.

## First Deployment

```bash
mkdir -p /home/infinity/apps
mkdir -p /home/infinity/data/pkos-vault

cd /home/infinity/apps
git clone <PKOS_REPO_URL> pkos-core

cd /home/infinity/apps/pkos-core
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python3 -B -m tools.pkos doctor
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python3 -B -m tools.pkos paths
```

For machine-readable checks:

```bash
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python3 -B -m tools.pkos doctor --json
PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python3 -B -m tools.pkos paths --json
```

## Smoke Test

From the PKOS core repository:

```bash
bash scripts/server_smoke_test.sh
```

Or with explicit paths:

```bash
PKOS_CORE_ROOT=/home/infinity/apps/pkos-core PKOS_DATA_ROOT=/home/infinity/data/pkos-vault bash scripts/server_smoke_test.sh
```

The smoke test:

- exports `PKOS_DATA_ROOT`;
- creates the data root if needed;
- runs `paths --json`;
- runs `doctor --json`;
- appends one Inbox item;
- appends one Current State snapshot;
- generates Flow Hub runtime JSON;
- exports the Agent Context Pack to stdout;
- runs `validate`.

It does not delete the vault, commit, push, open ports, or write secrets.

## Moonlolo Adapter Template

The reviewed Node adapter example lives at:

```text
integrations/moonlolo/pkos_client.mjs
```

It is a template for later manual integration into:

```text
/home/infinity/apps/moonlolo-reminder/pkos_client.mjs
```

The adapter uses Node `spawnSync` with argument arrays. It does not use shell command concatenation and only calls allowlisted PKOS commands:

The adapter is compatible with the existing Node v12.22.9 server runtime. Do not require a Node upgrade and do not add npm dependencies for this bridge. Keep the adapter free of optional chaining, nullish coalescing, top-level await, `Array.prototype.at()`, class fields, import assertions, and `node:` builtin import prefixes.

- `paths --json`
- `doctor --json`
- `export-agent-context --print`
- `inbox-append --json`
- `state-append --json`

## Permissions and Security

- PKOS does not expose a public API in this deployment pack.
- No HTTP port is opened.
- Moonlolo should call PKOS locally through subprocess, not arbitrary shell.
- `pkos-vault` is private data and must not be committed to public-safe core.
- `.env`, API keys, tokens, LLM configuration, and WeChat configuration must not be stored in PKOS core.
- Large files should not be added directly to Git; future large asset handling should use a separate `pkos-assets` or `asset_index` design.
- Moonlolo must not perform trusted migration.
- Moonlolo must not delete objects.
- Moonlolo must not directly edit `objects/`, `docs/`, schema, or `AGENTS.md`.
- Public publishing, blog, WordPress, site-public, and `publish-check` remain out of scope.
