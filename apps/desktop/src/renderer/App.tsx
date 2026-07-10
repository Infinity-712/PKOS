import { useEffect, useMemo, useState } from "react";
import { AgentApiClient, AgentApiClientError, type HealthResponse, type StateTimelineItem } from "@pkos/agent-client";
import { agentServerBaseUrl } from "./config.js";
import { backendStatusFromHealth, EMPTY_CHAT_VIEW_STATE, getChatSessionView, hydrateSessionMessages, type ChatViewState } from "./features/chat/chatModel.js";
import { AgentPage } from "./pages/AgentPage.js";
import { CapturePage } from "./pages/CapturePage.js";
import { StatusPage } from "./pages/StatusPage.js";

type TabId = "agent" | "capture" | "status";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "agent", label: "Agent" },
  { id: "capture", label: "Quick Capture" },
  { id: "status", label: "Status" },
];

export function App() {
  const client = useMemo(() => new AgentApiClient({ baseUrl: agentServerBaseUrl }), []);
  const [tab, setTab] = useState<TabId>("agent");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [currentState, setCurrentState] = useState<StateTimelineItem | null>(null);
  const [chatState, setChatState] = useState<ChatViewState>(EMPTY_CHAT_VIEW_STATE);
  const [selectedChatSessionId, setSelectedChatSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const backend = backendStatusFromHealth(health);

  async function refreshStatus(): Promise<void> {
    try {
      const nextHealth = await client.health();
      setHealth(nextHealth);
      setMessage(null);
    } catch (error) {
      setHealth(null);
      setCurrentState(null);
      setMessage(networkMessage(error));
      return;
    }

    try {
      const timeline = await client.getStateTimeline({ limit: 1 });
      setCurrentState(timeline.current);
    } catch {
      setCurrentState(null);
      setMessage("Connected to PKOS Agent Server, but current state is unavailable.");
    }
  }

  async function openDashboard(): Promise<void> {
    await window.pkosDesktop.openDashboard();
  }

  useEffect(() => {
    const probe = desktopProbeMode();
    if (probe === "connectivity") {
      void runDesktopConnectivityProbe(client);
      return;
    }
    if (probe === "chat-history") {
      void runDesktopChatHistoryConnectivityProbe(client);
      return;
    }
    void refreshStatus();
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>PKOS Desktop</h1>
          <p>Daily interaction surface. Web Dashboard remains the authority management surface.</p>
        </div>
        <div className="topbar-actions">
          <span className={backend.connected ? "badge good" : "badge bad"}>{backend.label}</span>
          <button type="button" onClick={() => void openDashboard()}>
            Open Web Dashboard
          </button>
        </div>
      </header>

      <nav className="tabs" aria-label="Desktop tabs">
        {TABS.map((item) => (
          <button key={item.id} className={tab === item.id ? "active" : ""} type="button" onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>

      {message ? <p className="notice">{message}</p> : null}
      {tab === "agent" ? (
        <AgentPage
          client={client}
          connected={backend.connected}
          chatState={chatState}
          setChatState={setChatState}
          selectedId={selectedChatSessionId}
          onSelectedIdChange={setSelectedChatSessionId}
        />
      ) : null}
      {tab === "capture" ? <CapturePage client={client} onStateWritten={() => void refreshStatus()} /> : null}
      {tab === "status" ? <StatusPage health={health} current={currentState} onRefresh={() => void refreshStatus()} /> : null}
    </main>
  );
}

function desktopProbeMode(): "connectivity" | "chat-history" | null {
  const params = new URLSearchParams(window.location.search);
  if (params.has("pkos-chat-history-connectivity-probe")) {
    return "chat-history";
  }
  if (params.has("pkos-connectivity-probe")) {
    return "connectivity";
  }
  return null;
}

async function runDesktopConnectivityProbe(client: AgentApiClient): Promise<void> {
  try {
    const diagnostics = await client.healthWithDiagnostics();
    const connected = backendStatusFromHealth(diagnostics.health).connected;
    if (!connected) {
      throw new Error("health_invalid_response");
    }
    console.log(
      `DESKTOP_CONNECTIVITY_PROBE_OK ${JSON.stringify({
        rendererOrigin: window.location.origin,
        rendererProtocol: window.location.protocol,
        resolvedHealthUrl: diagnostics.requestUrl,
        status: diagnostics.status,
        receivedOrigin: diagnostics.receivedOrigin,
        connected,
      })}`,
    );
  } catch (error) {
    console.log(
      `DESKTOP_CONNECTIVITY_PROBE_FAILED ${JSON.stringify({
        rendererOrigin: window.location.origin,
        rendererProtocol: window.location.protocol,
        code: connectivityFailureCode(error),
      })}`,
    );
  }
}

async function runDesktopChatHistoryConnectivityProbe(client: AgentApiClient): Promise<void> {
  try {
    const sessions = await client.listChatSessions();
    let selected: { sessionId: string; history: Awaited<ReturnType<AgentApiClient["getSessionMessages"]>> } | null = null;
    for (const session of sessions.sessions) {
      const history = await client.getSessionMessages(session.id, { limit: 100 });
      if (history.items.length > 0) {
        selected = { sessionId: session.id, history };
        break;
      }
    }
    if (!selected) {
      throw new Error("session_not_found");
    }
    let state = hydrateSessionMessages(EMPTY_CHAT_VIEW_STATE, selected.sessionId, selected.history.items);
    const view = getChatSessionView(state, selected.sessionId);
    if (view.messages.length !== selected.history.items.length || view.historyStatus !== "loaded") {
      throw new Error("hydrate_failed");
    }
    console.log(
      `DESKTOP_CHAT_HISTORY_CONNECTIVITY_PROBE_OK ${JSON.stringify({
        rendererOrigin: window.location.origin,
        rendererProtocol: window.location.protocol,
        sessionPrefix: selected.sessionId.slice(0, 8),
        itemCount: selected.history.items.length,
        topLevelFields: Object.keys(selected.history).sort(),
        firstItemFields: selected.history.items[0] ? Object.keys(selected.history.items[0]).sort() : [],
      })}`,
    );
    state = EMPTY_CHAT_VIEW_STATE;
    void state;
  } catch (error) {
    console.log(
      `DESKTOP_CHAT_HISTORY_CONNECTIVITY_PROBE_FAILED ${JSON.stringify({
        rendererOrigin: window.location.origin,
        rendererProtocol: window.location.protocol,
        code: chatHistoryProbeFailureCode(error),
      })}`,
    );
  }
}

function networkMessage(error: unknown): string {
  const code = connectivityFailureCode(error);
  if (code === "server_unreachable") {
    return "Unable to connect to PKOS Agent Server. Please confirm the local service is running.";
  }
  if (code === "cors_or_origin_rejected") {
    return "Desktop request did not pass the local service security boundary.";
  }
  if (code === "invalid_health_response") {
    return "Agent Server returned an unrecognized health status.";
  }
  return "Unable to confirm Agent Server status.";
}

function connectivityFailureCode(error: unknown): "server_unreachable" | "cors_or_origin_rejected" | "invalid_health_response" | "unknown_network_error" {
  if (error instanceof AgentApiClientError) {
    if (error.status === 0) {
      return error.message.toLowerCase().includes("cors") ? "cors_or_origin_rejected" : "server_unreachable";
    }
    if (error.code === "invalid_response") {
      return "invalid_health_response";
    }
  }
  if (error instanceof Error && error.message === "health_invalid_response") {
    return "invalid_health_response";
  }
  return "unknown_network_error";
}

function chatHistoryProbeFailureCode(error: unknown): "route_not_found" | "session_not_found" | "invalid_response" | "cors_rejected" | "server_error" | "hydrate_failed" | "server_unreachable" | "unknown" {
  if (error instanceof AgentApiClientError) {
    if (error.status === 0) {
      return error.message.toLowerCase().includes("cors") ? "cors_rejected" : "server_unreachable";
    }
    if (error.status === 404 && error.code === "NOT_FOUND") {
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
  if (error instanceof Error) {
    if (error.message === "session_not_found") {
      return "session_not_found";
    }
    if (error.message === "hydrate_failed") {
      return "hydrate_failed";
    }
  }
  return "unknown";
}
