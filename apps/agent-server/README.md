# PKOS Agent Server

> Status: v0.6 local Agent Runtime with dry-run default and optional read-only OpenAI-compatible generation.

## Goal

This package provides the first PKOS-native Agent Runtime skeleton:

- persistent local chat sessions;
- SQLite runtime audit store;
- structured AgentEvent stream;
- bounded read-only runtime context;
- internal L1 append-only writeback foundation;
- dry-run generation by default;
- optional OpenAI Chat Completions compatible read-only text generation;
- sanitized read-only Audit API for dashboard inspection;
- local HTTP endpoints for smoke testing.

## Non-goals

This skeleton does not implement tool calling, automatic tool selection, a public tool execution endpoint, RAG, MCP, multi-agent orchestration, sandboxed shell execution, OpenClaw, WeChat, formal tasks, trusted migration, durable agent memory, or object mutation.

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
npm run cors-smoke
npm run llm-readonly-smoke
npm run provider-config -- list
npm run provider-config-smoke
npm run provider-profile-smoke
npm run chat-history-smoke
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

`npm run llm-readonly-smoke` verifies the real-provider read-only MVP against a local fake Chat Completions server. It does not call an external model. It covers dry-run default behavior, provider configuration validation, per-request external consent, bounded prompt assembly, SSE streaming, tool output rejection, safe error mapping, abort semantics, terminal generation state, and secret redaction.

`npm run provider-config-smoke` verifies local provider profile config management. `npm run provider-profile-smoke` verifies provider profile selection, connection state, generation snapshots, and reasoning-content discard against a local fake provider only.

`npm run chat-history-smoke` verifies the read-only session message history API, session isolation, pagination query validation, reasoning metadata redaction, database read-only behavior, and SQLite reopen persistence.

When testing Desktop chat history after route changes, ensure any old listener on
`127.0.0.1:8790` has been stopped before starting `npm run dev` again. A stale
Agent Server process can still answer `/health` and `/api/chat/sessions` while
returning `404 NOT_FOUND` for newer routes such as
`GET /api/chat/sessions/:sessionId/messages`.

## SQLite Migrations

Startup uses a minimal migration runner backed by `PRAGMA user_version`. No ORM or external migration framework is used.

Current migrations:

- `0001_initial.sql`: creates the existing v0.6 skeleton tables with `CREATE TABLE IF NOT EXISTS`;
- `0002_action_requests.sql`: adds `action_requests` for fixed Action API idempotency and replay;
- `0003_action_request_resolutions.sql`: adds append-only human resolution audit for indeterminate action requests;
- `0004_generation_provider_metadata.sql`: adds safe provider/model/finish/token/error metadata columns for generations;
- `0005_provider_runtime_selection.sql`: adds runtime provider selection, provider connection status, and generation provider snapshot columns.

Each migration runs inside a SQLite transaction and advances `user_version` only after the SQL succeeds. If a migration fails, startup fails and write APIs are not available from that database handle. Existing skeleton databases with tables but `user_version = 0` are upgraded safely because migrations use idempotent `CREATE ... IF NOT EXISTS` statements. Version 2 and 3 databases are upgraded without dropping `action_requests`, `tool_calls`, `agent_events`, `chat_messages`, or existing generation rows.

`schema.sql` is retained as a legacy/bootstrap schema reference. Runtime startup is governed by `MigrationRunner`.

## Provider Configuration

Default mode is dry-run:

```powershell
npm run dev
```

Provider identity is split into separate concepts:

- `providerId`: vendor or service identity, such as `deepseek`, `openai`, or `custom-openai`;
- `protocol`: call protocol, currently `dry-run` or `openai-chat-completions`;
- `profileId`: local runtime configuration profile;
- `modelId`: actual model identifier within a profile;
- `reasoningPreset`: normalized runtime preset. Built-in DeepSeek V4 models expose `off`, `high`, and `max`; generic custom profiles expose only what their model profile declares.

User profiles live at:

```text
${PKOS_DATA_ROOT}/runtime/agent/provider_profiles.json
```

This is runtime configuration, not PKOS authority, and it is under ignored `runtime/`. It must not enter `PromptAssembler` or `ContextBuilder`.

### DeepSeek Official Quick Config

The built-in `deepseek-official` profile is always available and is not written to `provider_profiles.json`. It exposes:

- `deepseek-v4-pro` as `DeepSeek V4 Pro`;
- `deepseek-v4-flash` as `DeepSeek V4 Flash`;
- reasoning presets `off`, `high`, and `max`.

It intentionally does not expose deprecated compatibility aliases such as `deepseek-chat` or `deepseek-reasoner`.

Configure only the key environment variable in the same shell that starts Agent Server:

```powershell
$env:DEEPSEEK_API_KEY="<set-in-current-shell>"
cd apps/agent-server
npm run dev
```

Then choose `DeepSeek V4 Pro` or `DeepSeek V4 Flash` in Desktop and select reasoning `off`, `high`, or `max`. Profile selection does not send data and does not count as external consent. Before the first successful call the connection state is `configured_unverified`, not `connected`. Restart Agent Server from the shell where `DEEPSEEK_API_KEY` is set when changing the environment.

DeepSeek V4 reasoning request mapping is static server code:

- `off`: `{ "thinking": { "type": "disabled" } }`
- `high`: `{ "thinking": { "type": "enabled" }, "reasoning_effort": "high" }`
- `max`: `{ "thinking": { "type": "enabled" }, "reasoning_effort": "max" }`

