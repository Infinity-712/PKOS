import { platform } from "node:os";

import { resolveAgentPaths, type AgentPaths } from "../config/paths.js";
import type { InboxAppendInput } from "../tools/builtin/inboxAppend.js";
import type { StateAppendInput } from "../tools/builtin/stateAppend.js";
import { CliProcessRunner, type CliProcessRunResult } from "./CliProcessRunner.js";
import { errorResult, type WritebackResult, writtenResult } from "./WritebackTypes.js";

type PkosCliClientOptions = {
  paths?: AgentPaths;
  pythonBin?: string;
  timeoutMs?: number;
  runner?: CliProcessRunner;
};

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

  private async runJsonCommand(operation: string, args: string[]): Promise<WritebackResult> {
    const result = await this.runner.run({
      executable: this.pythonBin,
      args,
      cwd: this.paths.coreRoot,
      env: buildChildEnv(this.paths),
      timeoutMs: this.timeoutMs,
      maxStdoutBytes: MAX_OUTPUT_BYTES,
      maxStderrBytes: MAX_OUTPUT_BYTES,
    });

    if (result.timedOut) {
      return errorResult({ operation, errorCode: "timeout", message: "PKOS CLI timed out" });
    }
    if (result.stdoutTruncated || result.stderrTruncated) {
      return errorResult({ operation, errorCode: "cli_failed", message: "PKOS CLI output exceeded limit" });
    }
    if (result.spawnError) {
      return errorResult({ operation, errorCode: "cli_failed", message: "PKOS CLI could not be started" });
    }
    if (result.exitCode !== 0) {
      return errorResult({ operation, errorCode: "cli_failed", message: `PKOS CLI exited with code ${result.exitCode ?? "unknown"}` });
    }

    const payload = parseCliJson(operation, result);
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
