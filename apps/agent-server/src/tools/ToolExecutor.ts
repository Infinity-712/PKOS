import { randomUUID } from "node:crypto";

import type { AgentDatabase } from "../db/connection.js";
import { createAgentEvent, nowIso } from "../events/AgentEvent.js";
import { EventStore } from "../events/EventStore.js";
import { WritebackRouter } from "../writeback/WritebackRouter.js";
import { errorResult, type WritebackResult } from "../writeback/WritebackTypes.js";
import type { ToolExecutionContext } from "./ToolTypes.js";
import { ToolInputError, type RegisteredToolDefinition } from "./ToolTypes.js";
import { ToolRegistry } from "./ToolRegistry.js";

type ToolCallStatus = "running" | "completed" | "failed" | "blocked";

export type ToolExecutionRecord = {
  toolCallId: string;
  result: WritebackResult;
};

export class ToolExecutor {
  constructor(
    private readonly db: AgentDatabase,
    private readonly registry: ToolRegistry,
    private readonly router: WritebackRouter,
    private readonly events: EventStore = new EventStore(db),
  ) {}

  async execute(toolName: string, input: unknown, context: ToolExecutionContext): Promise<WritebackResult> {
    return (await this.executeWithAudit(toolName, input, context)).result;
  }

  async executeWithAudit(toolName: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionRecord> {
    const toolCallId = this.createToolCall(toolName, context);
    this.recordEvent("tool_call_started", context, {
      toolCallId,
      toolName,
      requestedBy: context.requestedBy,
      sourceMessageId: context.sourceMessageId,
    });

    const tool = this.registry.get(toolName);
    if (!tool) {
      const result = this.router.unknownTool(toolName);
      this.updateToolCall(toolCallId, "blocked", null, result, null);
      this.recordEvent("writeback_blocked", context, { toolCallId, toolName, result });
      return { toolCallId, result };
    }

    let validated: unknown;
    let inputSummary: Record<string, unknown>;
    try {
      validated = tool.validateInput(input);
      inputSummary = buildInputSummary(tool, validated, context);
      this.updateToolCall(toolCallId, "running", inputSummary, null, null);
    } catch (error) {
      const result = errorResult({
        operation: toolName,
        errorCode: error instanceof ToolInputError ? error.code : "invalid_input",
        message: error instanceof Error ? error.message : "Invalid tool input",
      });
      this.updateToolCall(toolCallId, "failed", safeInputFailureSummary(toolName, context), null, result);
      this.recordEvent("tool_call_failed", context, { toolCallId, toolName, result });
      return { toolCallId, result };
    }

    this.recordEvent("writeback_requested", context, {
      toolCallId,
      toolName,
      permissionLevel: tool.permissionLevel,
      sideEffect: tool.sideEffect,
      requiresConfirmation: tool.requiresConfirmation,
      inputSummary,
    });

    try {
      const result = await this.router.route(tool, validated, context);
      return { toolCallId, result: this.finalizeResult(toolCallId, toolName, context, inputSummary, result) };
    } catch (error) {
      const result = errorResult({
        operation: toolName,
        errorCode: "error",
        message: error instanceof Error ? error.message : "Tool execution failed",
      });
      this.updateToolCall(toolCallId, "failed", inputSummary, null, result);
      this.recordEvent("tool_call_failed", context, { toolCallId, toolName, result });
      return { toolCallId, result };
    }
  }

  private finalizeResult(
    toolCallId: string,
    toolName: string,
    context: ToolExecutionContext,
    inputSummary: Record<string, unknown>,
    result: WritebackResult,
  ): WritebackResult {
    if (result.status === "written") {
      this.updateToolCall(toolCallId, "completed", inputSummary, result, null);
      this.recordEvent("writeback_written", context, { toolCallId, toolName, result });
      this.recordEvent("tool_call_completed", context, { toolCallId, toolName, result });
      return result;
    }

    if (result.status === "blocked" || result.status === "queued_for_review") {
      this.updateToolCall(toolCallId, "blocked", inputSummary, result, null);
      this.recordEvent("writeback_blocked", context, { toolCallId, toolName, result });
      return result;
    }

    this.updateToolCall(toolCallId, "failed", inputSummary, null, result);
    this.recordEvent("tool_call_failed", context, { toolCallId, toolName, result });
    return result;
  }

  private createToolCall(toolName: string, context: ToolExecutionContext): string {
    const ts = nowIso();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO tool_calls
          (id, session_id, generation_id, tool_name, status, input_json, output_json, error_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
      )
      .run(id, context.sessionId ?? null, context.generationId ?? null, toolName, "running", ts, ts);
    return id;
  }

  private updateToolCall(
    toolCallId: string,
    status: ToolCallStatus,
    inputSummary: Record<string, unknown> | null,
    output: WritebackResult | null,
    error: WritebackResult | null,
  ): void {
    this.db
      .prepare(
        `UPDATE tool_calls
         SET status = ?,
             input_json = COALESCE(?, input_json),
             output_json = ?,
             error_json = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        status,
        inputSummary ? JSON.stringify(inputSummary) : null,
        output ? JSON.stringify(output) : null,
        error ? JSON.stringify(error) : null,
        nowIso(),
        toolCallId,
      );
  }

  private recordEvent(type: Parameters<typeof createAgentEvent>[0]["type"], context: ToolExecutionContext, payload: Record<string, unknown>): void {
    this.events.record(
      createAgentEvent({
        sessionId: context.sessionId,
        generationId: context.generationId,
        type,
        severity: type === "tool_call_failed" || type === "writeback_blocked" ? "warn" : "info",
        payload,
      }),
    );
  }
}

function buildInputSummary(
  tool: RegisteredToolDefinition,
  input: unknown,
  context: ToolExecutionContext,
): Record<string, unknown> {
  return {
    operation: tool.name,
    requestedBy: context.requestedBy,
    sourceMessageId: context.sourceMessageId,
    ...(tool.summarizeInput ? tool.summarizeInput(input) : {}),
  };
}

function safeInputFailureSummary(toolName: string, context: ToolExecutionContext): Record<string, unknown> {
  return {
    operation: toolName,
    requestedBy: context.requestedBy,
    sourceMessageId: context.sourceMessageId,
    inputAccepted: false,
  };
}
