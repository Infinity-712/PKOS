import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAgentDatabase, type AgentDatabase } from "../db/connection.js";
import { createAgentHttpServer } from "../server/httpServer.js";

type JsonRecord = Record<string, unknown>;

const PROFILE_ID = "mock-openai";
const MODEL_ID = "mock-model";
const DEEPSEEK_PROFILE_ID = "deepseek-official";
const DEEPSEEK_PRO_MODEL_ID = "deepseek-v4-pro";
const DEEPSEEK_FLASH_MODEL_ID = "deepseek-v4-flash";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_ENDPOINT = `${DEEPSEEK_BASE_URL}/chat/completions`;
const API_KEY_ENV = "MOCK_PROVIDER_API_KEY";
const API_KEY = "MOCK_PROVIDER_SECRET_SHOULD_NOT_PERSIST";
const DEEPSEEK_API_KEY = "DEEPSEEK_TEST_KEY_SHOULD_NOT_PERSIST";
const BASE_URL = "https://mock-provider.example/v1";
const ENDPOINT = `${BASE_URL}/chat/completions`;
const REASONING_MARKER = "SECRET_REASONING_MARKER";

const originalFetch = globalThis.fetch;
const fake = createFakeProvider();
globalThis.fetch = fake.fetch;

try {
  await testDryRunDefault();
  await testBuiltinDeepSeekProfileAndRequestShape();
  await testExternalSelectionStatusAndGeneration();
  await testInvalidSelections();
  await testSelectionPersistsAfterDbReopen();
  await testGenerationSnapshotSurvivesGlobalSwitch();
  console.log("PROVIDER_PROFILE_SMOKE_OK");
} finally {
  globalThis.fetch = originalFetch;
}

