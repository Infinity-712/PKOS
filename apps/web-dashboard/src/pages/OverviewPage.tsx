import { useEffect, useState } from "react";

import { ApiClientError, getJson } from "../lib/apiClient.js";
import { isHealthResponse } from "../lib/guards.js";
import type { HealthResponse } from "../types.js";

export function OverviewPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setHealth(await getJson("/health", isHealthResponse));
    } catch (caught) {
      const message = caught instanceof ApiClientError ? caught.message : "health check failed";
      setError(message);
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-heading">
          <h2>连接状态</h2>
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            Refresh
          </button>
        </div>
        <dl className="kv-list">
          <dt>Agent Server</dt>
          <dd>
            <span className={`badge ${health?.ok ? "good" : "bad"}`}>{health?.ok ? "connected" : "disconnected"}</span>
          </dd>
          <dt>service</dt>
          <dd>{health?.service ?? "unknown"}</dd>
          <dt>mode</dt>
          <dd>{health?.mode ?? "unknown"}</dd>
          <dt>error</dt>
          <dd>{error ?? "none"}</dd>
        </dl>
      </div>

      <div className="panel">
        <h2>已启用能力</h2>
        <ul className="plain-list">
          <li>Fixed Action API</li>
          <li>Idempotency</li>
          <li>Human Resolution</li>
          <li>Audit</li>
        </ul>
      </div>

      <div className="panel">
        <h2>当前禁用</h2>
        <ul className="plain-list muted">
          <li>Real LLM</li>
          <li>Agent Tool Selection</li>
          <li>RAG</li>
          <li>Memory</li>
          <li>Task / Reminder</li>
        </ul>
      </div>
    </section>
  );
}
