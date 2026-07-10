import type { AgentEvent, ChatMessage, HealthResponse } from "@pkos/agent-client";

export type SendState = {
  active: boolean;
  statusText: string;
};

export type BackendStatus = {
  connected: boolean;
  label: string;
};

export type ChatMessageStatus = "completed" | "streaming" | "failed" | "aborted";
export type ChatHistoryStatus = "idle" | "loading" | "loaded" | "error";

export type ChatMessageView = {
  id: string;
  role: "user" | "assistant";
  content: string;
  generationId?: string;
  status: ChatMessageStatus;
  createdAt?: string;
};

export type ChatSessionView = {
  sessionId: string;
  messages: ChatMessageView[];
  sendState: SendState;
  activeGenerationId: string | null;
  restored: boolean;
  historyStatus: ChatHistoryStatus;
  historyError: string | null;
};

export type ChatViewState = {
  sessions: Record<string, ChatSessionView>;
};

export const EMPTY_SEND_STATE: SendState = { active: false, statusText: "" };
export const EMPTY_CHAT_VIEW_STATE: ChatViewState = { sessions: {} };

export function startSend(current: SendState): SendState {
  if (current.active) {
    return current;
  }
  return { active: true, statusText: "receiving stream" };
}

export function finishSend(current: SendState): SendState {
  return { ...current, active: false, statusText: current.statusText || "idle" };
}

export function abortSend(_current: SendState): SendState {
  return {
    active: false,
    statusText: "Abort requested for the local generation connection; the remote service may already have processed part of the request.",
  };
}

export function backendStatusFromHealth(health: HealthResponse | null): BackendStatus {
  if (health?.ok) {
    return { connected: true, label: "connected" };
  }
  return { connected: false, label: "disconnected" };
}

export function currentStateText(item: { stale: boolean } | null): string {
  if (!item) {
    return "No current state snapshot yet.";
  }
  if (item.stale) {
    return "The current state snapshot may be stale.";
  }
  return "From the latest explicit state snapshot.";
}

export function createUserMessage(content: string, id = nextLocalMessageId(), createdAt = new Date().toISOString()): ChatMessageView {
  return {
    id,
    role: "user",
    content,
    status: "completed",
    createdAt,
  };
}

export function getChatSessionView(state: ChatViewState, sessionId: string | null): ChatSessionView {
  if (!sessionId) {
    return defaultSessionView("");
  }
  return state.sessions[sessionId] ?? defaultSessionView(sessionId);
}

export function appendUserMessageToSession(state: ChatViewState, sessionId: string, content: string, id?: string): ChatViewState {
  const view = getChatSessionView(state, sessionId);
  return setChatSessionView(state, {
    ...view,
    messages: [...view.messages, createUserMessage(content, id)],
  });
}

export function applySessionChatEvent(state: ChatViewState, sessionId: string, event: AgentEvent): ChatViewState {
  const view = getChatSessionView(state, sessionId);
  const generationId = event.generationId ?? null;
  const terminal = event.type === "generation_completed" || event.type === "generation_failed" || event.type === "generation_aborted";
  return setChatSessionView(state, {
    ...view,
    messages: applyChatEvent(view.messages, event),
    activeGenerationId: event.type === "generation_started" && generationId ? generationId : terminal && view.activeGenerationId === generationId ? null : view.activeGenerationId,
  });
}

export function setSessionSendState(state: ChatViewState, sessionId: string, sendState: SendState): ChatViewState {
  const view = getChatSessionView(state, sessionId);
  return setChatSessionView(state, { ...view, sendState });
}

export function setSessionHistoryLoading(state: ChatViewState, sessionId: string): ChatViewState {
  const view = getChatSessionView(state, sessionId);
  return setChatSessionView(state, {
    ...view,
    historyStatus: "loading",
    historyError: null,
  });
}

export function setSessionHistoryError(state: ChatViewState, sessionId: string, historyError: string): ChatViewState {
  const view = getChatSessionView(state, sessionId);
  return setChatSessionView(state, {
    ...view,
    historyStatus: "error",
    historyError,
  });
}

