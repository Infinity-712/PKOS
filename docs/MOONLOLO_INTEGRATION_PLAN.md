# Moonlolo Integration Plan

> Status: bridge readiness only. This document does not implement Moonlolo, OpenClaw, API endpoints, RAG, tasks, recovery writeback, or app packaging.

## Goal

Moonlolo should access PKOS through controlled CLI commands now, and through a bounded local API later. It should not directly read or write PKOS authority files.

Current allowed bridge actions:

- read bounded Agent Context Pack;
- append an Inbox item;
- append a Current State snapshot.

Current forbidden actions:

- trusted migration;
- object deletion;
- direct object edits;
- docs, schema, or `AGENTS.md` edits;
- publishing;
- arbitrary shell commands.

## Recommended Deployment

```text
server
├── /home/infinity/apps/openclaw
├── /home/infinity/apps/moonlolo-reminder
├── /home/infinity/apps/pkos-core
└── /home/infinity/data/pkos-vault
```

- `pkos-core` contains tools, docs, schema, dashboard source, and demo-safe files.
- `pkos-vault` contains real private data: `objects/`, `review/`, `digests/`, `inbox/`, `state/`, and `runtime/`.
- Moonlolo should set `PKOS_DATA_ROOT=/home/infinity/data/pkos-vault` when invoking PKOS.

## Minimal CLI Calls

```bash
cd /home/infinity/apps/pkos-core

PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos paths --json

PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos doctor --json

PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos export-agent-context --print

PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos inbox-append --capture-type note --content "..." --source moonlolo --json

PKOS_DATA_ROOT=/home/infinity/data/pkos-vault python -m tools.pkos state-append --energy low --mood anxious --body chest_tight --source moonlolo --json
```

`--json` and `--print` modes emit parseable JSON on stdout without human-readable progress text.

## Node Subprocess Example

Do not concatenate untrusted user input into a shell command. Pass arguments as an array.

The reviewed adapter template lives at:

```text
integrations/moonlolo/pkos_client.mjs
```

It can later be copied manually into:

```text
/home/infinity/apps/moonlolo-reminder/pkos_client.mjs
```

```js
import { spawnSync } from "node:child_process";

export function appendInbox(content) {
  const result = spawnSync(
    "python3",
    [
      "-m",
      "tools.pkos",
      "inbox-append",
      "--capture-type",
      "note",
      "--content",
      content,
      "--source",
      "moonlolo",
      "--json"
    ],
    {
      cwd: "/home/infinity/apps/pkos-core",
      env: {
        ...process.env,
        PKOS_DATA_ROOT: "/home/infinity/data/pkos-vault",
        TZ: "Asia/Shanghai"
      },
      encoding: "utf8"
    }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }

  const payload = JSON.parse(result.stdout);
  if (!payload.ok) {
    throw new Error(payload.error?.message || "PKOS append failed");
  }
  return payload;
}
```

## Permission Boundary

Moonlolo may:

- call `paths --json`;
- call `doctor --json`;
- call `export-agent-context --print`;
- call `inbox-append --json`;
- call `state-append --json`.

Moonlolo may not:

- modify `objects/` directly;
- modify `docs/`, `AGENTS.md`, or schema files;
- migrate anything to `trusted`;
- delete objects;
- run public publishing commands;
- run arbitrary shell commands.

## Later Roadmap

```text
CLI Adapter
-> PKOSClient
-> FastAPI local API
-> Token auth
-> Review / Recovery / Task writeback
```

The later API should preserve the same boundary: bounded read context plus deterministic, allowlisted writeback only.

## Server Smoke Test

Before wiring Moonlolo to the adapter, run the PKOS deployment smoke test from the core repository:

```bash
bash scripts/server_smoke_test.sh
```

Or with explicit server paths:

```bash
PKOS_CORE_ROOT=/home/infinity/apps/pkos-core PKOS_DATA_ROOT=/home/infinity/data/pkos-vault bash scripts/server_smoke_test.sh
```

This verifies `paths`, `doctor`, Inbox append, State append, Flow Hub runtime generation, Agent Context export, and object validation without opening ports or touching the Moonlolo repository.
