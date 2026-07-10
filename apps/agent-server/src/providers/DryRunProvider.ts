import type { AgentProvider, ProviderDelta, ProviderRequest } from "./ProviderTypes.js";

export class DryRunProvider implements AgentProvider {
  readonly protocol = "dry-run" as const;
  readonly providerId = "dry-run";
  readonly profileId = "dry-run";
  readonly modelId = "dry-run";
  readonly reasoningPreset = "off" as const;
  readonly dataEgress = "none" as const;

  async *stream(request: ProviderRequest): AsyncGenerator<ProviderDelta> {
    const latestUser = [...request.messages].reverse().find((message) => message.role === "user");
    const safeMessage = (latestUser?.content ?? "").replace(/\s+/g, " ").trim();
    const response =
      "Received. This is the dry-run PKOS agent server skeleton. " +
      "No external API, RAG, tool, or authority write was called. " +
      `Prompt messages: ${request.messages.length}. ` +
      `You said: ${safeMessage}`;
    for (const chunk of chunkText(response, 48)) {
      yield { type: "content_delta", text: chunk };
    }
    yield { type: "completed", finishReason: "dry-run" };
  }
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}
