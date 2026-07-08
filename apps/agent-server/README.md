# PKOS Agent Server Skeleton

> Status: v0.6 first-step skeleton. This package is a local dry-run runtime only.

## Goal

This package provides the first PKOS-native Agent Runtime skeleton:

- persistent local chat sessions;
- SQLite runtime audit store;
- structured AgentEvent stream;
- bounded read-only runtime context;
- internal L1 append-only writeback foundation;
- dry-run generation without external APIs;
- sanitized read-only Audit API for dashboard inspection;
- local HTTP endpoints for smoke testing.

## Non-goals

This skeleton does not implement real LLM calls, automatic tool selection, a public tool execution endpoint, RAG, MCP, multi-agent orchestration, sandboxed shell execution, Electron UI, OpenClaw, WeChat, formal tasks, trusted migration, durable agent memory, or object mutation.

## SQLite Driver

The implementation uses Node's built-in `node:sqlite` `DatabaseSync` API. The audited local environment is Node `v24.14.1`, where `node:sqlite` is available. No ORM is used.

Node requirement:

```text
Node >= 24
```

`node:sqlite` may print an experimental warning depending on the Node release.

## Runtime Data Location

Environment variables:

- `PKOS_CORE_ROOT`: PKOS repository root. Defaults to the repository root inferred from this package.
- `PKOS_DATA_ROOT`: private data root. Defaults to `PKOS_CORE_ROOT`.
- `PKOS_AGENT_DB_PATH`: SQLite file path. Defaults to `${PKOS_DATA_ROOT}/runtime/agent/agent.sqlite`.
- `PKOS_AGENT_PORT`: local HTTP port for `npm run dev`. Defaults to `8790`.

The server automatically creates the parent directory for the SQLite database.

## Commands

```bash
npm install
npm run check
npm run smoke
npm run context-smoke
npm run writeback-smoke
npm run action-api-smoke
npm run action-recovery-smoke
npm run audit-api-smoke
npm run inbox-review-api-smoke
npm run state-timeline-api-smoke
npm run dev
```

`npm run smoke` uses a temporary `PKOS_DATA_ROOT`, creates a database, creates a session, sends one dry-run message, and verifies persisted rows and events.

`npm run context-smoke` verifies the ContextBuilder contract, including bounded Flow Hub reads, recent message limits, missing/invalid context degradation, `context_built` event summaries, and the read-only context debug endpoint.

`npm run writeback-smoke` uses a temporary `PKOS_DATA_ROOT`, invokes the real Python PKOS CLI, and verifies append-only writes, ToolExecutor audit events, blocked permissions, CLI failure handling, and audit redaction.

`npm run action-api-smoke` verifies migrations, fixed Action API endpoints, request idempotency, replay/conflict/running behavior, CLI failure replay, concurrent request safety, and action audit redaction.

`npm run action-recovery-smoke` verifies stale running detection, indeterminate outcomes, human resolution, append-only resolution audit, concurrent resolution safety, and migration from version 2 to version 3.

`npm run audit-api-smoke` verifies the read-only Audit API, filters, pagination, invalid query handling, and payload summary redaction.

`npm run inbox-review-api-smoke` verifies the fixed Inbox Review API against a temporary `PKOS_DATA_ROOT`, temporary SQLite database, and the real Python CLI.

`npm run state-timeline-api-smoke` verifies the read-only State Timeline API against a temporary `PKOS_DATA_ROOT`, temporary SQLite database, and the real Python CLI. It covers empty state, ordering, current/filter semantics, stale display, malformed JSONL failure, append-then-refresh, and audit redaction.

## SQLite Migrations

Startup uses a minimal migration runner backed by `PRAGMA user_version`. No ORM or external migration framework is used.

Current migrations:

- `0001_initial.sql`: creates the existing v0.6 skeleton tables with `CREATE TABLE IF NOT EXISTS`;
- `0002_action_requests.sql`: adds `action_requests` for fixed Action API idempotency and replay;
- `0003_action_request_resolutions.sql`: adds append-only human resolution audit for indeterminate action requests.

