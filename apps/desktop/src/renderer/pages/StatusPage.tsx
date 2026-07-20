import type { AgentApiClient, HealthResponse, RuntimeInfoResponse, StateTimelineItem } from "@pkos/agent-client";
import { backendStatusFromHealth } from "../features/chat/chatModel.js";
import { ReminderNotificationsCard } from "../features/reminders/ReminderNotificationsCard.js";
import { CurrentStateCard } from "../features/state/CurrentStateCard.js";

export function StatusPage(props: { client: AgentApiClient; health: HealthResponse | null; runtimeInfo: RuntimeInfoResponse | null; current: StateTimelineItem | null; onRefresh: () => void }) {
  const status = backendStatusFromHealth(props.health);
  const runtimeMismatch =
    typeof props.health?.runtimeFingerprint === "string" &&
    typeof props.runtimeInfo?.runtimeFingerprint === "string" &&
    props.health.runtimeFingerprint !== props.runtimeInfo.runtimeFingerprint;
  const serviceBuildMismatch =
    typeof props.health?.serviceBuildFingerprint === "string" &&
    typeof props.runtimeInfo?.service.buildFingerprint === "string" &&
    props.health.serviceBuildFingerprint !== props.runtimeInfo.service.buildFingerprint;
  const staleService = serviceBuildMismatch || props.runtimeInfo?.database.compatible === false || props.health?.databaseCompatible === false;
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
          <dt>Service build</dt>
          <dd>{props.runtimeInfo?.service.buildFingerprint ?? props.health?.serviceBuildFingerprint ?? "unknown"}</dd>
          <dt>API contract</dt>
          <dd>{props.runtimeInfo?.service.apiContractVersion ?? props.health?.apiContractVersion ?? "unknown"}</dd>
          <dt>mode</dt>
          <dd>{props.health?.mode ?? "unknown"}</dd>
          <dt>runtime</dt>
          <dd>
            {props.runtimeInfo ? (
              <span className={runtimeMismatch ? "badge bad runtime-mismatch" : "badge good"}>
                Runtime: {props.runtimeInfo.profileName} / {props.runtimeInfo.dataRoot.label} / {props.runtimeInfo.runtimeFingerprint.slice(0, 8)}
              </span>
            ) : (
              <span className="badge warn">Runtime identity unavailable</span>
            )}
          </dd>
          <dt>database</dt>
          <dd>{props.runtimeInfo ? `schema ${props.runtimeInfo.database.schemaVersion} / required ${props.runtimeInfo.database.requiredSchemaVersion}` : "unknown"}</dd>
          <dt>DB compatibility</dt>
          <dd>
            <span className={staleService ? "badge bad" : "badge good"}>
              {props.runtimeInfo?.database.compatible === false || props.health?.databaseCompatible === false ? "stale schema" : "compatible"}
            </span>
          </dd>
        </dl>
        {runtimeMismatch ? <p className="notice">The connected Agent Server may be using a different runtime data set.</p> : null}
        {staleService ? <p className="notice">Connected Agent Server build or schema is stale. Stop it and start the local runtime again.</p> : null}
        {!status.connected ? <p className="notice">请先启动 PKOS Agent Server。</p> : null}
      </section>
      <CurrentStateCard item={props.current} />
      <ReminderNotificationsCard client={props.client} connected={status.connected} />
    </section>
  );
}
