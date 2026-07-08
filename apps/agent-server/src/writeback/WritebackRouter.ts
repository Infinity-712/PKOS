import type { InboxAppendInput } from "../tools/builtin/inboxAppend.js";
import type { InboxReviewMarkInput } from "../tools/builtin/inboxReview.js";
import type { StateAppendInput } from "../tools/builtin/stateAppend.js";
import type { RegisteredToolDefinition, ToolExecutionContext } from "../tools/ToolTypes.js";
import { PkosCliClient } from "./PkosCliClient.js";
import { blockedResult, type WritebackResult } from "./WritebackTypes.js";

const DIRECT_WRITE_TOOLS = new Set([
  "pkos.inbox.append",
  "pkos.inbox_review.archive",
  "pkos.inbox_review.restore",
  "pkos.state.append",
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
