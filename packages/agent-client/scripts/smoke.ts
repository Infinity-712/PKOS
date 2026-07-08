import {
  AgentApiClient,
  AgentApiClientError,
  EMPTY_ATTEMPT,
  NdjsonParseError,
  applySubmitError,
  applySubmitResponse,
  isHealthResponse,
  isSuccessfulAttempt,
  parseNdjsonStream,
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

const parsed = await collectNdjson([
  JSON.stringify(eventA).slice(0, 12),
  JSON.stringify(eventA).slice(12) + "\n" + JSON.stringify(eventB),
]);
assert(parsed.length === 2, "NDJSON parser did not handle chunk boundaries and missing final newline");
assert(parsed[1]?.type === "content_delta", "NDJSON parser lost event type");

let invalidFailed = false;
try {
  await collectNdjson(["{\"ok\": true}\nnot-json\n"]);
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

const calls: Array<{ url: string; method: string }> = [];
const client = new AgentApiClient({
  baseUrl: "http://127.0.0.1:8790",
  fetchImpl: async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.endsWith("/health")) {
      return jsonResponse({ ok: true, service: "pkos-agent-server", mode: "dry-run" });
    }
    if (url.endsWith("/api/chat/sessions") && init?.method === "POST") {
      return jsonResponse({ ok: true, session: { id: "s1", title: "New session", status: "active", created_at: "t1", updated_at: "t1" } }, 201);
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
      return new Response(streamFromChunks([JSON.stringify(eventA) + "\n", JSON.stringify(eventB)]), {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      });
    }
    return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
  },
});

assert(isHealthResponse(await client.health()), "health response guard failed");
const diagnostics = await client.healthWithDiagnostics();
assert(diagnostics.requestUrl === "http://127.0.0.1:8790/health", "health diagnostics resolved wrong URL");
assert(diagnostics.status === 200, "health diagnostics did not retain status");
await client.createChatSession({ title: "hello" });
await client.listChatSessions();
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
for await (const event of client.sendChatMessage({ sessionId: "s1", message: "hello" })) {
  streamed.push(event.type);
}
assert(streamed.join(",") === "generation_started,content_delta", "chat stream events were not parsed");
assert(calls.some((call) => call.url === "http://127.0.0.1:8790/health"), "base URL was not applied");

console.log("AGENT_CLIENT_SMOKE_OK");

async function collectNdjson(chunks: string[]): Promise<AgentEvent[]> {
  const items: AgentEvent[] = [];
  for await (const item of parseNdjsonStream(streamFromChunks(chunks))) {
    items.push(item as AgentEvent);
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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
