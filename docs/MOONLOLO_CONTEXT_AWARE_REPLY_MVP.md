# Moonlolo Context-Aware Reply MVP

> Status: Git-side preparation only. This sprint does not modify production `process_reply.mjs`, OpenClaw runtime directories, Docker configuration, `tools.pkos`, or any private vault data.

## Scope

This MVP prepares the repository-side helper needed for a later minimal production patch:

- `integrations/moonlolo/pkos_client.mjs` can request the Moonlolo profile context.
- `integrations/moonlolo/moonlolo_context_prompt.mjs` converts bounded runtime context into a short prompt block.
- Tests verify the helper behavior without touching production Moonlolo files.

It does not implement ordinary chat injection in production.

## Context Fetch

Future callers may use:

```js
const context = getAgentContext({ profile: "moonlolo" });
```

The adapter refreshes Flow Hub first, then prints the bounded Moonlolo context:

```bash
python -B -m tools.pkos gen-flow
python -B -m tools.pkos export-agent-context --profile moonlolo --print
```

The default call remains compatible:

```js
const context = getAgentContext();
```

That path continues to call the default `export-agent-context --print` flow.

## Prompt Helper

`buildMoonloloContextBlock(context)` creates a short runtime context block for an LLM prompt. The block is intentionally small and includes:

- profile and schema version;
- `current_state.tone_hint`;
- the rule that state affects tone and reply load only;
- the rule that disabled task flow means Moonlolo must not invent active tasks;
- weekly review gate counts, without raw Inbox full text;
- allowed and forbidden write boundaries.

`deriveMoonloloToneInstruction(context)` maps `tone_hint` to style instructions only. It must not diagnose, change reminder frequency, reorder work, or create tasks.

`shouldMentionWeeklyReviewGate(context, userText)` returns true only when the user text is weekly-summary/review related and the context says review is required before weekly summary.

## Later Production Hook

The later minimal production patch should happen in the Moonlolo reply composition path, likely in the production `process_reply.mjs` flow after explicit command handling and before the LLM call.

Recommended later sequence:

1. Try `getAgentContext({ profile: "moonlolo" })`.
2. Build a short block with `buildMoonloloContextBlock(context)`.
3. Add that block to the system/developer prompt for the single reply.
4. If context fetch fails, omit the block and continue normal chat.
5. Never claim PKOS context was loaded if it failed.

This repository task does not edit the production file.

## Safety Boundaries

Context-aware ordinary chat may:

- make replies warmer, shorter, or lower pressure;
- avoid task claims when `task_flow_stub.enabled=false`;
- remind the user to review Inbox before weekly summary when the user asks about summary/review.

It must not:

- add write permissions;
- change reminder frequency;
- read secrets;
- read OpenClaw memory full text;
- include raw Inbox full text;
- auto-create tasks;
- write trusted status;
- write `objects/`;
- turn Inbox captures into facts;
- implement RAG, App/Web, or a task system.

## Failure Behavior

If context fetch or prompt-block building fails, Moonlolo should fall back to ordinary chat. The fallback should be quiet and honest:

- no fake memory claims;
- no claim that PKOS context was used;
- no write attempt caused by the failed context fetch.

## Acceptance Commands

```bash
node --check integrations/moonlolo/pkos_client.mjs
node --check integrations/moonlolo/moonlolo_context_prompt.mjs
node integrations/moonlolo/test_moonlolo_context_prompt.mjs
python -B tools/tests/check_moonlolo_adapter_example.py
```

Expected helper test marker:

```text
MOONLOLO_CONTEXT_PROMPT_OK
```
