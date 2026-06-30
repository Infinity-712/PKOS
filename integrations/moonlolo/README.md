# Moonlolo PKOS Adapter Example

This directory is an adapter example only. It is not the production `moonlolo-reminder` repository and should not be edited in place on the server.

The adapter demonstrates how Moonlolo can call PKOS through a bounded subprocess interface without reading or writing PKOS authority files directly.

The example targets Node v12.22.9 compatibility. It intentionally avoids optional chaining, nullish coalescing, top-level await, `Array.prototype.at()`, class fields, import assertions, npm dependencies, and `node:` builtin import prefixes.

Allowed calls:

- `paths --json`
- `doctor --json`
- `export-agent-context --print`
- `inbox-append --json`
- `state-append --json`

Forbidden behavior:

- arbitrary shell commands;
- direct file writes into `objects/`, `docs/`, schema, or `AGENTS.md`;
- trusted migration;
- publishing;
- storing API keys, tokens, or WeChat configuration in PKOS core.

## Copy Into Moonlolo

When ready to test in the real Moonlolo app, copy the example file into the Moonlolo repository:

```text
/home/infinity/apps/moonlolo-reminder/pkos_client.mjs
```

Do not modify `/home/infinity/apps/moonlolo-reminder` from this PKOS repository task. Treat this directory as a reviewed template.

## Environment

```bash
export PKOS_CORE_ROOT=/home/infinity/apps/pkos-core
export PKOS_DATA_ROOT=/home/infinity/data/pkos-vault
```

`PKOS_CORE_ROOT` points at the PKOS code repository. `PKOS_DATA_ROOT` points at the private vault.

## Example Usage

```js
import { appendInbox, appendState, getAgentContext } from "./pkos_client.mjs";

appendInbox({
  captureType: "note",
  content: "记一下：测试 PKOS bridge",
  source: "moonlolo"
});

appendState({
  energy: "low",
  mood: "calm",
  body: "tired",
  source: "moonlolo"
});

const context = getAgentContext();
console.log(context.current_state);
```

The exported functions are synchronous because the implementation uses `spawnSync`.

## Self Check

After setting `PKOS_CORE_ROOT` and `PKOS_DATA_ROOT`, you can run:

```bash
node pkos_client.mjs
```

This self-check calls `paths`, `doctor`, and `export-agent-context`. It does not append inbox or state entries.
