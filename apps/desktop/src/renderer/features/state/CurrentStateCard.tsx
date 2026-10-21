import type { JsonObject, StateTimelineItem } from "@pkos/agent-client";
import { useLocale } from "../../i18n/Locale.js";
import { currentStateText } from "../chat/chatModel.js";

export function CurrentStateCard(props: { item: StateTimelineItem | null }) {
  const { t, label, message } = useLocale();
  if (!props.item) {
    return (
      <section className="panel">
        <h2>{t("最近的状态", "Current State")}</h2>
        <p className="muted">{message(currentStateText(null))}</p>
      </section>
    );
  }
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>{t("最近的状态", "Current State")}</h2>
        <span className={props.item.stale ? "badge warn" : "badge good"}>{label(props.item.stale ? "stale" : "fresh")}</span>
      </div>
      <p className="subtle">{t("来自最近一次明确记录的状态", "From the latest explicit state snapshot.")}</p>
      {props.item.stale ? <p className="notice">{message(currentStateText(props.item))}</p> : null}
      <dl className="kv-list">
        <dt>{label("energy")}</dt>
        <dd>{label(props.item.energy)}</dd>
        <dt>{label("mood")}</dt>
        <dd>{label(props.item.mood)}</dd>
        <dt>{label("body")}</dt>
        <dd>{label(props.item.body)}</dd>
        <dt>{label("context")}</dt>
        <dd>{label(props.item.context)}</dd>
        <dt>{label("mode")}</dt>
        <dd>{label(props.item.mode)}</dd>
        <dt>{label("risk")}</dt>
        <dd>{formatRisk(props.item.risk, label)}</dd>
        <dt>{t("备注", "Note")}</dt>
        <dd>{props.item.note || label("none")}</dd>
        <dt>{t("记录于", "Recorded at")}</dt>
        <dd>{props.item.createdAt}</dd>
      </dl>
    </section>
  );
}

function formatRisk(risk: JsonObject, label: (value: string) => string): string {
  const enabled = Object.entries(risk)
    .filter((entry) => typeof entry[1] === "string" && entry[1] !== "unknown")
    .map((entry) => `${label(entry[0])}: ${label(String(entry[1]))}`);
  return enabled.length > 0 ? enabled.join(", ") : label("none");
}
