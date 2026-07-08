# PKOS Web Dashboard

> Status: v0.6 first Web Dashboard slice. This is a local human operations surface, not PKOS authority.

The dashboard is a private local UI for Agent Runtime operations and recovery. It talks to the Agent Server by same-origin `/api` and `/health` requests during development through the Vite proxy.

It does not implement real LLM calls, Agent tool selection, RAG, memory, task or reminder scheduling, object management, trusted migration, object conversion, OpenClaw, WeChat, Electron, mobile, or production static hosting.

Common browser-safe API types, guards, fetch helpers, NDJSON parsing, and request attempt state now live in `packages/agent-client`. Web-only management surfaces such as Inbox Review, Action Requests, and Audit keep their local model code and behavior boundaries unchanged.

## Run Locally

Use two terminals.

Terminal 1:

```bash
cd apps/agent-server
npm install
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

- Overview: health, connected status, dev/build marker, enabled capability summary, disabled capability summary.
- Capture: fixed Action API forms for `inbox-append` and `state-append`.
- State: Current State card, explicit new state snapshot form, and append-only state timeline.
- Inbox Review: local human review for `archive` and `restore` through fixed API endpoints.
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

Converted items are read-only in this version: “该条目已被标记为 converted。本版本不验证或创建转换目标。” The dashboard cannot create new converted status or conversion targets.

The page does not provide batch archive, inbox-zero pressure copy, object creation, task creation, content editing, deletion, or generic mark/status controls.

Inbox content is shown for local human review, but the dashboard does not persist capture content or review reasons in `localStorage`.

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
