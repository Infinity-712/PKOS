# Flow Hub Contract

Flow Hub 是 PKOS v0.5 的运行中枢。它不是权威层，也不是 Agent；它负责把权威文件、复习系统、Digest、私密 Dashboard 与月洛洛这样的主动 Agent 稳定耦合。

## Boundary

Flow Hub may:

- aggregate current operating state;
- generate today / review / recovery / writing queues;
- package bounded Agent context;
- route low-risk writeback intents to deterministic APIs;
- expose derived runtime JSON under `runtime/`.

Flow Hub may not:

- migrate objects to `trusted`;
- replace the Git authority layer;
- write arbitrary files;
- bypass validation;
- bypass Git commit / rollback;
- make long-term life decisions for the user.

## Core Runtime Objects

- `inbox_item`
- `state_snapshot`
- `task`
- `review_item`
- `review_log`
- `recovery_log`
- `writing_item`
- `flow_budget`
- `operational_skill`
- `agent_context_pack`

## Queues

### Inbox

Low-friction capture pool. Unclassified input enters Inbox before it becomes a PKOS object, task, writing item, or recovery log.

### Current State

Current operating state:

- energy
- mood
- body
- context
- mode
- risk
- updated_at

### Today Queue

Short-horizon action queue for current operation. It is not a full long-term todo system.

### Review Queue

SRS-derived queue for fact / skill / claim review.

### Recovery Queue

Recovery actions are first-class system work, not rewards.

### Writing Queue

Internal writing queue for creative objects, fragments, private expression, essays, drafts, and notes.

## Agent Context Pack

The context pack is a derived cache, not authority. It should be bounded and status-aware.

Minimal shape:

```json
{
  "current_state": {},
  "today_queue": [],
  "review_queue": [],
  "recovery_queue": [],
  "writing_queue": [],
  "latest_digest": {},
  "operational_skills": [],
  "retrieved_objects": []
}
```

## Writeback

Flow Hub writeback must pass through:

1. intent classification;
2. permission level check;
3. deterministic API;
4. whitelist path enforcement;
5. diff summary;
6. Git commit.

Flow Hub must never directly edit AGENTS.md, docs governance files, schema files, or trusted status.

## Implementation Contract

### Required Directories

Flow Hub MVP requires these directories:

- `inbox/`
- `state/`
- `runtime/`
- `runtime/flow/`

### Required CLI Commands

Flow Hub MVP requires:

- `python -m tools.pkos inbox-append`
- `python -m tools.pkos state-append`
- `python -m tools.pkos gen-flow`
- `python -m tools.pkos export-agent-context`

### Required Runtime Outputs

`gen-flow` must generate:

- `runtime/flow/current_state.json`
- `runtime/flow/today_queue.json`
- `runtime/flow/review_queue.json`
- `runtime/flow/recovery_queue.json`
- `runtime/flow/writing_queue.json`
- `runtime/flow/flow_budget.json`

`export-agent-context` must generate:

- `runtime/agent_context.json`

### Authority Rule

All files under `runtime/` are derived caches. They may be deleted and regenerated.

### Append-only Rule

Future append-only files include:

- `inbox/items.jsonl`
- `state/snapshots.jsonl`
- `review/logs/*`

This MVP implements append-only writes for `inbox/items.jsonl` and `state/snapshots.jsonl`. Both are local operational logs and are ignored by Git by default.

### Write Boundary

`gen-flow` and `export-agent-context` are read-model generation commands.

They may write only:

- `runtime/flow/*.json`
- `runtime/agent_context.json`

`inbox-append` may write only:

- `inbox/items.jsonl`

`state-append` may write only:

- `state/snapshots.jsonl`

These commands must not write:

- `objects/`
- `docs/`
- `AGENTS.md`
- schema files
- review logs
- digests
- trusted status fields

### Agent Context Boundary

`agent_context.json` is a bounded context pack for Moonlolo.

It must not contain the whole repository. It should include only:

- current_state
- today_queue
- review_queue
- recovery_queue
- writing_queue
- flow_budget
- latest_digest metadata or bounded excerpt
- operational_skills, currently empty if not implemented
- retrieved_objects, currently empty because RAG is not implemented

### MVP Acceptance

Flow Hub MVP is valid when:

1. `python -B -m tools.pkos validate` passes.
2. `python -B -m tools.pkos gen-queue` passes.
3. `python -B -m tools.pkos gen-flow` generates all required `runtime/flow/*.json`.
4. `python -B -m tools.pkos export-agent-context` generates `runtime/agent_context.json`.
5. `agent_context.json` is bounded and does not dump the whole repository.
6. `runtime/` is treated as derived cache.
7. No command can migrate objects to `trusted`.
8. No command writes AGENTS.md, docs governance files, schema files, or trusted status.
9. No public publishing / blog related command or route is restored.
10. `inbox-append` appends valid JSONL without overwriting old lines.
11. `state-append` appends valid JSONL, and `gen-flow` reads the latest valid state snapshot.
