import { randomUUID } from "node:crypto";

import type { AgentDatabase } from "../db/connection.js";
import { nowIso } from "../events/AgentEvent.js";
import type { WritebackResult } from "../writeback/WritebackTypes.js";

export type ActionRequestStatus = "running" | "completed" | "failed" | "indeterminate";
export type ActionEffectiveStatus = ActionRequestStatus;
export type ActionResolution = "confirmed_written" | "confirmed_not_written" | "abandoned";

export type ActionRequestRow = {
  request_id: string;
  action_name: string;
  payload_sha256: string;
  status: ActionRequestStatus;
  tool_call_id: string | null;
  result_json: string | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
};

export type ActionResolutionRow = {
  id: string;
  request_id: string;
  resolution: ActionResolution;
  reason: string;
  resolved_by: string;
  created_at: string;
};

export type ActionRequestView = {
  requestId: string;
  actionName: string;
  payloadSha256: string;
  storedStatus: ActionRequestStatus;
  effectiveStatus: ActionEffectiveStatus;
  toolCallId?: string;
  result?: WritebackResult;
  error?: WritebackResult;
  createdAt: string;
  updatedAt: string;
  stale: boolean;
  resolution?: {
    id: string;
    resolution: ActionResolution;
    resolvedBy: string;
    createdAt: string;
    reasonChars: number;
  };
};

export type BeginActionResult =
  | { kind: "started" }
  | { kind: "replay"; row: ActionRequestRow }
  | { kind: "in_progress"; row: ActionRequestRow }
  | { kind: "indeterminate"; row: ActionRequestRow }
  | { kind: "conflict"; row: ActionRequestRow };

export type ResolveActionInput = {
  requestId: string;
  resolution: ActionResolution;
  reason: string;
  resolvedBy: string;
};

export type ResolveActionResult = {
  request: ActionRequestView;
  resolution: ActionResolutionRow;
  result: WritebackResult;
};

export class ActionRequestStore {
  private readonly staleMs: number;

  constructor(
    private readonly db: AgentDatabase,
    options: { staleMs?: number; now?: () => Date } = {},
  ) {
    this.staleMs = options.staleMs ?? runningStaleMs();
    this.now = options.now ?? (() => new Date());
  }

  private readonly now: () => Date;

