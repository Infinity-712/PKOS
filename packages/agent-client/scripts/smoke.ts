import {
  AgentApiClient,
  AgentApiClientError,
  EMPTY_ATTEMPT,
  NdjsonParseError,
  applySubmitError,
  applySubmitResponse,
  isHealthResponse,
  isChatMessageListResponse,
  isSuccessfulAttempt,
  isAgentEvent,
  parseNdjsonStream,
  formatDateTime,
  resolveAgentApiUrl,
  resetAttempt,
  startOrReuseAttempt,
  type ActionDraft,
  type AgentEvent,
} from "../src/index.js";

const encoder = new TextEncoder();

const eventA: AgentEvent = {
  id: "event-a",
  ts: "2026-07-08T00:00:00.000Z",
  type: "generation_started",
  payload: { generationId: "g1" },
  severity: "info",
};
const eventB: AgentEvent = {
  id: "event-b",
  ts: "2026-07-08T00:00:01.000Z",
  type: "content_delta",
  payload: { delta: "hello" },
  severity: "debug",
};
const eventC: AgentEvent = {
  id: "event-c",
  ts: "2026-07-08T00:00:02.000Z",
  type: "content_delta",
  payload: { delta: "" },
  severity: "debug",
};

const parsed = await collectNdjson([
  JSON.stringify(eventA).slice(0, 12),
  JSON.stringify(eventA).slice(12) + "\n" + JSON.stringify(eventB),
]);
assert(parsed.length === 2, "NDJSON parser did not handle chunk boundaries and missing final newline");
assert(parsed[1]?.type === "content_delta", "NDJSON parser lost event type");
assert(isAgentEvent(eventB), "content_delta event guard rejected canonical delta payload");
assert(
  eventB.type === "content_delta" && eventB.payload.delta === "hello",
  "content_delta guard did not preserve canonical delta text",
);
assert(!isAgentEvent({ ...eventB, payload: { deltaChars: 5 } }), "deltaChars was accepted as a replacement for delta");
assert(isAgentEvent(eventC), "empty content_delta should be valid");
assert(!isAgentEvent({ ...eventB, payload: { delta: "visible", reasoning_content: "hidden" } }), "reasoning_content entered canonical event payload");

const multiLineChunk = await collectNdjson([`${JSON.stringify(eventA)}\n${JSON.stringify(eventB)}\n${JSON.stringify(eventC)}\n`]);
assert(multiLineChunk.length === 3, "NDJSON parser did not handle multiple lines in one chunk");
const utf8Event: AgentEvent = {
  ...eventB,
  id: "event-utf8",
  payload: { delta: "你好" },
};
const utf8Bytes = encoder.encode(`${JSON.stringify(utf8Event)}\n`);
const splitAt = utf8Bytes.findIndex((byte) => byte > 0x7f) + 1;
const utf8Parsed = await collectNdjsonBytes([utf8Bytes.slice(0, splitAt), utf8Bytes.slice(splitAt)]);
assert(
  utf8Parsed[0]?.type === "content_delta" && utf8Parsed[0].payload.delta === "你好",
  "NDJSON parser corrupted UTF-8 content across chunk boundaries",
);

let invalidFailed = false;
try {
  await collectNdjson([`${JSON.stringify(eventA)}\nnot-json\n`]);
} catch (error) {
  invalidFailed = error instanceof NdjsonParseError && error.lineNumber === 2;
}
assert(invalidFailed, "NDJSON parser did not report invalid JSON with line number");

const draft: ActionDraft = {
  actionName: "state-append",
  body: {
    energy: "low",
    mood: "anxious",
    body: "tired",
    context: "home",
    mode: "recovery",
    risk: { overload: "high" },
    source: "web",
    note: "NOTE_SHOULD_STAY_FROZEN",
  },
};
const first = startOrReuseAttempt(EMPTY_ATTEMPT, draft, () => "request-1");
const retry = startOrReuseAttempt(
  first,
  { ...draft, body: { ...draft.body, note: "EDITED_NOTE_SHOULD_NOT_REPLACE_FROZEN_PAYLOAD" } },
  () => "request-2",
);
assert(retry.requestId === "request-1", "retry changed requestId");
assert(retry.frozenPayload?.endpoint === "/api/actions/state-append", "state endpoint was not fixed");
assert(retry.frozenPayload?.body.note === "NOTE_SHOULD_STAY_FROZEN", "retry changed frozen payload");
assert(resetAttempt().status === "draft", "reset did not return draft");

