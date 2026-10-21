# PKOS Web Dashboard

> Status: v0.8-beta local Web Dashboard slice. This is a local human operations surface, not PKOS authority.

The dashboard is a private local UI for Agent Runtime operations and recovery. It talks to the Agent Server by same-origin `/api` and `/health` requests during development through the Vite proxy.

It does not implement real LLM calls, Agent tool selection, RAG, memory,
recurring reminder scheduling, trusted migration, object conversion, arbitrary
YAML editing, force/cascade object delete, OpenClaw, WeChat, Electron, mobile,
or production static hosting.

Common browser-safe API types, guards, fetch helpers, NDJSON parsing, and request attempt state now live in `packages/agent-client`. Web-only management surfaces such as Inbox Review, Action Requests, and Audit keep their local model code and behavior boundaries unchanged.

## 中文优先界面

默认使用简体中文，右上角 `中文 / EN` 切换语言。只允许保存
`pkos.ui.locale` 这一界面偏好，不缓存聊天、对象、表单或权威数据。
用户内容、对象 ID、API 枚举和审计原始字段不翻译；时间仍使用北京时间。
对象新建表单、技术信息按需展开，已有校验和人类确认流程不变。

## 隔离设计预览

```powershell
npm run ui-preview
```

打开 `http://127.0.0.1:5180/`，Desktop renderer 位于 `/desktop/`。
预览仅使用浏览器内合成数据；所有请求由本地 fixture 接管，CSP 禁止网络请求。
未模拟的请求失败关闭，不会回落到真实 Agent Server。可用 `PKOS_PREVIEW_PORT`
设置其他端口。此预览不代替正式 Data Root 的人工验收。

```powershell
npm run locale-smoke
node src/scripts/localeCopySmoke.mjs
npm run ui-visual-smoke
```

视觉测试需要可用的 Playwright 和 Microsoft Edge。若 Playwright 不在当前依赖中，
设置 `PKOS_PLAYWRIGHT_MODULE` 为已安装的 `playwright/index.mjs` 路径。
`PKOS_SCREENSHOT_DIR` 可指定截图目录；默认写入系统临时目录。
测试覆盖两种语言、1440/900/390px 窗口、会话隔离、页面恢复、输入快捷键和无业务数据缓存。

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
- Objects: human object list/get/render/create/update/delete-preflight/delete through fixed Agent Server APIs.
- Review: local human SRS review loop with hidden answer, rating, next-due result, history, and correction undo.
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

## Review/SRS Contract

The Review page manages human SRS ratings through fixed endpoints:

- `GET /api/pkos/review/queue`
- `GET /api/pkos/review/items/:objectId`
- `GET /api/pkos/review/items/:objectId/history`
- `POST /api/pkos/review/ratings`
- `POST /api/pkos/review/corrections`

The queue does not include object body text. The review card starts with the
answer hidden behind `Show answer`; clicking it calls
`GET /api/pkos/objects/:objectId/render` and displays the centralized object
render body plus sections. Ratings use bilingual 1..5 labels. Clicking
Submit Rating or Undo last rating is the human confirmation and sends
`confirmed: true`. Retry reuses the frozen `requestId` and payload. The page
does not use `localStorage` as authority and does not add pressure mechanics or
automatic mastery decisions.

## Objects Contract

The Objects page is the Web surface for v0.8-beta Object Authority. It uses:

- `GET /api/pkos/object-types`
- `GET /api/pkos/objects`
- `GET /api/pkos/objects/:objectId`
- `GET /api/pkos/objects/:objectId/render`
- `POST /api/pkos/objects/:objectId/delete-preflight`
- `POST /api/pkos/objects`
- `PUT /api/pkos/objects/:objectId`
- `POST /api/pkos/objects/:objectId/delete`

List rows show metadata only, not full object body text. Detail loads immutable
metadata, revision, semantic content hash, SRS eligibility, render body, and
read-only Additional Fields. Create and update forms submit only typed fields
plus `confirmed: true`, `requestId`, and `baseRevision` where required; the
browser never submits `srs`, arbitrary paths, or YAML.

Delete always starts with preflight. The final delete button is disabled until
preflight allows deletion, the human types the exact object id, and a non-empty
reason is present. The page does not implement force delete, cascade delete, or
object id reuse.

Full object text is visible only in the localhost UI for the human operator. It
is not stored in `localStorage`, URL query parameters, generic SQLite audit
payloads, or Agent event payloads.

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
npm run review-web-smoke
npm run object-web-smoke
```

Expected smoke marker:

```text
WEB_DASHBOARD_SMOKE_OK
REVIEW_WEB_SMOKE_OK
OBJECT_WEB_SMOKE_OK
```
