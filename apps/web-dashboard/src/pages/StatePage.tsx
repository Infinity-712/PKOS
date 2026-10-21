import { translateUiMessage } from "../i18n/copy.js";
import { useLocale } from "../i18n/Locale.js";
import { RefreshCw, Filter } from "lucide-react";
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
  const { label: uiLabel, locale } = useLocale();
  const uiMessage = (value: string) => translateUiMessage(value, locale);
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
            <h2>{uiLabel("State")}</h2>
            <p className="subtle">{uiLabel(stateBoundaryText())}</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={16} aria-hidden="true" />{uiLabel("Refresh")}
          </button>
        </div>
        <CurrentStateCard item={current} />
      </div>

      <div className="state-main-grid">
        <StateCaptureForm submitLabel={uiLabel("记录新状态快照")} onWritten={() => void refresh()} />
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{uiLabel("Timeline")}</h2>
              <p className="subtle">{uiLabel("Newest first. Filters only affect the list below, not Current State.")}</p>
            </div>
            <span className="badge">{count} {uiLabel("items")}</span>
          </div>
          <StateFilters filters={filters} onChange={setFilters} onApply={() => void refresh()} loading={loading} />
          {message ? <p className="notice">{uiMessage(message)}</p> : null}
          <div className="state-timeline-list">
            {items.map((item) => (
              <StateTimelineRow key={item.id} item={item} />
            ))}
            {items.length === 0 ? <p className="muted">{uiLabel("当前筛选下没有状态快照。")}</p> : null}
          </div>
        </section>
      </div>
    </section>
  );
}

function CurrentStateCard(props: { item: StateTimelineItem | null }) {
  const { label: uiLabel, locale } = useLocale();
  const uiMessage = (value: string) => translateUiMessage(value, locale);
  if (!props.item) {
    return <p className="muted">{uiLabel(currentStateEmptyText())}</p>;
  }
  const staleText = stateStaleText(props.item.stale);
  return (
    <div className="current-state-card">
      <div className="review-meta">
        <span className={`badge ${props.item.stale ? "warn" : "good"}`}>{props.item.stale ? uiLabel("stale") : uiLabel("fresh")}</span>
        <span>{props.item.createdAt}</span>
        <span>{props.item.source || uiLabel("unknown source")}</span>
      </div>
      <dl className="kv-list state-kv">
        <dt>{uiLabel("energy")}</dt>
        <dd>{uiLabel(props.item.energy)}</dd>
        <dt>{uiLabel("mood")}</dt>
        <dd>{uiLabel(props.item.mood)}</dd>
        <dt>{uiLabel("body")}</dt>
        <dd>{uiLabel(props.item.body)}</dd>
        <dt>{uiLabel("context")}</dt>
        <dd>{uiLabel(props.item.context)}</dd>
        <dt>{uiLabel("mode")}</dt>
        <dd>{uiLabel(props.item.mode)}</dd>
        <dt>{uiLabel("risk flags")}</dt>
        <dd>{formatRisk(props.item.risk, uiLabel)}</dd>
        <dt>{uiLabel("note")}</dt>
        <dd>{props.item.note || uiLabel("none")}</dd>
      </dl>
      <p className="subtle">{uiLabel(currentStateSourceText())}</p>
      {staleText ? <p className="notice">{uiMessage(staleText)}</p> : null}
      <p className="subtle">{uiLabel("该记录只作为语气和回复负荷参考，不用于诊断或自动改变任务。")}</p>
    </div>
  );
}

function StateFilters(props: { filters: Filters; onChange: (next: Filters) => void; onApply: () => void; loading: boolean }) {
  const { label: uiLabel } = useLocale();
  return (
    <div className="filter-row state-filter-row">
      <label>
        {uiLabel("energy")}
        <input value={props.filters.energy} onChange={(event) => props.onChange({ ...props.filters, energy: event.target.value })} />
      </label>
      <label>
        {uiLabel("mood")}
        <input value={props.filters.mood} onChange={(event) => props.onChange({ ...props.filters, mood: event.target.value })} />
      </label>
      <label>
        {uiLabel("mode")}
        <input value={props.filters.mode} onChange={(event) => props.onChange({ ...props.filters, mode: event.target.value })} />
      </label>
      <label>
        {uiLabel("limit")}
        <input value={props.filters.limit} onChange={(event) => props.onChange({ ...props.filters, limit: event.target.value })} />
      </label>
      <button type="button" onClick={props.onApply} disabled={props.loading}>
        <Filter size={16} aria-hidden="true" />{uiLabel("Apply")}
      </button>
    </div>
  );
}

function StateTimelineRow(props: { item: StateTimelineItem }) {
  const { label: uiLabel, locale } = useLocale();
  const uiMessage = (value: string) => translateUiMessage(value, locale);
  const staleText = stateStaleText(props.item.stale);
  return (
    <article className="state-timeline-item">
      <div className="review-meta">
        <span className={`badge ${props.item.stale ? "warn" : "good"}`}>{props.item.stale ? uiLabel("stale") : uiLabel("fresh")}</span>
        <span>{props.item.createdAt}</span>
        <span>{props.item.source || uiLabel("unknown source")}</span>
      </div>
      <dl className="kv-list compact state-kv">
        <dt>{uiLabel("energy")}</dt>
        <dd>{uiLabel(props.item.energy)}</dd>
        <dt>{uiLabel("mood")}</dt>
        <dd>{uiLabel(props.item.mood)}</dd>
        <dt>{uiLabel("body")}</dt>
        <dd>{uiLabel(props.item.body)}</dd>
        <dt>{uiLabel("context")}</dt>
        <dd>{uiLabel(props.item.context)}</dd>
        <dt>{uiLabel("mode")}</dt>
        <dd>{uiLabel(props.item.mode)}</dd>
        <dt>{uiLabel("risk flags")}</dt>
        <dd>{formatRisk(props.item.risk, uiLabel)}</dd>
        <dt>{uiLabel("note")}</dt>
        <dd>{props.item.note || uiLabel("none")}</dd>
      </dl>
      {staleText ? <p className="notice">{uiMessage(staleText)}</p> : null}
    </article>
  );
}

function formatRisk(risk: JsonObject, label: (value: string) => string): string {
  const enabled = Object.entries(risk)
    .filter((entry) => entry[1] === true || (typeof entry[1] === "string" && entry[1] !== "unknown"))
    .map((entry) => (entry[1] === true ? label(entry[0]) : `${label(entry[0])}:${label(String(entry[1]))}`));
  return enabled.length > 0 ? enabled.join(", ") : label("none");
}
