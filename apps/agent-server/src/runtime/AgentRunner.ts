import { randomUUID } from "node:crypto";

import { ContextBuilder, summarizeBuiltContext } from "../context/ContextBuilder.js";
import type { BuiltContext } from "../context/ContextTypes.js";
import type { AgentDatabase } from "../db/connection.js";
import type { AgentEvent } from "../events/AgentEvent.js";
import { createAgentEvent, nowIso } from "../events/AgentEvent.js";
import { EventStore } from "../events/EventStore.js";
import { assemblePromptMessages } from "../providers/PromptAssembler.js";
import { createProviderFromSnapshot } from "../providers/ProviderFactory.js";
import { ProviderRuntimeSelectionStore, ProviderSelectionError, type ProviderSelectionSnapshot } from "../providers/ProviderRuntimeSelection.js";
import { ProviderProfileRegistry } from "../providers/registry/ProviderProfileRegistry.js";
import type { ProviderProfileSummary } from "../providers/registry/ProviderProfileTypes.js";
import { ProviderError, type AgentProvider, type ProviderDelta, type ProviderStatus, type ReasoningPreset } from "../providers/ProviderTypes.js";
import { GenerationManager } from "./GenerationManager.js";

export type RunAgentInput = {
  sessionId: string;
  message: string;
  allowExternalProvider?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
};

export type RunAgentResult = {
  generationId: string;
  assistantMessage: string;
  events: AgentEvent[];
};

export class AgentRunner {
  private readonly providerRegistry: ProviderProfileRegistry;
  private readonly selectionStore: ProviderRuntimeSelectionStore;

  constructor(
    private readonly db: AgentDatabase,
    private readonly generations: GenerationManager,
    providerRegistry: ProviderProfileRegistry = new ProviderProfileRegistry(),
    private readonly events: EventStore = new EventStore(db),
    private readonly contextBuilder: ContextBuilder = new ContextBuilder(db),
  ) {
    this.providerRegistry = providerRegistry;
    this.selectionStore = new ProviderRuntimeSelectionStore(db, providerRegistry);
  }

  getProviderStatus(): ProviderStatus {
    return this.statusForSnapshot(this.selectionStore.getActiveSnapshot());
  }

  getProviderProfiles(): { items: ProviderProfileSummary[] } {
    return { items: this.providerRegistry.summaries() };
  }

  setProviderSelection(input: { profileId: string; modelId: string; reasoningPreset: ReasoningPreset; requestedBy?: string }): ProviderStatus {
    const { previous, next } = this.selectionStore.setActiveSelection(input);
    this.events.record(
      createAgentEvent({
        type: "provider_selection_changed",
        payload: {
          previousProfileId: previous.profileId,
          previousModelId: previous.modelId,
          previousReasoningPreset: previous.reasoningPreset,
          nextProfileId: next.profileId,
          nextModelId: next.modelId,
          nextReasoningPreset: next.reasoningPreset,
          requestedBy: input.requestedBy ?? "desktop",
          timestamp: nowIso(),
        },
      }),
    );
    return this.statusForSnapshot(next);
  }

  abortGeneration(generationId: string): ReturnType<GenerationManager["requestAbort"]> {
    return this.generations.requestAbort(generationId);
  }

  preflight(input: { allowExternalProvider?: boolean }): void {
    const snapshot = this.selectionStore.getActiveSnapshot();
    const provider = createProviderFromSnapshot(snapshot);
    if (!provider) {
      throw new ProviderError("provider_not_configured", "provider is not configured", 503);
    }
    if (snapshot.external && input.allowExternalProvider !== true) {
      throw new ProviderError("external_provider_consent_required", "external provider consent is required for this request", 412);
    }
  }

