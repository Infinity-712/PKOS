import { translateUiMessage } from "../i18n/copy.js";
import { useLocale } from "../i18n/Locale.js";
import { formatDateTime } from "@pkos/agent-client";
import { RefreshCw, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

import { ApiClientError, getJson } from "../lib/apiClient.js";
import { isAuditEventsResponse } from "../lib/guards.js";
import type { AuditEventView } from "../types.js";

export function AuditPage() {
  const { label: uiLabel, locale } = useLocale();
  const uiMessage = (value: string) => translateUiMessage(value, locale);
  const [items, setItems] = useState<AuditEventView[]>([]);
  const [type, setType] = useState("");
  const [severity, setSeverity] = useState("");
  const [limit, setLimit] = useState("50");
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load(before?: string): Promise<void> {
    setMessage(null);
    const params = new URLSearchParams();
    if (type.trim()) {
      params.set("type", type.trim());
    }
    if (severity.trim()) {
      params.set("severity", severity.trim());
    }
    params.set("limit", limit.trim() || "50");
    if (before) {
      params.set("before", before);
    }
    try {
      const response = await getJson(`/api/audit/events?${params.toString()}`, isAuditEventsResponse);
      setItems(before ? [...items, ...response.items] : response.items);
      setNextBefore(response.nextBefore);
    } catch (caught) {
      setMessage(caught instanceof ApiClientError ? `${caught.code}: ${caught.message}` : "audit request failed");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{uiLabel("Audit Events")}</h2>
        <button type="button" onClick={() => void load()}>
          <RefreshCw size={16} aria-hidden="true" />{uiLabel("Refresh")}
        </button>
      </div>
      <div className="filter-row">
        <label>
          {uiLabel("type")}
          <input value={type} onChange={(event) => setType(event.target.value)} />
        </label>
        <label>
          {uiLabel("severity")}
          <input value={severity} onChange={(event) => setSeverity(event.target.value)} />
        </label>
        <label>
          {uiLabel("limit")}
          <input value={limit} onChange={(event) => setLimit(event.target.value)} />
        </label>
      </div>
      {message ? <p className="notice">{uiMessage(message)}</p> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{uiLabel("ts")}</th>
              <th>{uiLabel("type")}</th>
              <th>{uiLabel("severity")}</th>
              <th>{uiLabel("sessionId")}</th>
              <th>{uiLabel("generationId")}</th>
              <th>{uiLabel("payloadSummary")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{formatDateTime(item.ts)}</td>
                <td>{uiLabel(item.type)}</td>
                <td>{uiLabel(item.severity)}</td>
                <td>{item.sessionId ?? uiLabel("none")}</td>
                <td>{item.generationId ?? uiLabel("none")}</td>
                <td>{Object.keys(item.payloadSummary).length === 0 ? uiLabel("无可公开的摘要字段") : summaryText(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" disabled={!nextBefore} onClick={() => nextBefore && void load(nextBefore)}>
        <ChevronDown size={16} aria-hidden="true" />{uiLabel("Load earlier")}
      </button>
    </section>
  );
}

function summaryText(item: AuditEventView): string {
  if (Object.keys(item.payloadSummary).length === 0) {
    return "无可公开的摘要字段";
  }
  return JSON.stringify(item.payloadSummary);
}