Each migration runs inside a SQLite transaction and advances `user_version` only after the SQL succeeds. If a migration fails, startup fails and write APIs are not available from that database handle. Existing skeleton databases with tables but `user_version = 0` are upgraded safely because migrations use idempotent `CREATE ... IF NOT EXISTS` statements. Version 2 databases are upgraded to version 3 without dropping `action_requests`, `tool_calls`, or `agent_events`.

`schema.sql` is retained as a legacy/bootstrap schema reference. Runtime startup is governed by `MigrationRunner`.

## ContextBuilder

The ContextBuilder is a runtime-only input pack for the dry-run AgentRunner. It reads only:

- `${PKOS_DATA_ROOT}/runtime/agent_context.json`;
- recent `chat_messages` rows for the current session;
- static Agent authority policy embedded in this package.

It must not read the full vault, `objects/`, `raw_vault/`, review logs, full inbox content, secrets, RAG indexes, or durable agent memory.

Default budget:

- max items: `20`;
- max characters: `12000`;
- recent messages: at most `12`;
- per-message content: at most `2000` characters.

Items carry source, authority, estimated character count, and freshness metadata. Flow Hub context is marked stale when `generated_at` or `current_state.updated_at` is older than 24 hours. Missing or invalid Flow Hub context degrades with warnings instead of failing chat generation.

AgentRunner records a `context_built` event for each generation, but the payload is summary metadata only: item count, used characters, truncation, warnings, and source counts. Full context items are not persisted in `agent_events`.

## Tools And Writeback

The tool layer is internal-only in this sprint. It is not connected to `AgentRunner`, `DryRunProvider`, or `POST /api/chat/send`, and there is no generic `POST /api/tools/execute` route.

Permission levels:

- `L0`: read-only;
- `L1`: low-risk append-only;
- `L2`: deterministic mutation requiring explicit confirmation;
- `L3`: authority mutation, human-only;
- `L4`: destructive/governance, human-only.

Current registered tools:

- `pkos.inbox.append`: `L1`, side-effecting, no confirmation required for explicit append calls;
- `pkos.inbox_review.archive`: `L2`, side-effecting, explicit user confirmation required;
- `pkos.inbox_review.restore`: `L2`, side-effecting, explicit user confirmation required;
- `pkos.state.append`: `L1`, side-effecting, no confirmation required for explicit append calls.

`ToolRegistry` is static code registration. It does not dynamically load modules or commands from strings.

`WritebackRouter` currently allows only:

- `pkos.inbox.append`;
- `pkos.inbox_review.archive`;
- `pkos.inbox_review.restore`;
- `pkos.state.append`.

It blocks unknown tools, trusted/object/task/governance writes, deletes, arbitrary file writes, and arbitrary command execution. The router distinguishes `unknown_tool`, `invalid_input`, `permission_denied`, `confirmation_required`, `cli_failed`, `timeout`, and `written` outcomes.

Node does not write `inbox/items.jsonl` or `state/snapshots.jsonl` directly. The deterministic write interface is the existing Python CLI:

```bash
python -B -m tools.pkos inbox-append --json
python -B -m tools.pkos inbox-review mark --id <id> --status archived --reason "..."
python -B -m tools.pkos inbox-review mark --id <id> --status unprocessed --reason "..."
python -B -m tools.pkos state-append --json
```

Node also does not read `state/snapshots.jsonl` directly for dashboard state history. The read-only State Timeline source is:

```bash
python -B -m tools.pkos state-list --json
```

The CLI process runner uses fixed argument arrays with `shell: false`, runs from `PKOS_CORE_ROOT`, forwards only a small environment allowlist plus `PKOS_CORE_ROOT` and `PKOS_DATA_ROOT`, and caps stdout/stderr at 64 KiB with a 10 second default timeout.

Audit data is minimized. `tool_calls` and `agent_events` record operation, enums, tags, source references, content/note length, and SHA-256 hashes. They do not duplicate full inbox content or state notes.

Inbox Review archive/restore records only `inboxId`, desired effective status, reason length, reason SHA-256, request id, sanitized result, and sanitized error code in SQLite audit/runtime tables. The full review reason is allowed only in the existing Python authority action log when the CLI appends `review/logs/inbox_review_actions.jsonl`.

## Fixed Action API

