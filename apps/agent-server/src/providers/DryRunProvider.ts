import type { BuiltContext } from "../context/ContextTypes.js";

export type DryRunRequest = {
  sessionId: string;
  userMessage: string;
  context: BuiltContext;
};

export class DryRunProvider {
  async *stream(request: DryRunRequest): AsyncGenerator<string> {
    const safeMessage = request.userMessage.replace(/\s+/g, " ").trim();
    const response =
      "Received. This is the dry-run PKOS agent server skeleton. " +
      "No external API, RAG, tool, or authority write was called. " +
      `Context items: ${request.context.items.length}; warnings: ${request.context.warnings.length}. ` +
      `You said: ${safeMessage}`;
    for (const chunk of chunkText(response, 48)) {
      yield chunk;
    }
  }
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}
