import {
  optionalString,
  optionalStringEnum,
  requireNonEmptyString,
  requireRecord,
  textDigest,
  type ToolDefinition,
  type ToolOutput,
} from "../ToolTypes.js";

export type ReminderCreateInput = {
  requestId: string;
  title: string;
  description?: string;
  remindAt: string;
  taskId?: string | null;
  source: string;
  createdBy: string;
};

export type ReminderActionInput = {
  requestId: string;
  reminderId: string;
  reason: string;
  createdBy: string;
};

export type ReminderRescheduleInput = ReminderActionInput & {
  remindAt: string;
};

const SOURCES = new Set(["manual", "web", "app", "moonlolo", "import"]);
const ALLOWED_CREATE_FIELDS = new Set(["requestId", "title", "description", "remindAt", "taskId", "source", "createdBy"]);
const ALLOWED_ACTION_FIELDS = new Set(["requestId", "reminderId", "reason", "createdBy"]);
const ALLOWED_RESCHEDULE_FIELDS = new Set(["requestId", "reminderId", "remindAt", "reason", "createdBy"]);

export const reminderCreateTool: ToolDefinition<ReminderCreateInput, ToolOutput> = {
  name: "pkos.reminder.create",
  description: "Create one one-shot PKOS Reminder through the Python CLI.",
  permissionLevel: "L2",
  sideEffect: true,
  requiresConfirmation: true,
  validateInput(input: unknown): ReminderCreateInput {
    const record = requireBoundedRecord(input, "pkos.reminder.create", ALLOWED_CREATE_FIELDS);
    return {
      requestId: requireNonEmptyString(record.requestId, "requestId"),
      title: requireNonEmptyString(record.title, "title"),
      description: optionalString(record.description, "description"),
      remindAt: requireNonEmptyString(record.remindAt, "remindAt"),
      taskId: optionalString(record.taskId, "taskId") ?? null,
      source: optionalStringEnum(record.source, "source", SOURCES, "web"),
      createdBy: optionalString(record.createdBy, "createdBy") ?? "human",
    };
  },
  summarizeInput(input: ReminderCreateInput): Record<string, unknown> {
    return {
      operation: "pkos.reminder.create",
      requestId: input.requestId,
      remindAt: input.remindAt,
      taskId: input.taskId,
      source: input.source,
      createdBy: input.createdBy,
      ...textDigest(input.title, "title"),
      ...textDigest(input.description, "description"),
    };
  },
  async execute(): Promise<ToolOutput> {
    return {
      status: "error",
      operation: "pkos.reminder.create",
      errorCode: "not_routed",
      message: "Tool execution is handled by WritebackRouter.",
    };
  },
};

export const reminderAcknowledgeTool = reminderActionTool({
  name: "pkos.reminder.acknowledge",
  description: "Append one PKOS Reminder acknowledgement through the Python CLI.",
});

export const reminderCancelTool = reminderActionTool({
  name: "pkos.reminder.cancel",
  description: "Append one PKOS Reminder cancellation through the Python CLI.",
});

export const reminderRescheduleTool: ToolDefinition<ReminderRescheduleInput, ToolOutput> = {
  name: "pkos.reminder.reschedule",
  description: "Append one PKOS Reminder reschedule action through the Python CLI.",
  permissionLevel: "L2",
  sideEffect: true,
  requiresConfirmation: true,
  validateInput(input: unknown): ReminderRescheduleInput {
    const record = requireBoundedRecord(input, "pkos.reminder.reschedule", ALLOWED_RESCHEDULE_FIELDS);
    return {
      requestId: requireNonEmptyString(record.requestId, "requestId"),
      reminderId: requireNonEmptyString(record.reminderId, "reminderId"),
      remindAt: requireNonEmptyString(record.remindAt, "remindAt"),
      reason: requireNonEmptyString(record.reason, "reason"),
      createdBy: optionalString(record.createdBy, "createdBy") ?? "human",
    };
  },
  summarizeInput(input: ReminderRescheduleInput): Record<string, unknown> {
    return {
      operation: "pkos.reminder.reschedule",
      requestId: input.requestId,
      reminderId: input.reminderId,
      remindAt: input.remindAt,
      createdBy: input.createdBy,
      ...textDigest(input.reason, "reason"),
    };
  },
  async execute(): Promise<ToolOutput> {
    return {
      status: "error",
      operation: "pkos.reminder.reschedule",
      errorCode: "not_routed",
      message: "Tool execution is handled by WritebackRouter.",
    };
  },
};

function reminderActionTool(input: { name: string; description: string }): ToolDefinition<ReminderActionInput, ToolOutput> {
  return {
    name: input.name,
    description: input.description,
    permissionLevel: "L2",
    sideEffect: true,
    requiresConfirmation: true,
    validateInput(candidate: unknown): ReminderActionInput {
      const record = requireBoundedRecord(candidate, input.name, ALLOWED_ACTION_FIELDS);
      return {
        requestId: requireNonEmptyString(record.requestId, "requestId"),
        reminderId: requireNonEmptyString(record.reminderId, "reminderId"),
        reason: requireNonEmptyString(record.reason, "reason"),
        createdBy: optionalString(record.createdBy, "createdBy") ?? "human",
      };
    },
    summarizeInput(candidate: ReminderActionInput): Record<string, unknown> {
      return {
        operation: input.name,
        requestId: candidate.requestId,
        reminderId: candidate.reminderId,
        createdBy: candidate.createdBy,
        ...textDigest(candidate.reason, "reason"),
      };
    },
    async execute(): Promise<ToolOutput> {
      return {
        status: "error",
        operation: input.name,
        errorCode: "not_routed",
        message: "Tool execution is handled by WritebackRouter.",
      };
    },
  };
}

function requireBoundedRecord(input: unknown, toolName: string, allowedFields: Set<string>): Record<string, unknown> {
  const record = requireRecord(input, toolName);
  for (const key of Object.keys(record)) {
    if (!allowedFields.has(key)) {
      throw new Error(`${key} is not allowed for ${toolName}`);
    }
  }
  return record;
}
