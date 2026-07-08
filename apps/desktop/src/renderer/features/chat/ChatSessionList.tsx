import type { ChatSession } from "@pkos/agent-client";

export function ChatSessionList(props: {
  sessions: ChatSession[];
  selectedId: string | null;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  disabled: boolean;
}) {
  return (
    <aside className="side-panel">
      <div className="section-heading">
        <h2>Sessions</h2>
        <button type="button" onClick={props.onCreate} disabled={props.disabled}>
          New
        </button>
      </div>
      <div className="session-list">
        {props.sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            className={session.id === props.selectedId ? "session-row active" : "session-row"}
            onClick={() => props.onSelect(session.id)}
          >
            <span>{session.title || "New session"}</span>
            <small>{session.updated_at}</small>
          </button>
        ))}
        {props.sessions.length === 0 ? <p className="muted">No sessions yet.</p> : null}
      </div>
    </aside>
  );
}
