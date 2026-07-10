import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAgentDatabase, type AgentDatabase } from "../db/connection.js";
import { createAgentHttpServer } from "../server/httpServer.js";

type JsonRecord = Record<string, unknown>;
type CapturedProviderRequest = {
  headers: Record<string, string | string[] | undefined>;
  body: JsonRecord;
  aborted: boolean;
};

const API_KEY = "LLM_READONLY_SECRET_KEY";
const API_KEY_ENV = "PKOS_TEST_PROVIDER_API_KEY";
const PROFILE_ID = "test-openai-compatible";
const MODEL_ID = "fake-model";
const PROFILE_BASE_URL = "https://fake-provider.local/v1";
const PROFILE_ENDPOINT = `${PROFILE_BASE_URL}/chat/completions`;
const RAW_INBOX_SECRET = "RAW_INBOX_SECRET_SHOULD_NOT_REACH_PROVIDER";
const USER_MESSAGE = "hello readonly model";

await testDryRunDefaultDoesNotNeedConsent();
await testExternalProviderRequiresPerRequestConsent();
await testConsentedProviderGetsOnlyBoundedPrompt();
await testProviderToolCallsAreRejected();
await testProviderErrorsAreSafelyMapped();
await testAbortEndpointStopsActiveProvider();

console.log("LLM_READONLY_SMOKE_OK");

async function testDryRunDefaultDoesNotNeedConsent(): Promise<void> {
  const env = createServerEnv("dry-run");
  const server = createAgentHttpServer({ db: env.db });
  try {
    const baseUrl = await listen(server);
    const status = await getJson<JsonRecord>(baseUrl, "/api/chat/provider-status");
    assert(status.payload.provider === "dry-run", "default provider was not dry-run");
    assert((status.payload.selection as JsonRecord).profileId === "dry-run", "default profile was not dry-run");
    assert(status.payload.configured === true, "dry-run provider was not configured");
    assert(status.payload.dataEgress === "none", "dry-run provider unexpectedly allows data egress");
    assert(status.payload.toolsEnabled === false && status.payload.readOnly === true, "provider status did not advertise read-only/no-tools");

    const session = await createSession(baseUrl);
    const response = await postJson<JsonRecord>(baseUrl, "/api/chat/send?stream=false", { sessionId: session, message: USER_MESSAGE });
    assert(response.status === 200, `dry-run send expected 200, got ${response.status}`);
    assert(typeof response.payload.assistantMessage === "string", "dry-run send did not return assistant message");
  } finally {
    await cleanup(server, env);
  }
}

async function testExternalProviderRequiresPerRequestConsent(): Promise<void> {
  const harness = await startExternalHarness("consent");
  try {
    const status = await getJson<JsonRecord>(harness.baseUrl, "/api/chat/provider-status");
    assert((status.payload.selection as JsonRecord).protocol === "openai-chat-completions", "configured provider status mismatch");
    assert(status.payload.configured === true, "configured provider was not marked configured");
    assert((status.payload.selection as JsonRecord).modelId === MODEL_ID, "provider status did not expose model");
    assert(JSON.stringify(status.payload).indexOf(PROFILE_ENDPOINT) === -1, "provider status leaked endpoint URL path");
    assert(JSON.stringify(status.payload).indexOf(API_KEY) === -1, "provider status leaked API key");

    const session = await createSession(harness.baseUrl);
    const response = await postJson<JsonRecord>(harness.baseUrl, "/api/chat/send?stream=false", { sessionId: session, message: USER_MESSAGE });
    assert(response.status === 412, `missing consent expected 412, got ${response.status}`);
    assert(errorCode(response.payload) === "external_provider_consent_required", "missing consent returned wrong error code");
    assert(harness.fake.requests.length === 0, "provider was called without external consent");
    assert(countRows(harness.env.db, "generations") === 0, "generation was created before external consent");
    assert(countRows(harness.env.db, "chat_messages") === 0, "chat message was saved before external consent");
  } finally {
    await cleanupHarness(harness);
  }
}

