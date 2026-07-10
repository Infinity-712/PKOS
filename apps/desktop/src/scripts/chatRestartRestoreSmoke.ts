import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { formatDateTime, type ChatMessage } from "@pkos/agent-client";
import {
  EMPTY_CHAT_VIEW_STATE,
  applySessionChatEvent,
  getChatSessionView,
  hydrateSessionMessages,
  isNearScrollBottom,
  setSessionHistoryError,
  setSessionHistoryLoading,
} from "../renderer/features/chat/chatModel.js";

let firstProcessState = EMPTY_CHAT_VIEW_STATE;
firstProcessState = hydrateSessionMessages(firstProcessState, "session-a", [
  message("a-user-1", "user", "A_PERSISTED_USER", "2026-07-09T16:00:00.000Z"),
  message("a-assistant-1", "assistant", "A_PERSISTED_ASSISTANT", "2026-07-09T16:00:01.000Z", "generation-a"),
]);
firstProcessState = hydrateSessionMessages(firstProcessState, "session-b", [message("b-user-1", "user", "B_PERSISTED_USER", "2026-07-09T17:00:00.000Z")]);
assert(getChatSessionView(firstProcessState, "session-a").messages.length === 2, "first lifecycle did not hydrate session A");

let restartedState = EMPTY_CHAT_VIEW_STATE;
assert(getChatSessionView(restartedState, "session-a").messages.length === 0, "new Desktop lifecycle must start from empty memory");
restartedState = setSessionHistoryLoading(restartedState, "session-a");
assert(getChatSessionView(restartedState, "session-a").historyStatus === "loading", "session history loading state missing");
restartedState = hydrateSessionMessages(restartedState, "session-a", [
  message("a-user-1", "user", "A_PERSISTED_USER", "2026-07-09T16:00:00.000Z"),
  message("a-assistant-1", "assistant", "A_PERSISTED_ASSISTANT", "2026-07-09T16:00:01.000Z", "generation-a"),
]);
assert(getChatSessionView(restartedState, "session-a").messages.map((item) => item.content).join("|") === "A_PERSISTED_USER|A_PERSISTED_ASSISTANT", "restarted lifecycle did not restore persisted messages");
assert(getChatSessionView(restartedState, "session-a").historyStatus === "loaded", "successful hydrate did not mark history loaded");

restartedState = hydrateSessionMessages(restartedState, "session-b", [message("b-user-1", "user", "B_PERSISTED_USER", "2026-07-09T17:00:00.000Z")]);
assert(!getChatSessionView(restartedState, "session-b").messages.some((item) => item.content.includes("A_PERSISTED")), "session B received session A history");

const lateAState = hydrateSessionMessages(restartedState, "session-a", [
  message("a-user-1", "user", "A_PERSISTED_USER", "2026-07-09T16:00:00.000Z"),
  message("a-assistant-1", "assistant", "A_PERSISTED_ASSISTANT", "2026-07-09T16:00:01.000Z", "generation-a"),
]);
assert(getChatSessionView(lateAState, "session-b").messages.map((item) => item.content).join("|") === "B_PERSISTED_USER", "late session A response changed selected session B view");

let streamingState = applySessionChatEvent(restartedState, "session-a", {
  id: "stream-start",
  ts: "2026-07-09T16:00:02.000Z",
  sessionId: "session-a",
  generationId: "generation-streaming",
  type: "generation_started",
  payload: {},
  severity: "info",
});
streamingState = applySessionChatEvent(streamingState, "session-a", {
  id: "stream-delta",
  ts: "2026-07-09T16:00:03.000Z",
  sessionId: "session-a",
  generationId: "generation-streaming",
  type: "content_delta",
  payload: { delta: "STREAMING_TEMP" },
  severity: "debug",
});
streamingState = hydrateSessionMessages(streamingState, "session-a", [
  message("a-user-1", "user", "A_PERSISTED_USER", "2026-07-09T16:00:00.000Z"),
  message("a-assistant-1", "assistant", "A_PERSISTED_ASSISTANT", "2026-07-09T16:00:01.000Z", "generation-a"),
]);
assert(getChatSessionView(streamingState, "session-a").messages.some((item) => item.content === "STREAMING_TEMP"), "hydrate lost still-streaming local assistant");

let dedupeState = hydrateSessionMessages(restartedState, "session-a", [
  message("a-user-1", "user", "A_PERSISTED_USER", "2026-07-09T16:00:00.000Z"),
  message("a-assistant-1", "assistant", "A_PERSISTED_ASSISTANT", "2026-07-09T16:00:01.000Z", "generation-a"),
]);
dedupeState = hydrateSessionMessages(dedupeState, "session-a", [
  message("a-user-1", "user", "A_PERSISTED_USER", "2026-07-09T16:00:00.000Z"),
  message("a-assistant-1", "assistant", "A_PERSISTED_ASSISTANT", "2026-07-09T16:00:01.000Z", "generation-a"),
]);
assert(getChatSessionView(dedupeState, "session-a").messages.length === 2, "duplicate hydrate duplicated persisted messages");

let failedState = setSessionHistoryError(restartedState, "session-a", "Unable to read this session's history messages.");
assert(getChatSessionView(failedState, "session-a").historyStatus === "error", "history failure state missing");
assert(getChatSessionView(failedState, "session-b").messages[0]?.content === "B_PERSISTED_USER", "history failure cleared another session");
assert(getChatSessionView(EMPTY_CHAT_VIEW_STATE, "empty-session").messages.length === 0, "empty session view should be empty");
assert(formatDateTime("2026-07-09T16:00:00.000Z") === "2026-07-10 00:00:00", "Desktop restore smoke timezone mismatch");
assert(isNearScrollBottom({ scrollTop: 360, clientHeight: 600, scrollHeight: 980 }), "auto-scroll near-bottom condition failed");

const source = readSource(join(process.cwd(), "src"));
for (const forbidden of ["localStorage", "sessionStorage", "indexedDB"]) {
  assert(!source.includes(forbidden), `Desktop source contains forbidden storage: ${forbidden}`);
}

console.log("CHAT_RESTART_RESTORE_SMOKE_OK");

function message(id: string, role: "user" | "assistant", content: string, createdAt: string, generationId?: string): ChatMessage {
  return {
    id,
    role,
    content,
    generationId: generationId ?? null,
    status: "completed",
    createdAt,
    updatedAt: createdAt,
  };
}

function readSource(root: string): string {
  const entries = readdirSync(root);
  const contents: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry === "scripts") {
        continue;
      }
      contents.push(readSource(path));
    } else if ((entry.endsWith(".ts") || entry.endsWith(".tsx")) && !path.endsWith(join("scripts", "chatRestartRestoreSmoke.ts"))) {
      contents.push(readFileSync(path, "utf8"));
    }
  }
  return contents.join("\n");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