async function testBuiltinDeepSeekProfileAndRequestShape(): Promise<void> {
  const env = createEnv("deepseek");
  delete process.env.DEEPSEEK_API_KEY;
  const server = createAgentHttpServer({ db: env.db });
  try {
    const baseUrl = await listen(server);
    const profiles = await getJson<JsonRecord>(baseUrl, "/api/chat/provider-profiles");
    const items = profiles.payload.items as JsonRecord[];
    const deepseek = items.find((item) => item.profileId === DEEPSEEK_PROFILE_ID);
    assert(deepseek, "built-in DeepSeek profile missing");
    assert(deepseek.providerId === "deepseek", "DeepSeek providerId mismatch");
    assert(deepseek.protocol === "openai-chat-completions", "DeepSeek protocol mismatch");
    assert(deepseek.endpointOrigin === DEEPSEEK_BASE_URL, "DeepSeek endpoint origin mismatch");
    assert(deepseek.apiKeyEnvName === "DEEPSEEK_API_KEY", "DeepSeek apiKeyEnv mismatch");
    assert(deepseek.keyConfigured === false, "DeepSeek key should start unconfigured");
    assert(!JSON.stringify(deepseek).includes(DEEPSEEK_API_KEY), "DeepSeek profile leaked key");

    const models = deepseek.models as JsonRecord[];
    const modelIds = models.map((model) => String(model.modelId));
    assert(modelIds.includes(DEEPSEEK_PRO_MODEL_ID), "DeepSeek V4 Pro missing");
    assert(modelIds.includes(DEEPSEEK_FLASH_MODEL_ID), "DeepSeek V4 Flash missing");
    assert(!modelIds.includes("deepseek-chat") && !modelIds.includes("deepseek-reasoner"), "deprecated DeepSeek aliases were exposed");
    for (const model of models) {
      const presets = model.reasoningPresets as string[];
      assert(presets.join(",") === "off,high,max", "DeepSeek reasoning presets should be off/high/max only");
      assert(!presets.includes("low") && !presets.includes("medium"), "DeepSeek low/medium presets should not be exposed");
    }

    const missingKey = await postJson<JsonRecord>(baseUrl, "/api/chat/provider-selection", {
      profileId: DEEPSEEK_PROFILE_ID,
      modelId: DEEPSEEK_PRO_MODEL_ID,
      reasoningPreset: "high",
    });
    assert(missingKey.status === 200, "DeepSeek selection with missing key should be allowed");
    assert((missingKey.payload.connection as JsonRecord).state === "unconfigured", "DeepSeek missing key should be unconfigured");
    assert(fake.requests.length === 0, "DeepSeek selection triggered HTTP");

    process.env.DEEPSEEK_API_KEY = DEEPSEEK_API_KEY;
    const configured = await getJson<JsonRecord>(baseUrl, "/api/chat/provider-status");
    assert((configured.payload.connection as JsonRecord).state === "configured_unverified", "DeepSeek key/no call should be configured_unverified");
    assert(JSON.stringify(configured.payload).includes(DEEPSEEK_BASE_URL), "DeepSeek status did not show endpoint origin");
    assert(!JSON.stringify(configured.payload).includes(DEEPSEEK_ENDPOINT), "DeepSeek status leaked endpoint path");
    assert(!JSON.stringify(configured.payload).includes(DEEPSEEK_API_KEY), "DeepSeek status leaked key");

    assert((await postJson<JsonRecord>(baseUrl, "/api/chat/provider-selection", { profileId: DEEPSEEK_PROFILE_ID, modelId: DEEPSEEK_PRO_MODEL_ID, reasoningPreset: "low" })).status === 400, "DeepSeek low preset was not rejected");
    assert((await postJson<JsonRecord>(baseUrl, "/api/chat/provider-selection", { profileId: DEEPSEEK_PROFILE_ID, modelId: DEEPSEEK_PRO_MODEL_ID, reasoningPreset: "medium" })).status === 400, "DeepSeek medium preset was not rejected");
    assert((await postJson<JsonRecord>(baseUrl, "/api/chat/provider-selection", { profileId: DEEPSEEK_PROFILE_ID, modelId: DEEPSEEK_PRO_MODEL_ID, reasoningPreset: "unknown" })).status === 400, "unknown DeepSeek preset was not rejected");

    const beforeSwitchCount = fake.requests.length;
    await postJson<JsonRecord>(baseUrl, "/api/chat/provider-selection", { profileId: DEEPSEEK_PROFILE_ID, modelId: DEEPSEEK_FLASH_MODEL_ID, reasoningPreset: "max" });
    await postJson<JsonRecord>(baseUrl, "/api/chat/provider-selection", { profileId: DEEPSEEK_PROFILE_ID, modelId: DEEPSEEK_PRO_MODEL_ID, reasoningPreset: "off" });
    assert(fake.requests.length === beforeSwitchCount, "DeepSeek switching triggered HTTP");

    const session = await createSession(baseUrl);
    await assertDeepSeekRequestShape(baseUrl, session, "off", { thinkingType: "disabled" });
    await assertDeepSeekRequestShape(baseUrl, session, "high", { thinkingType: "enabled", reasoningEffort: "high" });
    await assertDeepSeekRequestShape(baseUrl, session, "max", { thinkingType: "enabled", reasoningEffort: "max" });

    const missingConsent = await postJson<JsonRecord>(baseUrl, "/api/chat/send?stream=false", { sessionId: session, message: "needs consent" });
    assert(missingConsent.status === 412, "DeepSeek consent gate did not reject missing consent");

    fake.mode = "reasoning";
    const streamReasoning = await postJson<JsonRecord>(baseUrl, "/api/chat/send?stream=false", { sessionId: session, message: "stream reasoning", allowExternalProvider: true });
    assert(streamReasoning.status === 200, "DeepSeek streaming reasoning response failed");
    fake.mode = "json_reasoning";
    const jsonReasoning = await postJson<JsonRecord>(baseUrl, "/api/chat/send?stream=false", { sessionId: session, message: "json reasoning", allowExternalProvider: true });
    assert(jsonReasoning.status === 200, "DeepSeek non-stream reasoning response failed");
    const blob = databaseBlob(env.db);
    assert(blob.includes("visible content"), "DeepSeek final content was not persisted");
    assert(blob.includes("json visible content"), "DeepSeek JSON final content was not persisted");
    assert(!blob.includes(REASONING_MARKER), "DeepSeek reasoning_content was persisted");

    fake.mode = "server_error";
    const failed = await postJson<JsonRecord>(baseUrl, "/api/chat/send?stream=false", { sessionId: session, message: "fail", allowExternalProvider: true });
    assert(failed.status === 502, "DeepSeek failed request did not map safely");
    const errorStatus = await getJson<JsonRecord>(baseUrl, "/api/chat/provider-status");
    assert((errorStatus.payload.connection as JsonRecord).state === "error", "DeepSeek failed request did not mark error");
  } finally {
    await cleanup(server, env);
  }
}

