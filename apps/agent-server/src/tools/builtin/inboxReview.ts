import { createHash } from "node:crypto";

import {
  requireNonEmptyString,
  requireRecord,
  type ToolDefinition,
  type ToolOutput,
} from "../ToolTypes.js";

export type InboxReviewStatus = "archived" | "unprocessed";

export type InboxReviewMarkInput = {
  inboxId: string;
  reason: string;
};

const ALLOWED_FIELDS = new Set(["inboxId", "reason"]);

function validateInboxReviewInput(input: unknown, toolName: string): InboxReviewMarkInput {
  const record = requireRecord(input, toolName);
  for (const key of Object.keys(record)) {
    if (!ALLOWED_FIELDS.has(key)) {
      throw new Error(`${key} is not allowed for ${toolName}`);
    }
  }
  return {
    inboxId: requireNonEmptyString(record.inboxId, "inboxId"),
    reason: requireNonEmptyString(record.reason, "reason"),
  };
}

function summarizeReviewInput(input: InboxReviewMarkInput, desiredStatus: InboxReviewStatus, operation: string): Record<string, unknown> {
  return {
    operation,
    inboxId: input.inboxId,
    desiredStatus,
    reasonChars: input.reason.length,
    reasonSha256: createHash("sha256").update(input.reason, "utf8").digest("hex"),
  };
}

function createInboxReviewTool(name: string, desiredStatus: InboxReviewStatus, description: string): ToolDefinition<InboxReviewMarkInput, ToolOutput> {
  return {
    name,
    description,
    permissionLevel: "L2",
    sideEffect: true,
    requiresConfirmation: true,
    validateInput(input: unknown): InboxReviewMarkInput {
      return validateInboxReviewInput(input, name);
    },
    summarizeInput(input: InboxReviewMarkInput): Record<string, unknown> {
      return summarizeReviewInput(input, desiredStatus, name);
    },
    async execute(): Promise<ToolOutput> {
      return {
        status: "error",
        operation: name,
        errorCode: "not_routed",
        message: "Tool execution is handled by WritebackRouter.",
      };
    },
  };
}

export const inboxReviewArchiveTool = createInboxReviewTool(
  "pkos.inbox_review.archive",
  "archived",
  "Archive one Inbox Review item through the Python CLI.",
);

export const inboxReviewRestoreTool = createInboxReviewTool(
  "pkos.inbox_review.restore",
  "unprocessed",
  "Restore one Inbox Review item to unprocessed through the Python CLI.",
);
