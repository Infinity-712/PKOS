import {
  optionalString,
  optionalStringArray,
  optionalStringEnum,
  requireNonEmptyString,
  requireRecord,
  requireStringEnum,
  textDigest,
  type ToolDefinition,
  type ToolOutput,
} from "../ToolTypes.js";

export type TaskCreateInput = {
  requestId: string;
  title: string;
  description?: string;
  source: string;
  tags: string[];
  priority: string;
  dueAt?: string | null;
  createdBy: string;
};

export type TaskTransitionInput = {
  requestId: string;
  taskId: string;
  targetStatus: string;
  reason: string;
  createdBy: string;
};

const PRIORITIES = new Set(["low", "normal", "high"]);
const STATUSES = new Set(["open", "in_progress", "blocked", "done", "cancelled"]);
const SOURCES = new Set(["manual", "web", "app", "moonlolo", "import"]);
const ALLOWED_CREATE_FIELDS = new Set(["requestId", "title", "description", "source", "tags", "priority", "dueAt", "createdBy"]);
const ALLOWED_TRANSITION_FIELDS = new Set(["requestId", "taskId", "targetStatus", "reason", "createdBy"]);

export const taskCreateTool: ToolDefinition<TaskCreateInput, ToolOutput> = {
  name: "pkos.task.create",
  description: "Create one formal PKOS task through the Python CLI.",
  permissionLevel: "L2",
  sideEffect: true,
  requiresConfirmation: true,
  validateInput(input: unknown): TaskCreateInput {
    const record = requireBoundedRecord(input, "pkos.task.create", ALLOWED_CREATE_FIELDS);
    return {
      requestId: requireNonEmptyString(record.requestId, "requestId"),
      title: requireNonEmptyString(record.title, "title"),
      description: optionalString(record.description, "description"),
      source: optionalStringEnum(record.source, "source", SOURCES, "web"),
      tags: optionalStringArray(record.tags, "tags"),
      priority: optionalStringEnum(record.priority, "priority", PRIORITIES, "normal"),
      dueAt: optionalString(record.dueAt, "dueAt") ?? null,
      createdBy: optionalString(record.createdBy, "createdBy") ?? "human",
    };
  },
  summarizeInput(input: TaskCreateInput): Record<string, unknown> {
    return {
      operation: "pkos.task.create",
      requestId: input.requestId,
      source: input.source,
      tags: input.tags,
      priority: input.priority,
      dueAtPresent: Boolean(input.dueAt),
      createdBy: input.createdBy,
      ...textDigest(input.title, "title"),
      ...textDigest(input.description, "description"),
    };
  },
  async execute(): Promise<ToolOutput> {
    return {
      status: "error",
      operation: "pkos.task.create",
      errorCode: "not_routed",
      message: "Tool execution is handled by WritebackRouter.",
    };
  },
};

export const taskTransitionTool: ToolDefinition<TaskTransitionInput, ToolOutput> = {
  name: "pkos.task.transition",
  description: "Append one formal PKOS task status transition through the Python CLI.",
  permissionLevel: "L2",
  sideEffect: true,
  requiresConfirmation: true,
  validateInput(input: unknown): TaskTransitionInput {
    const record = requireBoundedRecord(input, "pkos.task.transition", ALLOWED_TRANSITION_FIELDS);
    return {
      requestId: requireNonEmptyString(record.requestId, "requestId"),
      taskId: requireNonEmptyString(record.taskId, "taskId"),
      targetStatus: requireStringEnum(record.targetStatus, "targetStatus", STATUSES),
      reason: requireNonEmptyString(record.reason, "reason"),
      createdBy: optionalString(record.createdBy, "createdBy") ?? "human",
    };
  },
  summarizeInput(input: TaskTransitionInput): Record<string, unknown> {
    return {
      operation: "pkos.task.transition",
      requestId: input.requestId,
      taskId: input.taskId,
      targetStatus: input.targetStatus,
      createdBy: input.createdBy,
      ...textDigest(input.reason, "reason"),
    };
  },
  async execute(): Promise<ToolOutput> {
    return {
      status: "error",
      operation: "pkos.task.transition",
      errorCode: "not_routed",
      message: "Tool execution is handled by WritebackRouter.",
    };
  },
};

function requireBoundedRecord(input: unknown, toolName: string, allowedFields: Set<string>): Record<string, unknown> {
  const record = requireRecord(input, toolName);
  for (const key of Object.keys(record)) {
    if (!allowedFields.has(key)) {
      throw new Error(`${key} is not allowed for ${toolName}`);
    }
  }
  return record;
}