async function assertDeepSeekRequestShape(
  baseUrl: string,
  sessionId: string,
  preset: "off" | "high" | "max",
  expected: { thinkingType: "disabled" | "enabled"; reasoningEffort?: "high" | "max" },
): Promise<void> {
  fake.mode = "normal";
  const select = await postJson<JsonRecord>(baseUrl, "/api/chat/provider-selection", { profileId: DEEPSEEK_PROFILE_ID, modelId: DEEPSEEK_PRO_MODEL_ID, reasoningPreset: preset });
  assert(select.status === 200, `DeepSeek ${preset} selection failed`);
  const response = await postJson<JsonRecord>(baseUrl, "/api/chat/send?stream=false", { sessionId, message: `shape ${preset}`, allowExternalProvider: true });
  assert(response.status === 200, `DeepSeek ${preset} generation failed`);
  const request = fake.requests[fake.requests.length - 1];
  assert(request, `DeepSeek ${preset} request missing`);
  const thinking = request.body.thinking as JsonRecord | undefined;
  assert(thinking?.type === expected.thinkingType, `DeepSeek ${preset} thinking.type mismatch`);
  if (expected.reasoningEffort) {
    assert(request.body.reasoning_effort === expected.reasoningEffort, `DeepSeek ${preset} reasoning_effort mismatch`);
  } else {
    assert(!("reasoning_effort" in request.body), "DeepSeek off should not send reasoning_effort");
  }
  assert(request.body.model === DEEPSEEK_PRO_MODEL_ID, "DeepSeek request model mismatch");
  assert(!("tools" in request.body), "DeepSeek request unexpectedly included tools");
  assert(!("tool_choice" in request.body), "DeepSeek request unexpectedly included tool_choice");
  assert(!("extraBody" in request.body), "DeepSeek request unexpectedly included extraBody");
  assert(request.headers.authorization === `Bearer ${DEEPSEEK_API_KEY}`, "DeepSeek request did not use configured key env");
}

async function testDryRunDefault(): Promise<void> {
  const env = createEnv("dry-run");
  const server = createAgentHttpServer({ db: env.db });
  try {
    const baseUrl = await listen(server);
    const status = await getJson<JsonRecord>(baseUrl, "/api/chat/provider-status");
    assert((status.payload.connection as JsonRecord).state === "dry_run", "dry-run default connection state mismatch");
    assert((status.payload.selection as JsonRecord).profileId === "dry-run", "dry-run default selection mismatch");
  } finally {
    await cleanup(server, env);
  }
}

