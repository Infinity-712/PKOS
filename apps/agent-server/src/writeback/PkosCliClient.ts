import { platform } from "node:os";

import { resolveAgentPaths, type AgentPaths } from "../config/paths.js";
import type { InboxAppendInput } from "../tools/builtin/inboxAppend.js";
import type { InboxReviewMarkInput, InboxReviewStatus } from "../tools/builtin/inboxReview.js";
import type { StateAppendInput } from "../tools/builtin/stateAppend.js";
import { CliProcessRunner, type CliProcessRunResult } from "./CliProcessRunner.js";
import { errorResult, type WritebackResult, writtenResult } from "./WritebackTypes.js";

type PkosCliClientOptions = {
  paths?: AgentPaths;
  pythonBin?: string;
  timeoutMs?: number;
  runner?: CliProcessRunner;
};

export type InboxReviewListFilters = {
  status?: string;
  source?: string;
  tag?: string;
  limit?: number;
};

export type InboxReviewCliItem = {
  id: string;
  effective_status: string;
  source: string;
  capture_type: string;
  created_at: string;
  content: string;
  tags: string[];
  review_action_id: string;
  reviewed_at: string;
  review_reason: string;
};

export type InboxReviewCliListResult =
  | { ok: true; items: InboxReviewCliItem[]; count: number; generatedAt: string }
  | { ok: false; errorCode: string; message: string };

export type StateTimelineFilters = {
  energy?: string;
  mood?: string;
  mode?: string;
  limit?: number;
};

export type StateTimelineCliItem = {
  id: string;
  source: string;
  energy: string;
  mood: string;
  body: string;
  context: string;
  mode: string;
  risk: Record<string, string>;
  note: string | null;
  created_at: string;
};

export type StateTimelineCliResult =
  | {
      ok: true;
      current: StateTimelineCliItem | null;
      items: StateTimelineCliItem[];
      count: number;
      filters: Record<string, unknown>;
    }
  | { ok: false; errorCode: string; message: string };

const MAX_OUTPUT_BYTES = 64 * 1024;

export class PkosCliClient {
  private readonly paths: AgentPaths;
  private readonly pythonBin: string;
  private readonly timeoutMs: number;
  private readonly runner: CliProcessRunner;

  constructor(options: PkosCliClientOptions = {}) {
    this.paths = options.paths ?? resolveAgentPaths();
    this.pythonBin = options.pythonBin ?? process.env.PKOS_PYTHON_BIN ?? (platform() === "win32" ? "python" : "python3");
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.runner = options.runner ?? new CliProcessRunner();
  }

  async inboxAppend(input: InboxAppendInput): Promise<WritebackResult> {
    const args = [
      "-B",
      "-m",
      "tools.pkos",
      "inbox-append",
      "--capture-type",
      input.captureType,
      "--content",
      input.content,
      "--source",
      input.source,
      "--status",
      input.status,
      "--json",
    ];
    if (input.tags.length > 0) {
      args.push("--tags", input.tags.join(","));
    }
    if (Object.keys(input.metadata).length > 0) {
      args.push("--metadata-json", JSON.stringify(input.metadata));
    }
    return this.runJsonCommand("pkos.inbox.append", args);
  }

  async stateAppend(input: StateAppendInput): Promise<WritebackResult> {
    const args = [
      "-B",
      "-m",
      "tools.pkos",
      "state-append",
      "--energy",
      input.energy,
      "--mood",
      input.mood,
      "--body",
      input.body,
      "--context",
      input.context,
      "--mode",
      input.mode,
      "--risk-short-video",
      input.risk.shortVideo,
      "--risk-rumination",
      input.risk.rumination,
      "--risk-overload",
      input.risk.overload,
      "--source",
      input.source,
      "--json",
    ];
    if (input.note) {
      args.push("--note", input.note);
    }
    return this.runJsonCommand("pkos.state.append", args);
  }

  async inboxReviewArchive(input: InboxReviewMarkInput): Promise<WritebackResult> {
    return this.inboxReviewMark("pkos.inbox_review.archive", "archived", input);
  }

