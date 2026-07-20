# PKOS Web Dashboard

> Status: v0.6 first Web Dashboard slice. This is a local human operations surface, not PKOS authority.

The dashboard is a private local UI for Agent Runtime operations and recovery. It talks to the Agent Server by same-origin `/api` and `/health` requests during development through the Vite proxy.

It does not implement real LLM calls, Agent tool selection, RAG, memory,
recurring reminder scheduling, object management, trusted migration, object conversion,
OpenClaw, WeChat, Electron, mobile, or production static hosting.

Common browser-safe API types, guards, fetch helpers, NDJSON parsing, and request attempt state now live in `packages/agent-client`. Web-only management surfaces such as Inbox Review, Action Requests, and Audit keep their local model code and behavior boundaries unchanged.

## Run Locally

Recommended local startup is the root runtime helper:

```powershell
powershell -ExecutionPolicy Bypass -File ..\..\scripts\local-runtime.ps1 start
```

Manual development can still use two terminals, but set `PKOS_CORE_ROOT` and
`PKOS_DATA_ROOT` explicitly before starting Agent Server.

Terminal 1:

```bash
cd apps/agent-server
npm install
$env:PKOS_CORE_ROOT="E:\Creation\Codex\PKOS"
$env:PKOS_DATA_ROOT="E:\Creation\PKOS-Data"
npm run dev
```

Terminal 2:

