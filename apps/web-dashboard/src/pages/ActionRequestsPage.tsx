import { translateUiMessage } from "../i18n/copy.js";
import { useLocale } from "../i18n/Locale.js";
import { formatDateTime } from "@pkos/agent-client";
import { RefreshCw, Check } from "lucide-react";
import { useEffect, useState, type FormEvent, type MouseEvent } from "react";

import { ApiClientError, getJson, postJson } from "../lib/apiClient.js";
import { isActionRequestDetailResponse, isActionRequestListResponse, isActionResolutionResponse } from "../lib/guards.js";
import type { ActionRequestView, ActionResolution, JsonObject, WritebackResult } from "../types.js";

const STATUS_OPTIONS = ["", "running", "completed", "failed", "indeterminate"];

export function ActionRequestsPage() {
  const { label: uiLabel, locale, t } = useLocale();
  const uiMessage = (value: string) => translateUiMessage(value, locale);
  const [requests, setRequests] = useState<ActionRequestView[]>([]);
  const [selected, setSelected] = useState<ActionRequestView | null>(null);
  const [status, setStatus] = useState("");
  const [limit, setLimit] = useState("50");
  const [message, setMessage] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setMessage(null);
    const params = new URLSearchParams();
    if (status) {
      params.set("status", status);
    }
    params.set("limit", limit);
    try {
      const response = await getJson(`/api/actions/requests?${params.toString()}`, isActionRequestListResponse);
      setRequests(response.requests);
    } catch (caught) {
      setMessage(caught instanceof ApiClientError ? caught.message : "request list failed");
    }
  }

  async function loadDetail(requestId: string): Promise<void> {
    setMessage(null);
    try {
      const response = await getJson(`/api/actions/requests/${encodeURIComponent(requestId)}`, isActionRequestDetailResponse);
      setSelected(response.request);
    } catch (caught) {
      setMessage(caught instanceof ApiClientError ? caught.message : "request detail failed");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="split-page">
      <div className="panel">
        <div className="panel-heading">
          <h2>{uiLabel("Action Requests")}</h2>
          <button type="button" onClick={() => void refresh()}>
            <RefreshCw size={16} aria-hidden="true" />{uiLabel("Refresh")}
          </button>
        </div>
        <div className="filter-row">
          <label>
            {uiLabel("status")}
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {STATUS_OPTIONS.map((item) => (
                <option key={item || "all"} value={item}>
                  {uiLabel(item || "all")}
                </option>
              ))}
            </select>
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
                <th>{uiLabel("requestId")}</th>
                <th>{uiLabel("actionName")}</th>
                <th>{uiLabel("stored")}</th>
                <th>{uiLabel("effective")}</th>
                <th>{uiLabel("stale")}</th>
                <th>{uiLabel("updatedAt")}</th>
                <th>{uiLabel("summary")}</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.requestId} tabIndex={0} aria-label={t(`查看请求 ${request.requestId}`, `View request ${request.requestId}`)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); void loadDetail(request.requestId); } }} onClick={() => void loadDetail(request.requestId)}>
                  <td>
                    <button type="button" className="link-button" title={t("复制请求 ID", "Copy request ID")} aria-label={t(`复制请求 ID ${request.requestId}`, `Copy request ID ${request.requestId}`)} onClick={(event) => copyRequestId(event, request.requestId)}>
                      {shortId(request.requestId)}
                    </button>
                  </td>
                  <td>{uiLabel(request.actionName)}</td>
                  <td>{uiLabel(request.storedStatus)}</td>
                  <td>
                    <span className={`badge ${request.effectiveStatus === "completed" ? "good" : request.effectiveStatus === "indeterminate" ? "warn" : ""}`}>
                      {uiLabel(request.effectiveStatus)}
                    </span>
                  </td>
                  <td>{request.stale ? uiLabel("yes") : uiLabel("no")}</td>
                  <td>{formatDateTime(request.updatedAt)}</td>
                  <td>{resultSummary(request.result ?? request.error, uiLabel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2>{uiLabel("Detail")}</h2>
        {selected ? (
          <>
            <dl className="kv-list">
              <dt>{uiLabel("requestId")}</dt>
              <dd>{selected.requestId}</dd>
              <dt>{uiLabel("actionName")}</dt>
              <dd>{uiLabel(selected.actionName)}</dd>
              <dt>{uiLabel("payloadSha256")}</dt>
              <dd>{selected.payloadSha256}</dd>
              <dt>{uiLabel("toolCallId")}</dt>
              <dd>{selected.toolCallId ?? uiLabel("none")}</dd>
              <dt>{uiLabel("stored/effective")}</dt>
              <dd>
                {uiLabel(selected.storedStatus)} / {uiLabel(selected.effectiveStatus)} {selected.stale ? uiLabel("(stale)") : ""}
              </dd>
              <dt>{uiLabel("result")}</dt>
              <dd>{selected.result ? JSON.stringify(sanitizeWriteback(selected.result)) : uiLabel("none")}</dd>
              <dt>{uiLabel("error")}</dt>
              <dd>{selected.error ? JSON.stringify(sanitizeWriteback(selected.error)) : uiLabel("none")}</dd>
              <dt>{uiLabel("resolution")}</dt>
              <dd>{selected.resolution ? JSON.stringify(selected.resolution) : uiLabel("none")}</dd>
            </dl>
            {selected.effectiveStatus === "indeterminate" ? (
              <ResolutionForm
                request={selected}
                onResolved={(next) => {
                  setSelected(next);
                  void refresh();
                }}
              />
            ) : null}
          </>
        ) : (
          <p className="muted">{uiLabel("选择一条 request 查看详情。")}</p>
        )}
      </div>
    </section>
  );
}

