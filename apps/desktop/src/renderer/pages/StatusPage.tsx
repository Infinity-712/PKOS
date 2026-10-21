import type { AgentApiClient, HealthResponse, RuntimeInfoResponse, StateTimelineItem } from "@pkos/agent-client";
import { RefreshCw } from "lucide-react";
import { useLocale } from "../i18n/Locale.js";
import { backendStatusFromHealth } from "../features/chat/chatModel.js";
import { ReminderNotificationsCard } from "../features/reminders/ReminderNotificationsCard.js";
import { CurrentStateCard } from "../features/state/CurrentStateCard.js";

export function StatusPage(props: { client: AgentApiClient; health: HealthResponse | null; runtimeInfo: RuntimeInfoResponse | null; current: StateTimelineItem | null; onRefresh: () => void }) {
  const { t, label } = useLocale();
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
          <h2>{t("连接与运行状态", "Backend")}</h2>
          <button type="button" onClick={props.onRefresh}>
            <RefreshCw size={16} aria-hidden="true" /> {t("刷新", "Refresh")}
          </button>
        </div>
        <dl className="kv-list">
          <dt>{t("状态", "Status")}</dt>
          <dd>
            <span className={status.connected ? "badge good" : "badge bad"}>{label(status.label)}</span>
          </dd>
          <dt>{t("服务", "Service")}</dt>
          <dd>{props.health?.service ?? label("unknown")}</dd>
          <dt>{t("服务构建", "Service build")}</dt>
          <dd>{props.runtimeInfo?.service.buildFingerprint ?? props.health?.serviceBuildFingerprint ?? label("unknown")}</dd>
          <dt>{t("API 协议", "API contract")}</dt>
          <dd>{props.runtimeInfo?.service.apiContractVersion ?? props.health?.apiContractVersion ?? label("unknown")}</dd>
          <dt>{t("模式", "Mode")}</dt>
          <dd>{label(props.health?.mode ?? "unknown")}</dd>
          <dt>{t("运行环境", "Runtime")}</dt>
          <dd>
            {props.runtimeInfo ? (
              <span className={runtimeMismatch ? "badge bad runtime-mismatch" : "badge good"}>
                {t("运行环境：", "Runtime:")} {props.runtimeInfo.profileName} / {props.runtimeInfo.dataRoot.label} / {props.runtimeInfo.runtimeFingerprint.slice(0, 8)}
              </span>
            ) : (
              <span className="badge warn">{t("运行环境身份不可用", "Runtime identity unavailable")}</span>
            )}
          </dd>
          <dt>{t("数据库", "Database")}</dt>
          <dd>{props.runtimeInfo ? `${t("结构版本", "schema")} ${props.runtimeInfo.database.schemaVersion} / ${t("所需版本", "required")} ${props.runtimeInfo.database.requiredSchemaVersion}` : label("unknown")}</dd>
          <dt>{t("数据库兼容性", "DB compatibility")}</dt>
          <dd>
            <span className={staleService ? "badge bad" : "badge good"}>
              {props.runtimeInfo?.database.compatible === false || props.health?.databaseCompatible === false ? t("结构版本过旧", "stale schema") : t("兼容", "compatible")}
            </span>
          </dd>
        </dl>
        {runtimeMismatch ? <p className="notice">{t("当前连接的 Agent Server 可能正在使用另一套运行数据。", "The connected Agent Server may be using a different runtime data set.")}</p> : null}
        {staleService ? <p className="notice">{t("当前 Agent Server 构建或数据结构版本过旧，请停止服务并重新启动本地运行环境。", "Connected Agent Server build or schema is stale. Stop it and start the local runtime again.")}</p> : null}
        {!status.connected ? <p className="notice">{t("请先启动 PKOS Agent Server。", "Please start PKOS Agent Server first.")}</p> : null}
      </section>
      <CurrentStateCard item={props.current} />
      <ReminderNotificationsCard client={props.client} connected={status.connected} />
    </section>
  );
}
