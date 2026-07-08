import { randomUUID } from "node:crypto";

export const agentEventTypes = [
  "generation_started",
  "content_delta",
  "generation_completed",
  "generation_aborted",
  "generation_failed",
  "tool_call_started",
  "tool_call_completed",
  "tool_call_failed",
  "writeback_requested",
  "writeback_written",
  "writeback_blocked",
  "review_candidate_created",
  "scheduler_run",
  "context_built",
  "action_request_resolved",
] as const;

export type AgentEventType = (typeof agentEventTypes)[number];
export type AgentEventSeverity = "debug" | "info" | "warn" | "error";

export type AgentEvent = {
  id: string;
  ts: string;
  sessionId?: string;
  generationId?: string;
  type: AgentEventType;
  payload: unknown;
  severity: AgentEventSeverity;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function createAgentEvent(input: {
  sessionId?: string;
  generationId?: string;
  type: AgentEventType;
  payload?: unknown;
  severity?: AgentEventSeverity;
}): AgentEvent {
  return {
    id: randomUUID(),
    ts: nowIso(),
    sessionId: input.sessionId,
    generationId: input.generationId,
    type: input.type,
    payload: input.payload ?? null,
    severity: input.severity ?? "info",
  };
}

export function serializePayload(payload: unknown): string {
  return JSON.stringify(payload ?? null);
}
