import { spawnSync } from "child_process";
import { pathToFileURL } from "url";

const DEFAULT_CORE_ROOT = process.env.PKOS_CORE_ROOT || "/home/infinity/apps/pkos-core";
const DEFAULT_DATA_ROOT = process.env.PKOS_DATA_ROOT || "/home/infinity/data/pkos-vault";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_BUFFER = 1024 * 1024;

const ALLOWED_COMMANDS = new Set([
  "paths",
  "doctor",
  "export-agent-context",
  "inbox-append",
  "state-append",
]);

export class PKOSBridgeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "PKOSBridgeError";
    this.code = details.code || "PKOS_BRIDGE_ERROR";
    this.command = details.command;
    this.status = details.status;
    this.stdout = details.stdout;
    this.stderr = details.stderr;
    this.payload = details.payload;
  }
}

function assertAllowed(args) {
  const command = args[0];
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new PKOSBridgeError(`PKOS command is not allowed: ${command}`, {
      code: "COMMAND_NOT_ALLOWED",
      command,
    });
  }
}

function parseJson(stdout, command) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new PKOSBridgeError(`PKOS stdout was not JSON for ${command}`, {
      code: "INVALID_JSON_STDOUT",
      command,
      stdout,
    });
  }
}

function runPkos(args, options = {}) {
  assertAllowed(args);

  const coreRoot = options.coreRoot || DEFAULT_CORE_ROOT;
  const dataRoot = options.dataRoot || DEFAULT_DATA_ROOT;
  const command = args[0];
  const result = spawnSync(
    "python3",
    ["-B", "-m", "tools.pkos", ...args],
    {
      cwd: coreRoot,
      env: {
        ...process.env,
        PKOS_DATA_ROOT: dataRoot,
      },
      encoding: "utf8",
      timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      maxBuffer: options.maxBuffer || DEFAULT_MAX_BUFFER,
    }
  );

  if (result.error) {
    throw new PKOSBridgeError(result.error.message, {
      code: result.error.code || "SPAWN_FAILED",
      command,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }

  if (result.status !== 0) {
    let payload = null;
    if (result.stdout && result.stdout.trim().startsWith("{")) {
      try {
        payload = JSON.parse(result.stdout);
      } catch (error) {
        payload = null;
      }
    }
    const payloadErrorMessage =
      payload && payload.error && payload.error.message
        ? payload.error.message
        : null;
    const payloadErrorCode =
      payload && payload.error && payload.error.code
        ? payload.error.code
        : "PKOS_COMMAND_FAILED";
    throw new PKOSBridgeError(result.stderr || payloadErrorMessage || result.stdout || `PKOS command failed: ${command}`, {
      code: payloadErrorCode,
      command,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      payload,
    });
  }

  return parseJson(result.stdout, command);
}

export function getPaths(options = {}) {
  return runPkos(["paths", "--json"], options);
}

export function doctor(options = {}) {
  return runPkos(["doctor", "--json"], options);
}

export function getAgentContext(options = {}) {
  return runPkos(["export-agent-context", "--print"], options);
}

export function appendInbox({
  captureType,
  content,
  source = "moonlolo",
  tags = [],
  metadata = null,
} = {}, options = {}) {
  const args = [
    "inbox-append",
    "--capture-type",
    captureType,
    "--content",
    content,
    "--source",
    source,
    "--json",
  ];

  const tagValue = Array.isArray(tags) ? tags.join(",") : tags;
  if (tagValue) {
    args.push("--tags", tagValue);
  }
  if (metadata && Object.keys(metadata).length > 0) {
    args.push("--metadata-json", JSON.stringify(metadata));
  }

  return runPkos(args, options);
}

export function appendState({
  energy,
  mood,
  body,
  context = "unknown",
  mode = "unknown",
  risks = {},
  source = "moonlolo",
  note = null,
} = {}, options = {}) {
  const args = [
    "state-append",
    "--energy",
    energy,
    "--mood",
    mood,
    "--body",
    body,
    "--context",
    context,
    "--mode",
    mode,
    "--risk-short-video",
    risks.shortVideo || "unknown",
    "--risk-rumination",
    risks.rumination || "unknown",
    "--risk-overload",
    risks.overload || "unknown",
    "--source",
    source,
    "--json",
  ];

  if (note) {
    args.push("--note", note);
  }

  return runPkos(args, options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = getPaths();
  const status = doctor();
  const context = getAgentContext();
  console.log(JSON.stringify({
    ok: true,
    paths,
    doctor: {
      ok: status.ok,
      checks: status.checks,
    },
    current_state: context.current_state,
  }, null, 2));
}
