# Reminder Contract

> Status: v0.7-beta MVP. This document defines the human-managed one-shot Reminder authority and runtime delivery boundary.

## Purpose

Reminders are explicit, human-managed one-shot records for local PKOS operation. They are separate from formal tasks: a task may have zero, one, or many reminders, and a reminder may also be standalone.

## Authority

Reminder authority is file-based and append-only:

```text
reminders/items.jsonl
reminders/actions.jsonl
```

Derived views are rebuildable runtime files:

```text
runtime/reminders/current.json
runtime/reminders/due.json
```

SQLite is not Reminder authority. The Agent Server may keep runtime delivery attempts in SQLite, but deleting SQLite must not delete or change reminder authority.

## Lifecycle

Reminder creation appends one `reminder_item`. Reminder lifecycle changes append one `reminder_action`.

Status is derived:

```text
scheduled -> acknowledged
scheduled -> cancelled
scheduled -> scheduled   # rescheduled
acknowledged/cancelled -> scheduled  # explicit reschedule reopens
```

The original item line is never modified.

## CLI

```bash
python -B -m tools.pkos reminder-create --title "..." --remind-at "2026-07-15T10:00:00Z" --request-id "..."
python -B -m tools.pkos reminder-list --json
python -B -m tools.pkos reminder-get --id reminder_... --json
python -B -m tools.pkos reminder-acknowledge --id reminder_... --reason "seen" --request-id "..."
python -B -m tools.pkos reminder-cancel --id reminder_... --reason "cancelled" --request-id "..."
python -B -m tools.pkos reminder-reschedule --id reminder_... --remind-at "2026-07-16T10:00:00Z" --reason "later" --request-id "..."
python -B -m tools.pkos reminder-due --now "2026-07-16T10:01:00Z" --json
python -B -m tools.pkos reminder-rebuild --json
```

All commands support `PKOS_DATA_ROOT`. Reminder commands do not write `objects/`, trusted status, task authority, docs, schema, or `AGENTS.md`.

## Idempotency

`request_id` replay with the same payload returns the existing write result and does not append another line. Reusing a `request_id` with a different payload is an idempotency conflict.

## Task Reference Boundary

`task_id` is optional. If present, it must reference an existing formal task. Creating a task with `dueAt` never creates a reminder automatically.

Reminders do not create, complete, reorder, or mutate tasks.

## Agent Server API

Read-only:

```text
GET /api/pkos/reminders
GET /api/pkos/reminders/:id
GET /api/pkos/reminders/due
GET /api/runtime/reminder-notifications
```

Explicit human mutations:

```text
POST /api/pkos/reminders
POST /api/pkos/reminders/:id/acknowledge
POST /api/pkos/reminders/:id/cancel
POST /api/pkos/reminders/:id/reschedule
```

Mutation endpoints require `confirmed: true` and are routed through the fixed Action API, ToolExecutor audit, WritebackRouter allowlist, and Python CLI. Generic tool names, commands, paths, and executables are not accepted from the client.

SQLite audit stores hashes and character counts for title, description, and reason. It must not store full reminder text.

## Runtime Scheduler Boundary

The v0.7-beta scheduler is a one-shot runtime delivery ledger:

```text
reminder_delivery_attempts
```

It records due reminder delivery attempts for the local runtime fingerprint and `desktop_panel` channel. It does not use one timer per reminder, does not run as a background OS service, and does not write reminder authority.

If SQLite is deleted, due reminders can be rediscovered from JSONL authority.

## UI Boundary

Web Dashboard provides human management for create/list/detail/acknowledge/cancel/reschedule.

Desktop provides a small due reminder runtime notification panel. Desktop does not create native OS notifications in this MVP and does not write reminder authority.

## Non-goals

This MVP does not implement:

- recurring reminders;
- task `dueAt` auto-reminders;
- Agent-created reminders;
- Agent auto-acknowledge/cancel/reschedule;
- reminder-to-task conversion;
- OS notification center integration;
- tray/background daemon;
- database reminder authority;
- RAG, memory, trusted/object writes, or public publishing.
