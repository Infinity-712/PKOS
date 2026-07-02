# Agent Context Contract

> Status: v0.5-beta design contract. This document defines the intended bounded Agent Context Pack for Moonlolo and future adapters. It does not implement code, change CLI behavior, modify runtime scripts, or touch server directories.

## 1. Purpose

Agent Context Pack is a bounded runtime context object for Moonlolo. It gives the interaction layer enough state to respond gently and safely without exposing the whole PKOS vault or confusing runtime cache with authority.

It answers:

- what may Moonlolo know each reply?
- what must Moonlolo not know by default?
- which context affects tone only?
- which writes are allowed?
- which writes are forbidden?

## 2. Design Goals

| Goal | Meaning |
|---|---|
| Bounded | Context must stay small, explicit, and budgeted. |
| Auditable | Every field should have a clear source and purpose. |
| Status-aware | Runtime context must preserve authority boundaries and avoid raw, unreviewed data dumps. |
| Anti-degradation | Context should reduce overload rather than maximize recall. |
| Safe for companionship | Moonlolo may adapt tone, but must not take over judgment. |
| Future-compatible | The shape should leave room for reminder state and task flow without pretending they exist today. |

## 3. Authority Boundary

Agent Context Pack is runtime context only.

It is not:

- source of truth;
- trusted knowledge;
- object authority;
- task authority;
- medical or psychological basis for diagnosis;
- proof that a write succeeded;
- a replacement for Inbox Review;
- a replacement for human judgment.

Authority remains:

| Layer | Authority Status |
|---|---|
| `AGENTS.md` / governance docs | Governance authority |
| `objects/` | Knowledge object authority |
| `inbox/items.jsonl` | Append-only capture log |
| `state/snapshots.jsonl` | Append-only state log |
| `review/logs/*.jsonl` | Append-only review/action logs |
| `runtime/*.json` | Derived cache, not authority |
| OpenClaw memory | Interaction runtime memory, not PKOS authority |

## 4. Context Pack Overview

v0.5-beta target shape:

```json
{
  "schema_version": "0.5-beta",
  "generated_at": "...Z",
  "current_state": {},
  "reminder_state": null,
  "weekly_review_gate": {},
  "task_flow_stub": {},
  "write_policy": {}
}
```

Allowed top-level sections:

| Section | Purpose | Current Status |
|---|---|---|
| `current_state` | Tone and reply-load adaptation | Based on v0.5-alpha state snapshots / Flow Hub |
| `reminder_state` | Reminder coordination state | Schema defined; first implementation may be `null` |
| `weekly_review_gate` | Weekly summary pre-review signal | Design target using Inbox Review summary, not raw Inbox dump |
| `task_flow_stub` | Explicit disabled placeholder | Must be disabled until task system exists |
| `write_policy` | Explicit write permissions and prohibitions | Required |

## 5. current_state

### Source

`current_state` may be derived from:

- `state/snapshots.jsonl`;
- `gen-flow` output;
- `export-agent-context` output.

### Purpose

`current_state` affects only:

- reply tone;
- reply length;
- cognitive load;
- pressure level.

It must not:

- change reminder frequency;
- reorder tasks;
- create tasks;
- diagnose medical or psychological conditions;
- convert short-term state into long-term personality claims;
- override user judgment.

### Suggested Shape

```json
{
  "energy": "very_low|low|medium|high|overloaded|unknown",
  "mood": "anxious|calm|low|numb|irritated|excited|overloaded|unknown",
  "body": "tired|sleepy|chest_tight|headache|hungry|sick|normal|unknown",
  "context": "home|dorm|classroom|library|outside|before_sleep|travel|other|unknown",
  "mode": "study|writing|recovery|social|quiet|life|project|other|unknown",
  "updated_at": "...Z",
  "tone_hint": "soft_low_pressure|normal|short_recovery|unknown"
}
```

### Tone Mapping

| Signal | Allowed Effect |
|---|---|
| `energy=very_low` | Extremely short, low-demand, stabilize-first reply. |
| `energy=low` | One small action at most. |
| `mood=anxious` | Avoid "you should"; reduce pressure. |
| `mood=calm` | Normal gentle prompting. |
| `body=tired/sleepy` | Prefer recovery-aware phrasing. |

`tone_hint` is a derived style hint, not a diagnosis.

## 6. reminder_state

`reminder_state` represents Moonlolo's current reminder state.

Possible future sources:

- Moonlolo runtime state;
- future adapter output;
- reminder scheduler state.

PKOS core v0.5-beta design must not directly read OpenClaw secrets or uncontrolled runtime files. First implementation may set this field to `null`.

Suggested shape:

