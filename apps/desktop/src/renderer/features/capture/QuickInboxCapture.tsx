import { useState, type FormEvent } from "react";
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
      <h2>Quick Inbox Capture</h2>
      <label>
        captureType
        <select value={draft.captureType} onChange={(event) => setDraft({ ...draft, captureType: event.target.value })}>
          {CAPTURE_TYPE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        content
        <textarea rows={5} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
      </label>
      <label>
        source
        <select value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })}>
          {CAPTURE_SOURCE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        tags
        <input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="comma,separated" />
      </label>
      <AttemptFooter attempt={attempt} onNew={() => setAttempt(resetAttempt())} submitLabel="Capture inbox" />
    </form>
  );
}

export function AttemptFooter(props: { attempt: RequestAttemptState; onNew: () => void; submitLabel: string }) {
  const frozen = props.attempt.frozenPayload;
  return (
    <div className="attempt-box">
      <div className="button-row">
        <button type="submit" disabled={props.attempt.status === "submitting"}>
          {frozen ? "Retry same requestId" : props.submitLabel}
        </button>
        <button type="button" onClick={props.onNew}>
          New request
        </button>
        <span className={`badge ${isSuccessfulAttempt(props.attempt.status) ? "good" : props.attempt.status === "draft" ? "" : "warn"}`}>
          {props.attempt.status}
        </span>
      </div>
      <p className="subtle">requestId: {props.attempt.requestId ?? "draft"}</p>
      {props.attempt.status === "request_indeterminate" ? <p className="notice">请在 Web Dashboard 的 Action Requests 页面核验。</p> : null}
      {props.attempt.status === "network_unknown" ? <p className="notice">Network result unknown. Retry keeps the same requestId and payload.</p> : null}
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
