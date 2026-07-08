import { useEffect, useMemo, useState } from "react";
import { AgentApiClient, AgentApiClientError, type HealthResponse, type StateTimelineItem } from "@pkos/agent-client";
import { agentServerBaseUrl } from "./config.js";
import { backendStatusFromHealth } from "./features/chat/chatModel.js";
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
    if (isConnectivityProbe()) {
      void runDesktopConnectivityProbe(client);
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
      {tab === "agent" ? <AgentPage client={client} connected={backend.connected} /> : null}
      {tab === "capture" ? <CapturePage client={client} onStateWritten={() => void refreshStatus()} /> : null}
      {tab === "status" ? <StatusPage health={health} current={currentState} onRefresh={() => void refreshStatus()} /> : null}
    </main>
  );
}

function isConnectivityProbe(): boolean {
  return new URLSearchParams(window.location.search).has("pkos-connectivity-probe");
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
