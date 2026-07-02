# Inbox Review Contract

> Status: MVP. This contract defines a local CLI review layer over `inbox/items.jsonl`.

## Purpose

Inbox Review lets a human review captured Inbox items without mutating the original capture log.

It is intentionally small:

- no object creation;
- no task creation;
- no trusted migration;
- no background service;
- no database;
- no RAG or vector index;
- no Moonlolo automation.

## Authority Files

Capture log:

```text
inbox/items.jsonl
```

Review action log:

```text
review/logs/inbox_review_actions.jsonl
```

Derived runtime view:

```text
runtime/inbox_review/current.json
```

`inbox/items.jsonl` is append-only capture history. Inbox Review must not edit old lines, delete lines, or rewrite the file.

`review/logs/inbox_review_actions.jsonl` is append-only review history. Status changes are represented as new events.

`runtime/inbox_review/current.json` is a rebuildable cache. It may be deleted and regenerated.

## Status Model

Allowed effective statuses:

```text
unprocessed
archived
converted
```

Effective status is computed as:

1. Start from the inbox item's `status` field.
2. If missing or invalid, use `unprocessed`.
3. If `review/logs/inbox_review_actions.jsonl` contains one or more `mark_status` events for the item, use the latest valid event in file order.

## Review Action Event

```json
{
  "schema_version": "0.5-alpha",
  "type": "inbox_review_action",
  "id": "inbox_review_<timestamp>_<suffix>",
  "created_at": "...Z",
  "inbox_id": "...",
  "action": "mark_status",
  "status": "archived",
  "reason": "reviewed",
  "source": "manual"
}
```

## CLI

List Inbox Review state:

```bash
python3 -B -m tools.pkos inbox-review list
python3 -B -m tools.pkos inbox-review list --json
python3 -B -m tools.pkos inbox-review list --status unprocessed --limit 20
python3 -B -m tools.pkos inbox-review list --source moonlolo
python3 -B -m tools.pkos inbox-review list --tag test
```

Append a review status action:

```bash
python3 -B -m tools.pkos inbox-review mark --id <inbox_id> --status archived --reason "reviewed"
python3 -B -m tools.pkos inbox-review mark --id <inbox_id> --status unprocessed --reason "restore"
python3 -B -m tools.pkos inbox-review mark --id <inbox_id> --status converted --reason "manually converted"
```

Both `list` and `mark` support `--json`.

## PKOS_DATA_ROOT

Inbox Review resolves all data paths under `PKOS_DATA_ROOT` when it is set:

- `inbox/items.jsonl`
- `review/logs/inbox_review_actions.jsonl`
- `runtime/inbox_review/current.json`

The command must not write to the core repository when a separate data root is configured.

## Non-Goals

Inbox Review does not:

- modify `objects/`;
- create tasks;
- create facts, skills, claims, or creative objects;
- migrate anything to `trusted`;
- delete Inbox items;
- rewrite Inbox JSONL;
- call Moonlolo automatically;
- expose HTTP endpoints.