const indeterminate = applySubmitError(retry, { code: "request_indeterminate", message: "check dashboard" });
assert(indeterminate.status === "request_indeterminate", "indeterminate was not represented");
assert(!isSuccessfulAttempt(indeterminate.status), "indeterminate was treated as success");
const written = applySubmitResponse(retry, {
  ok: true,
  requestId: "request-1",
  replayed: false,
  result: { status: "written", operation: "pkos.state.append" },
});
assert(written.status === "written", "written response was not represented");

assert(resolveAgentApiUrl("http://127.0.0.1:8790/", "/health") === "http://127.0.0.1:8790/health", "base URL slash normalization failed");
assert(resolveAgentApiUrl("", "health") === "/health", "same-origin endpoint normalization failed");
let absoluteEndpointRejected = false;
try {
  resolveAgentApiUrl("http://127.0.0.1:8790", "https://evil.example/health");
} catch (error) {
  absoluteEndpointRejected = error instanceof AgentApiClientError && error.code === "unsafe_endpoint";
}
assert(absoluteEndpointRejected, "absolute endpoint URL was not rejected");

const calls: Array<{ url: string; method: string; bodyPresent: boolean; signalPresent: boolean }> = [];
const client = new AgentApiClient({
  baseUrl: "http://127.0.0.1:8790",
  fetchImpl: async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, method: init?.method ?? "GET", bodyPresent: init?.body !== undefined, signalPresent: init?.signal !== undefined });
    if (url.endsWith("/health")) {
      return jsonResponse({ ok: true, service: "pkos-agent-server", mode: "dry-run" });
    }
    if (url.endsWith("/api/chat/provider-status")) {
      return jsonResponse(providerStatusPayload());
    }
    if (url.endsWith("/api/chat/provider-profiles")) {
      return jsonResponse({ items: [providerProfilePayload()] });
    }
    if (url.endsWith("/api/chat/provider-selection")) {
      return jsonResponse(providerStatusPayload());
    }
    if (url.endsWith("/api/chat/sessions") && init?.method === "POST") {
      return jsonResponse({ ok: true, session: { id: "s1", title: "New session", status: "active", created_at: "t1", updated_at: "t1" } }, 201);
    }
    if (url.endsWith("/api/chat/sessions/s%201/messages?limit=2&before=2026-07-09T16%3A00%3A02.000Z")) {
      return jsonResponse({
        sessionId: "s 1",
        items: [
          { id: "m1", role: "user", content: "hello", generationId: null, status: "completed", createdAt: "2026-07-09T16:00:00.000Z", updatedAt: "2026-07-09T16:00:00.000Z" },
          { id: "m2", role: "assistant", content: "world", generationId: "g1", status: "completed", createdAt: "2026-07-09T16:00:01.000Z", updatedAt: "2026-07-09T16:00:01.000Z" },
        ],
        nextBefore: null,
      });
    }
    if (url.endsWith("/api/chat/sessions")) {
      return jsonResponse({ ok: true, sessions: [] });
    }
    if (url.includes("/api/pkos/state-timeline")) {
      return jsonResponse({ current: null, items: [], count: 0, filters: { limit: 1 } });
    }
    if (url.endsWith("/api/actions/inbox-append") || url.endsWith("/api/actions/state-append")) {
      return jsonResponse({ ok: true, requestId: "request-1", replayed: false, result: { status: "written", operation: "pkos.append" } });
    }
    if (url.endsWith("/api/chat/send")) {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { allowExternalProvider?: boolean } : {};
      assert(body.allowExternalProvider === true, "sendChatMessage did not forward per-request external consent");
      return new Response(streamFromChunks([JSON.stringify(eventA) + "\n", JSON.stringify(eventB)]), {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      });
    }
    if (url.endsWith("/api/chat/generations/g1/abort")) {
      return jsonResponse({ ok: true, generationId: "g1", status: "aborted", message: "abort requested" }, 202);
    }
    return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
  },
});

