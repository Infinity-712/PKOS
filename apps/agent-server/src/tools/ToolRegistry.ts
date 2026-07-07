import { inboxAppendTool } from "./builtin/inboxAppend.js";
import { stateAppendTool } from "./builtin/stateAppend.js";
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
  registry.register(stateAppendTool);
  return registry;
}
