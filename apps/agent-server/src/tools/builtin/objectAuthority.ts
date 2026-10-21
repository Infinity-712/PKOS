import {
  optionalString,
  requireNonEmptyString,
  requireRecord,
  textDigest,
  type ToolDefinition,
  type ToolOutput,
} from "../ToolTypes.js";

export type ObjectCreateInput = {
  requestId: string;
  actor: string;
  object: Record<string, unknown>;
};

export type ObjectUpdateInput = {
  requestId: string;
  objectId: string;
  baseRevision: string;
  patch: Record<string, unknown>;
  actor: string;
};

export type ObjectDeleteInput = {
  requestId: string;
  objectId: string;
  typedObjectId: string;
  baseRevision: string;
  reason: string;
  actor: string;
};

const ALLOWED_CREATE_FIELDS = new Set(["requestId", "actor", "object"]);
const ALLOWED_UPDATE_FIELDS = new Set(["requestId", "objectId", "baseRevision", "patch", "actor"]);
const ALLOWED_DELETE_FIELDS = new Set(["requestId", "objectId", "typedObjectId", "baseRevision", "reason", "actor"]);

export const objectCreateTool: ToolDefinition<ObjectCreateInput, ToolOutput> = {
  name: "pkos.object.create",
  description: "Create one human-confirmed PKOS object through the Python authority CLI.",
  permissionLevel: "L2",
  sideEffect: true,
  requiresConfirmation: true,
  validateInput(input: unknown): ObjectCreateInput {
    const record = requireBoundedRecord(input, "pkos.object.create", ALLOWED_CREATE_FIELDS);
    return {
      requestId: requireNonEmptyString(record.requestId, "requestId"),
      actor: optionalString(record.actor, "actor") ?? "human",
      object: requireRecord(record.object, "object"),
    };
  },
  summarizeInput(input: ObjectCreateInput): Record<string, unknown> {
    return summarizeObjectMutation("pkos.object.create", input.requestId, input.actor, input.object);
  },
  async execute(): Promise<ToolOutput> {
    return {
      status: "error",
      operation: "pkos.object.create",
      errorCode: "not_routed",
      message: "Tool execution is handled by WritebackRouter.",
    };
  },
};

export const objectUpdateTool: ToolDefinition<ObjectUpdateInput, ToolOutput> = {
  name: "pkos.object.update",
  description: "Update editable fields on one human-confirmed PKOS object through the Python authority CLI.",
  permissionLevel: "L2",
  sideEffect: true,
  requiresConfirmation: true,
  validateInput(input: unknown): ObjectUpdateInput {
    const record = requireBoundedRecord(input, "pkos.object.update", ALLOWED_UPDATE_FIELDS);
    return {
      requestId: requireNonEmptyString(record.requestId, "requestId"),
      objectId: requireNonEmptyString(record.objectId, "objectId"),
      baseRevision: requireSha256(record.baseRevision, "baseRevision"),
      patch: requireRecord(record.patch, "patch"),
      actor: optionalString(record.actor, "actor") ?? "human",
    };
  },
  summarizeInput(input: ObjectUpdateInput): Record<string, unknown> {
    return {
      operation: "pkos.object.update",
      requestId: input.requestId,
      objectId: input.objectId,
      actor: input.actor,
      baseRevision: input.baseRevision,
      ...summarizeEditableText(input.patch),
    };
  },
  async execute(): Promise<ToolOutput> {
    return {
      status: "error",
      operation: "pkos.object.update",
      errorCode: "not_routed",
      message: "Tool execution is handled by WritebackRouter.",
    };
  },
};

export const objectDeleteTool: ToolDefinition<ObjectDeleteInput, ToolOutput> = {
  name: "pkos.object.delete",
  description: "Hard delete one human-confirmed PKOS object with tombstone through the Python authority CLI.",
  permissionLevel: "L2",
  sideEffect: true,
  requiresConfirmation: true,
  validateInput(input: unknown): ObjectDeleteInput {
    const record = requireBoundedRecord(input, "pkos.object.delete", ALLOWED_DELETE_FIELDS);
    return {
      requestId: requireNonEmptyString(record.requestId, "requestId"),
      objectId: requireNonEmptyString(record.objectId, "objectId"),
      typedObjectId: requireNonEmptyString(record.typedObjectId, "typedObjectId"),
      baseRevision: requireSha256(record.baseRevision, "baseRevision"),
      reason: requireNonEmptyString(record.reason, "reason"),
      actor: optionalString(record.actor, "actor") ?? "human",
    };
  },
  summarizeInput(input: ObjectDeleteInput): Record<string, unknown> {
    return {
      operation: "pkos.object.delete",
      requestId: input.requestId,
      objectId: input.objectId,
      typedObjectId: input.typedObjectId,
      actor: input.actor,
      baseRevision: input.baseRevision,
      ...textDigest(input.reason, "reason"),
    };
  },
  async execute(): Promise<ToolOutput> {
    return {
      status: "error",
      operation: "pkos.object.delete",
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

function requireSha256(value: unknown, field: string): string {
  const text = requireNonEmptyString(value, field);
  if (!/^[0-9a-f]{64}$/i.test(text)) {
    throw new Error(`${field} must be a SHA-256 hex string`);
  }
  return text.toLowerCase();
}

function summarizeObjectMutation(operation: string, requestId: string, actor: string, object: Record<string, unknown>): Record<string, unknown> {
  return {
    operation,
    requestId,
    objectId: typeof object.id === "string" ? object.id : undefined,
    objectType: typeof object.type === "string" ? object.type : undefined,
    status: typeof object.status === "string" ? object.status : undefined,
    actor,
    ...summarizeEditableText(object),
  };
}

function summarizeEditableText(record: Record<string, unknown>): Record<string, unknown> {
  return {
    ...textDigest(typeof record.title === "string" ? record.title : undefined, "title"),
    ...textDigest(typeof record.summary === "string" ? record.summary : undefined, "summary"),
    ...textDigest(typeof record.content === "string" ? record.content : undefined, "content"),
  };
}
