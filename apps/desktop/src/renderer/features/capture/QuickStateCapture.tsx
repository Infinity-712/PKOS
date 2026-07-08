import { useState, type FormEvent } from "react";
import {
  BODY_OPTIONS,
  CONTEXT_OPTIONS,
  EMPTY_ATTEMPT,
  ENERGY_OPTIONS,
  MODE_OPTIONS,
  MOOD_OPTIONS,
  RISK_OPTIONS,
  STATE_SOURCE_OPTIONS,
  AgentApiClientError,
  applySubmitError,
  applySubmitResponse,
  resetAttempt,
  startOrReuseAttempt,
  type ActionDraft,
  type AgentApiClient,
  type RequestAttemptState,
  type StateAppendRequest,
} from "@pkos/agent-client";
import { AttemptFooter } from "./QuickInboxCapture.js";

type Draft = {
  energy: string;
  mood: string;
  body: string;
  context: string;
  mode: string;
  riskShortVideo: string;
  riskRumination: string;
  riskOverload: string;
  source: string;
  note: string;
};

const DEFAULT_DRAFT: Draft = {
  energy: "unknown",
  mood: "unknown",
  body: "unknown",
  context: "unknown",
  mode: "unknown",
  riskShortVideo: "unknown",
  riskRumination: "unknown",
  riskOverload: "unknown",
  source: "web",
  note: "",
};

export function QuickStateCapture(props: { client: AgentApiClient; onWritten: () => void }) {
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
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
      source: draft.source,
      note: draft.note,
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
      const response = await props.client.stateAppend(started.frozenPayload.body as StateAppendRequest);
      const next = applySubmitResponse(started, response);
      setAttempt(next);
      if (next.status === "written" || next.status === "replayed") {
        props.onWritten();
      }
    } catch (error) {
      setAttempt(applySubmitError(started, safeError(error)));
    }
  }

  return (
    <form className="panel form-panel" onSubmit={(event) => void submit(event)}>
      <h2>Quick State Capture</h2>
      <div className="compact-grid">
        <SelectField label="energy" value={draft.energy} options={ENERGY_OPTIONS} onChange={(energy) => setDraft({ ...draft, energy })} />
        <SelectField label="mood" value={draft.mood} options={MOOD_OPTIONS} onChange={(mood) => setDraft({ ...draft, mood })} />
        <SelectField label="body" value={draft.body} options={BODY_OPTIONS} onChange={(body) => setDraft({ ...draft, body })} />
        <SelectField label="context" value={draft.context} options={CONTEXT_OPTIONS} onChange={(context) => setDraft({ ...draft, context })} />
        <SelectField label="mode" value={draft.mode} options={MODE_OPTIONS} onChange={(mode) => setDraft({ ...draft, mode })} />
        <SelectField label="source" value={draft.source} options={STATE_SOURCE_OPTIONS} onChange={(source) => setDraft({ ...draft, source })} />
        <SelectField label="shortVideo" value={draft.riskShortVideo} options={RISK_OPTIONS} onChange={(riskShortVideo) => setDraft({ ...draft, riskShortVideo })} />
        <SelectField label="rumination" value={draft.riskRumination} options={RISK_OPTIONS} onChange={(riskRumination) => setDraft({ ...draft, riskRumination })} />
        <SelectField label="overload" value={draft.riskOverload} options={RISK_OPTIONS} onChange={(riskOverload) => setDraft({ ...draft, riskOverload })} />
      </div>
      <label>
        note
        <textarea rows={4} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} />
      </label>
      <AttemptFooter attempt={attempt} onNew={() => setAttempt(resetAttempt())} submitLabel="Record state snapshot" />
    </form>
  );
}

function SelectField(props: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return (
    <label>
      {props.label}
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {props.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
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
