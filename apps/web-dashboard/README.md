# PKOS Web Dashboard

> Status: v0.6 first Web Dashboard slice. This is a local human operations surface, not PKOS authority.

The dashboard is a private local UI for Agent Runtime operations and recovery. It talks to the Agent Server by same-origin `/api` and `/health` requests during development through the Vite proxy.

It does not implement real LLM calls, Agent tool selection, RAG, memory, task or reminder scheduling, object management, trusted migration, Inbox Review, OpenClaw, WeChat, Electron, mobile, or production static hosting.

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
- Action Requests: idempotency/recovery list, detail view, and human resolution for indeterminate requests.
- Audit: read-only `agent_events` view through sanitized payload summaries.

## Capture Request Contract

The Capture page never asks for `toolName`, command, executable, module, or file path. It only calls fixed endpoints:

- `POST /api/actions/inbox-append`
- `POST /api/actions/state-append`

On first submit the browser creates one `requestId` with `crypto.randomUUID()` and freezes the normalized payload in memory. If the network result is unknown, retry reuses the same `requestId` and the same frozen payload. Editing the form after submit does not change that request. Use `新建请求` to clear the attempt and create a new `requestId`.

The dashboard does not store full capture content or state notes in `localStorage`. A page refresh can lose drafts.

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