async function testConsentedProviderGetsOnlyBoundedPrompt(): Promise<void> {
  const harness = await startExternalHarness("bounded", undefined, { seedContext: true });
  try {
    const session = await createSession(harness.baseUrl);
    const response = await postJson<JsonRecord>(harness.baseUrl, "/api/chat/send?stream=false", {
      sessionId: session,
      message: USER_MESSAGE,
      allowExternalProvider: true,
    });
    assert(response.status === 200, `consented provider expected 200, got ${response.status}`);
    assert(harness.fake.requests.length === 1, "provider was not called exactly once");
    const sent = JSON.stringify(harness.fake.requests[0].body);
    assert(sent.includes("You are operating in read-only mode."), "prompt did not include read-only policy");
    assert(sent.includes("Human judgment is final."), "prompt did not include human judgment policy");
    assert(sent.includes("soft_low_pressure"), "bounded Flow Hub context did not reach provider");
    assert(countOccurrences(sent, USER_MESSAGE) === 1, "current user message was sent more than once");
    assert(!sent.includes(RAW_INBOX_SECRET), "raw inbox content leaked into provider prompt");
    assert(!sent.includes(harness.env.dataRoot), "internal data root path leaked into provider prompt");
    assert(harness.fake.requests[0].headers.authorization === `Bearer ${API_KEY}`, "API key header was not sent to fake provider");

    const dbBlob = databaseBlob(harness.env.db);
    assert(!dbBlob.includes(API_KEY), "API key was persisted");
    assert(!dbBlob.includes(PROFILE_ENDPOINT), "endpoint URL path was persisted");
    assert(!dbBlob.includes("You are operating in read-only mode."), "assembled prompt was persisted");
    assert(dbBlob.includes(MODEL_ID), "safe model metadata was not persisted");
    assert(dbBlob.includes("openai-chat-completions"), "safe protocol metadata was not persisted");
  } finally {
    await cleanupHarness(harness);
  }
}

async function testProviderToolCallsAreRejected(): Promise<void> {
  const harness = await startExternalHarness("tool-calls", "tool_calls");
  try {
    const session = await createSession(harness.baseUrl);
    const response = await postJson<JsonRecord>(harness.baseUrl, "/api/chat/send?stream=false", {
      sessionId: session,
      message: USER_MESSAGE,
      allowExternalProvider: true,
    });
    assert(response.status === 502, `tool_calls provider output expected 502, got ${response.status}`);
    assert(errorCode(response.payload) === "unsupported_provider_tool_output", "tool_calls error code mismatch");
    assert(countRows(harness.env.db, "tool_calls") === 0, "provider tool_calls reached ToolExecutor");
    assert(countMessagesByRole(harness.env.db, "assistant") === 0, "failed provider generated fake assistant message");
  } finally {
    await cleanupHarness(harness);
  }
}

async function testProviderErrorsAreSafelyMapped(): Promise<void> {
  for (const [mode, expectedStatus, expectedCode] of [
    ["auth", 401, "provider_auth_failed"],
    ["rate", 429, "provider_rate_limited"],
    ["server_error", 502, "provider_unavailable"],
  ] as const) {
    const harness = await startExternalHarness(`provider-${mode}`, mode);
    try {
      const session = await createSession(harness.baseUrl);
      const response = await postJson<JsonRecord>(harness.baseUrl, "/api/chat/send?stream=false", {
        sessionId: session,
        message: USER_MESSAGE,
        allowExternalProvider: true,
      });
      assert(response.status === expectedStatus, `${mode} expected ${expectedStatus}, got ${response.status}`);
      assert(errorCode(response.payload) === expectedCode, `${mode} error code mismatch`);
      const payloadText = JSON.stringify(response.payload);
      assert(!payloadText.includes("provider secret body"), `${mode} leaked provider response body`);
      assert(!databaseBlob(harness.env.db).includes("provider secret body"), `${mode} persisted provider response body`);
    } finally {
      await cleanupHarness(harness);
    }
  }
}

