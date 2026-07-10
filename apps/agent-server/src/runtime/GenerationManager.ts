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
  providerName: string | null;
  modelName: string | null;
  providerId: string | null;
  profileId: string | null;
  protocol: string | null;
  modelId: string | null;
  reasoningPreset: string | null;
  endpointOrigin: string | null;
  external: boolean | null;
  finishReason: string | null;
  inputChars: number | null;
  outputChars: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GenerationMetadata = {
  providerName: string;
  modelName: string;
  providerId: string;
  profileId: string;
  protocol: string;
  modelId: string;
  reasoningPreset: string;
  endpointOrigin?: string;
  external: boolean;
  inputChars: number;
};

export type CompletionMetadata = {
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
};

export type TerminalUpdate = {
  generation: Generation;
  event: AgentEvent | null;
  changed: boolean;
};

type GenerationRow = {
  id: string;
  session_id: string;
  status: GenerationStatus;
  partial_content: string;
  error_json: string | null;
  provider_name: string | null;
  model_name: string | null;
  provider_id: string | null;
  profile_id: string | null;
  protocol: string | null;
  model_id: string | null;
  reasoning_preset: string | null;
  endpoint_origin: string | null;
  external: number | null;
  finish_reason: string | null;
  input_chars: number | null;
  output_chars: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};

