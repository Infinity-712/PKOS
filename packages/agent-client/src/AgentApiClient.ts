import {
  isAbortGenerationResponse,
  isActionSubmitResponse,
  isAgentEvent,
  isApiErrorPayload,
  isChatMessageListResponse,
  isChatSessionListResponse,
  isCreateChatSessionResponse,
  isHealthResponse,
  isProviderStatusResponse,
  isProviderProfilesResponse,
  isRecord,
  isStateTimelineResponse,
} from "./guards.js";
import { parseNdjsonStream } from "./NdjsonStreamParser.js";
import type {
  ActionSubmitResponse,
  AbortGenerationResponse,
  AgentEvent,
  ChatMessageListResponse,
  ChatSessionListResponse,
  CreateChatSessionResponse,
  GetSessionMessagesOptions,
  HealthDiagnosticsResponse,
  HealthResponse,
  InboxAppendRequest,
  JsonObject,
  ProviderStatusResponse,
  ProviderProfilesResponse,
  SetProviderSelectionInput,
  SendChatMessageInput,
  StateAppendRequest,
  StateTimelineFilters,
  StateTimelineResponse,
} from "./types.js";

type Guard<T> = (value: unknown) => value is T;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class AgentApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentApiClientError";
  }
}

export type AgentApiClientOptions = {
  baseUrl?: string;
  fetchImpl?: FetchLike;
};

export class AgentApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: AgentApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  health(signal?: AbortSignal): Promise<HealthResponse> {
    return this.get("/health", isHealthResponse, signal);
  }

  healthWithDiagnostics(signal?: AbortSignal): Promise<HealthDiagnosticsResponse> {
    const requestUrl = this.url("/health");
    return requestJsonWithDiagnostics(this.fetchImpl, requestUrl, { method: "GET", signal }, isHealthResponse);
  }

  createChatSession(input: { title?: string } = {}, signal?: AbortSignal): Promise<CreateChatSessionResponse> {
    return this.post("/api/chat/sessions", { ...(input.title ? { title: input.title } : {}) }, isCreateChatSessionResponse, signal);
  }

  listChatSessions(signal?: AbortSignal): Promise<ChatSessionListResponse> {
    return this.get("/api/chat/sessions", isChatSessionListResponse, signal);
  }

  getSessionMessages(sessionId: string, options: GetSessionMessagesOptions = {}, signal?: AbortSignal): Promise<ChatMessageListResponse> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) {
      params.set("limit", String(options.limit));
    }
    if (options.before !== undefined) {
      params.set("before", options.before);
    }
    const query = params.toString();
    return this.get(`/api/chat/sessions/${encodeURIComponent(sessionId)}/messages${query ? `?${query}` : ""}`, isChatMessageListResponse, signal);
  }

  listChatMessages(sessionId: string, signal?: AbortSignal): Promise<ChatMessageListResponse> {
    return this.getSessionMessages(sessionId, {}, signal);
  }

  getProviderStatus(signal?: AbortSignal): Promise<ProviderStatusResponse> {
    return this.get("/api/chat/provider-status", isProviderStatusResponse, signal);
  }

  getProviderProfiles(signal?: AbortSignal): Promise<ProviderProfilesResponse> {
    return this.get("/api/chat/provider-profiles", isProviderProfilesResponse, signal);
  }

  setProviderSelection(input: SetProviderSelectionInput, signal?: AbortSignal): Promise<ProviderStatusResponse> {
    return this.post("/api/chat/provider-selection", input, isProviderStatusResponse, signal);
  }

  inboxAppend(input: InboxAppendRequest, signal?: AbortSignal): Promise<ActionSubmitResponse> {
    return this.post("/api/actions/inbox-append", input, isActionSubmitResponse, signal);
  }

  stateAppend(input: StateAppendRequest, signal?: AbortSignal): Promise<ActionSubmitResponse> {
    return this.post("/api/actions/state-append", input, isActionSubmitResponse, signal);
  }

  getStateTimeline(filters: StateTimelineFilters = {}, signal?: AbortSignal): Promise<StateTimelineResponse> {
    const params = new URLSearchParams();
    if (filters.energy) {
      params.set("energy", filters.energy);
    }
    if (filters.mood) {
      params.set("mood", filters.mood);
    }
    if (filters.mode) {
      params.set("mode", filters.mode);
    }
    if (filters.limit !== undefined) {
      params.set("limit", String(filters.limit));
    }
    const query = params.toString();
    return this.get(`/api/pkos/state-timeline${query ? `?${query}` : ""}`, isStateTimelineResponse, signal);
  }

  abortGeneration(generationId: string, signal?: AbortSignal): Promise<AbortGenerationResponse> {
    return this.post(`/api/chat/generations/${encodeURIComponent(generationId)}/abort`, {}, isAbortGenerationResponse, signal);
  }

  async *sendChatMessage(input: SendChatMessageInput, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url("/api/chat/send"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "network request failed";
      throw new AgentApiClientError(0, "network_unknown", message);
    }
    if (!response.ok) {
      const payload = await parseResponseJson(response);
      const error = errorPayload(payload);
      throw new AgentApiClientError(response.status, error.code, error.message);
    }
    if (!response.body) {
      throw new AgentApiClientError(response.status, "empty_stream", "server returned an empty stream");
    }
    for await (const item of parseNdjsonStream(response.body)) {
      if (isAgentEvent(item)) {
        yield item;
        continue;
      }
      if (isRecord(item) && item.ok === false && isApiErrorPayload(item.error)) {
        throw new AgentApiClientError(response.status, item.error.code, item.error.message);
      }
      throw new AgentApiClientError(response.status, "invalid_stream_event", "server stream event shape was not recognized");
    }
  }

  private get<T>(path: string, guard: Guard<T>, signal?: AbortSignal): Promise<T> {
    return requestJson(this.fetchImpl, this.url(path), { method: "GET", signal }, guard);
  }

  private post<T>(path: string, body: JsonObject, guard: Guard<T>, signal?: AbortSignal): Promise<T> {
    return requestJson(
      this.fetchImpl,
      this.url(path),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      },
      guard,
    );
  }

  private url(path: string): string {
    return resolveAgentApiUrl(this.baseUrl, path);
  }
}

