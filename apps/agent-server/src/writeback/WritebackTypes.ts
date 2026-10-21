export type WritebackStatus = "written" | "queued_for_review" | "blocked" | "duplicate" | "error";

export type ReviewBatchOutcome = {
  items: Array<{ objectId: string; requestId: string; status: "written" | "replayed"; eventId: string }>;
  failures: Array<{ objectId: string; requestId: string; code: string }>;
};

export type WritebackResult = {
  status: WritebackStatus;
  operation: string;
  recordId?: string;
  target?: string;
  errorCode?: string;
  commitHash?: string | null;
  changedFiles?: string[];
  fileRevisionSha256?: string;
  objectContentSha256?: string;
  reviewBatch?: ReviewBatchOutcome;
  message: string;
};

export function writtenResult(input: {
  operation: string;
  recordId?: string;
  target?: string;
  commitHash?: string | null;
  changedFiles?: string[];
  fileRevisionSha256?: string;
  objectContentSha256?: string;
  reviewBatch?: ReviewBatchOutcome;
  message: string;
}): WritebackResult {
  return {
    status: "written",
    operation: input.operation,
    recordId: input.recordId,
    target: input.target,
    commitHash: input.commitHash,
    changedFiles: input.changedFiles,
    fileRevisionSha256: input.fileRevisionSha256,
    objectContentSha256: input.objectContentSha256,
    ...(input.reviewBatch ? { reviewBatch: input.reviewBatch } : {}),
    message: input.message,
  };
}

export function errorResult(input: { operation: string; errorCode: string; message: string; reviewBatch?: ReviewBatchOutcome }): WritebackResult {
  return {
    status: "error",
    operation: input.operation,
    errorCode: input.errorCode,
    message: input.message,
    ...(input.reviewBatch ? { reviewBatch: input.reviewBatch } : {}),
  };
}

export function blockedResult(input: { operation: string; errorCode: string; message: string }): WritebackResult {
  return {
    status: "blocked",
    operation: input.operation,
    errorCode: input.errorCode,
    message: input.message,
  };
}
