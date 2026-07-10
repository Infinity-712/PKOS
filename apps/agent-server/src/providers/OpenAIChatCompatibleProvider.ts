import type { OpenAIChatCompatibleConfig } from "./ProviderConfig.js";
import { applyReasoningAdapter } from "./registry/ReasoningAdapterRegistry.js";
import type { AgentProvider, ProviderDelta, ProviderRequest } from "./ProviderTypes.js";
import { ProviderError } from "./ProviderTypes.js";

const MAX_DELTA_CHARS = 4_096;
const MAX_TOTAL_OUTPUT_CHARS = 64_000;

export class OpenAIChatCompatibleProvider implements AgentProvider {
  readonly protocol = "openai-chat-completions" as const;
  readonly providerId: string;
  readonly profileId: string;
  readonly modelId: string;
  readonly reasoningPreset: "off" | "low" | "medium" | "high" | "max";
  readonly dataEgress = "configured-endpoint" as const;

  constructor(private readonly config: OpenAIChatCompatibleConfig) {
    this.providerId = config.providerId;
    this.profileId = config.profileId;
    this.modelId = config.modelId;
    this.reasoningPreset = config.reasoningPreset;
  }

  async *stream(request: ProviderRequest): AsyncGenerator<ProviderDelta> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("provider_timeout")), this.config.timeoutMs);
    const abort = () => controller.abort(new Error("provider_aborted"));
    request.signal.addEventListener("abort", abort, { once: true });
    let outputChars = 0;
    let completed = false;
    let completionEmitted = false;

    try {
      const response = await fetch(this.config.endpoint, {
        method: "POST",
        headers: buildHeaders(this.config.apiKey),
        body: JSON.stringify(buildRequestBody(this.config, request)),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw statusError(response.status);
      }
      if (isJsonResponse(response)) {
        const payload = (await response.json()) as unknown;
        for (const delta of deltasFromPayload(payload, "message")) {
          outputChars = checkAndAddOutput(outputChars, delta.text);
          yield delta;
        }
        const choice = firstChoice(payload);
        const finishReason = choice && typeof choice.finish_reason === "string" ? choice.finish_reason : undefined;
        yield { type: "completed", finishReason, usage: usageFromPayload(payload) };
        completed = true;
        completionEmitted = true;
      } else {
        if (!response.body) {
          throw new ProviderError("provider_invalid_response", "provider returned an empty stream");
        }

        for await (const data of readSseData(response.body)) {
        if (data === "[DONE]") {
          completed = true;
          break;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(data) as unknown;
        } catch {
          throw new ProviderError("provider_invalid_response", "provider returned malformed stream JSON");
        }
        const choice = firstChoice(payload);
        if (!choice) {
          throw new ProviderError("provider_invalid_response", "provider stream event shape was not recognized");
        }
        if (hasToolOutput(choice)) {
          throw new ProviderError("unsupported_provider_tool_output", "provider returned unsupported tool output");
        }
        for (const delta of deltasFromPayload(payload, "delta")) {
          outputChars = checkAndAddOutput(outputChars, delta.text);
          yield delta;
        }
        const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : undefined;
        if (finishReason && !completionEmitted) {
          completionEmitted = true;
          yield { type: "completed", finishReason, usage: usageFromPayload(payload) };
        }
      }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason;
        if (reason instanceof Error && reason.message === "provider_timeout") {
          throw new ProviderError("provider_timeout", "provider request timed out", 504);
        }
        throw new ProviderError("provider_aborted", "provider request was aborted", 499);
      }
      if (error instanceof ProviderError) {
        throw error;
      }
      throw new ProviderError("unknown_provider_error", "provider request failed");
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abort);
    }

    if (!completed && !completionEmitted) {
      throw new ProviderError("provider_stream_error", "provider stream ended before completion");
    }
    if (!completionEmitted) {
      yield { type: "completed" };
    }
  }
}

function buildHeaders(apiKey: string | null): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function buildRequestBody(config: OpenAIChatCompatibleConfig, request: ProviderRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.modelId,
    messages: request.messages,
    stream: true,
    ...(config.maxOutputTokens !== undefined ? { max_tokens: config.maxOutputTokens } : {}),
  };
  return config.reasoningAdapterId ? applyReasoningAdapter(config.reasoningAdapterId, config.reasoningPreset, body) : body;
}

function isJsonResponse(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").toLowerCase().includes("application/json");
}

function* deltasFromPayload(payload: unknown, containerKey: "delta" | "message"): Generator<{ type: "content_delta"; text: string }> {
  const choice = firstChoice(payload);
  if (!choice) {
    throw new ProviderError("provider_invalid_response", "provider response event shape was not recognized");
  }
  if (hasToolOutput(choice)) {
    throw new ProviderError("unsupported_provider_tool_output", "provider returned unsupported tool output");
  }
  const container = choice[containerKey];
  if (container && typeof container === "object" && !Array.isArray(container) && typeof (container as { content?: unknown }).content === "string") {
    yield { type: "content_delta", text: (container as { content: string }).content };
  }
}

function checkAndAddOutput(outputChars: number, text: string): number {
  if (text.length > MAX_DELTA_CHARS) {
    throw new ProviderError("provider_output_too_large", "provider delta exceeded output limit");
  }
  const next = outputChars + text.length;
  if (next > MAX_TOTAL_OUTPUT_CHARS) {
    throw new ProviderError("provider_output_too_large", "provider output exceeded limit");
  }
  return next;
}

async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let boundary = findBoundary(buffer);
    while (boundary >= 0) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + boundaryLength(buffer, boundary));
      const data = eventData(event);
      if (data) {
        yield data;
      }
      boundary = findBoundary(buffer);
    }
  }
  const data = eventData(buffer);
  if (data) {
    yield data;
  }
}

function findBoundary(value: string): number {
  const lf = value.indexOf("\n\n");
  const crlf = value.indexOf("\r\n\r\n");
  if (lf < 0) {
    return crlf;
  }
  if (crlf < 0) {
    return lf;
  }
  return Math.min(lf, crlf);
}

function boundaryLength(value: string, index: number): number {
  return value.slice(index, index + 4) === "\r\n\r\n" ? 4 : 2;
}

function eventData(event: string): string | null {
  const lines = event.split(/\r?\n/);
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line.trim() || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  return dataLines.length > 0 ? dataLines.join("\n").trim() : null;
}

function firstChoice(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object" || Array.isArray(choices[0])) {
    return null;
  }
  return choices[0] as Record<string, unknown>;
}

function hasToolOutput(choice: Record<string, unknown>): boolean {
  if ("tool_calls" in choice || "function_call" in choice) {
    return true;
  }
  const delta = choice.delta;
  return Boolean(delta && typeof delta === "object" && ("tool_calls" in delta || "function_call" in delta));
}

function usageFromPayload(payload: unknown): { inputTokens?: number; outputTokens?: number } | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return undefined;
  }
  const inputTokens = (usage as { prompt_tokens?: unknown }).prompt_tokens;
  const outputTokens = (usage as { completion_tokens?: unknown }).completion_tokens;
  return {
    ...(typeof inputTokens === "number" ? { inputTokens } : {}),
    ...(typeof outputTokens === "number" ? { outputTokens } : {}),
  };
}

function statusError(status: number): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError("provider_auth_failed", "provider authentication failed", 401);
  }
  if (status === 429) {
    return new ProviderError("provider_rate_limited", "provider rate limited request", 429);
  }
  if (status >= 500) {
    return new ProviderError("provider_unavailable", "provider was unavailable", 502);
  }
  return new ProviderError("provider_invalid_response", "provider returned an unexpected status", 502);
}
