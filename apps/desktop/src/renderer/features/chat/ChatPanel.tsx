import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type KeyboardEvent, type SetStateAction } from "react";
import { formatDateTime, type AgentApiClient, type ChatSession, type ProviderProfileSummary, type ProviderProfilesResponse, type ProviderStatusResponse, type ReasoningPreset } from "@pkos/agent-client";
import {
  abortSend,
  applySessionChatEvent,
  appendUserMessageToSession,
  finishSend,
  getChatSessionView,
  isNearScrollBottom,
  setSessionSendState,
  shouldSubmitChatKey,
  startSend,
  type ChatSessionView,
  type ChatViewState,
} from "./chatModel.js";

export function ChatPanel(props: {
  client: AgentApiClient;
  session: ChatSession | null;
  sessionView: ChatSessionView;
  setChatState: Dispatch<SetStateAction<ChatViewState>>;
  providerStatus: ProviderStatusResponse | null;
  providerProfiles: ProviderProfilesResponse | null;
  onProviderStatus: (status: ProviderStatusResponse) => void;
  onRefreshProviderStatus: () => Promise<void>;
  onRefreshSessionMessages: (sessionId: string) => Promise<void>;
  onNeedsSession: () => Promise<string | null>;
}) {
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationIdRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const messageStreamRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);

  const provider = props.providerStatus;
  const modelOptions = useMemo(() => flattenModelOptions(props.providerProfiles), [props.providerProfiles]);
  const activeModelValue = provider ? selectionValue(provider.selection.profileId, provider.selection.modelId) : "";
  const activeModel = modelOptions.find((option) => option.value === activeModelValue) ?? null;
  const reasoningPresets = provider?.capabilities.reasoningPresets ?? [];
  const reasoningFixed = activeModel?.model.reasoningFixed ?? reasoningPresets.length <= 1;
  const providerUnavailable = !provider || !provider.configured || provider.connection.state === "disabled";
  const sendState = props.sessionView.sendState;
  const sendDisabled = sendState.active || !draft.trim() || providerUnavailable;

  useEffect(() => {
    const element = messageStreamRef.current;
    if (!element || !nearBottomRef.current) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [props.sessionView.messages]);

  async function submitForm(event: FormEvent): Promise<void> {
    event.preventDefault();
    await submitDraft();
  }

  async function submitDraft(): Promise<void> {
    if (sendDisabled || submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setMessage(null);
    const sessionId = props.session?.id ?? (await props.onNeedsSession());
    if (!sessionId) {
      setMessage("Create a session before sending.");
      submittingRef.current = false;
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    generationIdRef.current = null;
    const outgoing = draft;
    setDraft("");
    props.setChatState((current) => {
      const view = getChatSessionView(current, sessionId);
      return setSessionSendState(current, sessionId, startSend(view.sendState));
    });
    props.setChatState((current) => appendUserMessageToSession(current, sessionId, outgoing));

    try {
      for await (const item of props.client.sendChatMessage({ sessionId, message: outgoing, allowExternalProvider: true }, controller.signal)) {
        if (item.type === "generation_started" && typeof item.generationId === "string") {
          generationIdRef.current = item.generationId;
        }
        props.setChatState((current) => applySessionChatEvent(current, sessionId, item));
      }
      props.setChatState((current) => setSessionSendState(current, sessionId, finishSend({ active: true, statusText: "completed" })));
      await props.onRefreshProviderStatus();
      await props.onRefreshSessionMessages(sessionId);
    } catch (error) {
      await props.onRefreshProviderStatus();
      if (controller.signal.aborted) {
        props.setChatState((current) => setSessionSendState(current, sessionId, abortSend(getChatSessionView(current, sessionId).sendState)));
      } else {
        setMessage(error instanceof Error ? error.message : "Chat request failed");
        props.setChatState((current) => setSessionSendState(current, sessionId, finishSend({ active: true, statusText: "failed" })));
      }
    } finally {
      abortRef.current = null;
      generationIdRef.current = null;
      submittingRef.current = false;
    }
  }

  async function abort(): Promise<void> {
    const sessionId = props.session?.id;
    const generationId = props.sessionView.activeGenerationId ?? generationIdRef.current;
    if (generationId) {
      try {
        await props.client.abortGeneration(generationId);
      } catch {
        // Local abort still stops reading; server audit remains source of truth.
      }
    }
    abortRef.current?.abort();
    if (sessionId) {
      props.setChatState((current) => setSessionSendState(current, sessionId, abortSend(getChatSessionView(current, sessionId).sendState)));
    }
    await props.onRefreshProviderStatus();
  }

  async function changeModel(value: string): Promise<void> {
    const option = modelOptions.find((candidate) => candidate.value === value);
    if (!option || sendState.active) {
      return;
    }
    setMessage(null);
    try {
      const status = await props.client.setProviderSelection({
        profileId: option.profile.profileId,
        modelId: option.model.modelId,
        reasoningPreset: option.model.defaultReasoningPreset,
      });
      props.onProviderStatus(status);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to switch provider model.");
    }
  }

  async function changeReasoning(preset: ReasoningPreset): Promise<void> {
    if (!provider || sendState.active) {
      return;
    }
    setMessage(null);
    try {
      const status = await props.client.setProviderSelection({
        profileId: provider.selection.profileId,
        modelId: provider.selection.modelId,
        reasoningPreset: preset,
      });
      props.onProviderStatus(status);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to switch reasoning preset.");
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (shouldSubmitChatKey({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing }, sendState.active)) {
      void submitDraft();
    }
  }

  function onMessageScroll(): void {
    const element = messageStreamRef.current;
    if (!element) {
      return;
    }
    nearBottomRef.current = isNearScrollBottom({
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    });
  }

  return (
    <section className="panel chat-panel">
      <div className="section-heading">
        <div>
          <h2>Agent Chat</h2>
          <ProviderStatusBlock status={provider} />
        </div>
        <div className="button-row">
          <button type="button" onClick={() => void props.onRefreshProviderStatus()} disabled={sendState.active}>
            Refresh
          </button>
          {sendState.active ? (
            <button type="button" onClick={() => void abort()}>
              Stop receiving
            </button>
          ) : null}
        </div>
      </div>

      <SessionHeader session={props.session} provider={provider} />

      <div className="provider-controls">
        <label>
          <span>Model</span>
          <select value={activeModelValue} onChange={(event) => void changeModel(event.target.value)} disabled={sendState.active || modelOptions.length === 0}>
            {modelOptions.map((option) => (
              <option key={option.value} value={option.value} disabled={!option.profile.enabled}>
                {option.profile.displayName} / {option.model.displayName}
              </option>
            ))}
          </select>
        </label>
        {reasoningFixed ? (
          <label>
            <span>Reasoning</span>
            <select value={provider?.selection.reasoningPreset ?? "off"} disabled>
              <option value={provider?.selection.reasoningPreset ?? "off"}>{reasoningLabel(provider?.selection.reasoningPreset ?? "off")} (fixed)</option>
            </select>
          </label>
        ) : (
          <label>
            <span>Reasoning</span>
            <select value={provider?.selection.reasoningPreset ?? "off"} onChange={(event) => void changeReasoning(event.target.value as ReasoningPreset)} disabled={sendState.active}>
              {reasoningPresets.map((preset) => (
                <option key={preset} value={preset}>
                  {reasoningLabel(preset)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <p className="notice">Model output is not a PKOS authority record and may be wrong; verify with evidence and human judgment.</p>
      <div className="message-stream" aria-live="polite" ref={messageStreamRef} onScroll={onMessageScroll}>
        {props.sessionView.historyStatus === "loading" ? <p className="muted">Loading session history...</p> : null}
        {props.sessionView.historyStatus === "error" ? (
          <div className="notice">
            <span>{props.sessionView.historyError ?? "Unable to read this session's history messages."}</span>
            {props.session ? (
              <button type="button" onClick={() => void props.onRefreshSessionMessages(props.session?.id ?? "")} disabled={!props.session}>
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
        {props.sessionView.messages.map((item) => (
          <article className={`message-row ${item.role}`} key={item.id}>
            <div className="message-meta">
              <span className="badge">{item.role}</span>
              <span>{item.status}</span>
              {item.createdAt ? <span>{formatDateTime(item.createdAt)}</span> : null}
            </div>
            <p className="message-bubble">{item.content || (item.status === "streaming" ? "Receiving..." : "")}</p>
          </article>
        ))}
        {props.sessionView.messages.length === 0 && props.sessionView.historyStatus !== "loading" && props.sessionView.historyStatus !== "error" ? (
          <p className="muted">This session has no messages yet.</p>
        ) : null}
      </div>
      <form className="composer" onSubmit={(event) => void submitForm(event)}>
        <textarea rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKeyDown} placeholder="Send a message" />
        <button type="submit" disabled={sendDisabled}>
          Send
        </button>
      </form>
      {sendState.statusText ? <p className="subtle">{sendState.statusText}</p> : null}
      {providerUnavailable ? <p className="notice">Provider is not ready for sending. Check profile configuration and required key environment variables.</p> : null}
      {message ? <p className="notice">{message}</p> : null}
    </section>
  );
}

function SessionHeader(props: { session: ChatSession | null; provider: ProviderStatusResponse | null }) {
  const session = props.session;
  const provider = props.provider;
  return (
    <dl className="session-header">
      <div>
        <dt>Session</dt>
        <dd>{session?.title || session?.id || "No session selected"}</dd>
      </div>
      <div>
        <dt>Created</dt>
        <dd>{formatDateTime(session?.created_at)}</dd>
      </div>
      <div>
        <dt>Updated</dt>
        <dd>{formatDateTime(session?.updated_at)}</dd>
      </div>
      <div>
        <dt>Model</dt>
        <dd>{provider ? `${provider.selection.providerDisplayName} / ${provider.selection.modelDisplayName}` : "Loading"}</dd>
      </div>
      <div>
        <dt>Reasoning</dt>
        <dd>{provider ? reasoningLabel(provider.selection.reasoningPreset) : "Loading"}</dd>
      </div>
    </dl>
  );
}

function ProviderStatusBlock(props: { status: ProviderStatusResponse | null }) {
  const status = props.status;
  if (!status) {
    return <p className="subtle">Provider status is loading.</p>;
  }
  const label = connectionLabel(status.connection.state);
  return (
    <div className="provider-status">
      <span className={`badge ${status.connection.state === "connected" || status.connection.state === "dry_run" ? "good" : status.connection.state === "configured_unverified" ? "warn" : "bad"}`}>
        {label}
      </span>
      <span>{status.selection.providerDisplayName}</span>
      <span>{status.selection.modelDisplayName}</span>
      <span>{reasoningLabel(status.selection.reasoningPreset)}</span>
      {status.selection.endpointOrigin ? <span>{status.selection.endpointOrigin}</span> : <span>local dry-run</span>}
      {status.connection.lastSuccessAt ? <span>last success {formatDateTime(status.connection.lastSuccessAt)}</span> : null}
      {status.connection.lastErrorCode ? <span>{status.connection.lastErrorCode}</span> : null}
      {status.selection.warning ? <span>{status.selection.warning}</span> : null}
    </div>
  );
}

function flattenModelOptions(profiles: ProviderProfilesResponse | null): Array<{ value: string; profile: ProviderProfileSummary; model: ProviderProfileSummary["models"][number] }> {
  const options: Array<{ value: string; profile: ProviderProfileSummary; model: ProviderProfileSummary["models"][number] }> = [];
  for (const profile of profiles?.items ?? []) {
    for (const model of profile.models) {
      options.push({ value: selectionValue(profile.profileId, model.modelId), profile, model });
    }
  }
  return options;
}

function selectionValue(profileId: string, modelId: string): string {
  return `${profileId}::${modelId}`;
}

function connectionLabel(state: ProviderStatusResponse["connection"]["state"]): string {
  if (state === "dry_run") {
    return "Dry-run";
  }
  if (state === "unconfigured") {
    return "Not connected";
  }
  if (state === "configured_unverified") {
    return "Configured, unverified";
  }
  if (state === "connected") {
    return "Connected";
  }
  if (state === "error") {
    return "Connection error";
  }
  return "Disabled";
}

function reasoningLabel(preset: ReasoningPreset): string {
  if (preset === "off") {
    return "Off";
  }
  if (preset === "low") {
    return "Low";
  }
  if (preset === "medium") {
    return "Medium";
  }
  if (preset === "high") {
    return "High";
  }
  return "Max";
}
