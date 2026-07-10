import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  EMPTY_ATTEMPT,
  NdjsonParseError,
  parseNdjsonStream,
  startOrReuseAttempt,
  type AgentEvent,
  type ActionDraft,
} from "@pkos/agent-client";
import {
  abortSend,
  applyChatEvent,
  applySessionChatEvent,
  backendStatusFromHealth,
  appendUserMessageToSession,
  currentStateText,
  EMPTY_CHAT_VIEW_STATE,
  finishSend,
  getChatSessionView,
  hydrateSessionMessages,
  isNearScrollBottom,
  shouldSubmitChatKey,
  startSend,
} from "../renderer/features/chat/chatModel.js";
import { formatDateTime, type ChatMessage } from "@pkos/agent-client";
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
assert(stopped.statusText.includes("remote service may already have processed"), "abort status text is misleading");
assert(!finishSend(stopped).active, "finish did not release send lock");

assert(backendStatusFromHealth(null).connected === false, "null health did not map to disconnected");
assert(backendStatusFromHealth({ ok: true, service: "pkos-agent-server", mode: "dry-run" }).connected, "health did not map to connected");
assert(currentStateText(null).includes("No current state snapshot"), "current=null text missing");
assert(currentStateText({ stale: true }).includes("may be stale"), "stale text missing");

const generationStarted: AgentEvent = {
  id: "desktop-event-started",
  ts: "2026-07-08T00:00:00.000Z",
  sessionId: "s1",
  generationId: "desktop-generation-1",
  type: "generation_started",
  payload: {},
  severity: "info",
};
const deltaP: AgentEvent = {
  ...generationStarted,
  id: "desktop-event-delta-p",
  type: "content_delta",
  payload: { delta: "P" },
  severity: "debug",
};
const deltaKos: AgentEvent = {
  ...deltaP,
  id: "desktop-event-delta-kos",
  payload: { delta: "KOS" },
};
const deltaOk: AgentEvent = {
  ...deltaP,
  id: "desktop-event-delta-ok",
  payload: { delta: "_OK" },
};
const emptyDelta: AgentEvent = {
  ...deltaP,
  id: "desktop-event-empty-delta",
  payload: { delta: "" },
};
const generationCompleted: AgentEvent = {
  ...generationStarted,
  id: "desktop-event-completed",
  type: "generation_completed",
  payload: {},
};
const generationFailed: AgentEvent = {
  ...generationStarted,
  id: "desktop-event-failed",
  type: "generation_failed",
  payload: { code: "provider_stream_error" },
  severity: "error",
};
const generationAborted: AgentEvent = {
  ...generationStarted,
  id: "desktop-event-aborted",
  type: "generation_aborted",
  payload: { reason: "user_requested_abort" },
  severity: "warn",
};

let messages = applyChatEvent([], generationStarted);
assert(messages.length === 1 && messages[0]?.role === "assistant", "generation_started did not create pending assistant message");
assert(messages[0]?.status === "streaming" && messages[0]?.content === "", "pending assistant message has wrong initial state");
messages = applyChatEvent(messages, deltaP);
messages = applyChatEvent(messages, deltaKos);
messages = applyChatEvent(messages, deltaOk);
assert(messages[0]?.content === "PKOS_OK", "content_delta text was not accumulated into assistant message");
messages = applyChatEvent(messages, emptyDelta);
assert(messages.length === 1 && messages[0]?.content === "PKOS_OK", "empty delta changed assistant content or created a message");
messages = applyChatEvent(messages, generationCompleted);
assert(messages[0]?.status === "completed" && messages[0]?.content === "PKOS_OK", "generation_completed cleared assistant content");
const failedMessages = applyChatEvent(applyChatEvent(applyChatEvent([], generationStarted), deltaP), generationFailed);
assert(failedMessages[0]?.status === "failed" && failedMessages[0]?.content === "P", "generation_failed did not preserve partial assistant content");
const abortedMessages = applyChatEvent(applyChatEvent(applyChatEvent([], generationStarted), deltaP), generationAborted);
assert(abortedMessages[0]?.status === "aborted" && abortedMessages[0]?.content === "P", "generation_aborted did not preserve partial assistant content");
const chineseMessages = applyChatEvent(applyChatEvent(applyChatEvent([], generationStarted), { ...deltaP, payload: { delta: "你" } }), {
  ...deltaP,
  payload: { delta: "好" },
});
assert(chineseMessages[0]?.content === "你好", "Chinese content_delta text was not accumulated");
assert(applyChatEvent([], emptyDelta).length === 0, "empty delta created an empty assistant message");

let chatState = EMPTY_CHAT_VIEW_STATE;
chatState = appendUserMessageToSession(chatState, "session-a", "A_ONLY", "user-a");
chatState = appendUserMessageToSession(chatState, "session-b", "B_ONLY", "user-b");
chatState = applySessionChatEvent(chatState, "session-a", { ...generationStarted, generationId: "generation-a" });
chatState = applySessionChatEvent(chatState, "session-a", { ...deltaP, generationId: "generation-a", payload: { delta: "A_REPLY" } });
assert(getChatSessionView(chatState, "session-a").messages.map((item) => item.content).join("|").includes("A_REPLY"), "session A reply missing");
assert(!getChatSessionView(chatState, "session-b").messages.map((item) => item.content).join("|").includes("A_REPLY"), "session B received session A message");
console.log("SESSION_SWITCH_UI_SMOKE_OK");