export class GenerationManager {
  private readonly events: EventStore;
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly db: AgentDatabase, events?: EventStore) {
    this.events = events ?? new EventStore(db);
  }

  createGeneration(sessionId: string, metadata: GenerationMetadata): { generation: Generation; event: AgentEvent } {
    const ts = nowIso();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO generations
          (id, session_id, status, partial_content, error_json, provider_name, model_name, provider_id, profile_id, protocol, model_id, reasoning_preset, endpoint_origin, external, input_chars, created_at, updated_at)
         VALUES (?, ?, ?, '', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        sessionId,
        "running",
        metadata.providerName,
        metadata.modelName,
        metadata.providerId,
        metadata.profileId,
        metadata.protocol,
        metadata.modelId,
        metadata.reasoningPreset,
        metadata.endpointOrigin ?? null,
        metadata.external ? 1 : 0,
        metadata.inputChars,
        ts,
        ts,
      );
    const generation = this.requireGeneration(id);
    const event = this.events.record(
      createAgentEvent({
        sessionId,
        generationId: id,
        type: "generation_started",
        payload: {
          status: generation.status,
          provider: metadata.providerName,
          model: metadata.modelName,
          providerId: metadata.providerId,
          profileId: metadata.profileId,
          protocol: metadata.protocol,
          modelId: metadata.modelId,
          reasoningPreset: metadata.reasoningPreset,
          endpointOrigin: metadata.endpointOrigin,
          external: metadata.external,
          inputChars: metadata.inputChars,
        },
      }),
    );
    return { generation, event };
  }

  registerAbortController(generationId: string, controller: AbortController): void {
    this.controllers.set(generationId, controller);
  }

  clearAbortController(generationId: string): void {
    this.controllers.delete(generationId);
  }

  requestAbort(generationId: string, reason = "user_requested_abort"): { status: "not_found" | "terminal" | "aborted"; generation?: Generation; event?: AgentEvent | null } {
    const generation = this.getGeneration(generationId);
    if (!generation) {
      return { status: "not_found" };
    }
    if (generation.status === "aborted") {
      return { status: "aborted", generation, event: null };
    }
    if (generation.status !== "running") {
      return { status: "terminal", generation };
    }
    const controller = this.controllers.get(generationId);
    controller?.abort(new Error("provider_aborted"));
    const update = this.abortGeneration(generationId, reason);
    return { status: "aborted", generation: update.generation, event: update.event };
  }

  appendPartial(generationId: string, delta: string): { generation: Generation; event: AgentEvent } {
    const before = this.requireGeneration(generationId);
    if (before.status !== "running") {
      throw new Error(`generation is terminal: ${generationId}`);
    }
    const updatedAt = nowIso();
    this.db
      .prepare("UPDATE generations SET partial_content = partial_content || ?, output_chars = COALESCE(output_chars, 0) + ?, updated_at = ? WHERE id = ?")
      .run(delta, delta.length, updatedAt, generationId);
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

  completeGeneration(generationId: string, metadata: CompletionMetadata = {}): TerminalUpdate {
    const before = this.requireGeneration(generationId);
    if (before.status !== "running") {
      return { generation: before, event: null, changed: false };
    }
    const updatedAt = nowIso();
    this.db
      .prepare(
        `UPDATE generations
         SET status = ?, finish_reason = ?, input_tokens = ?, output_tokens = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run("completed", metadata.finishReason ?? null, metadata.inputTokens ?? null, metadata.outputTokens ?? null, updatedAt, generationId);
    const generation = this.requireGeneration(generationId);
    const event = this.events.record(
      createAgentEvent({
        sessionId: before.sessionId,
        generationId,
        type: "generation_completed",
        payload: {
          status: generation.status,
          provider: generation.providerName,
          model: generation.modelName,
          providerId: generation.providerId,
          profileId: generation.profileId,
          protocol: generation.protocol,
          modelId: generation.modelId,
          reasoningPreset: generation.reasoningPreset,
          endpointOrigin: generation.endpointOrigin,
          external: generation.external,
          finishReason: generation.finishReason,
          contentLength: generation.partialContent.length,
          inputTokens: generation.inputTokens ?? undefined,
          outputTokens: generation.outputTokens ?? undefined,
        },
      }),
    );
    return { generation, event, changed: true };
  }

  failGeneration(generationId: string, error: unknown): TerminalUpdate {
    const before = this.requireGeneration(generationId);
    if (before.status !== "running") {
      return { generation: before, event: null, changed: false };
    }
    const updatedAt = nowIso();
    const payload = toErrorPayload(error);
    const errorJson = JSON.stringify(payload);
    this.db
      .prepare("UPDATE generations SET status = ?, error_json = ?, error_code = ?, updated_at = ? WHERE id = ?")
      .run("failed", errorJson, payload.code, updatedAt, generationId);
    const generation = this.requireGeneration(generationId);
    const event = this.events.record(
      createAgentEvent({
        sessionId: before.sessionId,
        generationId,
        type: "generation_failed",
        severity: "error",
        payload: {
          code: payload.code,
          provider: generation.providerName,
          model: generation.modelName,
          providerId: generation.providerId,
          profileId: generation.profileId,
          protocol: generation.protocol,
          modelId: generation.modelId,
          reasoningPreset: generation.reasoningPreset,
        },
      }),
    );
    return { generation, event, changed: true };
  }

  abortGeneration(generationId: string, reason: string): TerminalUpdate {
    const before = this.requireGeneration(generationId);
    if (before.status !== "running") {
      return { generation: before, event: null, changed: false };
    }
    const updatedAt = nowIso();
    const errorJson = JSON.stringify({ code: "provider_aborted", reason });
    this.db
      .prepare("UPDATE generations SET status = ?, error_json = ?, error_code = ?, updated_at = ? WHERE id = ?")
      .run("aborted", errorJson, "provider_aborted", updatedAt, generationId);
    const generation = this.requireGeneration(generationId);
    const event = this.events.record(
      createAgentEvent({
        sessionId: before.sessionId,
        generationId,
        type: "generation_aborted",
        severity: "warn",
        payload: {
          reason,
          provider: generation.providerName,
          model: generation.modelName,
          providerId: generation.providerId,
          profileId: generation.profileId,
          protocol: generation.protocol,
          modelId: generation.modelId,
          reasoningPreset: generation.reasoningPreset,
        },
      }),
    );
    return { generation, event, changed: true };
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
    providerName: row.provider_name,
    modelName: row.model_name,
    providerId: row.provider_id,
    profileId: row.profile_id,
    protocol: row.protocol,
    modelId: row.model_id,
    reasoningPreset: row.reasoning_preset,
    endpointOrigin: row.endpoint_origin,
    external: row.external === null ? null : row.external === 1,
    finishReason: row.finish_reason,
    inputChars: row.input_chars,
    outputChars: row.output_chars,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toErrorPayload(error: unknown): { code: string; message: string; name?: string } {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    return { code: (error as { code: string }).code, message: "generation failed" };
  }
  if (error instanceof Error) {
    return { code: error.name || "unknown_provider_error", message: "generation failed", name: error.name };
  }
  return { code: "unknown_provider_error", message: "generation failed" };
}
