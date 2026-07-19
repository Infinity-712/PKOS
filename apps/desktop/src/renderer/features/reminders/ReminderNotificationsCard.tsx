import { useEffect, useState } from "react";
import { AgentApiClientError, formatDateTime, type AgentApiClient, type RuntimeReminderNotification } from "@pkos/agent-client";

export function ReminderNotificationsCard(props: { client: AgentApiClient; connected: boolean }) {
  const [items, setItems] = useState<RuntimeReminderNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    if (!props.connected) {
      setItems([]);
      setMessage("Agent Server is not connected.");
      return;
    }
    setLoading(true);
    try {
      const response = await props.client.getRuntimeReminderNotifications({ limit: 20 });
      setItems(response.notifications);
      setMessage(null);
    } catch (error) {
      setItems([]);
      setMessage(error instanceof AgentApiClientError ? `${error.code}: ${error.message}` : "Unable to read due reminders.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [props.connected]);

  return (
    <section className="panel reminder-notifications">
      <div className="section-heading">
        <div>
          <h2>Due Reminders</h2>
          <p className="subtle">Runtime notification view only; reminder authority remains in JSONL.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          Refresh
        </button>
      </div>
      {message ? <p className="notice">{message}</p> : null}
      {items.length === 0 && !message ? <p className="muted">No due reminders.</p> : null}
      {items.length > 0 ? (
        <ul className="reminder-notification-list">
          {items.map((item) => (
            <li key={item.id}>
              <strong>{item.reminderId}</strong>
              <span>{formatDateTime(item.remindAt)}</span>
              <span className="badge warn">{item.deliveryState}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