async function testExternalSelectionStatusAndGeneration(): Promise<void> {
  fake.mode = "normal";
  const env = createEnv("external");
  writeProfileConfig(env.dataRoot);
  const server = createAgentHttpServer({ db: env.db });
  try {
    const baseUrl = await listen(server);
    const profiles = await getJson<JsonRecord>(baseUrl, "/api/chat/provider-profiles");
    assert(JSON.stringify(profiles.payload).includes(PROFILE_ID), "valid external profile did not load");
    assert(!JSON.stringify(profiles.payload).includes(API_KEY), "profiles leaked API key");
    assert(JSON.stringify(profiles.payload).includes("https://mock-provider.example"), "profiles did not expose endpoint origin");
    assert(!JSON.stringify(profiles.payload).includes("/v1"), "profiles leaked endpoint path");

    delete process.env[API_KEY_ENV];
    const selectedMissingKey = await postJson<JsonRecord>(baseUrl, "/api/chat/provider-selection", { profileId: PROFILE_ID, modelId: MODEL_ID, reasoningPreset: "off" });
    assert(selectedMissingKey.status === 200, "selection with missing key should be allowed");
    assert((selectedMissingKey.payload.connection as JsonRecord).state === "unconfigured", "missing key should be unconfigured");
    assert((selectedMissingKey.payload.selection as JsonRecord).keyConfigured === false, "missing key did not report keyConfigured=false");

    process.env[API_KEY_ENV] = API_KEY;
    const selected = await postJson<JsonRecord>(baseUrl, "/api/chat/provider-selection", { profileId: PROFILE_ID, modelId: MODEL_ID, reasoningPreset: "off" });
    assert(selected.status === 200, "valid provider selection failed");
    assert((selected.payload.connection as JsonRecord).state === "configured_unverified", "new external selection should be configured_unverified");
    const requestCountAfterSelection = fake.requests.length;
    assert(requestCountAfterSelection >= 0, "selection request count was invalid");

    const session = await createSession(baseUrl);
    const missingConsent = await postJson<JsonRecord>(baseUrl, "/api/chat/send?stream=false", { sessionId: session, message: "needs consent" });
    assert(missingConsent.status === 412, "external send without consent should fail");
    assert(fake.requests.length === requestCountAfterSelection, "missing consent triggered provider call");

    fake.mode = "normal";
    const ok = await postJson<JsonRecord>(baseUrl, "/api/chat/send?stream=false", { sessionId: session, message: "hello", allowExternalProvider: true });
    assert(ok.status === 200, "successful mock generation failed");
    const firstRequest = fake.requests[fake.requests.length - 1];
    assert(firstRequest, "mock provider was not called");
    assert(JSON.stringify(firstRequest.body).includes("\"model\":\"mock-model\""), "request body did not include selected model");
    assert(!JSON.stringify(firstRequest.body).includes("reasoning"), "fixed reasoning leaked into request body");
    const connected = await getJson<JsonRecord>(baseUrl, "/api/chat/provider-status");
    assert((connected.payload.connection as JsonRecord).state === "connected", "successful generation did not mark connected");

    fake.mode = "server_error";
    const failed = await postJson<JsonRecord>(baseUrl, "/api/chat/send?stream=false", { sessionId: session, message: "fail", allowExternalProvider: true });
    assert(failed.status === 502, "failed mock generation status mismatch");
    const errored = await getJson<JsonRecord>(baseUrl, "/api/chat/provider-status");
    assert((errored.payload.connection as JsonRecord).state === "error", "failed generation did not mark error");
    assert((errored.payload.connection as JsonRecord).lastErrorCode === "provider_unavailable", "sanitized error code mismatch");

    fake.mode = "reasoning";
    const reasoning = await postJson<JsonRecord>(baseUrl, "/api/chat/send?stream=false", { sessionId: session, message: "reasoning", allowExternalProvider: true });
    assert(reasoning.status === 200, "reasoning-content generation failed");
    const blob = databaseBlob(env.db);
    assert(blob.includes("visible content"), "final content was not persisted");
    assert(!blob.includes(REASONING_MARKER), "reasoning_content was persisted");
    assert(!blob.includes(API_KEY), "API key was persisted");
    assert(!blob.includes(ENDPOINT), "full endpoint path was persisted");
  } finally {
    await cleanup(server, env);
  }
}

