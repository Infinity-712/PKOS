import {
  optionalPlainObject,
  optionalStringArray,
  optionalStringEnum,
  requireNonEmptyString,
  requireRecord,
  textDigest,
  type ToolDefinition,
  type ToolOutput,
} from "../ToolTypes.js";

export type InboxAppendInput = {
  captureType: string;
  content: string;
  source: string;
  status: string;
  tags: string[];
  metadata: Record<string, unknown>;
};

const CAPTURE_TYPES = new Set(["emotion", "knowledge", "note", "other", "recovery", "state", "task", "thought", "writing"]);
const SOURCES = new Set(["app", "import", "manual", "moonlolo", "web"]);
const STATUSES = new Set(["archived", "converted", "unprocessed"]);

export const inboxAppendTool: ToolDefinition<InboxAppendInput, ToolOutput> = {
  name: "pkos.inbox.append",
  description: "Append one PKOS inbox capture through the Python CLI.",
  permissionLevel: "L1",
  sideEffect: true,
  requiresConfirmation: false,
  validateInput(input: unknown): InboxAppendInput {
    const record = requireRecord(input, "pkos.inbox.append");
    return {
      captureType: optionalStringEnum(record.captureType, "captureType", CAPTURE_TYPES, "note"),
      content: requireNonEmptyString(record.content, "content"),
      source: optionalStringEnum(record.source, "source", SOURCES, "manual"),
      status: optionalStringEnum(record.status, "status", STATUSES, "unprocessed"),
      tags: optionalStringArray(record.tags, "tags"),
      metadata: optionalPlainObject(record.metadata, "metadata"),
    };
  },
  summarizeInput(input: InboxAppendInput): Record<string, unknown> {
    return {
      operation: "pkos.inbox.append",
      captureType: input.captureType,
      source: input.source,
      status: input.status,
      tags: input.tags,
      metadataKeys: Object.keys(input.metadata).sort(),
      ...textDigest(input.content, "content"),
    };
  },
  async execute(): Promise<ToolOutput> {
    return {
      status: "error",
      operation: "pkos.inbox.append",
      errorCode: "not_routed",
      message: "Tool execution is handled by WritebackRouter.",
    };
  },
};