`low` and `medium` are not exposed for DeepSeek V4 because the API does not provide distinct low/medium behavior for this surface.

### Custom Compatible Profiles

Custom compatible providers still use the local provider-config CLI:

```powershell
npm run provider-config -- set custom-deepseek --json '{
  "providerId": "deepseek",
  "displayName": "Custom DeepSeek Compatible",
  "protocol": "openai-chat-completions",
  "baseUrl": "https://your-api-base.example/v1",
  "apiKeyEnv": "CUSTOM_PROVIDER_API_KEY",
  "external": true,
  "enabled": true,
  "models": [
    {
      "id": "model-name",
      "displayName": "model-name",
      "contextWindow": 128000,
      "maxOutputTokens": 4096,
      "reasoningControl": {
        "kind": "fixed",
        "defaultPreset": "off"
      }
    }
  ]
}'
```

Do not write a real key to Git, README examples, screenshots, logs, tests, SQLite, or profile config. Profile JSON must use `apiKeyEnv`, not `apiKey`. The provider-config command rejects plaintext `apiKey`, `authorization`, `headers`, `bearerToken`, `secret`, `password`, `extraBody`, `requestTemplate`, `command`, and `executable`. User profile IDs may not override built-in IDs such as `deepseek-official`.

Provider config commands:

```bash
npm run provider-config -- list
npm run provider-config -- show custom-deepseek
npm run provider-config -- set custom-deepseek --json '{...}'
npm run provider-config -- remove custom-deepseek
npm run provider-config -- validate
```

Base URLs must be HTTPS, must not contain username/password, query, fragment, or path traversal, and are not supplied by Desktop. This sprint does not enable arbitrary local provider URLs.

Selecting a model is a runtime setting stored in SQLite `provider_runtime_selection`. It never triggers an external request and does not count as external data consent. If the saved selection is invalid, disabled, or removed, runtime falls back to dry-run. It never automatically selects the first external profile.

Connection state is evidence-based:

- `dry_run`: current selection is Dry-run;
- `unconfigured`: profile/model/key is missing or incomplete;
- `configured_unverified`: config is complete, but no successful call has completed for that profile/model/reasoning preset;
- `connected`: the latest successful generation completed for that selection;
- `error`: the latest provider call failed with a sanitized error code;
- `disabled`: the selected profile is disabled.

The server never probes providers on startup and never sends a background billable request just to test connectivity. Having an API key only means configured, not connected.

`GET /api/chat/provider-profiles` returns sanitized selectable profiles and model/reasoning options for Desktop. `POST /api/chat/provider-selection` accepts only `profileId`, `modelId`, and `reasoningPreset`; it rejects base URL, API key, headers, arbitrary body, and unknown presets. `GET /api/chat/provider-status` reports the current selection, connection state, `consentRequired`, endpoint origin, `apiKeyEnvName`, and `keyConfigured`; it never returns endpoint path/query, API key values, authorization headers, prompt, context, or environment variables.

The OpenAI-compatible adapter sends only:

```json
{
  "model": "...",
  "messages": [],
  "stream": true
}
```

It may include `max_tokens` only when configured by the selected model. It does not send tools, functions, response format, hidden metadata, arbitrary request body, request templates, or provider-specific parameters. It parses SSE `data: {json}` events and `[DONE]`, maps only `choices[0].delta.content` to text deltas, and rejects `tool_calls` or `function_call` with `unsupported_provider_tool_output` without invoking `ToolExecutor`.

Provider extension fields such as `reasoning_content`, `reasoning`, `chain_of_thought`, `thoughts`, `analysis`, `internal_reasoning`, and `hidden_reasoning` are ignored. They are not displayed, persisted, added to recent messages, or resent. The only DeepSeek V4 reasoning fields emitted by this sprint are the static whitelisted `thinking` and `reasoning_effort` fields described above.

External data egress requires per-request consent. In real-provider mode, `POST /api/chat/send` must include:

```json
{
  "allowExternalProvider": true
}
```

Missing consent returns `412 external_provider_consent_required` before a generation, chat message, or external request is created. Consent is not stored as a global setting, not stored in Desktop, and not granted by provider selection.

Generation rows snapshot the selected provider/profile/protocol/model/reasoning/endpointOrigin/external values when the generation is created. Later global selection changes do not affect that generation, its abort path, or its audit metadata.

Prompt assembly is bounded and in-memory only. It consumes `ContextBuilder` output plus the current session's bounded recent messages. It must not read the full vault, raw inbox, review logs, arbitrary files, RAG indexes, or secrets. The assembled prompt is not written to SQLite or events.

Abort endpoint:

```text
POST /api/chat/generations/:generationId/abort
```

Abort requests stop the local provider fetch/stream when possible and mark active generations as `aborted`. Remote providers may already have processed part of the request; abort does not guarantee remote compute or cost cancellation.

## ContextBuilder

The ContextBuilder is a runtime-only input pack for AgentRunner and provider prompt assembly. It reads only:

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
- `GET /api/chat/sessions/:sessionId/messages`
- `GET /api/chat/provider-status`
- `GET /api/chat/provider-profiles`
- `POST /api/chat/provider-selection`
- `POST /api/chat/send`
- `POST /api/chat/generations/:generationId/abort`
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
  "message": "...",
  "allowExternalProvider": false
}
```

The default response is `application/x-ndjson`, one persisted `AgentEvent` per line.

Model output is non-authoritative runtime output. It may be wrong and must not be treated as PKOS authority.

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
