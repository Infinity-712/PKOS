import { randomUUID } from "node:crypto";

import type { AgentDatabase } from "../db/connection.js";
import type { AgentEvent } from "../events/AgentEvent.js";
import { createAgentEvent, nowIso } from "../events/AgentEvent.js";
import { EventStore } from "../events/EventStore.js";

export type GenerationStatus = "running" | "completed" | "failed" | "aborted";

export type Generation = {
  id: string;
  sessionId: string;
  status: GenerationStatus;
  partialContent: string;
  errorJson: string | null;
  createdAt: string;
  updatedAt: string;
};

type GenerationRow = {
  id: string;
  session_id: string;
  status: GenerationStatus;
  partial_content: string;
  error_json: string | null;
  created_at: string;
  updated_at: string;
};

export class GenerationManager {
  private readonly events: EventStore;

  constructor(private readonly db: AgentDatabase, events?: EventStore) {
    this.events = events ?? new EventStore(db);
  }

  createGeneration(sessionId: string): { generation: Generation; event: AgentEvent } {
    const ts = nowIso();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO generations
          (id, session_id, status, partial_content, error_json, created_at, updated_at)
         VALUES (?, ?, ?, '', NULL, ?, ?)`,
      )
      .run(id, sessionId, "running", ts, ts);
    const generation = this.requireGeneration(id);
    const event = this.events.record(
      createAgentEvent({
        sessionId,
        generationId: id,
        type: "generation_started",
        payload: { status: generation.status },
      }),
    );
    return { generation, event };
  }

  appendPartial(generationId: string, delta: string): { generation: Generation; event: AgentEvent } {
    const before = this.requireGeneration(generationId);
    const updatedAt = nowIso();
    this.db
      .prepare("UPDATE generations SET partial_content = partial_content || ?, updated_at = ? WHERE id = ?")
      .run(delta, updatedAt, generationId);
    const generation = this.requireGeneration(generationId);
    const event = this.events.record(
      createAgentEvent({
        sessionId: before.sessionId,
        generationId,
        type: "content_delta",
        severity: "debug",
        payload: { delta, partialLength: generation.partialContent.length },
      }),
    );
    return { generation, event };
  }

  completeGeneration(generationId: string): { generation: Generation; event: AgentEvent } {
    const before = this.requireGeneration(generationId);
    const updatedAt = nowIso();
    this.db.prepare("UPDATE generations SET status = ?, updated_at = ? WHERE id = ?").run("completed", updatedAt, generationId);
    const generation = this.requireGeneration(generationId);
    const event = this.events.record(
      createAgentEvent({
        sessionId: before.sessionId,
        generationId,
        type: "generation_completed",
        payload: { status: generation.status, contentLength: generation.partialContent.length },
      }),
    );
    return { generation, event };
  }

  failGeneration(generationId: string, error: unknown): { generation: Generation; event: AgentEvent } {
    const before = this.requireGeneration(generationId);
    const updatedAt = nowIso();
    const errorJson = JSON.stringify(toErrorPayload(error));
    this.db
      .prepare("UPDATE generations SET status = ?, error_json = ?, updated_at = ? WHERE id = ?")
      .run("failed", errorJson, updatedAt, generationId);
    const generation = this.requireGeneration(generationId);
    const event = this.events.record(
      createAgentEvent({
        sessionId: before.sessionId,
        generationId,
        type: "generation_failed",
        severity: "error",
        payload: JSON.parse(errorJson),
      }),
    );
    return { generation, event };
  }

  abortGeneration(generationId: string, reason: string): { generation: Generation; event: AgentEvent } {
    const before = this.requireGeneration(generationId);
    const updatedAt = nowIso();
    const errorJson = JSON.stringify({ reason });
    this.db
      .prepare("UPDATE generations SET status = ?, error_json = ?, updated_at = ? WHERE id = ?")
      .run("aborted", errorJson, updatedAt, generationId);
    const generation = this.requireGeneration(generationId);
    const event = this.events.record(
      createAgentEvent({
        sessionId: before.sessionId,
        generationId,
        type: "generation_aborted",
        severity: "warn",
        payload: { reason },
      }),
    );
    return { generation, event };
  }

  getGeneration(generationId: string): Generation | undefined {
    const row = this.db.prepare("SELECT * FROM generations WHERE id = ?").get(generationId) as GenerationRow | undefined;
    return row ? fromGenerationRow(row) : undefined;
  }

  private requireGeneration(generationId: string): Generation {
    const generation = this.getGeneration(generationId);
    if (!generation) {
      throw new Error(`generation not found: ${generationId}`);
    }
    return generation;
  }
}

function fromGenerationRow(row: GenerationRow): Generation {
  return {
    id: row.id,
    sessionId: row.session_id,
    status: row.status,
    partialContent: row.partial_content,
    errorJson: row.error_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toErrorPayload(error: unknown): { message: string; name?: string } {
  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }
  return { message: String(error) };
}
