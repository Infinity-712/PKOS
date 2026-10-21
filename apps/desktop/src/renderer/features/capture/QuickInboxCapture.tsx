import { useState, type FormEvent } from "react";
import { Plus, RotateCcw, Save } from "lucide-react";
import { useLocale } from "../../i18n/Locale.js";
import {
  CAPTURE_SOURCE_OPTIONS,
  CAPTURE_TYPE_OPTIONS,
  EMPTY_ATTEMPT,
  AgentApiClientError,
  applySubmitError,
  applySubmitResponse,
  isSuccessfulAttempt,
  resetAttempt,
  startOrReuseAttempt,
  type ActionDraft,
  type AgentApiClient,
  type InboxAppendRequest,
  type RequestAttemptState,
} from "@pkos/agent-client";

type Draft = {
  captureType: string;
  content: string;
  source: string;
  tags: string;
};

const DEFAULT_DRAFT: Draft = {
  captureType: "note",
  content: "",
  source: "web",
  tags: "",
};

export function QuickInboxCapture(props: { client: AgentApiClient }) {
  const { t, label } = useLocale();
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [attempt, setAttempt] = useState<RequestAttemptState>(EMPTY_ATTEMPT);

  const actionDraft: ActionDraft = {
    actionName: "inbox-append",
    body: {
      captureType: draft.captureType,
      content: draft.content,
      source: draft.source,
      status: "unprocessed",
      tags: draft.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      metadata: { submittedBy: "desktop" },
    },
  };

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const started = startOrReuseAttempt(attempt, actionDraft, createRequestId);
    setAttempt(started);
    if (!started.frozenPayload) {
      return;
    }
    try {
      const response = await props.client.inboxAppend(started.frozenPayload.body as InboxAppendRequest);
      setAttempt(applySubmitResponse(started, response));
    } catch (error) {
      setAttempt(applySubmitError(started, safeError(error)));
    }
  }

  return (
    <form className="panel form-panel" onSubmit={(event) => void submit(event)}>
      <h2>{t("先记下来", "A quick note")}</h2>
      <label>
        {t("类型", "Type")}
        <select value={draft.captureType} onChange={(event) => setDraft({ ...draft, captureType: event.target.value })}>
          {CAPTURE_TYPE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {label(option)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("内容", "Content")}
        <textarea rows={5} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
      </label>
      <label>
        {t("来源", "Source")}
        <select value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })}>
          {CAPTURE_SOURCE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {label(option)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("标签", "Tags")}
        <input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder={t("灵感,日常", "ideas,daily")} />
      </label>
      <AttemptFooter attempt={attempt} onNew={() => setAttempt(resetAttempt())} submitLabel={t("记到收集箱", "Capture inbox")} />
    </form>
  );
}

export function AttemptFooter(props: { attempt: RequestAttemptState; onNew: () => void; submitLabel: string }) {
  const { t, label } = useLocale();
  const frozen = props.attempt.frozenPayload;
  return (
    <div className="attempt-box">
      <div className="button-row">
        <button className="primary-button" type="submit" disabled={props.attempt.status === "submitting"}>
          {frozen ? <RotateCcw size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
          {frozen ? t("重试同一请求", "Retry same requestId") : props.submitLabel}
        </button>
        <button type="button" onClick={props.onNew}>
          <Plus size={16} aria-hidden="true" /> {t("新请求", "New request")}
        </button>
        <span className={`badge ${isSuccessfulAttempt(props.attempt.status) ? "good" : props.attempt.status === "draft" ? "" : "warn"}`}>
          {label(props.attempt.status)}
        </span>
      </div>
      <p className="subtle">{t("请求编号", "requestId")}: {props.attempt.requestId ?? label("draft")}</p>
      {props.attempt.status === "request_indeterminate" ? <p className="notice">{t("结果待核验，请到 Web Dashboard 的 Action Requests 页面确认。", "Result indeterminate. Verify in Web Dashboard's Action Requests page.")}</p> : null}
      {props.attempt.status === "network_unknown" ? <p className="notice">{t("网络结果未知。重试会保留同一请求编号和内容。", "Network result unknown. Retry keeps the same requestId and payload.")}</p> : null}
    </div>
  );
}

function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof AgentApiClientError) {
    return { code: error.code, message: error.message };
  }
  return { code: "network_unknown", message: "request failed" };
}

function createRequestId(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `desktop-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