function ResolutionForm(props: { request: ActionRequestView; onResolved: (request: ActionRequestView) => void }) {
  const { label: uiLabel, locale } = useLocale();
  const uiMessage = (value: string) => translateUiMessage(value, locale);
  const [resolution, setResolution] = useState<ActionResolution>("confirmed_not_written");
  const [reason, setReason] = useState("");
  const [resolvedBy, setResolvedBy] = useState("local_user");
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setMessage(null);
    if (!checked) {
      setMessage("需要勾选人工核验确认。");
      return;
    }
    if (!reason.trim()) {
      setMessage("reason is required");
      return;
    }
    setSubmitting(true);
    try {
      const response = await postJson(
        `/api/actions/requests/${encodeURIComponent(props.request.requestId)}/resolve`,
        {
          resolution,
          reason,
          resolvedBy,
        },
        isActionResolutionResponse,
      );
      props.onResolved(response.request);
      setMessage(response.message);
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.status === 409) {
        setMessage(`409: ${caught.code}. 请刷新后重新查看状态。`);
      } else {
        setMessage(caught instanceof ApiClientError ? caught.message : "resolve failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="resolution-form" onSubmit={(event) => void submit(event)}>
      <h3>{uiLabel("Human Resolution")}</h3>
      <p className="notice">{uiLabel("confirmed_written 不会伪造 recordId；只表示你已人工核验 authority log 中存在写入。")}</p>
      <label>
        {uiLabel("resolution")}
        <select value={resolution} onChange={(event) => setResolution(event.target.value as ActionResolution)}>
          <option value="confirmed_written">{uiLabel("confirmed_written")}</option>
          <option value="confirmed_not_written">{uiLabel("confirmed_not_written")}</option>
          <option value="abandoned">{uiLabel("abandoned")}</option>
        </select>
      </label>
      <label>
        {uiLabel("resolvedBy")}
        <input value={resolvedBy} onChange={(event) => setResolvedBy(event.target.value)} />
      </label>
      <label>
        {uiLabel("reason")}
        <textarea rows={4} value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <label className="checkbox-line">
        <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
        {uiLabel("我已人工核验该操作结果。")}
      </label>
      <button type="submit" disabled={submitting}>
        <Check size={16} aria-hidden="true" />{uiLabel("Resolve")}
      </button>
      {message ? <p className="notice">{uiMessage(message)}</p> : null}
    </form>
  );
}

function copyRequestId(event: MouseEvent, requestId: string): void {
  event.stopPropagation();
  if (navigator.clipboard) {
    void navigator.clipboard.writeText(requestId);
  }
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function resultSummary(result: WritebackResult | undefined, label: (value: string) => string): string {
  if (!result) {
    return label("none");
  }
  return [result.status, result.operation, result.errorCode].filter(Boolean).map((value) => label(value!)).join(" / ");
}

function sanitizeWriteback(result: WritebackResult): JsonObject {
  return {
    status: result.status,
    operation: result.operation,
    ...(result.message ? { message: result.message } : {}),
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    ...(result.target ? { target: result.target } : {}),
    ...(result.recordId ? { recordId: result.recordId } : {}),
  };
}
