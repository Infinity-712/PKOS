import { useState, type FormEvent } from "react";

import {
  EMPTY_ATTEMPT,
  applySubmitError,
  applySubmitResponse,
  isSuccessfulAttempt,
  resetAttempt,
  startOrReuseAttempt,
  type ActionDraft,
  type RequestAttemptState,
} from "../features/actions/requestAttempt.js";
import { ApiClientError, postJson } from "../lib/apiClient.js";
import { isActionSubmitResponse } from "../lib/guards.js";
import type { JsonObject } from "../types.js";

type InboxDraft = {
  captureType: string;
  content: string;
  source: string;
  tags: string;
};

type StateDraft = {
  energy: string;
  mood: string;
  body: string;
  context: string;
  mode: string;
  note: string;
  riskShortVideo: string;
  riskRumination: string;
  riskOverload: string;
};

const DEFAULT_INBOX: InboxDraft = {
  captureType: "note",
  content: "",
  source: "web",
  tags: "",
};

const DEFAULT_STATE: StateDraft = {
  energy: "unknown",
  mood: "unknown",
  body: "unknown",
  context: "unknown",
  mode: "unknown",
  note: "",
  riskShortVideo: "unknown",
  riskRumination: "unknown",
  riskOverload: "unknown",
};

const ENERGY_OPTIONS = ["unknown", "very_low", "low", "medium", "high", "overloaded"];
const MOOD_OPTIONS = ["unknown", "calm", "anxious", "low", "excited", "numb", "irritated", "overloaded"];
const BODY_OPTIONS = ["unknown", "normal", "sleepy", "tired", "chest_tight", "headache", "hungry", "sick"];
const CONTEXT_OPTIONS = ["unknown", "dorm", "classroom", "library", "outside", "home", "before_sleep", "travel", "other"];
const MODE_OPTIONS = ["unknown", "study", "writing", "recovery", "social", "quiet", "life", "project", "other"];
const RISK_OPTIONS = ["unknown", "low", "medium", "high"];

export function CapturePage() {
  return (
    <section className="page-grid two-column">
      <InboxCaptureForm />
      <StateCaptureForm />
    </section>
  );
}

function InboxCaptureForm() {
  const [draft, setDraft] = useState<InboxDraft>(DEFAULT_INBOX);
  const [attempt, setAttempt] = useState<RequestAttemptState>(EMPTY_ATTEMPT);
  const actionDraft: ActionDraft = {
    actionName: "inbox-append",
    body: {
      captureType: draft.captureType.trim() || "note",
      content: draft.content,
      source: draft.source.trim() || "web",
      status: "unprocessed",
      tags: draft.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      metadata: { submittedBy: "web-dashboard" },
    },
  };

  return (
    <form className="panel form-panel" onSubmit={(event) => void submitAction(event, actionDraft, attempt, setAttempt)}>
      <h2>Inbox append</h2>
      <label>
        captureType
        <input value={draft.captureType} onChange={(event) => setDraft({ ...draft, captureType: event.target.value })} />
      </label>
      <label>
        content
        <textarea rows={5} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
      </label>
      <label>
        source
        <input value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })} />
      </label>
      <label>
        tags
        <input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="comma,separated" />
      </label>
      <AttemptControls attempt={attempt} onNew={() => setAttempt(resetAttempt())} />
    </form>
  );
}

