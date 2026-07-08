import { useRef, useState, type FormEvent } from "react";
import type { AgentApiClient, AgentEvent } from "@pkos/agent-client";
import { abortSend, finishSend, startSend, type SendState } from "./chatModel.js";

export function ChatPanel(props: { client: AgentApiClient; sessionId: string | null; onNeedsSession: () => Promise<string | null> }) {
  const [draft, setDraft] = useState("");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [sendState, setSendState] = useState<SendState>({ active: false, statusText: "" });
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (sendState.active || !draft.trim()) {
      return;
    }
    const nextSend = startSend(sendState);
    setSendState(nextSend);
    setMessage(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const sessionId = props.sessionId ?? (await props.onNeedsSession());
      if (!sessionId) {
        setMessage("Create a session before sending.");
        setSendState(finishSend(nextSend));
        return;
      }
      const outgoing = draft;
      setDraft("");
      for await (const item of props.client.sendChatMessage({ sessionId, message: outgoing }, controller.signal)) {
        setEvents((current) => [...current, item]);
      }
      setSendState(finishSend({ active: true, statusText: "completed" }));
    } catch (error) {
      if (controller.signal.aborted) {
        setSendState(abortSend(nextSend));
      } else {
        setMessage(error instanceof Error ? error.message : "Chat request failed");
        setSendState(finishSend({ active: true, statusText: "failed" }));
      }
    } finally {
      abortRef.current = null;
    }
  }

  function abort(): void {
    abortRef.current?.abort();
    setSendState(abortSend(sendState));
  }

  return (
    <section className="panel chat-panel">
      <div className="section-heading">
        <div>
          <h2>Agent Chat</h2>
          <p className="subtle">当前使用 Dry-run Provider，不会调用真实模型。</p>
        </div>
        {sendState.active ? (
          <button type="button" onClick={abort}>
            Stop receiving
          </button>
        ) : null}
      </div>
      <div className="event-stream" aria-live="polite">
        {events.map((item) => (
          <div className="event-row" key={item.id}>
            <span className="badge">{item.type}</span>
            <span>{eventSummary(item)}</span>
          </div>
        ))}
        {events.length === 0 ? <p className="muted">No stream events yet.</p> : null}
      </div>
      <form className="composer" onSubmit={(event) => void submit(event)}>
        <textarea rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Send a dry-run message" />
        <button type="submit" disabled={sendState.active || !draft.trim()}>
          Send
        </button>
      </form>
      {sendState.statusText ? <p className="subtle">{sendState.statusText}</p> : null}
      {message ? <p className="notice">{message}</p> : null}
    </section>
  );
}

function eventSummary(event: AgentEvent): string {
  if (event.type === "content_delta" && typeof event.payload === "object" && event.payload !== null && "delta" in event.payload) {
    const delta = (event.payload as { delta?: unknown }).delta;
    return typeof delta === "string" ? `${delta.length} chars` : "delta";
  }
  return event.severity;
}