The Action API is for explicit future Web/Electron user actions. It is not Agent autonomous behavior, not chat command routing, and not natural-language tool selection.

Endpoints:

- `POST /api/actions/inbox-append` maps only to `pkos.inbox.append`;
- `POST /api/pkos/inbox-review/:id/archive` maps only to `pkos.inbox_review.archive`;
- `POST /api/pkos/inbox-review/:id/restore` maps only to `pkos.inbox_review.restore`;
- `POST /api/actions/state-append` maps only to `pkos.state.append`.

Clients cannot provide a tool name, executable, module, CLI subcommand, or file path. Unknown body fields are rejected, including override attempts such as `toolName`, `command`, or `executable`.

Every request must include `requestId`. The server validates and normalizes the action payload first, then stores only a stable SHA-256 payload hash in `action_requests`. The hash is based on normalized validated input, not raw JSON key order.

Idempotency behavior:

- first `requestId` + payload: insert `running`, execute the fixed tool, then store `completed` or `failed`;
- same `requestId` + same payload after completion: return the stored sanitized result with `replayed: true`;
- same `requestId` + same payload after failure: return the stored failure with `replayed: true`; no automatic retry;
- same `requestId` + different payload: return `409 idempotency_conflict`; no write;
- same `requestId` while fresh `running`: return `409 request_in_progress`; no second write;
- same `requestId` while stale `running` or stored `indeterminate`: return `409 request_indeterminate`; no retry and no vault scan.

Request limits:

- JSON body max: 64 KiB;
- bounded `requestId`, `sessionId`, and `sourceMessageId`;
- bounded `content`, `note`, tags, and metadata JSON;
- non-JSON bodies return structured 400 errors;
- prototype-pollution keys such as `__proto__`, `constructor`, and `prototype` are rejected.

HTTP status mapping:

- `200`: written or replayed completed result;
- `400`: invalid input or invalid JSON;
- `403`: blocked or permission denied;
- `409`: idempotency conflict or request in progress;
- `500`: CLI failure or internal writeback failure;
- `504`: timeout.

The API never returns raw stderr, environment variables, internal command paths, vault record full text, or secrets.

`action_requests` stores `request_id`, action name, payload hash, status, optional `tool_call_id`, and sanitized result/error JSON. It does not store full inbox content or full state notes.

For Inbox Review archive/restore, the stable payload hash includes the fixed action name, `inboxId`, and normalized reason. Replays do not call Python again. Stale running requests become `request_indeterminate` and must be handled through the existing human resolution flow.

Converted Inbox Review state is read-only in this sprint. The server does not expose a converted endpoint, generic mark endpoint, or generic tool execution endpoint.

## Action Recovery

There is an external write crash window:

1. `action_requests` is written as `running`;
2. the Python CLI may append to the PKOS vault;
3. the Node process may crash before `action_requests` is updated to `completed`.

When that happens, the runtime cannot safely claim either success or failure. It also must not retry, because retrying could duplicate an append-only vault write.

Stored statuses:

- `running`: the operation may still be executing;
- `completed`: the write is confirmed, either by normal completion or human verification;
- `failed`: the write is confirmed not successful, or the human explicitly abandoned it;
- `indeterminate`: the outcome is unknown and requires human verification.

The server primarily uses derived effective status. A stored `running` request becomes effectively `indeterminate` when `now - updated_at >= PKOS_ACTION_RUNNING_STALE_MS`. The default threshold is `300000` ms. Startup does not bulk rewrite stale rows, because another process may still be active and there is no multi-instance lock in this sprint.

Human resolution:

- `confirmed_written`: a human checked the authority log and confirmed a write exists; the request becomes `completed`;
- `confirmed_not_written`: a human checked and confirmed no write exists; the request becomes `failed` with `human_verified_not_written`;
- `abandoned`: a human chooses not to verify further; the request becomes `failed` with `human_abandoned_indeterminate`.

Every human resolution appends one row to `action_request_resolutions` and updates the final `action_requests` status in the same SQLite transaction. Each `requestId` accepts only one final resolution; duplicate or concurrent resolution attempts return `409 already_resolved`.

