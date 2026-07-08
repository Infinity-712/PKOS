import { useEffect, useState, type FormEvent } from "react";

import {
  EMPTY_ATTEMPT,
  applySubmitError,
  applySubmitResponse,
  isSuccessfulAttempt,
  resetAttempt,
  type RequestAttemptState,
} from "../features/actions/requestAttempt.js";
import {
  buildInboxReviewQuery,
  canSubmitInboxReviewAction,
  createInboxReviewActionDraft,
  inboxReviewMutationForItem,
  startOrReuseInboxReviewAttempt,
  type InboxReviewActionKind,
} from "../features/inbox-review/inboxReviewModel.js";
import { ApiClientError, getJson, postJson } from "../lib/apiClient.js";
import { isActionSubmitResponse, isInboxReviewListResponse } from "../lib/guards.js";
import type { InboxReviewItem } from "../types.js";

type Filters = {
  status: string;
  source: string;
  tag: string;
  limit: string;
};

const DEFAULT_FILTERS: Filters = {
  status: "",
  source: "",
  tag: "",
  limit: "50",
};

export function InboxReviewPage() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [items, setItems] = useState<InboxReviewItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh(): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const query = buildInboxReviewQuery(filters);
      const response = await getJson(`/api/pkos/inbox-review${query ? `?${query}` : ""}`, isInboxReviewListResponse);
      setItems(response.items);
    } catch (caught) {
      setMessage(caught instanceof ApiClientError ? `${caught.code}: ${caught.message}` : "Inbox Review list failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Inbox Review</h2>
          <p className="subtle">Inbox Review 改变的是派生有效状态，不修改原始 capture log。</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          Refresh
        </button>
      </div>
      <div className="filter-row">
        <label>
          status
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="">all</option>
            <option value="unprocessed">unprocessed</option>
            <option value="archived">archived</option>
            <option value="converted">converted</option>
          </select>
        </label>
        <label>
          source
          <input value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })} />
        </label>
        <label>
          tag
          <input value={filters.tag} onChange={(event) => setFilters({ ...filters, tag: event.target.value })} />
        </label>
        <label>
          limit
          <input value={filters.limit} onChange={(event) => setFilters({ ...filters, limit: event.target.value })} />
        </label>
      </div>
      {message ? <p className="notice">{message}</p> : null}
      <div className="inbox-review-list">
        {items.map((item) => (
          <InboxReviewItemRow key={item.id} item={item} onChanged={() => void refresh()} />
        ))}
        {items.length === 0 ? <p className="muted">当前筛选下没有 Inbox Review 条目。</p> : null}
      </div>
    </section>
  );
}

function InboxReviewItemRow(props: { item: InboxReviewItem; onChanged: () => void }) {
  const mutation = inboxReviewMutationForItem(props.item);
  return (
    <article className="review-item">
      <div className="review-item-main">
        <div className="review-meta">
          <span className="badge">{props.item.effectiveStatus}</span>
          <span>{props.item.captureType || "capture"}</span>
          <span>{props.item.source || "unknown"}</span>
          <span>{props.item.createdAt || "unknown time"}</span>
        </div>
        <p className="review-content">{props.item.content}</p>
        <div className="tag-row">
          {props.item.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
        {props.item.latestAction ? (
          <p className="subtle">
            latest action: {props.item.latestAction.status}, {props.item.latestAction.createdAt}, reason: {props.item.latestAction.reason}
          </p>
        ) : null}
        {props.item.effectiveStatus === "converted" ? (
          <p className="notice">该条目已被标记为 converted。本版本不验证或创建转换目标。</p>
        ) : null}
      </div>
      {mutation ? <InboxReviewActionForm action={mutation} itemId={props.item.id} onChanged={props.onChanged} /> : null}
    </article>
  );
}

function InboxReviewActionForm(props: { itemId: string; action: InboxReviewActionKind; onChanged: () => void }) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [attempt, setAttempt] = useState<RequestAttemptState>(EMPTY_ATTEMPT);
  const [message, setMessage] = useState<string | null>(null);
  const frozenReason = typeof attempt.frozenPayload?.body.reason === "string" ? attempt.frozenPayload.body.reason : null;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setMessage(null);
    const input = { itemId: props.itemId, action: props.action, reason, confirmed };
    if (!canSubmitInboxReviewAction(input)) {
      setMessage("请填写 reason 并勾选确认。");
      return;
    }
    const draft = createInboxReviewActionDraft(input);
    const started = startOrReuseInboxReviewAttempt(attempt, draft, createRequestId);
    setAttempt(started);
    if (!started.frozenPayload) {
      return;
    }
    try {
      const response = await postJson(started.frozenPayload.endpoint, started.frozenPayload.body, isActionSubmitResponse);
      const next = applySubmitResponse(started, response);
      setAttempt(next);
      if (isSuccessfulAttempt(next.status)) {
        props.onChanged();
      }
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        const next = applySubmitError(started, { code: caught.code, message: caught.message });
        setAttempt(next);
        if (next.status === "request_indeterminate") {
          setMessage("结果不确定，请前往 Action Requests 进行人工核验。");
        }
        return;
      }
      setAttempt(applySubmitError(started, { code: "network_unknown", message: "结果未知：网络请求没有可靠返回。" }));
    }
  }

  return (
    <form className="review-action" onSubmit={(event) => void submit(event)}>
      <label>
        reason
        <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <label className="checkbox-line">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        我确认要{props.action === "archive" ? "归档" : "恢复为待处理"}该条目。
      </label>
      <div className="attempt-row">
        <button type="submit">{props.action === "archive" ? "归档" : "恢复为待处理"}</button>
        <button type="button" onClick={() => setAttempt(resetAttempt())}>
          新建请求
        </button>
        <span className={`badge ${isSuccessfulAttempt(attempt.status) ? "good" : attempt.status === "draft" ? "" : "warn"}`}>{attempt.status}</span>
      </div>
      {attempt.requestId ? <p className="subtle">requestId: {attempt.requestId}</p> : null}
      {frozenReason !== null && frozenReason !== reason.trim() ? <p className="notice">reason 已修改；请点“新建请求”后再提交新内容。</p> : null}
      {attempt.status === "network_unknown" ? <p className="notice">结果未知：重试会复用同一个 requestId 和冻结 payload。</p> : null}
      {attempt.status === "request_indeterminate" ? <p className="notice">请前往 Action Requests 进行人工核验。</p> : null}
      {message ? <p className="notice">{message}</p> : null}
    </form>
  );
}

function createRequestId(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `review-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
