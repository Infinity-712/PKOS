import { isAgentEvent, parseNdjsonStream, type AgentEvent } from "@pkos/agent-client";
import { applyChatEvent } from "../renderer/features/chat/chatModel.js";

const encoder = new TextEncoder();

const events: AgentEvent[] = [
  {
    id: "probe-started",
    ts: "2026-07-08T00:00:00.000Z",
    sessionId: "probe-session",
    generationId: "probe-generation",
    type: "generation_started",
    payload: {},
    severity: "info",
  },
  {
    id: "probe-delta-a",
    ts: "2026-07-08T00:00:01.000Z",
    sessionId: "probe-session",
    generationId: "probe-generation",
    type: "content_delta",
    payload: { delta: "PKOS_" },
    severity: "debug",
  },
  {
    id: "probe-delta-b",
    ts: "2026-07-08T00:00:02.000Z",
    sessionId: "probe-session",
    generationId: "probe-generation",
    type: "content_delta",
    payload: { delta: "CHAT_" },
    severity: "debug",
  },
  {
    id: "probe-delta-c",
    ts: "2026-07-08T00:00:03.000Z",
    sessionId: "probe-session",
    generationId: "probe-generation",
    type: "content_delta",
    payload: { delta: "OK" },
    severity: "debug",
  },
  {
    id: "probe-completed",
    ts: "2026-07-08T00:00:04.000Z",
    sessionId: "probe-session",
    generationId: "probe-generation",
    type: "generation_completed",
    payload: { contentLength: 12 },
    severity: "info",
  },
];

let messages = [];
for await (const item of parseNdjsonStream(
  streamFromChunks([
    `${JSON.stringify(events[0])}\n${JSON.stringify(events[1])}\n`,
    `${JSON.stringify(events[2])}\n${JSON.stringify(events[3])}\n${JSON.stringify(events[4])}`,
  ]),
)) {
  assert(isAgentEvent(item), "probe event failed AgentEvent guard");
  messages = applyChatEvent(messages, item);
}

const assistant = messages.find((message) => message.role === "assistant" && message.generationId === "probe-generation");
assert(assistant?.content === "PKOS_CHAT_OK", "probe assistant content was not accumulated");
assert(assistant.status === "completed", "probe assistant message was not marked completed");

console.log("DESKTOP_CHAT_STREAM_PROBE_OK");

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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