const restoredMessages: ChatMessage[] = [
  { id: "history-user", role: "user", content: "RESTORED_USER", generationId: null, status: "completed", createdAt: "2026-07-09T16:00:00.000Z", updatedAt: "2026-07-09T16:00:00.000Z" },
  { id: "history-assistant", role: "assistant", content: "RESTORED_ASSISTANT", generationId: "restored-generation", status: "completed", createdAt: "2026-07-09T16:00:01.000Z", updatedAt: "2026-07-09T16:00:01.000Z" },
];
chatState = hydrateSessionMessages(chatState, "session-c", restoredMessages);
assert(getChatSessionView(chatState, "session-c").messages.length === 2, "history restore did not hydrate messages");
assert(getChatSessionView(chatState, "session-c").messages[1]?.content === "RESTORED_ASSISTANT", "history restore lost assistant content");
assert(getChatSessionView(chatState, "session-a").messages.some((item) => item.content === "A_ONLY"), "page-level chat state did not preserve existing session messages");
console.log("CHAT_RESTORE_SMOKE_OK");

assert(shouldSubmitChatKey({ key: "Enter", shiftKey: false, isComposing: false }, false), "Enter did not request submit");
assert(!shouldSubmitChatKey({ key: "Enter", shiftKey: true, isComposing: false }, false), "Shift+Enter should insert newline");
assert(!shouldSubmitChatKey({ key: "Enter", shiftKey: false, isComposing: false }, true), "Enter submitted while send was active");
assert(!shouldSubmitChatKey({ key: "a", shiftKey: false, isComposing: false }, false), "non-Enter key submitted");
console.log("ENTER_SEND_SMOKE_OK");

assert(formatDateTime("2026-07-09T16:00:00.000Z") === "2026-07-10 00:00:00", "Asia/Shanghai formatter mismatch");
console.log("TIMEZONE_SMOKE_OK");

assert(isNearScrollBottom({ scrollTop: 352, clientHeight: 600, scrollHeight: 980 }), "near-bottom scroll state was not detected");
assert(!isNearScrollBottom({ scrollTop: 100, clientHeight: 600, scrollHeight: 1200 }), "manual upward scroll should not be treated as near bottom");
console.log("AUTO_SCROLL_SMOKE_OK");

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
assert(source.includes("window_show_fallback"), "window show fallback missing");
assert(source.includes("DESKTOP_WINDOW_PROBE_OK"), "window probe success marker missing");
assert(source.includes("protocol.registerSchemesAsPrivileged"), "desktop app scheme registration missing");
assert(source.includes("protocol.handle"), "desktop app scheme handler missing");
assert(source.includes("pkos-desktop://app"), "desktop app scheme origin missing");
assert(source.includes("DESKTOP_CONNECTIVITY_PROBE_OK"), "connectivity probe success marker missing");
assert(source.includes("getProviderStatus"), "desktop provider status lookup missing");
assert(source.includes("getProviderProfiles"), "desktop provider profiles lookup missing");
assert(source.includes("setProviderSelection"), "desktop provider selection mutation missing");
assert(source.includes("provider-controls"), "desktop provider controls missing");
assert(source.includes("configured_unverified"), "desktop configured_unverified state mapping missing");
assert(source.includes("Configured, unverified"), "desktop configured_unverified label missing");
assert(source.includes("Connection error"), "desktop error state label missing");
assert(source.includes("Not connected"), "desktop unconfigured state label missing");
assert(source.includes("reasoningFixed"), "desktop fixed reasoning guard missing");
assert(source.includes("reasoningPresets"), "desktop reasoning preset options are not server-driven");
assert(source.includes("disabled={sendState.active"), "desktop model/reasoning switching is not disabled during active generation");
assert(source.includes("allowExternalProvider: true"), "desktop must explicitly allow configured external provider requests");
assert(source.includes("abortGeneration"), "desktop Stop button does not call backend abort API");
assert(source.includes("Model output is not a PKOS authority record"), "desktop non-authoritative model output warning missing");
assert(!source.includes("I agree to send this message and bounded context"), "desktop must not render the old consent checkbox copy");
assert(source.includes("endpointOrigin"), "desktop external consent target does not show endpoint origin");
assert(!source.includes("event-details"), "desktop must not render stream event details");
assert(!source.includes("Stream events"), "desktop must not render stream event debug heading");
assert(!source.includes("apiKeyEnvName") || !source.includes("<input"), "desktop must not expose API key input");
assert(!source.includes("provider URL"), "desktop must not expose arbitrary provider URL input");
assert(!source.includes("model ID"), "desktop must not expose arbitrary model ID input");
assert(!source.includes("sessionStorage"), "desktop source must not persist external consent in browser storage");
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
      if (entry === "scripts") {
        continue;
      }
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
