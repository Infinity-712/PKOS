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
- local HTTP endpoints for smoke testing.

## Non-goals

This skeleton does not implement real LLM calls, automatic tool selection, a public tool execution endpoint, RAG, MCP, multi-agent orchestration, sandboxed shell execution, Electron UI, Web Dashboard integration, OpenClaw, WeChat, formal tasks, trusted migration, durable agent memory, or object mutation.

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
npm run dev
```

`npm run smoke` uses a temporary `PKOS_DATA_ROOT`, creates a database, creates a session, sends one dry-run message, and verifies persisted rows and events.

`npm run context-smoke` verifies the ContextBuilder contract, including bounded Flow Hub reads, recent message limits, missing/invalid context degradation, `context_built` event summaries, and the read-only context debug endpoint.

`npm run writeback-smoke` uses a temporary `PKOS_DATA_ROOT`, invokes the real Python PKOS CLI, and verifies append-only writes, ToolExecutor audit events, blocked permissions, CLI failure handling, and audit redaction.

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
- `pkos.state.append`: `L1`, side-effecting, no confirmation required for explicit append calls.

`ToolRegistry` is static code registration. It does not dynamically load modules or commands from strings.

`WritebackRouter` currently allows only:

- `pkos.inbox.append`;
- `pkos.state.append`.

It blocks unknown tools, trusted/object/task/governance writes, deletes, arbitrary file writes, and arbitrary command execution. The router distinguishes `unknown_tool`, `invalid_input`, `permission_denied`, `confirmation_required`, `cli_failed`, `timeout`, and `written` outcomes.

Node does not write `inbox/items.jsonl` or `state/snapshots.jsonl` directly. The deterministic write interface is the existing Python CLI:

```bash
python -B -m tools.pkos inbox-append --json
python -B -m tools.pkos state-append --json
```

The CLI process runner uses fixed argument arrays with `shell: false`, runs from `PKOS_CORE_ROOT`, forwards only a small environment allowlist plus `PKOS_CORE_ROOT` and `PKOS_DATA_ROOT`, and caps stdout/stderr at 64 KiB with a 10 second default timeout.

Audit data is minimized. `tool_calls` and `agent_events` record operation, enums, tags, source references, content/note length, and SHA-256 hashes. They do not duplicate full inbox content or state notes.

## API

- `GET /health`
- `POST /api/chat/sessions`
- `GET /api/chat/sessions`
- `POST /api/chat/send`
- `GET /api/context/:sessionId`

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

## PKOS Authority Boundary

SQLite is runtime storage only. It is not PKOS authority and must not replace Git/file authority, `objects/`, append-only vault logs, review logs, digests, governance docs, or human review gates.

Context is runtime-derived input, not authority. It may guide a generation, but it must not promote knowledge, create tasks, mutate objects, or bypass human review gates.

This skeleton writes only the Agent Runtime SQLite database under `runtime/agent/`. It does not write `objects/`, `trusted`, formal tasks, governance docs, Moonlolo/OpenClaw files, or PKOS Python core behavior.

The only authority data writes reachable from the internal tool layer are append-only `inbox/items.jsonl` and `state/snapshots.jsonl` writes performed by the Python PKOS CLI. The runtime does not create objects, tasks, trusted migrations, reminder schedules, or long-term diagnoses.