export function hydrateSessionMessages(state: ChatViewState, sessionId: string, messages: ChatMessage[]): ChatViewState {
  const view = getChatSessionView(state, sessionId);
  const persistentMessages = messages.map(chatMessageToView);
  const persistentIds = new Set(persistentMessages.map((message) => message.id));
  const stillStreaming = view.messages.filter((message) => message.status === "streaming" && !persistentIds.has(message.id));
  return setChatSessionView(state, {
    ...view,
    messages: [...persistentMessages, ...stillStreaming],
    restored: true,
    historyStatus: "loaded",
    historyError: null,
  });
}

export function shouldSubmitChatKey(event: { key: string; shiftKey?: boolean; isComposing?: boolean }, active: boolean): boolean {
  return event.key === "Enter" && event.shiftKey !== true && event.isComposing !== true && !active;
}

export function isNearScrollBottom(input: { scrollTop: number; clientHeight: number; scrollHeight: number }, thresholdPx = 48): boolean {
  return input.scrollHeight - input.scrollTop - input.clientHeight <= thresholdPx;
}

export function applyChatEvent(current: ChatMessageView[], event: AgentEvent): ChatMessageView[] {
  const generationId = event.generationId;
  if (!generationId) {
    return current;
  }
  if (event.type === "generation_started") {
    return ensureAssistantMessage(current, generationId);
  }
  if (event.type === "content_delta") {
    const delta = contentDeltaFromEvent(event);
    if (!delta) {
      return current;
    }
    return appendAssistantDelta(ensureAssistantMessage(current, generationId), generationId, delta);
  }
  if (event.type === "generation_completed") {
    return markAssistantStatus(ensureAssistantMessage(current, generationId), generationId, "completed");
  }
  if (event.type === "generation_failed") {
    return markAssistantStatus(ensureAssistantMessage(current, generationId), generationId, "failed");
  }
  if (event.type === "generation_aborted") {
    return markAssistantStatus(ensureAssistantMessage(current, generationId), generationId, "aborted");
  }
  return current;
}

export function chatEventDebugSummary(event: AgentEvent): string {
  if (event.type === "content_delta") {
    return `${contentDeltaFromEvent(event)?.length ?? 0} chars`;
  }
  return event.severity;
}

function contentDeltaFromEvent(event: AgentEvent): string | null {
  if (event.type !== "content_delta" || !event.payload || typeof event.payload !== "object") {
    return null;
  }
  const delta = (event.payload as { delta?: unknown }).delta;
  return typeof delta === "string" ? delta : null;
}

function ensureAssistantMessage(current: ChatMessageView[], generationId: string): ChatMessageView[] {
  if (current.some((message) => message.role === "assistant" && message.generationId === generationId)) {
    return current;
  }
  return [
    ...current,
    {
      id: `assistant-${generationId}`,
      role: "assistant",
      generationId,
      content: "",
      status: "streaming",
    },
  ];
}

function appendAssistantDelta(current: ChatMessageView[], generationId: string, delta: string): ChatMessageView[] {
  return current.map((message) =>
    message.role === "assistant" && message.generationId === generationId
      ? {
          ...message,
          content: message.content + delta,
          status: message.status === "failed" || message.status === "aborted" ? message.status : "streaming",
        }
      : message,
  );
}

function markAssistantStatus(current: ChatMessageView[], generationId: string, status: ChatMessageStatus): ChatMessageView[] {
  return current.map((message) => (message.role === "assistant" && message.generationId === generationId ? { ...message, status } : message));
}

function chatMessageToView(message: ChatMessage): ChatMessageView {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    generationId: message.generationId ?? undefined,
    status: message.status,
    createdAt: message.createdAt,
  };
}

function defaultSessionView(sessionId: string): ChatSessionView {
  return {
    sessionId,
    messages: [],
    sendState: EMPTY_SEND_STATE,
    activeGenerationId: null,
    restored: false,
    historyStatus: "idle",
    historyError: null,
  };
}

function setChatSessionView(state: ChatViewState, view: ChatSessionView): ChatViewState {
  return {
    sessions: {
      ...state.sessions,
      [view.sessionId]: view,
    },
  };
}

function nextLocalMessageId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
