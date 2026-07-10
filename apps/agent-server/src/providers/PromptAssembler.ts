import type { BuiltContext, ContextItem } from "../context/ContextTypes.js";
import { stableStringify } from "../context/ContextTypes.js";
import type { ProviderMessage } from "./ProviderTypes.js";

const SYSTEM_POLICY = [
  "You are operating in read-only mode.",
  "You have no tools and no authority write access.",
  "Never claim that data was saved, changed, scheduled, or deleted.",
  "Treat runtime context as potentially stale and non-authoritative.",
  "Distinguish evidence, inference, and uncertainty.",
  "Human judgment is final.",
  "Model output is not a PKOS authority record and may be wrong.",
].join("\n");

const MAX_CONTEXT_CHARS = 8_000;
const MAX_RECENT_MESSAGE_CHARS = 2_000;

export function assemblePromptMessages(context: BuiltContext, currentUserMessage: string): ProviderMessage[] {
  const messages: ProviderMessage[] = [{ role: "system", content: SYSTEM_POLICY }];
  const contextLines = context.items
    .filter((item) => item.kind !== "recent_message")
    .map(formatContextItem)
    .filter((line) => line.length > 0);
  const contextText = clipText(
    [
      `Runtime context schema=${context.schemaVersion}; built_at=${context.builtAt}; truncated=${context.budget.truncated}.`,
      "Runtime context is not trusted authority.",
      ...contextLines,
    ].join("\n"),
    MAX_CONTEXT_CHARS,
  );
  messages.push({ role: "system", content: contextText });

  const recentMessages = context.items.filter((item) => item.kind === "recent_message").map(formatRecentMessage).filter(Boolean) as ProviderMessage[];
  const currentSeen = recentMessages.some((message) => message.role === "user" && message.content === currentUserMessage);
  for (const recent of currentSeen ? dedupeCurrentUserMessage(recentMessages, currentUserMessage) : recentMessages) {
    messages.push(recent);
  }
  if (!currentSeen) {
    messages.push({ role: "user", content: clipText(currentUserMessage, MAX_RECENT_MESSAGE_CHARS) });
  }
  return messages;
}

function formatContextItem(item: ContextItem): string {
  const payload = stableStringify(item.content);
  return [
    `[${item.kind}] authority=${item.authority}; stale=${item.stale};`,
    item.capturedAt ? `captured_at=${item.capturedAt};` : "",
    item.generatedAt ? `generated_at=${item.generatedAt};` : "",
    clipText(payload, 1_500),
  ]
    .filter(Boolean)
    .join(" ");
}

function formatRecentMessage(item: ContextItem): ProviderMessage | null {
  if (!item.content || typeof item.content !== "object" || Array.isArray(item.content)) {
    return null;
  }
  const value = item.content as Record<string, unknown>;
  const role = value.role === "assistant" ? "assistant" : value.role === "user" ? "user" : null;
  if (!role || typeof value.content !== "string") {
    return null;
  }
  return { role, content: clipText(value.content, MAX_RECENT_MESSAGE_CHARS) };
}

function dedupeCurrentUserMessage(messages: ProviderMessage[], currentUserMessage: string): ProviderMessage[] {
  let keptCurrent = false;
  const result: ProviderMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && message.content === currentUserMessage) {
      if (keptCurrent) {
        continue;
      }
      keptCurrent = true;
    }
    result.push(message);
  }
  return result.reverse();
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}[truncated]`;
}