```json
{
  "wake_status": "idle|waiting_wake|snoozing|awake|unknown",
  "quiet_until": null,
  "focus_until": null,
  "hourly_pending": false,
  "resume_ping_sent": false
}
```

Purpose:

- avoid conflict between normal replies and reminder state;
- avoid proactive interruption during quiet periods;
- help Moonlolo know whether wake-up, focus, recovery, or resume reminder state is active.

Boundary:

- `reminder_state` may affect whether proactive reminders fire in future implementations;
- `current_state` must not change reminder frequency;
- v0.5-beta does not implement new reminder strategy.

## 7. weekly_review_gate

`weekly_review_gate` supports weekly summary preparation. It is not daily inbox-zero.

Inbox positioning:

```text
Inbox = low-friction capture buffer + evidence pool before weekly summary
```

Inbox may contain:

- `记一下 ...`;
- temporary thoughts;
- weekly events;
- state side-notes;
- material that may later be summarized;
- material that may later become an object.

Inbox is not:

- daily todo;
- daily inbox-zero target;
- long-term memory;
- trusted knowledge;
- task system;
- raw context read on every reply;
- automatic knowledge pipeline.

Suggested shape:

```json
{
  "cadence": "weekly",
  "unprocessed_inbox_count": 0,
  "archived_this_week": 0,
  "converted_this_week": 0,
  "review_required_before_weekly_summary": true,
  "sample_items": []
}
```

`sample_items` constraints:

```json
{
  "id": "inbox_...",
  "source": "moonlolo",
  "capture_type": "note",
  "created_at": "...Z",
  "effective_status": "unprocessed",
  "content_excerpt": "最多 120 字"
}
```

Budget:

- `sample_items <= 5`;
- `content_excerpt <= 120` Chinese characters;
- no raw Inbox full text;
- no automatic fact/trusted/object creation from samples.

Purpose:

- remind user before weekly summary to review Inbox;
- provide a small evidence hint;
- prevent automatic summary from swallowing unreviewed capture data.

Weekly summary rules:

- cadence is weekly;
- review should happen before weekly summary;
- unreviewed Inbox content must not directly enter trusted/object;
- the system must not automatically summarize all Inbox items as facts.

## 8. task_flow_stub

The task system is not implemented in v0.5-beta.

Therefore context must include a disabled stub rather than hallucinated task state.

Required shape:

```json
{
  "enabled": false,
  "reason": "task_system_not_implemented",
  "active_task": null,
  "next_action": null
}
```

Rules:

- do not infer tasks from Inbox;
- do not auto-create long-term tasks;
- do not let Moonlolo invent an active task;
- future task flow should be managed mainly by Web/App;
- Moonlolo may later provide low-friction task traversal after task authority exists.

## 9. write_policy

`write_policy` must be explicit in the context pack.

Required shape:

```json
{
  "agent_may_write": true,
  "allowed_writes": [
    "inbox_append",
    "state_append"
  ],
  "forbidden_writes": [
    "trusted",
    "objects",
    "tasks",
    "task_auto_creation",
    "weekly_summary_without_review",
    "raw_vault_mutation",
    "secret_reading"
  ],
  "authority": "runtime context only; not source of truth"
}
```

Allowed:

- append Inbox capture through controlled interface;
- append State snapshot through controlled interface.

Forbidden:

- write trusted status;
- write `objects/`;
- create tasks automatically;
- generate authority weekly summary without Inbox Review;
- mutate raw vault;
- read secrets;
- treat runtime context as authority.

## 10. Excluded Context

The context pack must not include:

| Excluded | Reason |
|---|---|
| `learning_flow` | Too verbose for current context; not part of v0.5-beta pack. |
| Raw Inbox full text | Unreviewed capture must not flood every reply. |
| OpenClaw memory full text | OpenClaw memory is not PKOS authority and may be too large. |
| Secrets / tokens / account config | Security boundary. |
| Trusted migration results | Agent must not auto-migrate trusted state. |
| Full object contents | Too large and may blur authority boundaries. |
| Full weekly summary history | Too large; use explicit review/digest flows instead. |
| Large private vault content | Context budget and privacy. |
| Unreviewed capture bulk text | Requires Inbox Review before summary/object use. |

## 11. Token Budget

Budget rules:

- `current_state`: keep complete, but field-limited.
- `reminder_state`: keep complete, but field-limited; may be `null`.
- `weekly_review_gate`:
  - `sample_items <= 5`;
  - `content_excerpt <= 120` Chinese characters.
- `task_flow_stub`: fixed short structure.
- `write_policy`: keep complete.
- No raw Inbox full text.
- No long-term chat history full text.
- No OpenClaw memory full text.
- No broad private vault dump.
- No secrets.

Goals:

