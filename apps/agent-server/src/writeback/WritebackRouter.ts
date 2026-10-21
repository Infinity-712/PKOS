import type { InboxAppendInput } from "../tools/builtin/inboxAppend.js";
import type { InboxReviewMarkInput } from "../tools/builtin/inboxReview.js";
import type { ObjectCreateInput, ObjectDeleteInput, ObjectUpdateInput } from "../tools/builtin/objectAuthority.js";
import type { ReminderActionInput, ReminderCreateInput, ReminderRescheduleInput } from "../tools/builtin/reminderFlow.js";
import type { ReviewBatchRatingInput, ReviewCorrectionInput, ReviewRatingInput } from "../tools/builtin/reviewFlow.js";
import type { StateAppendInput } from "../tools/builtin/stateAppend.js";
import type { TaskCreateInput, TaskTransitionInput } from "../tools/builtin/taskFlow.js";
import type { RegisteredToolDefinition, ToolExecutionContext } from "../tools/ToolTypes.js";
import { PkosCliClient } from "./PkosCliClient.js";
import { blockedResult, type WritebackResult } from "./WritebackTypes.js";

const DIRECT_WRITE_TOOLS = new Set([
  "pkos.inbox.append",
  "pkos.inbox_review.archive",
  "pkos.inbox_review.restore",
  "pkos.state.append",
  "pkos.task.create",
  "pkos.task.transition",
  "pkos.reminder.create",
  "pkos.reminder.acknowledge",
  "pkos.reminder.cancel",
  "pkos.reminder.reschedule",
  "pkos.review.rating",
  "pkos.review.rating_batch",
  "pkos.review.correction",
  "pkos.object.create",
  "pkos.object.update",
  "pkos.object.delete",
]);

export class WritebackRouter {
  constructor(private readonly cli: PkosCliClient = new PkosCliClient()) {}

  route(tool: RegisteredToolDefinition, input: unknown, context: ToolExecutionContext): Promise<WritebackResult> {
    const permissionBlocked = this.checkPermission(tool, context);
    if (permissionBlocked) {
      return Promise.resolve(permissionBlocked);
    }

    if (!DIRECT_WRITE_TOOLS.has(tool.name)) {
      return Promise.resolve(
        blockedResult({
          operation: tool.name,
          errorCode: "permission_denied",
          message: "Tool is not in the direct writeback allowlist",
        }),
      );
    }

    if (tool.name === "pkos.inbox.append") {
      return this.cli.inboxAppend(input as InboxAppendInput);
    }
    if (tool.name === "pkos.inbox_review.archive") {
      return this.cli.inboxReviewArchive(input as InboxReviewMarkInput);
    }
    if (tool.name === "pkos.inbox_review.restore") {
      return this.cli.inboxReviewRestore(input as InboxReviewMarkInput);
    }
    if (tool.name === "pkos.state.append") {
      return this.cli.stateAppend(input as StateAppendInput);
    }
    if (tool.name === "pkos.task.create") {
      return this.cli.taskCreate(input as TaskCreateInput);
    }
    if (tool.name === "pkos.task.transition") {
      return this.cli.taskTransition(input as TaskTransitionInput);
    }
    if (tool.name === "pkos.reminder.create") {
      return this.cli.reminderCreate(input as ReminderCreateInput);
    }
    if (tool.name === "pkos.reminder.acknowledge") {
      return this.cli.reminderAcknowledge(input as ReminderActionInput);
    }
    if (tool.name === "pkos.reminder.cancel") {
      return this.cli.reminderCancel(input as ReminderActionInput);
    }
    if (tool.name === "pkos.reminder.reschedule") {
      return this.cli.reminderReschedule(input as ReminderRescheduleInput);
    }
    if (tool.name === "pkos.review.rating") {
      return this.cli.reviewRate(input as ReviewRatingInput);
    }
    if (tool.name === "pkos.review.rating_batch") {
      return this.cli.reviewRateBatch(input as ReviewBatchRatingInput);
    }
    if (tool.name === "pkos.review.correction") {
      return this.cli.reviewCorrect(input as ReviewCorrectionInput);
    }
    if (tool.name === "pkos.object.create") {
      return this.cli.objectCreate(input as ObjectCreateInput);
    }
    if (tool.name === "pkos.object.update") {
      return this.cli.objectUpdate(input as ObjectUpdateInput);
    }
    if (tool.name === "pkos.object.delete") {
      return this.cli.objectDelete(input as ObjectDeleteInput);
    }

    return Promise.resolve(
      blockedResult({
        operation: tool.name,
        errorCode: "permission_denied",
        message: "Tool is not allowed",
      }),
    );
  }

  unknownTool(toolName: string): WritebackResult {
    return blockedResult({
      operation: toolName,
      errorCode: "unknown_tool",
      message: "Tool is not registered",
    });
  }

  private checkPermission(tool: RegisteredToolDefinition, context: ToolExecutionContext): WritebackResult | null {
    if (tool.permissionLevel === "L3" || tool.permissionLevel === "L4") {
      return blockedResult({
        operation: tool.name,
        errorCode: "permission_denied",
        message: "Authority, destructive, and governance writes are human-only",
      });
    }
    if (tool.requiresConfirmation && !context.confirmed) {
      return blockedResult({
        operation: tool.name,
        errorCode: "confirmation_required",
        message: "Tool requires explicit confirmation",
      });
    }
    if (tool.permissionLevel === "L2" && context.requestedBy === "user_explicit") {
      return null;
    }
    if (tool.permissionLevel !== "L1") {
      return blockedResult({
        operation: tool.name,
        errorCode: "permission_denied",
        message: "Only L1 append-only writeback tools are enabled",
      });
    }
    return null;
  }
}