async function testInvalidSelections(): Promise<void> {
  const env = createEnv("invalid-selection");
  writeProfileConfig(env.dataRoot);
  process.env[API_KEY_ENV] = API_KEY;
  const server = createAgentHttpServer({ db: env.db });
  try {
    const baseUrl = await listen(server);
    assert((await postJson<JsonRecord>(baseUrl, "/api/chat/provider-selection", { profileId: "missing", modelId: MODEL_ID, reasoningPreset: "off" })).status === 404, "invalid profile was not rejected");
    assert((await postJson<JsonRecord>(baseUrl, "/api/chat/provider-selection", { profileId: PROFILE_ID, modelId: "missing", reasoningPreset: "off" })).status === 404, "invalid model was not rejected");
    assert((await postJson<JsonRecord>(baseUrl, "/api/chat/provider-selection", { profileId: PROFILE_ID, modelId: MODEL_ID, reasoningPreset: "high" })).status === 400, "invalid reasoning preset was not rejected");
    assert((await postJson<JsonRecord>(baseUrl, "/api/chat/provider-selection", { profileId: PROFILE_ID, modelId: MODEL_ID, reasoningPreset: "off", apiKey: "secret" })).status === 400, "selection accepted forbidden extra field");
  } finally {
    await cleanup(server, env);
  }
}

async function testSelectionPersistsAfterDbReopen(): Promise<void> {
  const env = createEnv("persist");
  writeProfileConfig(env.dataRoot);
  process.env[API_KEY_ENV] = API_KEY;
  let server = createAgentHttpServer({ db: env.db });
  let baseUrl = await listen(server);
  const selected = await postJson<JsonRecord>(baseUrl, "/api/chat/provider-selection", { profileId: PROFILE_ID, modelId: MODEL_ID, reasoningPreset: "off" });
  assert(selected.status === 200, "initial persisted selection failed");
  await closeServer(server);
  env.db.close();

  const db = openAgentDatabase();
  server = createAgentHttpServer({ db });
  baseUrl = await listen(server);
  try {
    const status = await getJson<JsonRecord>(baseUrl, "/api/chat/provider-status");
    assert((status.payload.selection as JsonRecord).profileId === PROFILE_ID, "selection did not persist after DB reopen");
  } finally {
    await cleanup(server, { dataRoot: env.dataRoot, db });
  }
}

