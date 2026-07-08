import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  EMPTY_ATTEMPT,
  NdjsonParseError,
  parseNdjsonStream,
  startOrReuseAttempt,
  type ActionDraft,
} from "@pkos/agent-client";
import { abortSend, backendStatusFromHealth, currentStateText, finishSend, startSend } from "../renderer/features/chat/chatModel.js";
import { dashboardUrl, desktopAppEntryUrl, desktopAppOrigin, isAllowedExternalUrl, isAllowedNavigationUrl, securityHeaders } from "../main/securityPolicy.js";

const encoder = new TextEncoder();
const parsed = [];
for await (const item of parseNdjsonStream(streamFromChunks(['{"type":"generation_started","id":"1","ts":"t","payload":{},"severity":"info"}\n{"type"', ':"content_delta","id":"2","ts":"t","payload":{"delta":"a"},"severity":"debug"}']))) {
  parsed.push(item);
}
assert(parsed.length === 2, "desktop NDJSON parser chunk handling failed");

let invalidJsonFailed = false;
try {
  for await (const _item of parseNdjsonStream(streamFromChunks(["not-json\n"]))) {
    // unreachable
  }
} catch (error) {
  invalidJsonFailed = error instanceof NdjsonParseError;
}
assert(invalidJsonFailed, "desktop NDJSON parser did not reject invalid JSON");

const draft: ActionDraft = {
  actionName: "inbox-append",
  body: {
    captureType: "note",
    content: "DESKTOP_CAPTURE_SHOULD_STAY_FROZEN",
    source: "web",
    status: "unprocessed",
    tags: [],
    metadata: {},
  },
};
const first = startOrReuseAttempt(EMPTY_ATTEMPT, draft, () => "desktop-request-1");
const retry = startOrReuseAttempt(
  first,
  { ...draft, body: { ...draft.body, content: "EDITED_CAPTURE_SHOULD_NOT_REPLACE_FROZEN_PAYLOAD" } },
  () => "desktop-request-2",
);
assert(retry.requestId === "desktop-request-1", "desktop retry changed requestId");
assert(retry.frozenPayload?.body.content === "DESKTOP_CAPTURE_SHOULD_STAY_FROZEN", "desktop retry changed frozen payload");

const sending = startSend({ active: false, statusText: "" });
assert(sending.active, "chat send did not become active");
assert(startSend(sending) === sending, "chat active-send lock allowed a second send");
const stopped = abortSend(sending);
assert(stopped.statusText.includes("已停止接收流"), "abort status text is misleading");
assert(!finishSend(stopped).active, "finish did not release send lock");

assert(backendStatusFromHealth(null).connected === false, "null health did not map to disconnected");
assert(backendStatusFromHealth({ ok: true, service: "pkos-agent-server", mode: "dry-run" }).connected, "health did not map to connected");
assert(currentStateText(null).includes("尚无状态快照"), "current=null text missing");
assert(currentStateText({ stale: true }).includes("可能已经过期"), "stale text missing");

assert(dashboardUrl === "http://127.0.0.1:5173", "dashboard URL is not fixed");
assert(desktopAppOrigin === "pkos-desktop://app", "desktop app origin is not fixed");
assert(desktopAppEntryUrl === "pkos-desktop://app/index.html", "desktop app entry URL is not fixed");
assert(isAllowedExternalUrl("http://127.0.0.1:5173"), "dashboard URL was not allowlisted");
assert(!isAllowedExternalUrl("https://example.com"), "arbitrary external URL was allowlisted");
assert(isAllowedNavigationUrl("pkos-desktop://app/index.html", null), "desktop app scheme navigation was not allowlisted");
assert(!isAllowedNavigationUrl("pkos-desktop://app.evil/index.html", null), "deceptive desktop app origin was allowlisted");
assert(!isAllowedNavigationUrl("file:///tmp/index.html", null), "file navigation was allowlisted");
assert(securityHeaders().includes("default-src 'self'"), "CSP default-src missing");
assert(securityHeaders().includes("connect-src http://127.0.0.1:8790"), "CSP connect-src is not bounded");

const source = readSource(join(process.cwd(), "src"));
for (const forbidden of [
  "nodeIntegration: true",
  "contextIsolation: false",
  "sandbox: false",
  "webSecurity: false",
  "enableRemoteModule",
  "child_process",
  "exec(",
  "shell: true",
  "bypassCSP: true",
  "mode: \"no-cors\"",
  "Access-Control-Allow-Origin: *",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
]) {
  assert(!source.includes(forbidden), `desktop source contains forbidden pattern: ${forbidden}`);
}
assert(source.includes("nodeIntegration: false"), "BrowserWindow nodeIntegration=false missing");
assert(source.includes("contextIsolation: true"), "BrowserWindow contextIsolation=true missing");
assert(source.includes("sandbox: true"), "BrowserWindow sandbox=true missing");
assert(source.includes("webSecurity: true"), "BrowserWindow webSecurity=true missing");
assert(source.includes("show: false"), "BrowserWindow must start hidden until renderer load is observed");
assert(source.includes("ready-to-show"), "ready-to-show lifecycle diagnostic missing");
assert(source.includes("renderer_load_started"), "renderer load start diagnostic missing");
assert(source.includes("renderer_load_succeeded"), "renderer load success diagnostic missing");
assert(source.includes("renderer_load_failed"), "renderer load failure diagnostic missing");
assert(source.includes("render_process_gone"), "render process gone diagnostic missing");
assert(source.includes("window_show_fallback"), "window show fallback diagnostic missing");
assert(source.includes("DESKTOP_WINDOW_PROBE_OK"), "window probe success marker missing");
assert(source.includes("protocol.registerSchemesAsPrivileged"), "desktop app scheme registration missing");
assert(source.includes("protocol.handle"), "desktop app scheme handler missing");
assert(source.includes("pkos-desktop://app"), "desktop app scheme origin missing");
assert(source.includes("DESKTOP_CONNECTIVITY_PROBE_OK"), "connectivity probe success marker missing");
assert(source.includes("pkosDesktop"), "preload bridge missing");
assert(source.includes("openDashboard"), "openDashboard bridge missing");
assert(source.includes("getAppInfo"), "getAppInfo bridge missing");
const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { scripts?: Record<string, string> };
assert(packageJson.scripts?.["window-probe"] === "electron . --pkos-window-probe", "window-probe npm script missing");
assert(packageJson.scripts?.["connectivity-probe"] === "electron . --pkos-connectivity-probe", "connectivity-probe npm script missing");

console.log("DESKTOP_SMOKE_OK");

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function readSource(root: string): string {
  const entries = readdirSync(root);
  const contents: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      contents.push(readSource(path));
    } else if ((entry.endsWith(".ts") || entry.endsWith(".tsx")) && !path.endsWith(join("scripts", "smoke.ts"))) {
      contents.push(readFileSync(path, "utf8"));
    }
  }
  return contents.join("\n");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
