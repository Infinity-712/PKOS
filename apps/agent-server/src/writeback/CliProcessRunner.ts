import { spawn } from "node:child_process";

export type CliProcessRunInput = {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
};

export type CliProcessRunResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  spawnError?: {
    code?: string;
    message: string;
  };
};

export class CliProcessRunner {
  run(input: CliProcessRunInput): Promise<CliProcessRunResult> {
    return new Promise((resolve) => {
      let settled = false;
      let timedOut = false;
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      const child = spawn(input.executable, input.args, {
        cwd: input.cwd,
        env: input.env,
        shell: false,
        windowsHide: true,
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, input.timeoutMs);

      const finish = (result: Omit<CliProcessRunResult, "stdout" | "stderr" | "timedOut" | "stdoutTruncated" | "stderrTruncated">): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve({
          ...result,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          timedOut,
          stdoutTruncated,
          stderrTruncated,
        });
      };

      child.stdout.on("data", (chunk: Buffer) => {
        const remaining = input.maxStdoutBytes - stdoutBytes;
        if (remaining <= 0) {
          stdoutTruncated = true;
          child.kill();
          return;
        }
        if (chunk.length > remaining) {
          stdoutChunks.push(chunk.subarray(0, remaining));
          stdoutBytes += remaining;
          stdoutTruncated = true;
          child.kill();
          return;
        }
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const remaining = input.maxStderrBytes - stderrBytes;
        if (remaining <= 0) {
          stderrTruncated = true;
          child.kill();
          return;
        }
        if (chunk.length > remaining) {
          stderrChunks.push(chunk.subarray(0, remaining));
          stderrBytes += remaining;
          stderrTruncated = true;
          child.kill();
          return;
        }
        stderrChunks.push(chunk);
        stderrBytes += chunk.length;
      });

      child.on("error", (error: NodeJS.ErrnoException) => {
        finish({
          exitCode: null,
          signal: null,
          spawnError: {
            code: error.code,
            message: error.message,
          },
        });
      });

      child.on("close", (exitCode, signal) => {
        finish({ exitCode, signal });
      });
    });
  }
}
