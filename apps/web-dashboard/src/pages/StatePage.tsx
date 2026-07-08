import { useEffect, useState } from "react";

import {
  buildStateTimelineQuery,
  currentStateEmptyText,
  currentStateSourceText,
  stateBoundaryText,
  stateStaleText,
} from "../features/state/stateModel.js";
import { ApiClientError, getJson } from "../lib/apiClient.js";
import { isStateTimelineResponse } from "../lib/guards.js";
import type { JsonObject, StateTimelineItem } from "../types.js";
import { StateCaptureForm } from "./CapturePage.js";

type Filters = {
  energy: string;
  mood: string;
  mode: string;
  limit: string;
};

const DEFAULT_FILTERS: Filters = {
  energy: "",
  mood: "",
  mode: "",
  limit: "50",
};

export function StatePage() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [current, setCurrent] = useState<StateTimelineItem | null>(null);
  const [items, setItems] = useState<StateTimelineItem[]>([]);
  const [count, setCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh(): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const query = buildStateTimelineQuery(filters);
      const response = await getJson(`/api/pkos/state-timeline${query ? `?${query}` : ""}`, isStateTimelineResponse);
      setCurrent(response.current);
      setItems(response.items);
      setCount(response.count);
    } catch (caught) {
      setMessage(caught instanceof ApiClientError ? `${caught.code}: ${caught.message}` : "State timeline refresh failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="state-page">
      <div className="panel state-summary-panel">
        <div className="panel-heading">
          <div>
            <h2>State</h2>
            <p className="subtle">{stateBoundaryText()}</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            Refresh
          </button>
        </div>
        <CurrentStateCard item={current} />
      </div>

      <div className="state-main-grid">
        <StateCaptureForm submitLabel="记录新状态快照" onWritten={() => void refresh()} />
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Timeline</h2>
              <p className="subtle">Newest first. Filters only affect the list below, not Current State.</p>
            </div>
            <span className="badge">{count} items</span>
          </div>
          <StateFilters filters={filters} onChange={setFilters} onApply={() => void refresh()} loading={loading} />
          {message ? <p className="notice">{message}</p> : null}
          <div className="state-timeline-list">
            {items.map((item) => (
              <StateTimelineRow key={item.id} item={item} />
            ))}
            {items.length === 0 ? <p className="muted">当前筛选下没有状态快照。</p> : null}
          </div>
        </section>
      </div>
    </section>
  );
}

function CurrentStateCard(props: { item: StateTimelineItem | null }) {
  if (!props.item) {
    return <p className="muted">{currentStateEmptyText()}</p>;
  }
  const staleText = stateStaleText(props.item.stale);
  return (
    <div className="current-state-card">
      <div className="review-meta">
        <span className={`badge ${props.item.stale ? "warn" : "good"}`}>{props.item.stale ? "stale" : "fresh"}</span>
        <span>{props.item.createdAt}</span>
        <span>{props.item.source || "unknown source"}</span>
      </div>
      <dl className="kv-list state-kv">
        <dt>energy</dt>
        <dd>{props.item.energy}</dd>
        <dt>mood</dt>
        <dd>{props.item.mood}</dd>
        <dt>body</dt>
        <dd>{props.item.body}</dd>
        <dt>context</dt>
        <dd>{props.item.context}</dd>
        <dt>mode</dt>
        <dd>{props.item.mode}</dd>
        <dt>risk flags</dt>
        <dd>{formatRisk(props.item.risk)}</dd>
        <dt>note</dt>
        <dd>{props.item.note || "none"}</dd>
      </dl>
      <p className="subtle">{currentStateSourceText()}</p>
      {staleText ? <p className="notice">{staleText}</p> : null}
      <p className="subtle">该记录只作为语气和回复负荷参考，不用于诊断或自动改变任务。</p>
    </div>
  );
}

function StateFilters(props: { filters: Filters; onChange: (next: Filters) => void; onApply: () => void; loading: boolean }) {
  return (
    <div className="filter-row state-filter-row">
      <label>
        energy
        <input value={props.filters.energy} onChange={(event) => props.onChange({ ...props.filters, energy: event.target.value })} />
      </label>
      <label>
        mood
        <input value={props.filters.mood} onChange={(event) => props.onChange({ ...props.filters, mood: event.target.value })} />
      </label>
      <label>
        mode
        <input value={props.filters.mode} onChange={(event) => props.onChange({ ...props.filters, mode: event.target.value })} />
      </label>
      <label>
        limit
        <input value={props.filters.limit} onChange={(event) => props.onChange({ ...props.filters, limit: event.target.value })} />
      </label>
      <button type="button" onClick={props.onApply} disabled={props.loading}>
        Apply
      </button>
    </div>
  );
}

function StateTimelineRow(props: { item: StateTimelineItem }) {
  const staleText = stateStaleText(props.item.stale);
  return (
    <article className="state-timeline-item">
      <div className="review-meta">
        <span className={`badge ${props.item.stale ? "warn" : "good"}`}>{props.item.stale ? "stale" : "fresh"}</span>
        <span>{props.item.createdAt}</span>
        <span>{props.item.source || "unknown source"}</span>
      </div>
      <dl className="kv-list compact state-kv">
        <dt>energy</dt>
        <dd>{props.item.energy}</dd>
        <dt>mood</dt>
        <dd>{props.item.mood}</dd>
        <dt>body</dt>
        <dd>{props.item.body}</dd>
        <dt>context</dt>
        <dd>{props.item.context}</dd>
        <dt>mode</dt>
        <dd>{props.item.mode}</dd>
        <dt>risk flags</dt>
        <dd>{formatRisk(props.item.risk)}</dd>
        <dt>note</dt>
        <dd>{props.item.note || "none"}</dd>
      </dl>
      {staleText ? <p className="notice">{staleText}</p> : null}
    </article>
  );
}

function formatRisk(risk: JsonObject): string {
  const enabled = Object.entries(risk)
    .filter((entry) => entry[1] === true || (typeof entry[1] === "string" && entry[1] !== "unknown"))
    .map((entry) => (entry[1] === true ? entry[0] : `${entry[0]}:${entry[1]}`));
  return enabled.length > 0 ? enabled.join(", ") : "none";
}
