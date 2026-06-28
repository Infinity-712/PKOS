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