  async inboxReviewRestore(input: InboxReviewMarkInput): Promise<WritebackResult> {
    return this.inboxReviewMark("pkos.inbox_review.restore", "unprocessed", input);
  }

  async inboxReviewList(filters: InboxReviewListFilters): Promise<InboxReviewCliListResult> {
    const args = ["-B", "-m", "tools.pkos", "inbox-review", "list", "--json"];
    if (filters.status) {
      args.push("--status", filters.status);
    }
    if (filters.source) {
      args.push("--source", filters.source);
    }
    if (filters.tag) {
      args.push("--tag", filters.tag);
    }
    if (filters.limit !== undefined) {
      args.push("--limit", String(filters.limit));
    }

    const result = await this.runRawCommand(args);
    if (result.error) {
      return result.error;
    }
    const payload = parseCliJson("pkos.inbox_review.list", result.result);
    if (!payload) {
      return { ok: false, errorCode: "cli_failed", message: "PKOS CLI returned invalid JSON" };
    }
    if (payload.ok === false) {
      return {
        ok: false,
        errorCode: cliErrorCode(payload),
        message: "PKOS CLI rejected inbox review list",
      };
    }
    return {
      ok: true,
      generatedAt: typeof payload.generated_at === "string" ? payload.generated_at : "",
      count: typeof payload.count === "number" ? payload.count : 0,
      items: normalizeInboxReviewCliItems(payload.items),
    };
  }

  async stateTimeline(filters: StateTimelineFilters): Promise<StateTimelineCliResult> {
    const args = ["-B", "-m", "tools.pkos", "state-list", "--json"];
    if (filters.energy) {
      args.push("--energy", filters.energy);
    }
    if (filters.mood) {
      args.push("--mood", filters.mood);
    }
    if (filters.mode) {
      args.push("--mode", filters.mode);
    }
    if (filters.limit !== undefined) {
      args.push("--limit", String(filters.limit));
    }

    const result = await this.runRawCommand(args);
    if (result.error) {
      return result.error;
    }
    const payload = parseCliJson("pkos.state.timeline", result.result);
    if (!payload) {
      return { ok: false, errorCode: "cli_failed", message: "PKOS CLI returned invalid JSON" };
    }
    if (payload.ok === false) {
      return {
        ok: false,
        errorCode: cliErrorCode(payload),
        message: "PKOS CLI rejected state timeline query",
      };
    }
    return {
      ok: true,
      current: isRecord(payload.current) ? normalizeStateTimelineCliItem(payload.current) : null,
      items: normalizeStateTimelineCliItems(payload.items),
      count: typeof payload.count === "number" ? payload.count : 0,
      filters: isRecord(payload.filters) ? payload.filters : {},
    };
  }

  private async inboxReviewMark(operation: string, status: InboxReviewStatus, input: InboxReviewMarkInput): Promise<WritebackResult> {
    const args = [
      "-B",
      "-m",
      "tools.pkos",
      "inbox-review",
      "mark",
      "--id",
      input.inboxId,
      "--status",
      status,
      "--reason",
      input.reason,
      "--json",
    ];
    const result = await this.runRawCommand(args);
    if (result.error) {
      return result.errorResult(operation);
    }
    const payload = parseCliJson(operation, result.result);
    if (!payload || payload.ok !== true) {
      return errorResult({ operation, errorCode: cliErrorCode(payload), message: "PKOS CLI returned invalid inbox review JSON" });
    }
    const action = isRecord(payload.action) ? payload.action : {};
    const recordId = typeof action.id === "string" ? action.id : undefined;
    const target = typeof payload.action_log_path === "string" ? payload.action_log_path : undefined;
    return writtenResult({
      operation,
      recordId,
      target,
      message: "PKOS inbox review action appended",
    });
  }

  private async runJsonCommand(operation: string, args: string[]): Promise<WritebackResult> {
    const result = await this.runRawCommand(args);
    if (result.error) {
      return result.errorResult(operation);
    }

    const payload = parseCliJson(operation, result.result);
    if (!payload || payload.ok !== true) {
      return errorResult({ operation, errorCode: "cli_failed", message: "PKOS CLI returned invalid JSON" });
    }
    const recordId = typeof payload.id === "string" ? payload.id : undefined;
    const target = typeof payload.path === "string" ? payload.path : undefined;
    return writtenResult({
      operation,
      recordId,
      target,
      message: "PKOS append completed",
    });
  }

