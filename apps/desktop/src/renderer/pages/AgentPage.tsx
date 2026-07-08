import { useEffect, useState } from "react";
import type { AgentApiClient, ChatSession } from "@pkos/agent-client";
import { ChatPanel } from "../features/chat/ChatPanel.js";
import { ChatSessionList } from "../features/chat/ChatSessionList.js";

export function AgentPage(props: { client: AgentApiClient; connected: boolean }) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    if (!props.connected) {
      return;
    }
    try {
      const response = await props.client.listChatSessions();
      setSessions(response.sessions);
      setSelectedId((current) => current ?? response.sessions[0]?.id ?? null);
      setMessage(null);
    } catch {
      setMessage("Unable to load sessions.");
    }
  }

  async function createSession(): Promise<string | null> {
    if (!props.connected) {
      setMessage("请先启动 PKOS Agent Server。");
      return null;
    }
    try {
      const response = await props.client.createChatSession({ title: "Desktop session" });
      setSessions((current) => [response.session, ...current]);
      setSelectedId(response.session.id);
      setMessage(null);
      return response.session.id;
    } catch {
      setMessage("Unable to create session.");
      return null;
    }
  }

  useEffect(() => {
    void refresh();
  }, [props.connected]);

  return (
    <section className="split-page">
      <ChatSessionList sessions={sessions} selectedId={selectedId} onSelect={setSelectedId} onCreate={() => void createSession()} disabled={!props.connected} />
      <ChatPanel client={props.client} sessionId={selectedId} onNeedsSession={createSession} />
      {message ? <p className="notice">{message}</p> : null}
    </section>
  );
}