async function testAbortEndpointStopsActiveProvider(): Promise<void> {
  const harness = await startExternalHarness("abort", "slow");
  try {
    const session = await createSession(harness.baseUrl);
    const response = await fetch(`${harness.baseUrl}/api/chat/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session, message: USER_MESSAGE, allowExternalProvider: true }),
    });
    assert(response.status === 200 && response.body, "streaming request did not start");
    const reader = response.body.getReader();
    let generationId: string | null = null;
    const decoder = new TextDecoder();
    let buffer = "";
    while (!generationId) {
      const chunk = await reader.read();
      assert(!chunk.done, "stream ended before generation_started");
      buffer += decoder.decode(chunk.value, { stream: true });
      for (const line of buffer.split("\n")) {
        if (!line.trim()) {
          continue;
        }
        const event = JSON.parse(line) as JsonRecord;
        if (event.type === "generation_started") {
          generationId = typeof event.generationId === "string" ? event.generationId : null;
          break;
        }
      }
    }
    await waitFor(() => harness.fake.requests.length === 1, "fake provider did not receive streaming request");
    const abort = await postJson<JsonRecord>(harness.baseUrl, `/api/chat/generations/${generationId}/abort`, {});
    assert(abort.status === 202, `abort expected 202, got ${abort.status}`);
    await reader.cancel();
    await waitFor(() => harness.fake.requests.some((request) => request.aborted), "fake provider did not receive abort");
    const generation = harness.env.db.prepare("SELECT status, error_json FROM generations WHERE id = ?").get(generationId) as JsonRecord;
    assert(generation.status === "aborted", "generation was not marked aborted");
    assert(countEvents(harness.env.db, generationId, "generation_aborted") === 1, "generation_aborted terminal event was not recorded exactly once");
  } finally {
    await cleanupHarness(harness);
  }
}

function createServerEnv(name: string): { dataRoot: string; db: AgentDatabase } {
  const dataRoot = mkdtempSync(join(tmpdir(), `pkos-llm-readonly-${name}-`));
  process.env.PKOS_DATA_ROOT = dataRoot;
  delete process.env.PKOS_AGENT_DB_PATH;
  delete process.env.PKOS_AGENT_PROVIDER;
  delete process.env.PKOS_LLM_CHAT_COMPLETIONS_URL;
  delete process.env.PKOS_LLM_MODEL;
  process.env[API_KEY_ENV] = API_KEY;
  return { dataRoot, db: openAgentDatabase() };
}

async function startExternalHarness(name: string, mode?: string, options: { seedContext?: boolean } = {}): Promise<{
  fake: ReturnType<typeof createFakeProvider>;
  restoreFetch: () => void;
  env: { dataRoot: string; db: AgentDatabase };
  server: ReturnType<typeof createAgentHttpServer>;
  baseUrl: string;
}> {
  const fake = createFakeProvider({ mode });
  await fake.listen();
  const restoreFetch = installFakeProviderRedirect(fake);
  const env = createServerEnv(name);
  configureExternalProfile(env.dataRoot);
  if (options.seedContext) {
    seedFlowContext(env.dataRoot);
    seedRawInbox(env.dataRoot);
  }
  const server = createAgentHttpServer({ db: env.db });
  const baseUrl = await listen(server);
  await selectExternalProvider(baseUrl);
  return { fake, restoreFetch, env, server, baseUrl };
}

async function cleanupHarness(harness: {
  fake: ReturnType<typeof createFakeProvider>;
  restoreFetch: () => void;
  env: { dataRoot: string; db: AgentDatabase };
  server: ReturnType<typeof createAgentHttpServer>;
}): Promise<void> {
  harness.restoreFetch();
  await closeServer(harness.fake.server);
  await cleanup(harness.server, harness.env);
}

function configureExternalProfile(dataRoot: string): void {
  const path = join(dataRoot, "runtime", "agent");
  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(path, "provider_profiles.json"),
    JSON.stringify({
      schemaVersion: "0.6",
      profiles: [
        {
          id: PROFILE_ID,
          providerId: "custom-openai",
          displayName: "Fake Provider",
          protocol: "openai-chat-completions",
          baseUrl: PROFILE_BASE_URL,
          apiKeyEnv: API_KEY_ENV,
          external: true,
          enabled: true,
          models: [
            {
              id: MODEL_ID,
              displayName: "Fake Model",
              maxOutputTokens: 128,
              reasoningControl: { kind: "fixed", defaultPreset: "off" },
            },
          ],
        },
      ],
    }),
    "utf8",
  );
}

async function selectExternalProvider(baseUrl: string): Promise<void> {
  const response = await postJson<JsonRecord>(baseUrl, "/api/chat/provider-selection", {
    profileId: PROFILE_ID,
    modelId: MODEL_ID,
    reasoningPreset: "off",
  });
  assert(response.status === 200, `provider selection failed: ${response.status}`);
}

function createFakeProvider(options: { mode?: string } = {}): {
  server: ReturnType<typeof createServer>;
  requests: CapturedProviderRequest[];
  url: string;
  listen(): Promise<void>;
} {
  const requests: CapturedProviderRequest[] = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const body = await readRequestJson(req);
    const captured: CapturedProviderRequest = { headers: req.headers, body, aborted: false };
    requests.push(captured);
    req.on("aborted", () => {
      captured.aborted = true;
    });
    req.on("close", () => {
      if (!res.writableEnded) {
        captured.aborted = true;
      }
    });
    res.on("close", () => {
      if (!res.writableEnded) {
        captured.aborted = true;
      }
    });

    if (options.mode === "auth") {
      sendProviderJson(res, 401, { error: { message: "provider secret body auth" } });
      return;
    }
    if (options.mode === "rate") {
      sendProviderJson(res, 429, { error: { message: "provider secret body rate" } });
      return;
    }
    if (options.mode === "server_error") {
      sendProviderJson(res, 500, { error: { message: "provider secret body unavailable" } });
      return;
    }

    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
    if (options.mode === "tool_calls") {
      res.write('data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1"}]}}]}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    if (options.mode === "slow") {
      res.write('data: {"choices":[{"delta":{"content":"slow"}}]}\n\n');
      await new Promise<void>((resolve) => {
        req.on("close", resolve);
        setTimeout(resolve, 5000);
      });
      if (!res.writableEnded) {
        res.end();
      }
      return;
    }

    res.write('data: {"choices":[{"delta":{"content":"hello "}}]}\r\n\r\n');
    res.write('data: {"choices":[{"delta":{"content":"world"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n');
    res.write("data: [DONE]\n\n");
    res.end();
  });
  return {
    server,
    requests,
    url: "",
    async listen() {
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("fake provider did not bind");
      }
      this.url = `http://127.0.0.1:${address.port}/v1/chat/completions`;
    },
  };
}