  private async runRawCommand(args: string[]): Promise<
    | { result: CliProcessRunResult; error?: undefined }
    | { error: { ok: false; errorCode: string; message: string }; errorResult(operation: string): WritebackResult }
  > {
    const result = await this.runner.run({
      executable: this.pythonBin,
      args,
      cwd: this.paths.coreRoot,
      env: buildChildEnv(this.paths),
      timeoutMs: this.timeoutMs,
      maxStdoutBytes: MAX_OUTPUT_BYTES,
      maxStderrBytes: MAX_OUTPUT_BYTES,
    });

    const failure = cliRunFailure(result);
    if (failure) {
      return {
        error: failure,
        errorResult(operation: string): WritebackResult {
          return errorResult({ operation, errorCode: failure.errorCode, message: failure.message });
        },
      };
    }
    return { result };
  }
}

function parseCliJson(operation: string, result: CliProcessRunResult): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(result.stdout.trim()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return { ok: false, operation };
  }
}

function cliRunFailure(result: CliProcessRunResult): { ok: false; errorCode: string; message: string } | null {
  if (result.timedOut) {
    return { ok: false, errorCode: "timeout", message: "PKOS CLI timed out" };
  }
  if (result.stdoutTruncated || result.stderrTruncated) {
    return { ok: false, errorCode: "cli_failed", message: "PKOS CLI output exceeded limit" };
  }
  if (result.spawnError) {
    return { ok: false, errorCode: "cli_failed", message: "PKOS CLI could not be started" };
  }
  if (result.exitCode !== 0) {
    return { ok: false, errorCode: "cli_failed", message: `PKOS CLI exited with code ${result.exitCode ?? "unknown"}` };
  }
  return null;
}

function cliErrorCode(payload: Record<string, unknown> | null): string {
  if (!payload || !isRecord(payload.error)) {
    return "cli_failed";
  }
  return typeof payload.error.code === "string" ? payload.error.code : "cli_failed";
}

function normalizeInboxReviewCliItems(value: unknown): InboxReviewCliItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map((item) => ({
    id: stringValue(item.id),
    effective_status: stringValue(item.effective_status),
    source: stringValue(item.source),
    capture_type: stringValue(item.capture_type),
    created_at: stringValue(item.created_at),
    content: stringValue(item.content),
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
    review_action_id: stringValue(item.review_action_id),
    reviewed_at: stringValue(item.reviewed_at),
    review_reason: stringValue(item.review_reason),
  }));
}

function normalizeStateTimelineCliItems(value: unknown): StateTimelineCliItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map(normalizeStateTimelineCliItem);
}

function normalizeStateTimelineCliItem(item: Record<string, unknown>): StateTimelineCliItem {
  return {
    id: stringValue(item.id),
    source: stringValue(item.source),
    energy: stringValue(item.energy),
    mood: stringValue(item.mood),
    body: stringValue(item.body),
    context: stringValue(item.context),
    mode: stringValue(item.mode),
    risk: normalizeRisk(item.risk),
    note: typeof item.note === "string" ? item.note : null,
    created_at: stringValue(item.created_at),
  };
}

function normalizeRisk(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string") {
      result[key] = child;
    }
  }
  return result;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildChildEnv(paths: AgentPaths): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  copyEnv(env, "PATH");
  copyEnv(env, "Path");
  copyEnv(env, "PATHEXT");
  copyEnv(env, "SystemRoot");
  copyEnv(env, "WINDIR");
  copyEnv(env, "HOME");
  copyEnv(env, "USERPROFILE");
  copyEnv(env, "TMP");
  copyEnv(env, "TEMP");
  copyEnv(env, "PYTHONUTF8");
  env.PKOS_CORE_ROOT = paths.coreRoot;
  env.PKOS_DATA_ROOT = paths.dataRoot;
  return env;
}

function copyEnv(target: NodeJS.ProcessEnv, key: string): void {
  const value = process.env[key];
  if (typeof value === "string") {
    target[key] = value;
  }
}
