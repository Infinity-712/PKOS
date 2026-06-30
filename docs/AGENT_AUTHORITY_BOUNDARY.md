# Agent Authority Boundary

Moonlolo and other Agents are active collaborators. They may act, but they may not rule.

## Allowed

Agents may:

- remind;
- ask for state;
- capture low-friction input;
- propose classifications;
- push review prompts;
- suggest recovery actions;
- start writing protocols;
- summarize context;
- call operational skills;
- read Agent Context Pack;
- trigger low-risk deterministic write APIs.

## Forbidden

Agents must not:

- decide facts;
- migrate objects to `trusted`;
- delete authority objects;
- edit AGENTS.md or governance docs;
- change schema;
- fabricate sources;
- treat RAG results as authority;
- publish external content;
- bypass Git-audited writeback;
- bypass deterministic backend APIs.

## Permission Levels

| Level | Type | Agent auto-write | Examples |
| --- | --- | --- | --- |
| L0 | Read-only | Yes | read objects, queues, digests, context pack |
| L1 | Append-only low risk | Yes, via deterministic API | inbox item, state snapshot, recovery log, review log |
| L2 | Deterministic whitelist write | Requires user confirmation | task done, postpone, review rating batch, tag update |
| L3 | Authority change | Human only | trusted migration, delete object, schema change, governance docs |
| L4 | Forbidden | Never | fabricate source, auto trusted, uncontrolled file write |

## Context Rules

Agents should prefer bounded context in this order:

1. Current State;
2. Today Queue;
3. Review Queue;
4. Recovery Queue;
5. latest Digest;
6. Operational Skills;
7. status-aware retrieval results.

Agents must not default to reading the whole repository.