function installFakeProviderRedirect(fake: ReturnType<typeof createFakeProvider>): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === PROFILE_ENDPOINT) {
      return originalFetch(fake.url, init);
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function seedFlowContext(dataRoot: string): void {
  const runtime = join(dataRoot, "runtime");
  mkdirSync(runtime, { recursive: true });
  writeFileSync(
    join(runtime, "agent_context.json"),
    JSON.stringify({
      schema_version: "0.5-beta",
      profile: "moonlolo",
      generated_at: "2026-07-08T00:00:00Z",
      current_state: { energy: "low", mood: "anxious", body: "tired", context: "home", mode: "recovery", updated_at: "2026-07-08T00:00:00Z", tone_hint: "soft_low_pressure" },
      weekly_review_gate: { cadence: "weekly", unprocessed_inbox_count: 1, review_required_before_weekly_summary: true, sample_items: [{ content_excerpt: "bounded only" }] },
      write_policy: { allowed_writes: ["inbox_append", "state_append"], forbidden_writes: ["trusted", "objects", "tasks"], authority: "runtime context only; not source of truth" },
    }),
    "utf8",
  );
}

function seedRawInbox(dataRoot: string): void {
  const inbox = join(dataRoot, "inbox");
  mkdirSync(inbox, { recursive: true });
  writeFileSync(join(inbox, "items.jsonl"), JSON.stringify({ id: "raw.secret", content: RAW_INBOX_SECRET }) + "\n", "utf8");
}

async function readRequestJson(req: IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as JsonRecord) : {};
}

function sendProviderJson(res: ServerResponse, status: number, body: JsonRecord): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function createSession(baseUrl: string): Promise<string> {
  const response = await postJson<{ session?: { id?: string } }>(baseUrl, "/api/chat/sessions", { title: "LLM readonly smoke" });
  const sessionId = response.payload.session?.id;
  assert(response.status === 201 && typeof sessionId === "string", "session creation failed");
  return sessionId;
}

async function listen(server: ReturnType<typeof createAgentHttpServer>): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function cleanup(server: ReturnType<typeof createAgentHttpServer>, env: { dataRoot: string; db: AgentDatabase }): Promise<void> {
  await closeServer(server);
  env.db.close();
  rmSync(env.dataRoot, { recursive: true, force: true });
}

async function closeServer(server: { listening: boolean; close(callback?: (error?: Error) => void): unknown }): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => (error ? reject(error) : resolve()));
  });
}

async function getJson<T>(baseUrl: string, path: string): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, payload: (await response.json()) as T };
}

async function postJson<T>(baseUrl: string, path: string, body: JsonRecord): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: (await response.json()) as T };
}

async function waitFor(check: () => boolean, message: string): Promise<void> {
  for (let index = 0; index < 40; index += 1) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

function countRows(db: AgentDatabase, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

function countMessagesByRole(db: AgentDatabase, role: string): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE role = ?").get(role) as { count: number };
  return row.count;
}

function countEvents(db: AgentDatabase, generationId: string, type: string): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM agent_events WHERE generation_id = ? AND type = ?").get(generationId, type) as { count: number };
  return row.count;
}

function databaseBlob(db: AgentDatabase): string {
  const messages = db.prepare("SELECT content, metadata_json FROM chat_messages").all() as JsonRecord[];
  const generations = db.prepare("SELECT * FROM generations").all() as JsonRecord[];
  const events = db.prepare("SELECT payload_json FROM agent_events").all() as JsonRecord[];
  return JSON.stringify({ messages, generations, events });
}

function errorCode(payload: JsonRecord): string | undefined {
  const error = payload.error;
  return error && typeof error === "object" && "code" in error ? String((error as JsonRecord).code) : undefined;
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