  begin(actionName: string, requestId: string, payloadSha256: string): BeginActionResult {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.get(requestId);
      if (existing) {
        this.db.exec("COMMIT");
        if (existing.action_name !== actionName || existing.payload_sha256 !== payloadSha256) {
          return { kind: "conflict", row: existing };
        }
        const effectiveStatus = this.effectiveStatus(existing).effectiveStatus;
        if (effectiveStatus === "running") {
          return { kind: "in_progress", row: existing };
        }
        if (effectiveStatus === "indeterminate") {
          return { kind: "indeterminate", row: existing };
        }
        return { kind: "replay", row: existing };
      }

      const ts = nowIso();
      this.db
        .prepare(
          `INSERT INTO action_requests
            (request_id, action_name, payload_sha256, status, tool_call_id, result_json, error_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
        )
        .run(requestId, actionName, payloadSha256, "running", ts, ts);
      this.db.exec("COMMIT");
      return { kind: "started" };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  finish(requestId: string, toolCallId: string, result: WritebackResult): void {
    const status: ActionRequestStatus = result.status === "written" ? "completed" : "failed";
    const resultJson = result.status === "written" ? JSON.stringify(result) : null;
    const errorJson = result.status === "written" ? null : JSON.stringify(result);
    this.db
      .prepare(
        `UPDATE action_requests
         SET status = ?,
             tool_call_id = ?,
             result_json = ?,
             error_json = ?,
             updated_at = ?
         WHERE request_id = ?`,
      )
      .run(status, toolCallId, resultJson, errorJson, nowIso(), requestId);
  }

  resolve(input: ResolveActionInput): ResolveActionResult {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.get(input.requestId);
      if (!row) {
        throw new ActionResolutionError("not_found", "action request not found");
      }

      const existingResolution = this.getResolution(input.requestId);
      if (existingResolution) {
        throw new ActionResolutionError("already_resolved", "action request was already resolved");
      }

      const effective = this.effectiveStatus(row);
      if (effective.effectiveStatus !== "indeterminate") {
        throw new ActionResolutionError("invalid_resolution_state", "only indeterminate requests can be resolved");
      }

      const result = resultForResolution(row.action_name, input.resolution);
      const status: ActionRequestStatus = result.status === "written" ? "completed" : "failed";
      const resultJson = result.status === "written" ? JSON.stringify(result) : null;
      const errorJson = result.status === "written" ? null : JSON.stringify(result);
      const ts = nowIso();
      const resolutionRow: ActionResolutionRow = {
        id: randomUUID(),
        request_id: input.requestId,
        resolution: input.resolution,
        reason: input.reason,
        resolved_by: input.resolvedBy,
        created_at: ts,
      };

      this.db
        .prepare(
          `INSERT INTO action_request_resolutions
            (id, request_id, resolution, reason, resolved_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(resolutionRow.id, resolutionRow.request_id, resolutionRow.resolution, resolutionRow.reason, resolutionRow.resolved_by, resolutionRow.created_at);

      this.db
        .prepare(
          `UPDATE action_requests
           SET status = ?,
               result_json = ?,
               error_json = ?,
               updated_at = ?
           WHERE request_id = ?`,
        )
        .run(status, resultJson, errorJson, ts, input.requestId);

      this.db.exec("COMMIT");
      const updated = this.requireView(input.requestId);
      return {
        request: updated,
        resolution: resolutionRow,
        result,
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  list(input: { status?: string; limit?: number; before?: string } = {}): ActionRequestView[] {
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
    const before = input.before ?? "9999-12-31T23:59:59.999Z";
    const rows = this.db
      .prepare("SELECT * FROM action_requests WHERE updated_at < ? ORDER BY updated_at DESC, request_id DESC LIMIT ?")
      .all(before, limit) as ActionRequestRow[];
    const views = rows.map((row) => this.toView(row));
    return input.status ? views.filter((view) => view.effectiveStatus === input.status || view.storedStatus === input.status) : views;
  }

  getView(requestId: string): ActionRequestView | undefined {
    const row = this.get(requestId);
    return row ? this.toView(row) : undefined;
  }

  requireView(requestId: string): ActionRequestView {
    const view = this.getView(requestId);
    if (!view) {
      throw new ActionResolutionError("not_found", "action request not found");
    }
    return view;
  }

  get(requestId: string): ActionRequestRow | undefined {
    return this.db.prepare("SELECT * FROM action_requests WHERE request_id = ?").get(requestId) as ActionRequestRow | undefined;
  }

  getResolution(requestId: string): ActionResolutionRow | undefined {
    return this.db
      .prepare("SELECT * FROM action_request_resolutions WHERE request_id = ?")
      .get(requestId) as ActionResolutionRow | undefined;
  }

  private toView(row: ActionRequestRow): ActionRequestView {
    const effective = this.effectiveStatus(row);
    const resolution = this.getResolution(row.request_id);
    return {
      requestId: row.request_id,
      actionName: row.action_name,
      payloadSha256: row.payload_sha256,
      storedStatus: row.status,
      effectiveStatus: effective.effectiveStatus,
      toolCallId: row.tool_call_id ?? undefined,
      result: row.result_json ? parseWriteback(row.result_json) : undefined,
      error: row.error_json ? parseWriteback(row.error_json) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      stale: effective.stale,
      resolution: resolution
        ? {
            id: resolution.id,
            resolution: resolution.resolution,
            resolvedBy: resolution.resolved_by,
            createdAt: resolution.created_at,
            reasonChars: resolution.reason.length,
          }
        : undefined,
    };
  }

  private effectiveStatus(row: ActionRequestRow): { effectiveStatus: ActionEffectiveStatus; stale: boolean } {
    if (row.status === "running" && isStale(row.updated_at, this.now(), this.staleMs)) {
      return { effectiveStatus: "indeterminate", stale: true };
    }
    return { effectiveStatus: row.status, stale: false };
  }
}

export class ActionResolutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ActionResolutionError";
  }
}

export function resultFromActionRow(row: ActionRequestRow): WritebackResult | null {
  const value = row.result_json ?? row.error_json;
  if (!value) {
    return null;
  }
  return parseWriteback(value);
}

function parseWriteback(value: string): WritebackResult {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("stored action result is invalid");
  }
  return parsed as WritebackResult;
}

function resultForResolution(actionName: string, resolution: ActionResolution): WritebackResult {
  const operation = operationForAction(actionName);
  if (resolution === "confirmed_written") {
    return {
      status: "written",
      operation,
      message: "The write was confirmed by human verification.",
    };
  }
  if (resolution === "confirmed_not_written") {
    return {
      status: "error",
      operation,
      errorCode: "human_verified_not_written",
      message: "Human verification confirmed that no write was produced.",
    };
  }
  return {
    status: "error",
    operation,
    errorCode: "human_abandoned_indeterminate",
    message: "Human abandoned the indeterminate action without retrying.",
  };
}

function operationForAction(actionName: string): string {
  if (actionName === "inbox-append") {
    return "pkos.inbox.append";
  }
  if (actionName === "state-append") {
    return "pkos.state.append";
  }
  return actionName;
}

function isStale(value: string, now: Date, staleMs: number): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return true;
  }
  return now.getTime() - date.getTime() >= staleMs;
}

function runningStaleMs(): number {
  const raw = process.env.PKOS_ACTION_RUNNING_STALE_MS;
  if (!raw) {
    return 300_000;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
}
