# Review/SRS Contract

> Status: v0.8-alpha MVP contract. Review/SRS authority is human-managed and append-only. Agent/LLM code must not grade mastery or mutate trusted knowledge.

## Authority Paths

Review authority lives under the active `PKOS_DATA_ROOT`:

```text
review/logs/YYYY-MM-DD.jsonl
```

Each line is an append-only event. Historical lines must not be edited in place.

Derived projections are rebuildable caches:

```text
runtime/review/current.json
runtime/review/queue.json
```

`object.srs` is a compatibility projection for old queue/export code. It is not independent authority and must be regenerated from review events plus explicit legacy state.

## Reviewable Objects

Only `fact`, `skill`, and `claim` enter default Review/SRS. `creative` remains internal writing material and is excluded.

## Event Schema

`review_rating` events include:

- `schemaVersion = "0.8-alpha"`
- `type = "review_rating"`
- `id`
- `objectId`
- `objectType`
- `rating`
- `ratingLabel`
- `reviewedAt`
- `actor`
- `requestId`
- `algorithmId`
- `algorithmVersion`
- `objectContentSha256`
- `previousState`
- `resultingState`
- `payloadSha256`

`previousState` and `resultingState` include `repetitions`, `intervalDays`, `easeFactor`, `dueAt`, and `lastReviewedAt`.

`review_correction` events append a correction instead of editing the target event. They include `targetEventId`, `reasonChars`, `reasonSha256`, optional `correctedRating`, `createdAt`, `actor`, `requestId`, and `payloadSha256`.

## Rating Semantics

Ratings remain compatible with the existing 1..5 range:

| Value | Label |
|---:|---|
| 1 | Again |
| 2 | Hard |
| 3 | Good |
| 4 | Easy |
| 5 | Perfect |

Web labels are bilingual, but Python and Web share the same numeric mapping.

New ratings cannot precede the object's latest accepted rating time. The
existing timestamp parser normalizes offsets to UTC seconds. Rejection uses
`review_time_regression` (HTTP 409) before any event, SRS/projection write or
commit. Exact requestId replay is resolved before this time check, so later
ratings cannot invalidate an earlier accepted request's replay.

The existing replay order is sorted log path, then physical JSONL line order.
Equal normalized timestamps share a date partition and retain append order
under the Data Root lock. Corrections retain their target's chronological slot,
including undo; they do not erase that rating's timestamp watermark. Correction
requests continue to reference explicit targets, not this new-rating time gate.
Legacy-only objects use their compatibility state's lastReviewedAt as the floor.
Already backdated historical logs are not migrated or recalculated here.

## Algorithm Versioning

Current algorithm:

```text
algorithmId: sm2-subset
algorithmVersion: 1
```

The implementation is a pure function in `tools/review_flow/algorithms/sm2_v1.py`. It receives `previous_state`, `rating`, and `reviewed_at`; it does not read files or system time.

Future algorithm changes must add a new version. Old events must not be reinterpreted by changing v1.

## Queue Ordering

`runtime/review/queue.json` is generated from reviewable objects plus replayed current state at `evaluatedAt`.

Due ordering:

1. overdue days descending;
2. `dueAt` ascending;
3. `objectType`;
4. `objectId`.

New objects without replayable review events use their existing `object.srs` as `legacy_unverified` onboarding state. This does not create fake history.

## Content Change Handling

Each rating stores `objectContentSha256`, computed from object authority content excluding `srs`.

If the current object hash differs from the latest rating hash, current/queue item state includes:

```json
{ "contentChangedSinceLastReview": true }
```

This does not automatically reset SRS. The UI warns the human reviewer. Reset is intentionally deferred.

## Object Authority Integration

Object create, update, and delete are handled by the v0.8-beta Object Authority
flow. Reviewable objects (`fact`, `skill`, and `claim`) enter Review/SRS
onboarding when projections are rebuilt. `creative` remains excluded.

Object updates preserve existing SRS state and never create review events. If
the semantic content hash changes, queues and item views expose
`contentChangedSinceLastReview`.

Object deletes do not delete review logs. Historical review events remain
append-only and are surfaced as orphaned when their object no longer exists.

Review Show Answer must use `GET /api/pkos/objects/:objectId/render` after the
human explicitly reveals the answer; review queue payloads must remain bounded
and must not include full object body text.

## Legacy Compatibility

Old v0.4 rows such as `{"id":"...","score":3,"ts":"..."}` are not rewritten. They are marked `legacy_unverified`.

Existing `object.srs` can seed current state only as legacy compatibility. It is exposed with a warning and becomes replayable after a new v0.8 `review_rating` event.

Malformed JSONL rows fail rebuild with `malformed_review_log`; they are not silently ignored.

## Orphan Handling

If a review event references a missing object, current projection includes an `orphaned` item and a warning. Orphans do not enter the normal review queue and never recreate objects automatically.

## Idempotency And Batch

Every mutation requires `requestId`.

Same `requestId` with the same normalized payload returns replay without appending, rewriting projection, or creating a new git commit.

Same `requestId` with a different payload fails with `idempotency_conflict`.

Batch writes use deterministic per-item request IDs:

```text
sha256(batchRequestId + ":" + objectId)
```

Batch semantics are deterministic partial success: successful items append independently; failures are returned without rolling back successful items; retry does not duplicate successful items.

## Git And Data Root

Rating, batch rating and correction require a Git working tree whose resolved
repository root is exactly the resolved `PKOS_DATA_ROOT`, checked before file
mutation. A missing repository, bare repository or ancestor/Core repository
fails with `data_root_git_required` (HTTP 409). There is no production bypass
flag and no successful-write fallback without version history. This replaces
the earlier non-Git write behavior; Task/Reminder persistence is unchanged.

The CLI commits only this operation's authority files and affected object SRS
compatibility projection. `runtime/` JSON is excluded. Idempotent replay makes
no new commit. The internal `commit=False` call is for the enclosing batch
transaction, not an exposed CLI option. Tests initialize isolated Git fixtures.

Read-only get/history/status/queue do not require Git and never modify object
authority. Queue may refresh its runtime JSON cache. Interrupted, uncommitted
review logs fail closed with `review_recovery_required`; automatic crash
recovery is not implemented. Do not infer event ownership from staged status,
delete accepted events, or discard unrelated changes during manual recovery.

## Agent Boundary

Agent/LLM code may read bounded review counts. It must not:

- grade a rating;
- decide mastery;
- create review events;
- correct review events;
- reset SRS;
- mutate objects/trusted/tasks from review;
- include full review queue, object title/content, rating history, or correction reason in ordinary Agent Context.

## Agent Context

Flow Hub may expose only a bounded `review_summary`: due count, overdue count, upcoming count, next due time, warning counts, and source hashes.

No object titles, object body, review history, or correction reasons are included.
