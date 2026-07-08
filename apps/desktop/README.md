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

`npm run dev` currently runs `npm run build && electron .`. It loads the built local renderer from `dist/renderer/index.html`; it does not start the Vite dev server. Only an explicit, allowlisted `PKOS_DESKTOP_DEV_SERVER_URL=http://127.0.0.1:5174` switches Desktop to a local dev URL.

Electron does not start, stop, or package the Agent Server. If `/health` is unavailable, the app still opens and shows: `请先启动 PKOS Agent Server。`

## Features

- Agent: dry-run chat sessions over the existing Agent Server chat API.
- Quick Capture: explicit Inbox and State append actions with frozen `requestId` retry semantics.
- Status: backend connectivity plus Current State summary from `GET /api/pkos/state-timeline?limit=1`.
- Open Web Dashboard: fixed allowlisted URL `http://127.0.0.1:5173`.

Chat currently uses Dry-run Provider only and does not call a real model. Abort stops receiving the frontend stream; backend status remains governed by runtime records.

## Security

BrowserWindow uses:

- `nodeIntegration = false`
- `contextIsolation = true`
- `sandbox = true`
- `webSecurity = true`

The preload exposes only:

- `getAppInfo()`
- `openDashboard()`

`openDashboard()` accepts no renderer URL and opens only the fixed dashboard URL. The app denies `window.open`, blocks navigation outside local files or the configured local dev URL, and installs a CSP that restricts connection to `http://127.0.0.1:8790`.

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

This MVP does not include installer packaging, real LLM calls, Agent tool selection, Task Flow, Reminder Scheduler, Agent Memory, RAG, MCP, tray, notifications, auto-start, auto-update, mobile, OpenClaw, WeChat, Inbox Review UI, Action Resolution UI, Audit UI, Objects, or Trusted management.

## Commands

```bash
npm install
npm run check
npm run build
npm run smoke
npm run window-probe
```

Expected smoke marker:

```text
DESKTOP_SMOKE_OK
```
