import {
  optionalString,
  requireNonEmptyString,
  requireRecord,
  textDigest,
  type ToolDefinition,
  type ToolOutput,
} from "../ToolTypes.js";

export type ReviewRatingInput = {
  requestId: string;
  objectId: string;
  rating: number;
  reviewedAt: string;
  actor: string;
};

export type ReviewBatchRatingInput = {
  requestId: string;
  items: Array<{ objectId: string; rating: number }>;
  reviewedAt: string;
  actor: string;
};

export type ReviewCorrectionInput = {
  requestId: string;
  targetEventId: string;
  correctedRating: number | null;
  reason: string;
  actor: string;
};

const ALLOWED_RATING_FIELDS = new Set(["requestId", "objectId", "rating", "reviewedAt", "actor"]);
const ALLOWED_BATCH_FIELDS = new Set(["requestId", "items", "reviewedAt", "actor"]);
const ALLOWED_CORRECTION_FIELDS = new Set(["requestId", "targetEventId", "correctedRating", "reason", "actor"]);

export const reviewRatingTool: ToolDefinition<ReviewRatingInput, ToolOutput> = {
  name: "pkos.review.rating",
  description: "Append one human Review/SRS rating through the Python authority CLI.",
  permissionLevel: "L2",
  sideEffect: true,
  requiresConfirmation: true,
  validateInput(input: unknown): ReviewRatingInput {
    const record = requireBoundedRecord(input, "pkos.review.rating", ALLOWED_RATING_FIELDS);
    return {
      requestId: requireNonEmptyString(record.requestId, "requestId"),
      objectId: requireNonEmptyString(record.objectId, "objectId"),
      rating: requireRating(record.rating),
      reviewedAt: requireNonEmptyString(record.reviewedAt, "reviewedAt"),
      actor: optionalString(record.actor, "actor") ?? "human",
    };
  },
  summarizeInput(input: ReviewRatingInput): Record<string, unknown> {
    return {
      operation: "pkos.review.rating",
      requestId: input.requestId,
      objectId: input.objectId,
      rating: input.rating,
      actor: input.actor,
      reviewedAt: input.reviewedAt,
    };
  },
  async execute(): Promise<ToolOutput> {
    return {
      status: "error",
      operation: "pkos.review.rating",
      errorCode: "not_routed",
      message: "Tool execution is handled by WritebackRouter.",
    };
  },
};

export const reviewRatingBatchTool: ToolDefinition<ReviewBatchRatingInput, ToolOutput> = {
  name: "pkos.review.rating_batch",
  description: "Append a deterministic partial human Review/SRS rating batch through the Python authority CLI.",
  permissionLevel: "L2",
  sideEffect: true,
  requiresConfirmation: true,
  validateInput(input: unknown): ReviewBatchRatingInput {
    const record = requireBoundedRecord(input, "pkos.review.rating_batch", ALLOWED_BATCH_FIELDS);
    return {
      requestId: requireNonEmptyString(record.requestId, "requestId"),
      items: requireRatingItems(record.items),
      reviewedAt: requireNonEmptyString(record.reviewedAt, "reviewedAt"),
      actor: optionalString(record.actor, "actor") ?? "human",
    };
  },
  summarizeInput(input: ReviewBatchRatingInput): Record<string, unknown> {
    return {
      operation: "pkos.review.rating_batch",
      requestId: input.requestId,
      itemCount: input.items.length,
      objectIds: input.items.map((item) => item.objectId),
      ratings: input.items.map((item) => item.rating),
      actor: input.actor,
      reviewedAt: input.reviewedAt,
    };
  },
  async execute(): Promise<ToolOutput> {
    return {
      status: "error",
      operation: "pkos.review.rating_batch",
      errorCode: "not_routed",
      message: "Tool execution is handled by WritebackRouter.",
    };
  },
};

export const reviewCorrectionTool: ToolDefinition<ReviewCorrectionInput, ToolOutput> = {
  name: "pkos.review.correction",
  description: "Append one human Review/SRS correction through the Python authority CLI.",
  permissionLevel: "L2",
  sideEffect: true,
  requiresConfirmation: true,
  validateInput(input: unknown): ReviewCorrectionInput {
    const record = requireBoundedRecord(input, "pkos.review.correction", ALLOWED_CORRECTION_FIELDS);
    return {
      requestId: requireNonEmptyString(record.requestId, "requestId"),
      targetEventId: requireNonEmptyString(record.targetEventId, "targetEventId"),
      correctedRating: record.correctedRating === null || record.correctedRating === undefined ? null : requireRating(record.correctedRating),
      reason: requireNonEmptyString(record.reason, "reason"),
      actor: optionalString(record.actor, "actor") ?? "human",
    };
  },
  summarizeInput(input: ReviewCorrectionInput): Record<string, unknown> {
    return {
      operation: "pkos.review.correction",
      requestId: input.requestId,
      targetEventId: input.targetEventId,
      correctedRating: input.correctedRating,
      actor: input.actor,
      ...textDigest(input.reason, "reason"),
    };
  },
  async execute(): Promise<ToolOutput> {
    return {
      status: "error",
      operation: "pkos.review.correction",
      errorCode: "not_routed",
      message: "Tool execution is handled by WritebackRouter.",
    };
  },
};

function requireRating(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
    throw new Error("rating must be an integer from 1 to 5");
  }
  return parsed;
}

function requireRatingItems(value: unknown): Array<{ objectId: string; rating: number }> {
  if (!Array.isArray(value)) {
    throw new Error("items must be an array");
  }
  if (value.length < 1 || value.length > 100) {
    throw new Error("items must contain 1 to 100 entries");
  }
  return value.map((item, index) => {
    const record = requireRecord(item, `items[${index}]`);
    return {
      objectId: requireNonEmptyString(record.objectId, `items[${index}].objectId`),
      rating: requireRating(record.rating),
    };
  });
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