- reduce context cost;
- avoid memory bloat;
- prevent Agent over-reading unreviewed material;
- keep context explainable and auditable.

## 12. Refresh Semantics

Context should be refreshed before Moonlolo uses it for a reply when practical.

Current v0.5-alpha behavior:

- Flow Hub runtime can be regenerated with `gen-flow`;
- Agent Context can be exported with `export-agent-context`;
- runtime output is derived and may be stale if not regenerated.

v0.5-beta design rule:

```text
fresh enough for tone and safety, never authoritative enough for facts
```

Refresh must not:

- write `objects/`;
- write trusted status;
- read secrets;
- mutate OpenClaw runtime files outside controlled adapters.

## 13. Safety Rules

| Rule | Requirement |
|---|---|
| Runtime is not authority | Moonlolo must not cite context as final truth. |
| `current_state` affects tone only | No reminder frequency change, task reorder, or diagnosis. |
| Weekly review gate blocks automatic summary | Unreviewed Inbox does not become trusted/object. |
| `task_flow_stub.enabled=false` | Moonlolo must not invent active tasks. |
| `write_policy` is explicit | Allowed and forbidden writes are visible in context. |
| No secrets | Context must not contain tokens, keys, account config, or WeChat config. |
| No raw Inbox dump | Only bounded samples, if any. |
| No learning flow | Excluded from v0.5-beta context. |
| Human judgment first | Agent suggestions remain suggestions. |

## 14. Example Context Pack

```json
{
  "schema_version": "0.5-beta",
  "generated_at": "2026-07-02T12:00:00Z",
  "current_state": {
    "energy": "low",
    "mood": "calm",
    "body": "tired",
    "context": "home",
    "mode": "recovery",
    "updated_at": "2026-07-02T11:58:00Z",
    "tone_hint": "soft_low_pressure"
  },
  "reminder_state": null,
  "weekly_review_gate": {
    "cadence": "weekly",
    "unprocessed_inbox_count": 3,
    "archived_this_week": 4,
    "converted_this_week": 1,
    "review_required_before_weekly_summary": true,
    "sample_items": [
      {
        "id": "inbox_20260702T090000Z_abcd1234",
        "source": "moonlolo",
        "capture_type": "note",
        "created_at": "2026-07-02T09:00:00Z",
        "effective_status": "unprocessed",
        "content_excerpt": "记一下：这里是一条等待周总结前 review 的短摘录。"
      }
    ]
  },
  "task_flow_stub": {
    "enabled": false,
    "reason": "task_system_not_implemented",
    "active_task": null,
    "next_action": null
  },
  "write_policy": {
    "agent_may_write": true,
    "allowed_writes": [
      "inbox_append",
      "state_append"
    ],
    "forbidden_writes": [
      "trusted",
      "objects",
      "tasks",
      "task_auto_creation",
      "weekly_summary_without_review",
      "raw_vault_mutation",
      "secret_reading"
    ],
    "authority": "runtime context only; not source of truth"
  }
}
```

## 15. Non-Goals

v0.5-beta context contract does not implement:

- task system;
- task generation from Inbox;
- learning flow context;
- RAG;
- full object retrieval;
- full chat history retrieval;
- weekly summary generation;
- trusted migration;
- direct OpenClaw memory ingestion;
- secret reading;
- new HTTP APIs;
- App / Android behavior.

## 16. Acceptance Criteria

This contract is satisfied when:

- context contains `current_state`, `reminder_state`, `weekly_review_gate`, `task_flow_stub`, and `write_policy`;
- `current_state` is explicitly tone-only;
- reminder frequency is not controlled by `current_state`;
- `task_flow_stub.enabled` is `false`;
- `learning_flow` is excluded;
- raw Inbox full text is excluded;
- Inbox is treated as weekly review evidence pool, not daily inbox-zero;
- `weekly_review_gate.sample_items` is bounded to at most 5 items and 120-character excerpts;
- `write_policy.allowed_writes` includes only `inbox_append` and `state_append`;
- `write_policy.forbidden_writes` includes trusted, objects, tasks, task auto-creation, weekly summary without review, raw vault mutation, and secret reading;
- runtime context is clearly marked as not authority;
- no secret/token/account config appears in the context.

## 17. Future Extension Points

Future / not implemented yet:

| Extension | Conditions Before Implementation |
|---|---|
| Real `reminder_state` adapter | Must avoid secrets and uncontrolled runtime reads. |
| Real task flow | Requires task authority model, Web/App management, confirmation, and rollback. |
| Recovery style switching | Must affect tone only, not authority. |
| Weekly summary workflow | Must require Inbox Review Gate before authority summary/object use. |
| App / Android context consumer | Must preserve the same write policy and budget. |
| RAG sidecar | Must remain derived retrieval, not authority. |
