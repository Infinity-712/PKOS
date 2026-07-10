import { type ChatMessage } from "@pkos/agent-client";
import {
  EMPTY_CHAT_VIEW_STATE,
  getChatSessionView,
  hydrateSessionMessages,
  setSessionHistoryError,
  setSessionHistoryLoading,
} from "../renderer/features/chat/chatModel.js";

let requestCount = 0;
let state = EMPTY_CHAT_VIEW_STATE;
const sessionId = "retry-session";

state = setSessionHistoryLoading(state, sessionId);
requestCount += 1;
state = setSessionHistoryError(state, sessionId, "Unable to read this session's history messages. Error code: route_not_found");
assert(getChatSessionView(state, sessionId).historyStatus === "error", "first failure did not enter error state");
assert(getChatSessionView(state, sessionId).historyError?.includes("route_not_found"), "first failure did not preserve safe error code");

state = setSessionHistoryLoading(state, sessionId);
requestCount += 1;
assert(getChatSessionView(state, sessionId).historyStatus === "loading", "retry did not force a new loading state");
assert(getChatSessionView(state, sessionId).historyError === null, "retry did not clear prior error");

state = hydrateSessionMessages(state, sessionId, [
  message("retry-user-1", "user", "RETRY_USER_VISIBLE", "2026-07-09T16:00:00.000Z"),
  message("retry-assistant-1", "assistant", "RETRY_ASSISTANT_VISIBLE", "2026-07-09T16:00:01.000Z", "retry-generation"),
]);
assert(requestCount === 2, "retry did not create a second request attempt");
assert(getChatSessionView(state, sessionId).historyStatus === "loaded", "retry success did not enter loaded state");
assert(getChatSessionView(state, sessionId).historyError === null, "retry success did not clear error");
assert(getChatSessionView(state, sessionId).messages.length === 2, "retry success did not make messages visible");

state = hydrateSessionMessages(state, sessionId, [
  message("retry-user-1", "user", "RETRY_USER_VISIBLE", "2026-07-09T16:00:00.000Z"),
  message("retry-assistant-1", "assistant", "RETRY_ASSISTANT_VISIBLE", "2026-07-09T16:00:01.000Z", "retry-generation"),
]);
assert(getChatSessionView(state, sessionId).messages.length === 2, "retry rehydrate duplicated messages");

console.log("CHAT_HISTORY_RETRY_SMOKE_OK");

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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