Resolution never calls `ToolExecutor`, never runs Python, never writes the PKOS vault, never guesses a `recordId`, and never scans the vault to infer a result. Future Web Dashboard work should show indeterminate requests clearly and ask the human to inspect the authority log.

## API

- `GET /health`
- `POST /api/chat/sessions`
- `GET /api/chat/sessions`
- `POST /api/chat/send`
- `GET /api/context/:sessionId`
- `POST /api/actions/inbox-append`
- `POST /api/actions/state-append`
- `GET /api/pkos/state-timeline`
- `GET /api/pkos/inbox-review`
- `POST /api/pkos/inbox-review/:id/archive`
- `POST /api/pkos/inbox-review/:id/restore`
- `GET /api/actions/requests`
- `GET /api/actions/requests/:requestId`
- `POST /api/actions/requests/:requestId/resolve`
- `GET /api/audit/events`

`POST /api/chat/send` accepts:

```json
{
  "sessionId": "...",
  "message": "..."
}
```

The default response is `application/x-ndjson`, one persisted `AgentEvent` per line.

`GET /api/context/:sessionId` is a read-only debug endpoint. It returns the bounded runtime context for an existing session and does not modify authority data.

No public tool execution API exists in this skeleton.

The fixed Action API is not wired into `POST /api/chat/send`.

`GET /api/audit/events` is read-only and returns sanitized event summaries for the local dashboard. Supported query parameters are `type`, `severity`, `sessionId`, `generationId`, `limit`, and `before`. The default limit is 50 and the maximum is 200. The route never returns raw `payload_json`, full message text, full context items, capture content, state notes, raw reason text, stderr, command paths, or secrets.

`GET /api/pkos/inbox-review` is read-only and calls `python -B -m tools.pkos inbox-review list --json`. Supported query parameters are `status`, `source`, `tag`, and `limit`. The default limit is 50 and the maximum is 200. The response is explicitly normalized for the local dashboard. It may include inbox content for human review, but that content is not copied into `agent_events`, `tool_calls`, `action_requests`, or browser persistence.

`GET /api/pkos/state-timeline` is read-only and calls `python -B -m tools.pkos state-list --json`. Supported query parameters are `energy`, `mood`, `mode`, and `limit`. The default limit is 50 and the maximum is 200. `current` is always the latest overall explicit state snapshot before filters; `items` may be filtered. The route adds a derived `stale` flag when a snapshot is older than the 24 hour freshness window used by the Agent Context contract. Stale means "possibly outdated", not invalid. The API does not score, diagnose, summarize trends, edit historical snapshots, or write audit events for ordinary reads. Python integrity failures return a structured 500 without raw stderr, tracebacks, paths, environment variables, or state note full text.

## Web Dashboard

The companion dashboard lives in `apps/web-dashboard`. In development, run the Agent Server and the dashboard in two terminals:

```bash
cd apps/agent-server
npm run dev
```

```bash
cd apps/web-dashboard
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` and `/health` to `http://127.0.0.1:8790`.

The dashboard is a local human operations surface for health, fixed capture actions, State Timeline viewing, Inbox Review archive/restore, indeterminate action recovery, and audit viewing. It is not PKOS authority and does not add write permissions, generic tool execution, Agent tool selection, task management, reminders, RAG, memory, OpenClaw, WeChat, or production hosting.

## PKOS Authority Boundary

SQLite is runtime storage only. It is not PKOS authority and must not replace Git/file authority, `objects/`, append-only vault logs, review logs, digests, governance docs, or human review gates.

Context is runtime-derived input, not authority. It may guide a generation, but it must not promote knowledge, create tasks, mutate objects, or bypass human review gates.

This skeleton writes only the Agent Runtime SQLite database under `runtime/agent/`. It does not write `objects/`, `trusted`, formal tasks, governance docs, Moonlolo/OpenClaw files, or PKOS Python core behavior.

The only authority data writes reachable from the internal tool layer are append-only `inbox/items.jsonl`, `state/snapshots.jsonl`, and Inbox Review action log writes performed by the Python PKOS CLI. Node never edits existing inbox captures, historical state snapshots, or review actions directly. The runtime does not create objects, tasks, trusted migrations, converted targets, reminder schedules, or diagnoses.
