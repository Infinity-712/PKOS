import { formatDateTime, type ChatSession } from "@pkos/agent-client";
import { Plus } from "lucide-react";
import { useLocale } from "../../i18n/Locale.js";

export function ChatSessionList(props: {
  sessions: ChatSession[];
  selectedId: string | null;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  disabled: boolean;
}) {
  const { t } = useLocale();
  return (
    <aside className="side-panel">
      <div className="section-heading">
        <h2>{t("最近的对话", "Conversations")}</h2>
        <button type="button" onClick={props.onCreate} disabled={props.disabled} aria-label={t("新对话", "New conversation")} title={t("新对话", "New conversation")}>
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="session-list">
        {props.sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            className={session.id === props.selectedId ? "session-row active" : "session-row"}
            onClick={() => props.onSelect(session.id)}
            aria-current={session.id === props.selectedId ? "true" : undefined}
          >
            <span>{session.title || t("新对话", "New session")}</span>
            <small>{formatDateTime(session.updated_at)}</small>
          </button>
        ))}
        {props.sessions.length === 0 ? <p className="muted">{t("还没有对话", "No conversations yet.")}</p> : null}
      </div>
    </aside>
  );
}