  async run(input: RunAgentInput): Promise<RunAgentResult> {
    const snapshot = this.selectionStore.getActiveSnapshot();
    const provider = this.requireProvider(snapshot, input);
    const session = this.db.prepare("SELECT id FROM chat_sessions WHERE id = ?").get(input.sessionId) as { id: string } | undefined;
    if (!session) {
      throw new Error(`session not found: ${input.sessionId}`);
    }

    const events: AgentEvent[] = [];
    const emit = (event: AgentEvent | null): void => {
      if (!event) {
        return;
      }
      events.push(event);
      input.onEvent?.(event);
    };

    insertMessage(this.db, input.sessionId, "user", input.message, null);
    const context = this.buildContextForGeneration(input.sessionId);
    const messages = assemblePromptMessages(context, input.message);
    const inputChars = messages.reduce((sum, message) => sum + message.content.length, 0);
    const { generation, event: started } = this.generations.createGeneration(input.sessionId, {
      providerName: snapshot.providerDisplayName,
      modelName: snapshot.modelDisplayName,
      providerId: snapshot.providerId,
      profileId: snapshot.profileId,
      protocol: snapshot.protocol,
      modelId: snapshot.modelId,
      reasoningPreset: snapshot.reasoningPreset,
      endpointOrigin: snapshot.endpointOrigin,
      external: snapshot.external,
      inputChars,
    });
    const controller = new AbortController();
    const abortFromInput = () => controller.abort(new Error("provider_aborted"));
    input.signal?.addEventListener("abort", abortFromInput, { once: true });
    this.generations.registerAbortController(generation.id, controller);
    emit(started);

    let completion: Extract<ProviderDelta, { type: "completed" }> | null = null;
    try {
      const contextEvent = this.events.record(
        createAgentEvent({
          sessionId: input.sessionId,
          generationId: generation.id,
          type: "context_built",
          payload: {
            ...summarizeBuiltContext(context),
            provider: snapshot.providerDisplayName,
            model: snapshot.modelDisplayName,
            providerId: snapshot.providerId,
            profileId: snapshot.profileId,
            protocol: snapshot.protocol,
            modelId: snapshot.modelId,
            reasoningPreset: snapshot.reasoningPreset,
            endpointOrigin: snapshot.endpointOrigin,
            external: snapshot.external,
            promptChars: inputChars,
            externalProviderConsent: input.allowExternalProvider === true,
          },
          severity: context.warnings.length > 0 ? "warn" : "info",
        }),
      );
      emit(contextEvent);

      this.selectionStore.markAttempt(snapshot);
      for await (const delta of provider.stream({ generationId: generation.id, messages, signal: controller.signal })) {
        if (delta.type === "content_delta") {
          const { event } = this.generations.appendPartial(generation.id, delta.text);
          emit(event);
          continue;
        }
        completion = delta;
      }
      const completedGeneration = this.generations.getGeneration(generation.id);
      const assistantMessage = completedGeneration?.partialContent ?? "";
      insertMessage(this.db, input.sessionId, "assistant", assistantMessage, {
        generationId: generation.id,
        provider: snapshot.providerDisplayName,
        model: snapshot.modelDisplayName,
        providerId: snapshot.providerId,
        profileId: snapshot.profileId,
        protocol: snapshot.protocol,
        modelId: snapshot.modelId,
        reasoningPreset: snapshot.reasoningPreset,
        nonAuthority: true,
      });
      const { event: completed } = this.generations.completeGeneration(generation.id, {
        finishReason: completion?.finishReason,
        inputTokens: completion?.usage?.inputTokens,
        outputTokens: completion?.usage?.outputTokens,
      });
      this.selectionStore.markConnected(snapshot);
      emit(completed);
      touchSession(this.db, input.sessionId);
      return { generationId: generation.id, assistantMessage, events };
    } catch (error) {
      if (controller.signal.aborted || (error instanceof ProviderError && error.code === "provider_aborted")) {
        const { event: aborted } = this.generations.abortGeneration(generation.id, "user_requested_abort");
        this.selectionStore.markError(snapshot, "provider_aborted");
        emit(aborted);
      } else {
        const { event: failed } = this.generations.failGeneration(generation.id, error);
        this.selectionStore.markError(snapshot, errorCodeForConnection(error));
        emit(failed);
      }
      throw error;
    } finally {
      input.signal?.removeEventListener("abort", abortFromInput);
      this.generations.clearAbortController(generation.id);
    }
  }

  private requireProvider(snapshot: ProviderSelectionSnapshot, input: { allowExternalProvider?: boolean }): AgentProvider {
    const provider = createProviderFromSnapshot(snapshot);
    if (!provider) {
      throw new ProviderError("provider_not_configured", "provider is not configured", 503);
    }
    if (snapshot.external && input.allowExternalProvider !== true) {
      throw new ProviderError("external_provider_consent_required", "external provider consent is required for this request", 412);
    }
    return provider;
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

  private statusForSnapshot(snapshot: ProviderSelectionSnapshot): ProviderStatus {
    const connection = this.selectionStore.getConnectionRecord(snapshot);
    const reasoningPresets = this.providerRegistry.reasoningPresets(snapshot.model);
    const configured = snapshot.protocol === "dry-run" ? true : snapshot.configured;
    return {
      selection: {
        profileId: snapshot.profileId,
        providerId: snapshot.providerId,
        providerDisplayName: snapshot.providerDisplayName,
        protocol: snapshot.protocol,
        modelId: snapshot.modelId,
        modelDisplayName: snapshot.modelDisplayName,
        reasoningPreset: snapshot.reasoningPreset,
        external: snapshot.external,
        endpointOrigin: snapshot.endpointOrigin,
        apiKeyEnvName: snapshot.apiKeyEnvName,
        keyConfigured: snapshot.keyConfigured,
        warning: snapshot.warning,
      },
      connection,
      consentRequired: snapshot.external,
      configured,
      capabilities: {
        streaming: true,
        textGeneration: true,
        toolCallingEnabled: false,
        reasoningPresets,
      },
      provider: snapshot.protocol,
      model: snapshot.modelId,
      dataEgress: snapshot.external ? "configured-endpoint" : "none",
      toolsEnabled: false,
      readOnly: true,
      ...(!configured ? { errorCode: "provider_not_configured" as const } : {}),
      ...(connection.state === "disabled" ? { errorCode: "provider_profile_disabled" as const } : {}),
    };
  }
}

function errorCodeForConnection(error: unknown): string {
  if (error instanceof ProviderError) {
    return error.code;
  }
  return "unknown_provider_error";
}

export function providerSelectionErrorToProviderError(error: unknown): ProviderError | null {
  if (!(error instanceof ProviderSelectionError)) {
    return null;
  }
  const status = error.code === "provider_profile_disabled" ? 403 : error.code === "unsupported_reasoning_preset" ? 400 : 404;
  return new ProviderError(error.code, error.code, status);
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