export function StateCaptureForm(props: { submitLabel?: string; onWritten?: () => void }) {
  const [draft, setDraft] = useState<StateDraft>(DEFAULT_STATE);
  const [attempt, setAttempt] = useState<RequestAttemptState>(EMPTY_ATTEMPT);
  const actionDraft: ActionDraft = {
    actionName: "state-append",
    body: {
      energy: draft.energy,
      mood: draft.mood,
      body: draft.body,
      context: draft.context,
      mode: draft.mode,
      risk: {
        shortVideo: draft.riskShortVideo,
        rumination: draft.riskRumination,
        overload: draft.riskOverload,
      },
      source: "web",
      note: draft.note,
    },
  };

  return (
    <form className="panel form-panel" onSubmit={(event) => void submitAction(event, actionDraft, attempt, setAttempt, props.onWritten)}>
      <h2>State append</h2>
      <div className="compact-grid">
        <label>
          energy
          <select value={draft.energy} onChange={(event) => setDraft({ ...draft, energy: event.target.value })}>
            {ENERGY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          mood
          <select value={draft.mood} onChange={(event) => setDraft({ ...draft, mood: event.target.value })}>
            {MOOD_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          body
          <select value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })}>
            {BODY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          context
          <select value={draft.context} onChange={(event) => setDraft({ ...draft, context: event.target.value })}>
            {CONTEXT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        mode
        <select value={draft.mode} onChange={(event) => setDraft({ ...draft, mode: event.target.value })}>
          {MODE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <div className="compact-grid">
        <label>
          shortVideo
          <select value={draft.riskShortVideo} onChange={(event) => setDraft({ ...draft, riskShortVideo: event.target.value })}>
            {RISK_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          rumination
          <select value={draft.riskRumination} onChange={(event) => setDraft({ ...draft, riskRumination: event.target.value })}>
            {RISK_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          overload
          <select value={draft.riskOverload} onChange={(event) => setDraft({ ...draft, riskOverload: event.target.value })}>
            {RISK_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        note
        <textarea rows={4} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} />
      </label>
      <AttemptControls attempt={attempt} onNew={() => setAttempt(resetAttempt())} submitLabel={props.submitLabel} />
    </form>
  );
}

async function submitAction(
  event: FormEvent,
  draft: ActionDraft,
  attempt: RequestAttemptState,
  setAttempt: (next: RequestAttemptState) => void,
  onWritten?: () => void,
): Promise<void> {
  event.preventDefault();
  const started = startOrReuseAttempt(attempt, draft, createRequestId);
  setAttempt(started);
  if (!started.frozenPayload) {
    return;
  }
  try {
    const response = await postJson(started.frozenPayload.endpoint, started.frozenPayload.body, isActionSubmitResponse);
    const next = applySubmitResponse(started, response);
    setAttempt(next);
    if (isSuccessfulAttempt(next.status)) {
      onWritten?.();
    }
  } catch (caught) {
    if (caught instanceof ApiClientError) {
      setAttempt(applySubmitError(started, { code: caught.code, message: caught.message }));
      return;
    }
    setAttempt(applySubmitError(started, { code: "network_unknown", message: "结果未知：网络请求没有可靠返回。" }));
  }
}

function AttemptControls(props: { attempt: RequestAttemptState; onNew: () => void; submitLabel?: string }) {
  const frozen = props.attempt.frozenPayload;
  return (
    <div className="attempt-box">
      <div className="attempt-row">
        <button type="submit" disabled={props.attempt.status === "submitting"}>
          {frozen ? "重试同一 requestId" : props.submitLabel ?? "提交"}
        </button>
        <button type="button" onClick={props.onNew}>
          新建请求
        </button>
        <span className={`badge ${isSuccessfulAttempt(props.attempt.status) ? "good" : props.attempt.status === "draft" ? "" : "warn"}`}>
          {props.attempt.status}
        </span>
      </div>
      <dl className="kv-list compact">
        <dt>requestId</dt>
        <dd>{props.attempt.requestId ?? "draft"}</dd>
        <dt>frozen payload</dt>
        <dd>{frozen ? `${frozen.actionName}, ${payloadSize(frozen.body)} chars` : "none"}</dd>
        <dt>last response</dt>
        <dd>{props.attempt.lastResponse ? JSON.stringify(props.attempt.lastResponse) : "none"}</dd>
      </dl>
      {props.attempt.status === "network_unknown" ? <p className="notice">结果未知：请使用同一个 requestId 重试，或到 Action Requests 核验。</p> : null}
      {props.attempt.status === "request_indeterminate" ? <p className="notice">该请求需要人工核验，请转到 Action Requests。</p> : null}
    </div>
  );
}

function createRequestId(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function payloadSize(value: JsonObject): number {
  return JSON.stringify(value).length;
}
