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

Review writes operate on `PKOS_DATA_ROOT`. If that data root is a Git repository, the Python CLI commits only the changed review authority/projection files for the current operation.

If data root is not a Git repository, writes still complete and return:

```json
{ "gitCommitCreated": false }
```

The CLI must not accidentally commit the core repository when `PKOS_DATA_ROOT` points elsewhere.

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
