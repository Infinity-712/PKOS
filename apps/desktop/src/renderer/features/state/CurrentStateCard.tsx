import type { JsonObject, StateTimelineItem } from "@pkos/agent-client";
import { currentStateText } from "../chat/chatModel.js";

export function CurrentStateCard(props: { item: StateTimelineItem | null }) {
  if (!props.item) {
    return (
      <section className="panel">
        <h2>Current State</h2>
        <p className="muted">{currentStateText(null)}</p>
      </section>
    );
  }
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Current State</h2>
        <span className={props.item.stale ? "badge warn" : "badge good"}>{props.item.stale ? "stale" : "fresh"}</span>
      </div>
      <p className="subtle">来自最近一次显式状态快照</p>
      {props.item.stale ? <p className="notice">{currentStateText(props.item)}</p> : null}
      <dl className="kv-list">
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
        <dt>risk</dt>
        <dd>{formatRisk(props.item.risk)}</dd>
        <dt>note</dt>
        <dd>{props.item.note || "none"}</dd>
        <dt>createdAt</dt>
        <dd>{props.item.createdAt}</dd>
      </dl>
    </section>
  );
}

function formatRisk(risk: JsonObject): string {
  const enabled = Object.entries(risk)
    .filter((entry) => typeof entry[1] === "string" && entry[1] !== "unknown")
    .map((entry) => `${entry[0]}:${entry[1]}`);
  return enabled.length > 0 ? enabled.join(", ") : "none";
}