async function testGenerationSnapshotSurvivesGlobalSwitch(): Promise<void> {
  const env = createEnv("snapshot");
  writeProfileConfig(env.dataRoot);
  process.env[API_KEY_ENV] = API_KEY;
  fake.mode = "slow";
  const server = createAgentHttpServer({ db: env.db });
  try {
    const baseUrl = await listen(server);
    await postJson<JsonRecord>(baseUrl, "/api/chat/provider-selection", { profileId: PROFILE_ID, modelId: MODEL_ID, reasoningPreset: "off" });
    const session = await createSession(baseUrl);
    const response = await fetch(`${baseUrl}/api/chat/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session, message: "slow", allowExternalProvider: true }),
    });
    assert(response.body, "streaming response missing body");
    const generationId = await readGenerationId(response.body);
    await postJson<JsonRecord>(baseUrl, "/api/chat/provider-selection", { profileId: "dry-run", modelId: "dry-run", reasoningPreset: "off" });
    fake.resolveSlow();
    await waitFor(() => {
      const status = env.db.prepare("SELECT status FROM generations WHERE id = ?").get(generationId) as JsonRecord | undefined;
      return status?.status === "completed";
    }, "slow generation did not complete");
    await response.body.cancel();
    const row = env.db.prepare("SELECT profile_id, model_id, protocol, endpoint_origin, external FROM generations WHERE id = ?").get(generationId) as JsonRecord;
    assert(row.profile_id === PROFILE_ID, "generation profile snapshot changed after global switch");
    assert(row.model_id === MODEL_ID, "generation model snapshot changed after global switch");
    assert(row.protocol === "openai-chat-completions", "generation protocol snapshot missing");
    assert(row.endpoint_origin === "https://mock-provider.example", "generation endpoint origin snapshot mismatch");
    assert(row.external === 1, "generation external snapshot mismatch");
  } finally {
    fake.resolveSlow();
    await cleanup(server, env);
  }
}

function createEnv(name: string): { dataRoot: string; db: AgentDatabase } {
  const dataRoot = mkdtempSync(join(tmpdir(), `pkos-provider-profile-${name}-`));
  process.env.PKOS_DATA_ROOT = dataRoot;
  delete process.env.PKOS_AGENT_DB_PATH;
  delete process.env.PKOS_AGENT_PROVIDER;
  delete process.env.PKOS_LLM_CHAT_COMPLETIONS_URL;
  delete process.env.PKOS_LLM_MODEL;
  delete process.env.PKOS_LLM_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env[API_KEY_ENV];
  return { dataRoot, db: openAgentDatabase() };
}

function writeProfileConfig(dataRoot: string): void {
  const dir = join(dataRoot, "runtime", "agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "provider_profiles.json"),
    JSON.stringify({
      schemaVersion: "0.6",
      profiles: [
        {
          id: PROFILE_ID,
          providerId: "custom-openai",
          displayName: "Mock Provider",
          protocol: "openai-chat-completions",
          baseUrl: BASE_URL,
          apiKeyEnv: API_KEY_ENV,
          external: true,
          enabled: true,
          models: [
            {
              id: MODEL_ID,
              displayName: "Mock Model",
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

function createFakeProvider(): {
  mode: "normal" | "server_error" | "reasoning" | "json_reasoning" | "slow";
  requests: Array<{ body: JsonRecord; headers: Record<string, string>; aborted: boolean }>;
  fetch: typeof fetch;
  resolveSlow(): void;
} {
  let slowResolve: (() => void) | null = null;
  const state = {
    mode: "normal" as "normal" | "server_error" | "reasoning" | "json_reasoning" | "slow",
    requests: [] as Array<{ body: JsonRecord; headers: Record<string, string>; aborted: boolean }>,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url !== ENDPOINT && url !== DEEPSEEK_ENDPOINT) {
        return originalFetch(input, init);
      }
      const request = {
        body: typeof init?.body === "string" ? JSON.parse(init.body) as JsonRecord : {},
        headers: headersToRecord(init?.headers),
        aborted: false,
      };
      state.requests.push(request);
      init?.signal?.addEventListener("abort", () => {
        request.aborted = true;
        slowResolve?.();
      }, { once: true });
      if (state.mode === "server_error") {
        return new Response(JSON.stringify({ error: { message: "secret upstream body" } }), { status: 500, headers: { "content-type": "application/json" } });
      }
      if (state.mode === "json_reasoning") {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: { reasoning_content: { marker: REASONING_MARKER }, content: "json visible content" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 3, completion_tokens: 2 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          if (state.mode === "slow") {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"slow"}}]}\n\n'));
            await new Promise<void>((resolve) => {
              slowResolve = resolve;
            });
          } else if (state.mode === "reasoning") {
            controller.enqueue(encoder.encode(`data: {"choices":[{"delta":{"reasoning_content":"${REASONING_MARKER}","content":"visible content"},"finish_reason":"stop"}]}\n\n`));
          } else {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n'));
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch,
    resolveSlow() {
      slowResolve?.();
      slowResolve = null;
    },
  };
  return state;
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

async function createSession(baseUrl: string): Promise<string> {
  const response = await postJson<{ session?: { id?: string } }>(baseUrl, "/api/chat/sessions", { title: "Provider profile smoke" });
  const sessionId = response.payload.session?.id;
  assert(response.status === 201 && typeof sessionId === "string", "session creation failed");
  return sessionId;
}

async function readGenerationId(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    assert(!chunk.done, "stream ended before generation_started");
    buffer += decoder.decode(chunk.value, { stream: true });
    for (const line of buffer.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      const event = JSON.parse(line) as JsonRecord;
      if (event.type === "generation_started" && typeof event.generationId === "string") {
        reader.releaseLock();
        return event.generationId;
      }
    }
  }
}

async function waitFor(check: () => boolean, message: string): Promise<void> {
  for (let index = 0; index < 60; index += 1) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
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

function databaseBlob(db: AgentDatabase): string {
  const messages = db.prepare("SELECT content, metadata_json FROM chat_messages").all() as JsonRecord[];
  const generations = db.prepare("SELECT * FROM generations").all() as JsonRecord[];
  const events = db.prepare("SELECT payload_json FROM agent_events").all() as JsonRecord[];
  return JSON.stringify({ messages, generations, events });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