export function resolveAgentApiUrl(baseUrl: string | undefined, path: string): string {
  if (isAbsoluteOrProtocolRelativeUrl(path)) {
    throw new AgentApiClientError(0, "unsafe_endpoint", "endpoint must not override the configured origin");
  }
  const normalizedBase = (baseUrl ?? "").replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export async function getJson<T>(path: string, guard: Guard<T>, signal?: AbortSignal): Promise<T> {
  return requestJson(fetch.bind(globalThis), path, { method: "GET", signal }, guard);
}

export async function postJson<T>(path: string, body: JsonObject, guard: Guard<T>, signal?: AbortSignal): Promise<T> {
  return requestJson(
    fetch.bind(globalThis),
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
    guard,
  );
}

async function requestJson<T>(fetchImpl: FetchLike, path: string, init: RequestInit, guard: Guard<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(path, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : "network request failed";
    throw new AgentApiClientError(0, "network_unknown", message);
  }

  const payload = await parseResponseJson(response);
  if (!response.ok) {
    const error = errorPayload(payload);
    throw new AgentApiClientError(response.status, error.code, error.message);
  }
  if (!guard(payload)) {
    throw new AgentApiClientError(response.status, "invalid_response", "server response shape was not recognized");
  }
  return payload;
}

async function requestJsonWithDiagnostics<T extends HealthResponse>(
  fetchImpl: FetchLike,
  path: string,
  init: RequestInit,
  guard: Guard<T>,
): Promise<HealthDiagnosticsResponse> {
  let response: Response;
  try {
    response = await fetchImpl(path, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : "network request failed";
    throw new AgentApiClientError(0, "network_unknown", message);
  }

  const payload = await parseResponseJson(response);
  if (!response.ok) {
    const error = errorPayload(payload);
    throw new AgentApiClientError(response.status, error.code, error.message);
  }
  if (!guard(payload)) {
    throw new AgentApiClientError(response.status, "invalid_response", "server response shape was not recognized");
  }
  return {
    health: payload,
    requestUrl: path,
    status: response.status,
    responseType: response.type,
    contentType: response.headers.get("content-type"),
    receivedOrigin: response.headers.get("x-pkos-received-origin"),
  };
}

async function parseResponseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { error: { code: "non_json_response", message: "server returned a non-JSON response" } };
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    return { error: { code: "invalid_json_response", message: "server returned invalid JSON" } };
  }
}

function errorPayload(payload: unknown): { code: string; message: string } {
  if (isRecord(payload) && isRecord(payload.error)) {
    const code = typeof payload.error.code === "string" ? payload.error.code : "request_failed";
    const message = typeof payload.error.message === "string" ? payload.error.message : "request failed";
    return { code, message };
  }
  return { code: "request_failed", message: "request failed" };
}

function isAbsoluteOrProtocolRelativeUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) || value.startsWith("//");
}
