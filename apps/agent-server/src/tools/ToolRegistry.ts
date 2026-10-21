import { inboxAppendTool } from "./builtin/inboxAppend.js";
import { inboxReviewArchiveTool, inboxReviewRestoreTool } from "./builtin/inboxReview.js";
import { objectCreateTool, objectDeleteTool, objectUpdateTool } from "./builtin/objectAuthority.js";
import { reminderAcknowledgeTool, reminderCancelTool, reminderCreateTool, reminderRescheduleTool } from "./builtin/reminderFlow.js";
import { reviewCorrectionTool, reviewRatingBatchTool, reviewRatingTool } from "./builtin/reviewFlow.js";
import { stateAppendTool } from "./builtin/stateAppend.js";
import { taskCreateTool, taskTransitionTool } from "./builtin/taskFlow.js";
import type { RegisteredToolDefinition, ToolDefinition, ToolDescriptor } from "./ToolTypes.js";

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredToolDefinition>();

  register<TInput, TOutput>(definition: ToolDefinition<TInput, TOutput>): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`tool already registered: ${definition.name}`);
    }
    this.tools.set(definition.name, definition as unknown as RegisteredToolDefinition);
  }

  get(name: string): RegisteredToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDescriptor[] {
    return Array.from(this.tools.values())
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        permissionLevel: tool.permissionLevel,
        sideEffect: tool.sideEffect,
        requiresConfirmation: tool.requiresConfirmation,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(inboxAppendTool);
  registry.register(inboxReviewArchiveTool);
  registry.register(inboxReviewRestoreTool);
  registry.register(stateAppendTool);
  registry.register(taskCreateTool);
  registry.register(taskTransitionTool);
  registry.register(reminderCreateTool);
  registry.register(reminderAcknowledgeTool);
  registry.register(reminderCancelTool);
  registry.register(reminderRescheduleTool);
  registry.register(reviewRatingTool);
  registry.register(reviewRatingBatchTool);
  registry.register(reviewCorrectionTool);
  registry.register(objectCreateTool);
  registry.register(objectUpdateTool);
  registry.register(objectDeleteTool);
  return registry;
}
