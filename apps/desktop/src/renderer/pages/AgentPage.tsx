import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AgentApiClientError, type AgentApiClient, type ChatSession, type ProviderProfilesResponse, type ProviderStatusResponse } from "@pkos/agent-client";
import { ChatPanel } from "../features/chat/ChatPanel.js";
import { ChatSessionList } from "../features/chat/ChatSessionList.js";
import { getChatSessionView, hydrateSessionMessages, setSessionHistoryError, setSessionHistoryLoading, type ChatViewState } from "../features/chat/chatModel.js";

type ChatHistoryLoadErrorCode =
  | "server_unreachable"
  | "route_not_found"
  | "session_not_found"
  | "invalid_response"
  | "cors_or_origin_rejected"
  | "request_aborted"
  | "server_error"
  | "unknown";

export function AgentPage(props: {
  client: AgentApiClient;
  connected: boolean;
  chatState: ChatViewState;
  setChatState: Dispatch<SetStateAction<ChatViewState>>;
  selectedId: string | null;
  onSelectedIdChange: (sessionId: string | null) => void;
}) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [providerStatus, setProviderStatus] = useState<ProviderStatusResponse | null>(null);
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfilesResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const historyRequestSeq = useRef<Record<string, number>>({});
  const selectedSession = sessions.find((session) => session.id === props.selectedId) ?? null;
  const selectedView = getChatSessionView(props.chatState, props.selectedId);

  async function refresh(): Promise<void> {
    if (!props.connected) {
      return;
    }
    try {
      const [response, provider, profiles] = await Promise.all([props.client.listChatSessions(), props.client.getProviderStatus(), props.client.getProviderProfiles()]);
      setSessions(response.sessions);
      setProviderStatus(provider);
      setProviderProfiles(profiles);
      const selectedStillExists = props.selectedId ? response.sessions.some((session) => session.id === props.selectedId) : false;
      props.onSelectedIdChange(selectedStillExists ? props.selectedId : response.sessions[0]?.id ?? null);
      setMessage(null);
    } catch {
      setMessage("Unable to load sessions or provider status.");
    }
  }

  async function refreshProviderStatus(): Promise<void> {
    if (!props.connected) {
      return;
    }
    try {
      setProviderStatus(await props.client.getProviderStatus());
      setMessage(null);
    } catch {
      setMessage("Unable to refresh provider status.");
    }
  }

  async function createSession(): Promise<string | null> {
    if (!props.connected) {
      setMessage("Please start PKOS Agent Server first.");
      return null;
    }
    try {
      const response = await props.client.createChatSession({ title: "Desktop session" });
      setSessions((current) => [response.session, ...current]);
      props.onSelectedIdChange(response.session.id);
      setMessage(null);
      return response.session.id;
    } catch {
      setMessage("Unable to create session.");
      return null;
    }
  }

  useEffect(() => {
    void refresh();
  }, [props.connected]);

  useEffect(() => {
    if (!props.connected || !props.selectedId) {
      return;
    }
    const view = getChatSessionView(props.chatState, props.selectedId);
    if (view.restored || view.sendState.active || view.historyStatus === "loading" || view.historyStatus === "error") {
      return;
    }
    void refreshSessionMessages(props.selectedId);
  }, [props.connected, props.selectedId, props.chatState]);

  async function refreshSessionMessages(sessionId: string): Promise<void> {
    const requestId = (historyRequestSeq.current[sessionId] ?? 0) + 1;
    historyRequestSeq.current = { ...historyRequestSeq.current, [sessionId]: requestId };
    props.setChatState((current) => setSessionHistoryLoading(current, sessionId));
    try {
      const history = await props.client.getSessionMessages(sessionId);
      if (historyRequestSeq.current[sessionId] !== requestId) {
        return;
      }
      props.setChatState((current) => hydrateSessionMessages(current, sessionId, history.items));
      setMessage(null);
    } catch (error) {
      if (historyRequestSeq.current[sessionId] !== requestId) {
        return;
      }
      const code = classifyChatHistoryLoadError(error);
      logChatHistoryLoadFailure(sessionId, code, error);
      props.setChatState((current) => setSessionHistoryError(current, sessionId, `Unable to read this session's history messages. Error code: ${code}`));
    }
  }

  return (
    <section className="split-page">
      <ChatSessionList sessions={sessions} selectedId={props.selectedId} onSelect={props.onSelectedIdChange} onCreate={() => void createSession()} disabled={!props.connected} />
      <ChatPanel
        client={props.client}
        session={selectedSession}
        sessionView={selectedView}
        setChatState={props.setChatState}
        onNeedsSession={createSession}
        providerStatus={providerStatus}
        providerProfiles={providerProfiles}
        onProviderStatus={setProviderStatus}
        onRefreshProviderStatus={refreshProviderStatus}
        onRefreshSessionMessages={refreshSessionMessages}
      />
      {message ? <p className="notice">{message}</p> : null}
    </section>
  );
}

function classifyChatHistoryLoadError(error: unknown): ChatHistoryLoadErrorCode {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "request_aborted";
  }
  if (error instanceof AgentApiClientError) {
    if (error.status === 0) {
      return error.message.toLowerCase().includes("cors") ? "cors_or_origin_rejected" : "server_unreachable";
    }
    if (error.status === 404 && (error.code === "NOT_FOUND" || error.code === "route_not_found")) {
      return "route_not_found";
    }
    if (error.status === 404 && error.code === "SESSION_NOT_FOUND") {
      return "session_not_found";
    }
    if (error.code === "invalid_response") {
      return "invalid_response";
    }
    if (error.status >= 500) {
      return "server_error";
    }
  }
  return "unknown";
}

function logChatHistoryLoadFailure(sessionId: string, code: ChatHistoryLoadErrorCode, error: unknown): void {
  const status = error instanceof AgentApiClientError ? error.status : null;
  const errorCode = error instanceof AgentApiClientError ? error.code : error instanceof Error ? error.name : "unknown";
  console.warn(
    "pkos_desktop_chat_history_load_failed",
    JSON.stringify({
      operation: "get_session_messages",
      sessionPrefix: sessionId.slice(0, 8),
      code,
      httpStatus: status,
      errorCode,
    }),
  );
}
