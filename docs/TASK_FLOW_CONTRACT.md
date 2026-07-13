# Task Flow Contract v0.7-alpha

> Status: MVP authority contract for human-managed formal tasks.

## Scope

Formal tasks are PKOS authority data. They are not Agent SQLite runtime state,
not Flow Hub authority, and not reminders. This MVP provides human-created task
records, append-only task actions, deterministic current-view rebuilds, Python
CLI access, fixed Agent Server APIs, and a Web Dashboard management surface.

Not enabled in this version: reminder scheduler, recurring tasks, Agent
auto-creation, LLM task extraction, automatic priority, automatic due dates,
task re-planning, Desktop task UI, RAG, MCP, or trusted/object mutation.

## Authority Paths

All paths are resolved under `PKOS_DATA_ROOT`:

```text
tasks/items.jsonl
tasks/actions.jsonl
runtime/tasks/current.json
```

`tasks/items.jsonl` is append-only task creation authority.
`tasks/actions.jsonl` is append-only status action authority. Alpha legacy
`note_added` rows may exist and must remain parseable, but this version does
not provide a new note write interface.
`runtime/tasks/current.json` is a deterministic derived view and may be deleted
and rebuilt.

Node and Web must not write these JSONL files directly. Mutations must go
through fixed Python CLI commands.

## Task Item Schema

Each creation record uses `schema_version = "0.7-alpha"` and `type =
"task_item"`.

Required fields:

- `id`
- `title`
- `source`
- `tags`
- `priority`
- `status = "open"`
- `created_at`
- `created_by`
- `schema_version`

Optional fields:

- `description`
- `due_at`
- `request_id`
- `payload_sha256`

`priority` is one of `low`, `normal`, `high`.
`due_at`, when present, is stored as UTC ISO 8601 with `Z`. Web input and
display use Beijing time (`Asia/Shanghai`, `zh-CN`) and convert before writing.
The picker supports 30-minute precision only. `due_at` does not create a
reminder, repeat rule, or scheduler entry.

## Task Action Schema

Each action uses `schema_version = "0.7-alpha"` and `type = "task_action"`.

Common fields:

- `id`
- `task_id`
- `action_type`
- `created_at`
- `created_by`
- `request_id`
- `payload_sha256`

Supported new `action_type` values in this MVP:

- `status_changed`

`status_changed` also stores `from_status`, `to_status`, and `reason`.

Legacy-compatible action type:

- `note_added`

`note_added` stores `note` in historical alpha logs. Rebuild must tolerate it
without rewriting or deleting it. New task creation and status transitions must
not generate `note_added`, and there is no current `task-note` CLI, API route,
tool registration, or Web UI.

## Lifecycle

Allowed statuses:

```text
open
in_progress
blocked
done
cancelled
```

Allowed transitions:

```text
open        -> in_progress, blocked, done, cancelled
in_progress -> open, blocked, done, cancelled
blocked     -> open, in_progress, done, cancelled
done        -> open
cancelled   -> open
```

Invalid transitions are rejected. Same-state transitions do not append an
action and return `no_state_change`. Reopen appends an action; it never rewrites
the original completion or cancellation history.

## Current View

`runtime/tasks/current.json` contains:

- `schema_version`
- `generated_at`
- `source.items_path`
- `source.actions_path`
- `source.items_count`
- `source.actions_count`
- `source.items_sha256`
- `source.actions_sha256`
- deterministic `items[]`

Current items are ordered by status bucket, `due_at`, `created_at`, and `id`.
Malformed item or action logs fail explicitly; rebuild must not return partial
results as if complete.

## Idempotency

Python authority commands accept `request_id`.

Same `request_id` with the same normalized operation payload returns the
original result and does not append another row.

Same `request_id` with a different payload returns
`idempotency_conflict` and does not write authority data.

`request_id` is global across task item and task action logs. Reusing a task
creation request id for a transition, or reusing a legacy note request id for a
transition, is an `idempotency_conflict`.

Node `action_requests` idempotency remains necessary for HTTP recovery, but it
is not sufficient by itself because a process can crash after Python appends and
before SQLite records completion.

## Audit And Redaction

Task `title`, `description`, `reason`, and legacy `note` are sensitive content.
They may exist in authority task logs and may be returned to the localhost Web
Dashboard, but they must not be written in full to generic SQLite audit
payloads, AgentEvent payloads, URL query strings, browser storage, runtime
profile files, or logs.

Audit summaries may store:

- task id
- operation
- target status
- character counts
- SHA-256 digests
- request id
- result status

## Flow Hub Summary

Flow Hub may expose only a bounded derived task summary:

- open count
- in-progress count
- blocked count
- done count
- cancelled count
- overdue count
- next due timestamp
- source counts and hashes

It must not include full task title, description, reason, or note by default.
Flow Hub is runtime cache only and is not task authority.

## Agent Boundary

Agents may not automatically create, complete, cancel, prioritize, schedule, or
reorder formal tasks. Task mutations are L2 deterministic writes requiring
explicit user confirmation through fixed interfaces.

Agents may read bounded task summaries. They may not treat task summary as
authority and may not infer tasks from Inbox captures.

## Web Confirmation And Due Picker

The Web Dashboard does not show extra confirmation checkboxes for task creation
or task transitions. A click on an explicitly named mutation button is the human
confirmation in the UI. The HTTP API still requires `confirmed: true`, so
non-Web callers cannot accidentally mutate tasks without the confirmation flag.

Due picker quick-date semantics are Beijing calendar semantics:

- Today: current Beijing date.
- Tomorrow: current Beijing date + 1 calendar day.
- Next week: current Beijing date + 7 calendar days.
- Next month: current Beijing date + 1 calendar month, clamped to month end.

When no time is selected, quick dates use the next Beijing half-hour. Closing
the picker without confirming does not change the form value. Clearing due time
sets `dueAt = null`.

Example:

```text
Beijing input: 2026-07-15 18:00
Authority storage: 2026-07-15T10:00:00.000Z
Web display: 2026-07-15 18:00
```

## Manual Acceptance Path Check

PowerShell variables do not survive across new shell sessions. Manual
acceptance should reload the current runtime profile and fail immediately if the
data root is empty or missing:

```powershell
$profilePath = Join-Path (Get-Location) "runtime\local\runtime-profile.json"
if (-not (Test-Path $profilePath)) { throw "RUNTIME_PROFILE_NOT_FOUND: $profilePath" }
$profile = Get-Content $profilePath -Raw -Encoding UTF8 | ConvertFrom-Json
$acceptanceRoot = [string]$profile.dataRoot
if ([string]::IsNullOrWhiteSpace($acceptanceRoot)) { throw "PKOS_DATA_ROOT_EMPTY_IN_RUNTIME_PROFILE" }
if (-not (Test-Path $acceptanceRoot)) { throw "PKOS_DATA_ROOT_NOT_FOUND: $acceptanceRoot" }
$taskRoot = Join-Path $acceptanceRoot "tasks"
$currentView = Join-Path $acceptanceRoot "runtime\tasks\current.json"
Get-ChildItem $taskRoot -Force
Get-Item $currentView
```
