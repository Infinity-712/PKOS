import { useEffect, useState, type FormEvent, type MouseEvent } from "react";

import { ApiClientError, getJson, postJson } from "../lib/apiClient.js";
import { isActionRequestDetailResponse, isActionRequestListResponse, isActionResolutionResponse } from "../lib/guards.js";
import type { ActionRequestView, ActionResolution, JsonObject, WritebackResult } from "../types.js";

const STATUS_OPTIONS = ["", "running", "completed", "failed", "indeterminate"];

export function ActionRequestsPage() {
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
          <h2>Action Requests</h2>
          <button type="button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        <div className="filter-row">
          <label>
            status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {STATUS_OPTIONS.map((item) => (
                <option key={item || "all"} value={item}>
                  {item || "all"}
                </option>
              ))}
            </select>
          </label>
          <label>
            limit
            <input value={limit} onChange={(event) => setLimit(event.target.value)} />
          </label>
        </div>
        {message ? <p className="notice">{message}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>requestId</th>
                <th>actionName</th>
                <th>stored</th>
                <th>effective</th>
                <th>stale</th>
                <th>updatedAt</th>
                <th>summary</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.requestId} onClick={() => void loadDetail(request.requestId)}>
                  <td>
                    <button type="button" className="link-button" onClick={(event) => copyRequestId(event, request.requestId)}>
                      {shortId(request.requestId)}
                    </button>
                  </td>
                  <td>{request.actionName}</td>
                  <td>{request.storedStatus}</td>
                  <td>
                    <span className={`badge ${request.effectiveStatus === "completed" ? "good" : request.effectiveStatus === "indeterminate" ? "warn" : ""}`}>
                      {request.effectiveStatus}
                    </span>
                  </td>
                  <td>{request.stale ? "yes" : "no"}</td>
                  <td>{request.updatedAt}</td>
                  <td>{resultSummary(request.result ?? request.error)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2>Detail</h2>
        {selected ? (
          <>
            <dl className="kv-list">
              <dt>requestId</dt>
              <dd>{selected.requestId}</dd>
              <dt>actionName</dt>
              <dd>{selected.actionName}</dd>
              <dt>payloadSha256</dt>
              <dd>{selected.payloadSha256}</dd>
              <dt>toolCallId</dt>
              <dd>{selected.toolCallId ?? "none"}</dd>
              <dt>stored/effective</dt>
              <dd>
                {selected.storedStatus} / {selected.effectiveStatus} {selected.stale ? "(stale)" : ""}
              </dd>
              <dt>result</dt>
              <dd>{selected.result ? JSON.stringify(sanitizeWriteback(selected.result)) : "none"}</dd>
              <dt>error</dt>
              <dd>{selected.error ? JSON.stringify(sanitizeWriteback(selected.error)) : "none"}</dd>
              <dt>resolution</dt>
              <dd>{selected.resolution ? JSON.stringify(selected.resolution) : "none"}</dd>
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
          <p className="muted">选择一条 request 查看详情。</p>
        )}
      </div>
    </section>
  );
}

function ResolutionForm(props: { request: ActionRequestView; onResolved: (request: ActionRequestView) => void }) {
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
      <h3>Human Resolution</h3>
      <p className="notice">confirmed_written 不会伪造 recordId；只表示你已人工核验 authority log 中存在写入。</p>
      <label>
        resolution
        <select value={resolution} onChange={(event) => setResolution(event.target.value as ActionResolution)}>
          <option value="confirmed_written">confirmed_written</option>
          <option value="confirmed_not_written">confirmed_not_written</option>
          <option value="abandoned">abandoned</option>
        </select>
      </label>
      <label>
        resolvedBy
        <input value={resolvedBy} onChange={(event) => setResolvedBy(event.target.value)} />
      </label>
      <label>
        reason
        <textarea rows={4} value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <label className="checkbox-line">
        <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
        我已人工核验该操作结果。
      </label>
      <button type="submit" disabled={submitting}>
        Resolve
      </button>
      {message ? <p className="notice">{message}</p> : null}
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

function resultSummary(result: WritebackResult | undefined): string {
  if (!result) {
    return "none";
  }
  return [result.status, result.operation, result.errorCode].filter(Boolean).join(" / ");
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
