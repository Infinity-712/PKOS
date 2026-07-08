import type { HealthResponse, StateTimelineItem } from "@pkos/agent-client";
import { backendStatusFromHealth } from "../features/chat/chatModel.js";
import { CurrentStateCard } from "../features/state/CurrentStateCard.js";

export function StatusPage(props: { health: HealthResponse | null; current: StateTimelineItem | null; onRefresh: () => void }) {
  const status = backendStatusFromHealth(props.health);
  return (
    <section className="page-grid two-column">
      <section className="panel">
        <div className="section-heading">
          <h2>Backend</h2>
          <button type="button" onClick={props.onRefresh}>
            Refresh
          </button>
        </div>
        <dl className="kv-list">
          <dt>status</dt>
          <dd>
            <span className={status.connected ? "badge good" : "badge bad"}>{status.label}</span>
          </dd>
          <dt>service</dt>
          <dd>{props.health?.service ?? "unknown"}</dd>
          <dt>mode</dt>
          <dd>{props.health?.mode ?? "unknown"}</dd>
        </dl>
        {!status.connected ? <p className="notice">请先启动 PKOS Agent Server。</p> : null}
      </section>
      <CurrentStateCard item={props.current} />
    </section>
  );
}
