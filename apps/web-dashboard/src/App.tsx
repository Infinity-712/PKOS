import { useState } from "react";

import { ActionRequestsPage } from "./pages/ActionRequestsPage.js";
import { AuditPage } from "./pages/AuditPage.js";
import { CapturePage } from "./pages/CapturePage.js";
import { InboxReviewPage } from "./pages/InboxReviewPage.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { RemindersPage } from "./pages/RemindersPage.js";
import { ReviewPage } from "./pages/ReviewPage.js";
import { StatePage } from "./pages/StatePage.js";
import { TasksPage } from "./pages/TasksPage.js";

type TabId = "overview" | "capture" | "state" | "review" | "inboxReview" | "tasks" | "reminders" | "actions" | "audit";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "capture", label: "Capture" },
  { id: "state", label: "State" },
  { id: "review", label: "Review" },
  { id: "inboxReview", label: "Inbox Review" },
  { id: "tasks", label: "Tasks" },
  { id: "reminders", label: "Reminders" },
  { id: "actions", label: "Action Requests" },
  { id: "audit", label: "Audit" },
];

export function App() {
  const [tab, setTab] = useState<TabId>("overview");

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>PKOS Agent Operations</h1>
          <p>Agent Runtime 数据与审计不是 PKOS trusted authority。</p>
        </div>
        <span className="build-marker">dev:{import.meta.env.MODE}</span>
      </header>

      <nav className="tabs" aria-label="Dashboard tabs">
        {TABS.map((item) => (
          <button key={item.id} className={tab === item.id ? "active" : ""} type="button" onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "overview" ? <OverviewPage /> : null}
      {tab === "capture" ? <CapturePage /> : null}
      {tab === "state" ? <StatePage /> : null}
      {tab === "review" ? <ReviewPage /> : null}
      {tab === "inboxReview" ? <InboxReviewPage /> : null}
      {tab === "tasks" ? <TasksPage /> : null}
      {tab === "reminders" ? <RemindersPage /> : null}
      {tab === "actions" ? <ActionRequestsPage /> : null}
      {tab === "audit" ? <AuditPage /> : null}
    </main>
  );
}
