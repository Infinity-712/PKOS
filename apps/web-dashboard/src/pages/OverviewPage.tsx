import { useEffect, useState } from "react";
import { ArrowUpRight, BookOpen, Inbox, Layers3, ListTodo, RefreshCw, Server, ShieldCheck } from "lucide-react";
import type { TabId } from "../App.js";
import { useLocale } from "../i18n/Locale.js";
import { ApiClientError, getJson } from "../lib/apiClient.js";
import { isHealthResponse } from "../lib/guards.js";
import type { HealthResponse } from "../types.js";

export function OverviewPage({ onNavigate }: { onNavigate?: (tab: TabId) => void }) {
  const { t } = useLocale();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function refresh() {
    setLoading(true);
    setError(null);
    try { setHealth(await getJson("/health", isHealthResponse)); }
    catch (caught) { setError(caught instanceof ApiClientError ? caught.code : "unavailable"); setHealth(null); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  const entries = [
    { id: "objects" as const, icon: Layers3, zh: "知识对象", en: "Knowledge objects", detail: t("事实、技能、主张与创作", "Facts, skills, claims & creative work"), number: "01" },
    { id: "review" as const, icon: BookOpen, zh: "知识复习", en: "Knowledge review", detail: t("每日与每周复习", "Daily & weekly review"), number: "02" },
    { id: "inboxReview" as const, icon: Inbox, zh: "收件箱审阅", en: "Inbox review", detail: t("待整理的记录与灵感", "Captures & ideas to consider"), number: "03" },
    { id: "tasks" as const, icon: ListTodo, zh: "任务", en: "Tasks", detail: t("由你确认的行动", "Actions you have chosen"), number: "04" },
  ];
  return (
    <div className="overview-layout">
      <section className="overview-work">
        <div className="section-heading"><h2>{t("从这里继续", "Pick up where you left off")}</h2><span className="subtle">{t("知识 · 行动 · 回顾", "KNOWLEDGE · ACTION · REFLECTION")}</span></div>
        <div className="workspace-entries">{entries.map(({ id, icon: Icon, zh, en, detail, number }) => (
          <button className={`workspace-entry entry-${id}`} type="button" key={id} onClick={() => onNavigate?.(id)}>
            <span className="entry-number">{number}</span><span className="entry-icon"><Icon size={23} strokeWidth={1.6} /></span>
            <span className="entry-copy"><strong>{t(zh, en)}</strong><span>{detail}</span></span><ArrowUpRight size={19} />
          </button>
        ))}</div>
        <div className="authority-note"><ShieldCheck size={20} /><div><strong>{t("最终裁决，始终在你", "The final judgment is yours")}</strong><p>{t("Agent Runtime 不替代知识权威层。", "Agent Runtime does not replace knowledge authority.")}</p></div></div>
      </section>
      <section className="connection-panel">
        <div className="section-heading"><h2><Server size={17} />{t("本地服务", "Local service")}</h2><button className="icon-button" type="button" title={t("刷新连接", "Refresh connection")} aria-label={t("刷新连接", "Refresh connection")} onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} className={loading ? "spinning" : ""} /></button></div>
        <div className={`connection-state ${health?.ok ? "connected" : "disconnected"}`}><span className="status-dot" /><strong>{loading ? t("正在连接", "Connecting") : health?.ok ? t("已连接", "Connected") : t("未连接", "Disconnected")}</strong></div>
        <p className="subtle">PKOS Agent Server</p>
        {error ? <p className="notice">{t("无法连接本地服务，请检查服务状态。", "Cannot reach the local service. Check its status.")} <code>{error}</code></p> : null}
        <dl className="service-facts">
          <div><dt>{t("API 契约", "API contract")}</dt><dd>{health?.apiContractVersion ?? t("未知", "Unknown")}</dd></div>
          <div><dt>{t("数据库兼容性", "DB compatibility")}</dt><dd>{!health ? t("未知", "Unknown") : health.databaseCompatible === false ? t("需要更新", "Needs update") : t("兼容", "Compatible")}</dd></div>
          <div><dt>{t("运行模式", "Runtime mode")}</dt><dd>{health?.mode ?? t("未知", "Unknown")}</dd></div>
        </dl>
        <details className="service-details"><summary>{t("构建信息", "Build details")}</summary><dl className="kv-list compact"><dt>{t("服务", "Service")}</dt><dd>{health?.service ?? t("未知", "Unknown")}</dd><dt>{t("构建指纹", "Build")}</dt><dd><code>{health?.serviceBuildFingerprint ?? t("未知", "Unknown")}</code></dd></dl></details>
      </section>
    </div>
  );
}
