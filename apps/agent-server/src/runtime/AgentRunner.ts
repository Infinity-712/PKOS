import { randomUUID } from "node:crypto";

import { ContextBuilder, summarizeBuiltContext } from "../context/ContextBuilder.js";
import type { BuiltContext } from "../context/ContextTypes.js";
import type { AgentDatabase } from "../db/connection.js";
import type { AgentEvent } from "../events/AgentEvent.js";
import { createAgentEvent, nowIso } from "../events/AgentEvent.js";
import { EventStore } from "../events/EventStore.js";
import { DryRunProvider } from "../providers/DryRunProvider.js";
import { GenerationManager } from "./GenerationManager.js";

export type RunAgentInput = {
  sessionId: string;
  message: string;
  onEvent?: (event: AgentEvent) => void;
};

export type RunAgentResult = {
  generationId: string;
  assistantMessage: string;
  events: AgentEvent[];
};

export class AgentRunner {
  constructor(
    private readonly db: AgentDatabase,
    private readonly generations: GenerationManager,
    private readonly provider: DryRunProvider = new DryRunProvider(),
    private readonly events: EventStore = new EventStore(db),
    private readonly contextBuilder: ContextBuilder = new ContextBuilder(db),
  ) {}

  async run(input: RunAgentInput): Promise<RunAgentResult> {
    const session = this.db.prepare("SELECT id FROM chat_sessions WHERE id = ?").get(input.sessionId) as { id: string } | undefined;
    if (!session) {
      throw new Error(`session not found: ${input.sessionId}`);
    }

    const events: AgentEvent[] = [];
    const emit = (event: AgentEvent): void => {
      events.push(event);
      input.onEvent?.(event);
    };

    insertMessage(this.db, input.sessionId, "user", input.message, null);
    const { generation, event: started } = this.generations.createGeneration(input.sessionId);
    emit(started);

    try {
      const context = this.buildContextForGeneration(input.sessionId);
      const contextEvent = this.events.record(
        createAgentEvent({
          sessionId: input.sessionId,
          generationId: generation.id,
          type: "context_built",
          payload: summarizeBuiltContext(context),
          severity: context.warnings.length > 0 ? "warn" : "info",
        }),
      );
      emit(contextEvent);

      for await (const delta of this.provider.stream({ sessionId: input.sessionId, userMessage: input.message, context })) {
        const { event } = this.generations.appendPartial(generation.id, delta);
        emit(event);
      }
      const completedGeneration = this.generations.getGeneration(generation.id);
      const assistantMessage = completedGeneration?.partialContent ?? "";
      insertMessage(this.db, input.sessionId, "assistant", assistantMessage, { generationId: generation.id, provider: "dry-run" });
      const { event: completed } = this.generations.completeGeneration(generation.id);
      emit(completed);
      touchSession(this.db, input.sessionId);
      return { generationId: generation.id, assistantMessage, events };
    } catch (error) {
      const { event: failed } = this.generations.failGeneration(generation.id, error);
      emit(failed);
      throw error;
    }
  }

  private buildContextForGeneration(sessionId: string): BuiltContext {
    try {
      return this.contextBuilder.build(sessionId);
    } catch {
      const builtAt = nowIso();
      return {
        schemaVersion: "0.6",
        builtAt,
        sessionId,
        items: [],
        budget: {
          maxItems: 20,
          maxChars: 12000,
          usedItems: 0,
          usedChars: 0,
          truncated: false,
        },
        warnings: ["context_build_failed"],
      };
    }
  }
}

function insertMessage(
  db: AgentDatabase,
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  metadata: Record<string, unknown> | null,
): void {
  db.prepare(
    `INSERT INTO chat_messages
      (id, session_id, role, content, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), sessionId, role, content, metadata ? JSON.stringify(metadata) : null, nowIso());
}

function touchSession(db: AgentDatabase, sessionId: string): void {
  db.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(nowIso(), sessionId);
}
