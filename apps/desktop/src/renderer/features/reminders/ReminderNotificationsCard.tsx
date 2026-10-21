import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useLocale } from "../../i18n/Locale.js";
import { AgentApiClientError, formatDateTime, type AgentApiClient, type RuntimeReminderNotification } from "@pkos/agent-client";

export function ReminderNotificationsCard(props: { client: AgentApiClient; connected: boolean }) {
  const { t, label, message: translateMessage } = useLocale();
  const [items, setItems] = useState<RuntimeReminderNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | { code: string; text: string } | null>(null);

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
      setMessage(error instanceof AgentApiClientError ? { code: error.code, text: error.message } : "Unable to read due reminders.");
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
          <h2>{t("到点提醒", "Due Reminders")}</h2>
          <p className="subtle">{t("这里只展示运行时通知；提醒的权威记录仍在 JSONL 中。", "Runtime notification view only; reminder authority remains in JSONL.")}</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" /> {t("刷新", "Refresh")}
        </button>
      </div>
      {message ? <p className="notice">{typeof message === "string" ? translateMessage(message) : <>{message.code}: {translateMessage(message.text)}</>}</p> : null}
      {items.length === 0 && !message ? <p className="muted">{t("暂时没有到点提醒", "No due reminders.")}</p> : null}
      {items.length > 0 ? (
        <ul className="reminder-notification-list">
          {items.map((item) => (
            <li key={item.id}>
              <strong>{item.reminderId}</strong>
              <span>{formatDateTime(item.remindAt)}</span>
              <span className="badge warn">{label(item.deliveryState)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