assert(isHealthResponse(await client.health()), "health response guard failed");
const diagnostics = await client.healthWithDiagnostics();
assert(diagnostics.requestUrl === "http://127.0.0.1:8790/health", "health diagnostics resolved wrong URL");
assert(diagnostics.status === 200, "health diagnostics did not retain status");
const providerStatus = await client.getProviderStatus();
assert(providerStatus.provider === "dry-run" && providerStatus.readOnly && !providerStatus.toolsEnabled, "provider status guard failed");
const providerProfiles = await client.getProviderProfiles();
assert(providerProfiles.items[0]?.profileId === "dry-run", "provider profiles guard failed");
const selectedProvider = await client.setProviderSelection({ profileId: "dry-run", modelId: "dry-run", reasoningPreset: "off" });
assert(selectedProvider.selection.profileId === "dry-run", "provider selection guard failed");
await client.createChatSession({ title: "hello" });
await client.listChatSessions();
const historySignal = new AbortController().signal;
const history = await client.getSessionMessages("s 1", { limit: 2, before: "2026-07-09T16:00:02.000Z" }, historySignal);
assert(history.sessionId === "s 1", "chat history returned wrong session id");
assert(history.items.length === 2, "chat history did not return expected messages");
assert(history.items[1]?.role === "assistant" && history.items[1].generationId === "g1", "chat history did not preserve assistant generationId");
assert(!isChatMessageListResponse({ sessionId: "s1", items: [{ ...history.items[0], role: "system" }], nextBefore: null }), "chat history guard accepted illegal role");
await client.getStateTimeline({ limit: 1 });
await client.inboxAppend({ requestId: "request-1", captureType: "note", content: "hello", source: "web", status: "unprocessed", tags: [], metadata: {} });
await client.stateAppend({
  requestId: "request-1",
  energy: "low",
  mood: "calm",
  body: "normal",
  context: "home",
  mode: "life",
  risk: { shortVideo: "unknown", rumination: "unknown", overload: "low" },
  source: "web",
  note: "",
});
const streamed = [];
for await (const event of client.sendChatMessage({ sessionId: "s1", message: "hello", allowExternalProvider: true })) {
  streamed.push(event.type);
}
assert(streamed.join(",") === "generation_started,content_delta", "chat stream events were not parsed");
const abort = await client.abortGeneration("g1");
assert(abort.status === "aborted", "abortGeneration response guard failed");
assert(calls.some((call) => call.url === "http://127.0.0.1:8790/health"), "base URL was not applied");
const historyCall = calls.find((call) => call.url.includes("/api/chat/sessions/s%201/messages"));
assert(historyCall?.method === "GET", "getSessionMessages must use GET");
assert(historyCall.bodyPresent === false, "getSessionMessages must not send a request body");
assert(historyCall.signalPresent === true, "getSessionMessages did not forward AbortSignal");
assert(formatDateTime("2026-07-09T16:00:00.000Z") === "2026-07-10 00:00:00", "formatDateTime did not use Asia/Shanghai");

console.log("AGENT_CLIENT_SMOKE_OK");

async function collectNdjson(chunks: string[]): Promise<AgentEvent[]> {
  const items: AgentEvent[] = [];
  for await (const item of parseNdjsonStream(streamFromChunks(chunks))) {
    assert(isAgentEvent(item), "NDJSON item was not a valid AgentEvent");
    items.push(item);
  }
  return items;
}

async function collectNdjsonBytes(chunks: Uint8Array[]): Promise<AgentEvent[]> {
  const items: AgentEvent[] = [];
  for await (const item of parseNdjsonStream(streamFromByteChunks(chunks))) {
    assert(isAgentEvent(item), "NDJSON byte item was not a valid AgentEvent");
    items.push(item);
  }
  return items;
}

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

function streamFromByteChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function providerProfilePayload(): Record<string, unknown> {
  return {
    profileId: "dry-run",
    providerId: "dry-run",
    displayName: "Dry-run",
    protocol: "dry-run",
    enabled: true,
    external: false,
    keyConfigured: true,
    models: [
      {
        modelId: "dry-run",
        displayName: "Dry-run",
        reasoningPresets: ["off"],
        defaultReasoningPreset: "off",
        reasoningFixed: true,
      },
    ],
  };
}

function providerStatusPayload(): Record<string, unknown> {
  return {
    selection: {
      profileId: "dry-run",
      providerId: "dry-run",
      providerDisplayName: "Dry-run",
      protocol: "dry-run",
      modelId: "dry-run",
      modelDisplayName: "Dry-run",
      reasoningPreset: "off",
      external: false,
      keyConfigured: true,
    },
    connection: { state: "dry_run", lastAttemptAt: null, lastSuccessAt: null, lastErrorCode: null },
    consentRequired: false,
    configured: true,
    capabilities: { streaming: true, textGeneration: true, toolCallingEnabled: false, reasoningPresets: ["off"] },
    provider: "dry-run",
    model: "dry-run",
    dataEgress: "none",
    toolsEnabled: false,
    readOnly: true,
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
