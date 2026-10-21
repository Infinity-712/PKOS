import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, Layers3, MessageCircle, PenLine } from "lucide-react";
import { LanguageSwitch, LocaleProvider, useLocale } from "./i18n/Locale.js";
import { AgentApiClient, AgentApiClientError, type HealthResponse, type RuntimeInfoResponse, type StateTimelineItem } from "@pkos/agent-client";
import { agentServerBaseUrl } from "./config.js";
import { backendStatusFromHealth, EMPTY_CHAT_VIEW_STATE, getChatSessionView, hydrateSessionMessages, type ChatViewState } from "./features/chat/chatModel.js";
import { AgentPage } from "./pages/AgentPage.js";
import { CapturePage } from "./pages/CapturePage.js";
import { StatusPage } from "./pages/StatusPage.js";

type TabId = "agent" | "capture" | "status";

export function App() {
  return <LocaleProvider><Desktop /></LocaleProvider>;
}

function Desktop() {
  const { t, locale } = useLocale();
  const TABS = [
    { id: "agent" as const, label: t("聊一聊", "Chat"), icon: MessageCircle },
    { id: "capture" as const, label: t("记下来", "Capture"), icon: PenLine },
    { id: "status" as const, label: t("此刻", "Status"), icon: Activity },
  ];
  const client = useMemo(() => new AgentApiClient({ baseUrl: agentServerBaseUrl }), []);
  const [tab, setTab] = useState<TabId>("agent");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfoResponse | null>(null);
  const [currentState, setCurrentState] = useState<StateTimelineItem | null>(null);
  const [chatState, setChatState] = useState<ChatViewState>(EMPTY_CHAT_VIEW_STATE);
  const [selectedChatSessionId, setSelectedChatSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const backend = backendStatusFromHealth(health);
  useEffect(() => { document.title = t("PKOS · 日常", "PKOS · Daily"); }, [locale]);

  async function refreshStatus(): Promise<void> {
    try {
      const nextHealth = await client.health();
      setHealth(nextHealth);
      setMessage(null);
    } catch (error) {
      setHealth(null);
      setRuntimeInfo(null);
      setCurrentState(null);
      setMessage(networkMessage(error));
      return;
    }

    try {
      setRuntimeInfo(await client.getRuntimeInfo());
    } catch {
      setRuntimeInfo(null);
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
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Layers3 size={23} strokeWidth={1.6} /></span><div><strong>PKOS</strong><span>{t("留一点空间，给自己。", "A little space for yourself.")}</span></div></div>
        <nav className="tabs" aria-label={t("日常导航", "Desktop tabs")}>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} data-nav={id} aria-current={tab === id ? "page" : undefined} className={tab === id ? "active" : ""} type="button" onClick={() => setTab(id)}><Icon size={17} strokeWidth={1.7} />{label}</button>
          ))}
        </nav>
        <div className="topbar-actions">
          <LanguageSwitch />
          <button className="dashboard-link" type="button" title={t("打开 Web 工作台", "Open Web Dashboard")} onClick={() => void openDashboard()}>{t("工作台", "Workspace")}<ArrowUpRight size={16} /></button>
        </div>
      </header>
      <div className="runtime-strip"><span className={backend.connected ? "connection-label good" : "connection-label bad"}><span className="status-dot" />{backend.connected ? t("本地服务已连接", "Local service connected") : t("本地服务未连接", "Local service disconnected")}</span><RuntimeIdentityBadge health={health} runtimeInfo={runtimeInfo} /></div>
      <main className={`daily-content daily-${tab}`}>
      {message ? <p className="notice">{locale === "en" ? message : desktopMessage(message)}</p> : null}
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
      {tab === "status" ? <StatusPage client={client} health={health} runtimeInfo={runtimeInfo} current={currentState} onRefresh={() => void refreshStatus()} /> : null}
      </main>
    </div>
  );
}

function RuntimeIdentityBadge(props: { health: HealthResponse | null; runtimeInfo: RuntimeInfoResponse | null }) {
  const { t } = useLocale();
  if (!props.runtimeInfo) {
    return <span className="badge warn">{t("运行实例身份不可用", "Runtime identity unavailable")}</span>;
  }
  const mismatch =
    typeof props.health?.runtimeFingerprint === "string" &&
    props.health.runtimeFingerprint !== props.runtimeInfo.runtimeFingerprint;
  const serviceBuildMismatch =
    typeof props.health?.serviceBuildFingerprint === "string" &&
    props.health.serviceBuildFingerprint !== props.runtimeInfo.service.buildFingerprint;
  const staleService = serviceBuildMismatch || props.runtimeInfo.database.compatible === false || props.health?.databaseCompatible === false;
  return (
    <span
      className={mismatch || staleService ? "badge bad runtime-mismatch" : "badge good"}
      title={mismatch ? t("运行实例指纹与健康检查不一致。", "Connected runtime fingerprint does not match health response.") : staleService ? t("Agent Server 构建或数据结构已过时。", "Connected Agent Server build or schema is stale.") : t("已连接的运行实例", "Connected runtime identity")}
    >
      {t("运行实例：", "Runtime:")} {props.runtimeInfo.profileName} / {props.runtimeInfo.dataRoot.label} / {props.runtimeInfo.runtimeFingerprint.slice(0, 8)}
    </span>
  );
}

function desktopMessage(message: string): string {
  const known: Record<string, string> = {
    "Connected to PKOS Agent Server, but current state is unavailable.": "已连接本地服务，但当前状态暂不可用。",
    "Unable to connect to PKOS Agent Server. Please confirm the local service is running.": "无法连接 PKOS Agent Server，请确认本地服务已启动。",
    "Desktop request did not pass the local service security boundary.": "桌面请求未通过本地服务安全检查。",
    "Agent Server returned an unrecognized health status.": "本地服务返回了无法识别的健康状态。",
    "Unable to confirm Agent Server status.": "暂时无法确认本地服务状态。",
  };
  return known[message] ?? message;
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
