export type WritebackStatus = "written" | "queued_for_review" | "blocked" | "duplicate" | "error";

export type WritebackResult = {
  status: WritebackStatus;
  operation: string;
  recordId?: string;
  target?: string;
  errorCode?: string;
  message: string;
};

export function writtenResult(input: {
  operation: string;
  recordId?: string;
  target?: string;
  message: string;
}): WritebackResult {
  return {
    status: "written",
    operation: input.operation,
    recordId: input.recordId,
    target: input.target,
    message: input.message,
  };
}

export function errorResult(input: { operation: string; errorCode: string; message: string }): WritebackResult {
  return {
    status: "error",
    operation: input.operation,
    errorCode: input.errorCode,
    message: input.message,
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
