import { useEffect, useState } from "react";
import { Activity, Bell, BookOpen, ClipboardCheck, History, Inbox, Layers3, LayoutDashboard, ListTodo, PanelLeftClose, PanelLeftOpen, Plus, ShieldCheck, type LucideIcon } from "lucide-react";
import { LanguageSwitch, LocaleProvider, useLocale } from "./i18n/Locale.js";
import { ActionRequestsPage } from "./pages/ActionRequestsPage.js";
import { AuditPage } from "./pages/AuditPage.js";
import { CapturePage } from "./pages/CapturePage.js";
import { InboxReviewPage } from "./pages/InboxReviewPage.js";
import { ObjectsPage } from "./pages/ObjectsPage.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { RemindersPage } from "./pages/RemindersPage.js";
import { ReviewPage } from "./pages/ReviewPage.js";
import { StatePage } from "./pages/StatePage.js";
import { TasksPage } from "./pages/TasksPage.js";

export type TabId = "overview" | "capture" | "state" | "objects" | "review" | "inboxReview" | "tasks" | "reminders" | "actions" | "audit";
const TABS: Array<{ id: TabId; zh: string; en: string; icon: LucideIcon; group: number }> = [
  { id: "overview", zh: "总览", en: "Overview", icon: LayoutDashboard, group: 0 },
  { id: "objects", zh: "知识对象", en: "Objects", icon: Layers3, group: 0 },
  { id: "review", zh: "知识复习", en: "Review", icon: BookOpen, group: 0 },
  { id: "inboxReview", zh: "收件箱审阅", en: "Inbox Review", icon: Inbox, group: 0 },
  { id: "tasks", zh: "任务", en: "Tasks", icon: ListTodo, group: 1 },
  { id: "reminders", zh: "提醒", en: "Reminders", icon: Bell, group: 1 },
  { id: "state", zh: "状态记录", en: "State", icon: Activity, group: 1 },
  { id: "capture", zh: "快速记录", en: "Capture", icon: Plus, group: 1 },
  { id: "actions", zh: "操作请求", en: "Action Requests", icon: ClipboardCheck, group: 2 },
  { id: "audit", zh: "审计日志", en: "Audit", icon: History, group: 2 },
];

export function App() { return <LocaleProvider><Dashboard /></LocaleProvider>; }

function Dashboard() {
  const { t, locale } = useLocale();
  const [tab, setTab] = useState<TabId>("overview");
  const [collapsed, setCollapsed] = useState(false);
  const current = TABS.find((item) => item.id === tab)!;
  useEffect(() => { document.title = t("PKOS · 工作台", "PKOS · Workspace"); }, [locale]);
  return (
    <div className={`app-shell${collapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setTab("overview"); }} aria-label={t("PKOS 总览", "PKOS overview")}>
          <span className="brand-mark"><Layers3 size={22} strokeWidth={1.7} /></span>
          <span className="brand-copy"><strong>PKOS</strong><span>{t("私人知识工作台", "Personal workspace")}</span></span>
        </a>
        <nav className="tabs" aria-label={t("主导航", "Main navigation")}>
          {[0, 1, 2].map((group) => (
            <div className="nav-group" key={group}>
              <p className="nav-caption">{[t("知识与审阅", "KNOWLEDGE"), t("日常与行动", "DAILY"), t("治理", "GOVERNANCE")][group]}</p>
              {TABS.filter((item) => item.group === group).map(({ id, zh, en, icon: Icon }) => (
                <button key={id} data-nav={id} title={t(zh, en)} aria-current={tab === id ? "page" : undefined} className={tab === id ? "active" : ""} type="button" onClick={() => setTab(id)}>
                  <Icon size={18} strokeWidth={1.7} /><span>{t(zh, en)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer"><ShieldCheck size={17} /><span>{t("人类裁决 · 文件权威", "Human-led · File authority")}</span></div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button className="icon-button sidebar-toggle" type="button" title={t(collapsed ? "展开导航" : "收起导航", collapsed ? "Expand navigation" : "Collapse navigation")} aria-label={t(collapsed ? "展开导航" : "收起导航", collapsed ? "Expand navigation" : "Collapse navigation")} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
            <span>PKOS</span><span className="breadcrumb-divider">/</span><strong>{t(current.zh, current.en)}</strong>
          </div>
          <LanguageSwitch />
        </header>
        <main className="workspace-content" id="main-content">
          <div className="page-title"><div><p className="eyebrow">{t("我的工作台", "MY WORKSPACE")}</p><h1>{t(current.zh, current.en)}</h1></div><span className="workspace-date">{new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "long" }).format(new Date())}</span></div>
          {tab === "overview" ? <OverviewPage onNavigate={setTab} /> : null}
          {tab === "capture" ? <CapturePage /> : null}
          {tab === "state" ? <StatePage /> : null}
          {tab === "objects" ? <ObjectsPage /> : null}
          {tab === "review" ? <ReviewPage /> : null}
          {tab === "inboxReview" ? <InboxReviewPage /> : null}
          {tab === "tasks" ? <TasksPage /> : null}
          {tab === "reminders" ? <RemindersPage /> : null}
          {tab === "actions" ? <ActionRequestsPage /> : null}
          {tab === "audit" ? <AuditPage /> : null}
        </main>
      </div>
    </div>
  );
}