```bash
cd apps/web-dashboard
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

## Pages

- Overview: health, connected status, service build fingerprint, API contract, database compatibility, enabled capability summary, disabled capability summary.
- Capture: fixed Action API forms for `inbox-append` and `state-append`.
- State: Current State card, explicit new state snapshot form, and append-only state timeline.
- Inbox Review: local human review for `archive` and `restore` through fixed API endpoints.
- Tasks: local human management for formal task create/list/detail/status transitions through fixed API endpoints.
- Reminders: local human management for one-shot reminder create/list/detail/acknowledge/cancel/reschedule through fixed API endpoints.
- Action Requests: idempotency/recovery list, detail view, and human resolution for indeterminate requests.
- Audit: read-only `agent_events` view through sanitized payload summaries.

## Capture Request Contract

The Capture page never asks for `toolName`, command, executable, module, or file path. It only calls fixed endpoints:

- `POST /api/actions/inbox-append`
- `POST /api/actions/state-append`

On first submit the browser creates one `requestId` with `crypto.randomUUID()` and freezes the normalized payload in memory. If the network result is unknown, retry reuses the same `requestId` and the same frozen payload. Editing the form after submit does not change that request. Use `新建请求` to clear the attempt and create a new `requestId`.

The dashboard does not store full capture content or state notes in `localStorage`. A page refresh can lose drafts.

## State Page Contract

The State page is a local human view over explicit state snapshots. It is not a diagnosis surface and does not infer trends, reorder tasks, change reminders, or summarize the user automatically.

The page uses:

- `GET /api/pkos/state-timeline`
- `POST /api/actions/state-append`

Current State comes from the latest explicit `state/snapshots.jsonl` snapshot before page filters are applied. Timeline filters for `energy`, `mood`, `mode`, and `limit` affect only the list. A stale badge means the record is older than the freshness window and may no longer describe now; stale does not mean invalid.

New State Snapshot reuses the same State Capture form and requestAttempt state machine as the Capture page. The first submit creates a `requestId` and freezes the payload in memory; network-unknown retry reuses that `requestId`; edits after submit require `新建请求`; successful writes refresh the State Timeline. The submit button says `记录新状态快照` to keep the operation append-only.

The page does not provide edit, delete, batch mutation, drag sorting, trend inference, full CSV export, diagnosis, object conversion, task creation, reminder changes, or generic tool execution.

State note text may be displayed in the localhost page for human review, but it is not stored in `localStorage`, URL query parameters, console logs, `agent_events`, `tool_calls`, `action_requests`, or Audit API payload summaries.

## Inbox Review Contract

Inbox Review changes derived effective status only. It does not modify the original append-only `inbox/items.jsonl` capture log.

The page uses fixed endpoints:

- `GET /api/pkos/inbox-review`
- `POST /api/pkos/inbox-review/:id/archive`
- `POST /api/pkos/inbox-review/:id/restore`

Archive copy uses `归档`, not delete language. Restore copy uses `恢复为待处理`.

Each mutation requires a reason and explicit checkbox confirmation. The first submit creates a `requestId` and freezes the payload in memory. If the network result is unknown, retry reuses the same `requestId` and frozen payload. If the reason changes, use `新建请求` before submitting the new reason.

Converted items are read-only in this version: `该条目已被标记为 converted。本版本不验证或创建转换目标。` The dashboard cannot create new converted status or conversion targets.

The page does not provide batch archive, inbox-zero pressure copy, object creation, task creation, content editing, deletion, or generic mark/status controls.

Inbox content is shown for local human review, but the dashboard does not persist capture content or review reasons in `localStorage`.

## Tasks Contract

The Tasks page manages formal tasks through explicit human actions. Task
authority remains under `PKOS_DATA_ROOT`:

- `tasks/items.jsonl`
- `tasks/actions.jsonl`
- `runtime/tasks/current.json` as a rebuildable derived view

The page uses fixed endpoints:

- `GET /api/pkos/tasks`
- `GET /api/pkos/tasks/:taskId`
- `POST /api/pkos/tasks`
- `POST /api/pkos/tasks/:taskId/transition`

Task creation and status transitions require a filled title/reason and a click
on an explicitly named mutation button. There is no extra task confirmation
checkbox: clicking Create Task or Apply Transition is the human UI
confirmation. The request body still includes `confirmed: true`, and the server
continues to reject direct API calls with `confirmed: false`.

The first submit freezes one `requestId` and payload in memory; retry reuses
that exact request. Editing fields after submit does not alter the frozen retry
payload. Use `New Request` to intentionally start over.

The page does not infer tasks from Inbox, auto-prioritize, auto-create due
dates, schedule reminders, batch complete, drag reorder, call an Agent, create
task notes, or write task JSONL files directly. Full task
titles/descriptions/reasons may be shown in the localhost UI for the human
operator, but they are not placed in URL query parameters, `localStorage`,
generic SQLite audit payloads, or Agent event payloads.

Due Picker behavior:

- all user-facing task due input and display uses Beijing time;
- authority storage and API payloads remain UTC ISO strings;
- time choices are fixed to 30-minute intervals from `00:00` through `23:30`;
- quick dates are Today, Tomorrow, Next week, and Next month using Beijing
  calendar semantics;
- Next month clamps to the target month end when needed;
- closing the picker without confirming does not change the form;
- clearing due sets `dueAt` to `null`;
- due time does not create reminder or repeat data.

Example:

```text
Displayed/input: 2026-07-15 18:00
API/authority: 2026-07-15T10:00:00.000Z
```

## Reminders Contract

The Reminders page manages explicit one-shot reminders. Reminder authority
remains under `PKOS_DATA_ROOT`:

- `reminders/items.jsonl`
- `reminders/actions.jsonl`
- `runtime/reminders/current.json` and `runtime/reminders/due.json` as rebuildable derived views

The page uses fixed endpoints:

- `GET /api/pkos/reminders`
- `GET /api/pkos/reminders/:reminderId`
- `POST /api/pkos/reminders`
- `POST /api/pkos/reminders/:reminderId/acknowledge`
- `POST /api/pkos/reminders/:reminderId/cancel`
- `POST /api/pkos/reminders/:reminderId/reschedule`

The first submit freezes one `requestId` and payload in memory; retry reuses the
same request. Clicking Create Reminder, Apply Reminder Action, or Reschedule
Reminder is the explicit human confirmation and the request body includes
`confirmed: true`.

The page does not create recurring reminders, infer reminders from task dueAt,
auto-acknowledge, auto-cancel, auto-reschedule, or write reminder JSONL files
directly. Full reminder titles/descriptions/reasons may be shown in localhost UI
for the human operator, but they are not placed in URL query parameters,
`localStorage`, generic SQLite audit payloads, or Agent event payloads.

## Verification

```bash
npm run check
npm run build
npm run smoke
```

Expected smoke marker:

```text
WEB_DASHBOARD_SMOKE_OK
```
