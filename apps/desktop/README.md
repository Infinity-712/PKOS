# PKOS Desktop

> Status: v0.6 Electron Desktop Interaction MVP.

PKOS Desktop is a local daily interaction surface for the PKOS Agent Server. It is not the authority management UI. Web Dashboard remains the management surface for Inbox Review, Action Requests, Audit, and fuller State Timeline work.

## Run

Start the Agent Server separately:

```bash
cd apps/agent-server
npm install
npm run dev
```

Then run Desktop:

```bash
cd apps/desktop
npm install
npm run dev
```

`npm run dev` currently runs `npm run build && electron .`. It loads the built local renderer through the secure custom scheme `pkos-desktop://app`; it does not start the Vite dev server. Only an explicit, allowlisted `PKOS_DESKTOP_DEV_SERVER_URL=http://127.0.0.1:5174` switches Desktop to a local dev URL.

Electron does not start, stop, or package the Agent Server. If `/health` is unavailable, the app still opens and asks the user to start PKOS Agent Server first.

## Features

- Agent: read-only chat sessions over the existing Agent Server chat API.
- Provider status: shows current provider, model, reasoning preset, connection state, endpoint origin, last success time, and sanitized error code.
- Model selector: options come from `GET /api/chat/provider-profiles`. Desktop does not provide arbitrary provider URL, API key, model ID, or request body inputs.
- Reasoning selector: options come from the selected model profile. Fixed reasoning shows a disabled fixed value.
- External data consent: Desktop sends explicit per-request consent for the selected provider/model/endpoint origin/reasoning target. Server-side provider runtime rules remain the authority for external calls.
- Model boundary: replies are shown with a fixed warning that model output is not a PKOS authority record and may be wrong.
- Quick Capture: explicit Inbox and State append actions with frozen `requestId` retry semantics.
- Status: backend connectivity plus Current State summary from `GET /api/pkos/state-timeline?limit=1`.
- Open Web Dashboard: fixed allowlisted URL `http://127.0.0.1:5173`.

Provider configuration stays in Agent Server runtime config and environment variables. Desktop has no API key, endpoint, model ID, or arbitrary parameter settings UI. A configured profile is not the same as connected: connection becomes `connected` only after a successful generation completes.

Connection labels:

- `未连接`: required profile/model/key config is missing;
- `已配置，未验证`: config is present, but no successful call has completed yet;
- `已连接`: the selected profile/model/reasoning preset completed a generation successfully;
- `连接异常`: the latest provider request failed with a sanitized error code.

Stop first calls the backend generation abort endpoint, then stops local stream reading. The UI states that the local generation connection was requested to stop, while the remote service may already have processed part of the request.

Dry-run mode is the default:

```powershell
cd apps/agent-server
npm run dev
```

Official DeepSeek is built in. Set the key in the same shell that starts Agent Server, then choose `DeepSeek / DeepSeek V4 Pro` or `DeepSeek / DeepSeek V4 Flash` in Desktop:

```powershell
cd apps/agent-server
$env:DEEPSEEK_API_KEY="<set-in-current-shell>"
npm run dev
```

DeepSeek reasoning presets shown by Desktop are:

- `关闭`: sends `thinking.type=disabled`;
- `高`: sends `thinking.type=enabled` and `reasoning_effort=high`;
- `最大`: sends `thinking.type=enabled` and `reasoning_effort=max`.

Desktop does not show low/medium for DeepSeek because the API does not expose distinct low/medium behavior for this surface.

Custom compatible providers still use the Agent Server CLI. This example uses placeholders; do not put real keys in Git, logs, screenshots, or tests:

```powershell
cd apps/agent-server
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
      "maxOutputTokens": 4096,
      "reasoningControl": {
        "kind": "fixed",
        "defaultPreset": "off"
      }
    }
  ]
}'
npm run dev
```

Switching provider/model/reasoning in Desktop only updates local runtime selection. It does not grant external data consent and does not send a provider request.

## Security

BrowserWindow uses:

- `nodeIntegration = false`
- `contextIsolation = true`
- `sandbox = true`
- `webSecurity = true`

The preload exposes only:

- `getAppInfo()`
- `openDashboard()`

`openDashboard()` accepts no renderer URL and opens only the fixed dashboard URL. The app denies `window.open`, blocks navigation outside `pkos-desktop://app` or the configured local dev URL, and installs a CSP that restricts connection to `http://127.0.0.1:8790`.

## Startup Diagnostics

The main process emits structured startup logs prefixed with `[pkos-desktop]`. Safe diagnostic markers include:

- `main_module_loaded`
- `app_when_ready_waiting`
- `app_ready`
- `create_window_started`
- `browser_window_created`
- `renderer_load_started`
- `renderer_load_succeeded`
- `ready_to_show`
- `window_shown`
- `renderer_load_failed`
- `render_process_gone`
- `window_closed`

The confirmed startup failure fixed in this slice was a sandbox preload format mismatch: Electron loaded `dist/preload/preload.js` as a CommonJS sandbox preload, but the emitted file contained ESM `import` syntax. The preload source is now `preload.cts`, emitted as `dist/preload/preload.cjs`, and `BrowserWindow` points at that `.cjs` file.

To enable Electron logging manually:

```powershell
$env:ELECTRON_ENABLE_LOGGING="1"
$env:ELECTRON_ENABLE_STACK_DUMPING="1"
.\node_modules\.bin\electron.cmd . --enable-logging
```

To clear residual Electron processes during local debugging:

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
```

Window lifecycle probe:

```bash
npm run window-probe
```

Expected marker:

```text
DESKTOP_WINDOW_PROBE_OK
```

## Non-goals

This MVP does not include installer packaging, Agent tool selection, Task Flow, Reminder Scheduler, Agent Memory, RAG, MCP, tray, notifications, auto-start, auto-update, mobile, OpenClaw, WeChat, Inbox Review UI, Action Resolution UI, Audit UI, Objects, Trusted management, API key settings, provider URL settings, arbitrary model ID input, or request parameter editors.

## Commands

```bash
npm install
npm run check
npm run build
npm run smoke
npm run chat-restart-restore-smoke
npm run chat-history-retry-smoke
npm run chat-history-connectivity-probe
npm run chat-stream-probe
npm run window-probe
npm run connectivity-probe
```

Expected smoke markers:

```text
DESKTOP_SMOKE_OK
CHAT_RESTART_RESTORE_SMOKE_OK
CHAT_HISTORY_RETRY_SMOKE_OK
DESKTOP_CHAT_HISTORY_CONNECTIVITY_PROBE_OK
DESKTOP_CHAT_STREAM_PROBE_OK
DESKTOP_WINDOW_PROBE_OK
DESKTOP_CONNECTIVITY_PROBE_OK
```

`npm run chat-history-connectivity-probe` requires a running Agent Server on
`127.0.0.1:8790`. It uses the real Electron renderer origin
`pkos-desktop://app`, the shared `@pkos/agent-client`, and the same history API
used by Desktop. If history restore fails after code changes, fully stop the old
Agent Server process on port `8790`, restart `cd apps/agent-server && npm run
dev`, then run the probe again.
