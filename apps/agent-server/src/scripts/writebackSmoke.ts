import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { resolveAgentPaths } from "../config/paths.js";
import { openAgentDatabase } from "../db/connection.js";
import { EventStore } from "../events/EventStore.js";
import { ToolExecutor } from "../tools/ToolExecutor.js";
import { createDefaultToolRegistry, ToolRegistry } from "../tools/ToolRegistry.js";
import { WritebackRouter } from "../writeback/WritebackRouter.js";
import { PkosCliClient } from "../writeback/PkosCliClient.js";

type CountRow = { count: number };
type ToolCallRow = {
  status: string;
  input_json: string | null;
  output_json: string | null;
  error_json: string | null;
};
type EventRow = { type: string; payload_json: string };

const INBOX_SECRET = "WRITEBACK_SMOKE_FULL_INBOX_CONTENT_SHOULD_NOT_BE_IN_AUDIT";
const STATE_SECRET = "WRITEBACK_SMOKE_FULL_STATE_NOTE_SHOULD_NOT_BE_IN_AUDIT";

const coreRoot = resolveAgentPaths().coreRoot;
const coreFiles = [
  join(coreRoot, "tools", "pkos.py"),
  join(coreRoot, "tools", "flow_hub", "append_logs.py"),
];
const coreHashesBefore = hashFiles(coreFiles);

const dataRoot = mkdtempSync(join(tmpdir(), "pkos-agent-writeback-smoke-"));
process.env.PKOS_DATA_ROOT = dataRoot;
delete process.env.PKOS_AGENT_DB_PATH;

const db = openAgentDatabase();
const events = new EventStore(db);
const registry = createDefaultToolRegistry();
const router = new WritebackRouter(new PkosCliClient());
const executor = new ToolExecutor(db, registry, router, events);

try {
  const inboxPath = join(dataRoot, "inbox", "items.jsonl");
  const statePath = join(dataRoot, "state", "snapshots.jsonl");
  const originalInboxLine = JSON.stringify({ id: "inbox_existing", type: "inbox_item", content: "existing" }) + "\n";
  const originalStateLine = JSON.stringify({ id: "state_existing", type: "state_snapshot", energy: "unknown" }) + "\n";
  writeFile(inboxPath, originalInboxLine);
  writeFile(statePath, originalStateLine);

  const inboxSourceMessageId = `test-source-${randomUUID()}`;
  const inboxResult = await executor.execute("pkos.inbox.append", {
    captureType: "note",
    content: INBOX_SECRET,
    source: "manual",
    tags: ["smoke", "writeback"],
    metadata: { smoke: true },
  }, {
    sessionId: "session-writeback-smoke",
    generationId: "generation-writeback-smoke",
    sourceMessageId: inboxSourceMessageId,
    requestedBy: "test",
    confirmed: false,
  });

  assert(inboxResult.status === "written", `inbox append not written: ${JSON.stringify(inboxResult)}`);
  assert(inboxResult.operation === "pkos.inbox.append", "inbox operation mismatch");
  assert(typeof inboxResult.recordId === "string" && inboxResult.recordId.startsWith("inbox_"), "inbox record id missing");
  const inboxLines = readLines(inboxPath);
  assert(inboxLines.length === 2, `expected two inbox rows, got ${inboxLines.length}`);
  assert(inboxLines[0] + "\n" === originalInboxLine, "existing inbox row changed");
  const appendedInbox = JSON.parse(inboxLines[1]) as Record<string, unknown>;
  assert(appendedInbox.content === INBOX_SECRET, "appended inbox content missing from vault record");
  assert(appendedInbox.status === "unprocessed", "inbox status did not preserve Python default semantics");
  assert(appendedInbox.source === "manual", "inbox source mismatch");
  assert(!existsSync(join(dataRoot, "objects")), "inbox append created objects directory");

  const stateSourceMessageId = `test-source-${randomUUID()}`;
  const stateResult = await executor.execute("pkos.state.append", {
    energy: "low",
    mood: "anxious",
    body: "tired",
    context: "home",
    mode: "recovery",
    risk: {
      shortVideo: "low",
      rumination: "medium",
      overload: "low",
    },
    source: "manual",
    note: STATE_SECRET,
  }, {
    sessionId: "session-writeback-smoke",
    generationId: "generation-writeback-smoke",
    sourceMessageId: stateSourceMessageId,
    requestedBy: "test",
    confirmed: false,
  });

  assert(stateResult.status === "written", `state append not written: ${JSON.stringify(stateResult)}`);
  assert(stateResult.operation === "pkos.state.append", "state operation mismatch");
  assert(typeof stateResult.recordId === "string" && stateResult.recordId.startsWith("state_"), "state record id missing");
  const stateLines = readLines(statePath);
  assert(stateLines.length === 2, `expected two state rows, got ${stateLines.length}`);
  assert(stateLines[0] + "\n" === originalStateLine, "existing state row changed");
  const appendedState = JSON.parse(stateLines[1]) as Record<string, unknown>;
  assert(appendedState.note === STATE_SECRET, "appended state note missing from vault record");
  assert(appendedState.energy === "low", "state energy mismatch");
  assert(!existsSync(join(dataRoot, "tasks")), "state append created tasks directory");

  const auditBlob = readAuditBlob();
  assert(auditBlob.indexOf(INBOX_SECRET) === -1, "audit leaked full inbox content");
  assert(auditBlob.indexOf(STATE_SECRET) === -1, "audit leaked full state note");
  assert(auditBlob.indexOf(sha256(INBOX_SECRET)) !== -1, "audit missing inbox content hash");
  assert(auditBlob.indexOf(sha256(STATE_SECRET)) !== -1, "audit missing state note hash");
  assert(auditBlob.indexOf(inboxSourceMessageId) !== -1, "audit missing source message reference");

  assertToolCallStatus("pkos.inbox.append", "completed");
  assertToolCallStatus("pkos.state.append", "completed");
  assertEventCount("tool_call_started", 2);
  assertEventCount("tool_call_completed", 2);
  assertEventCount("writeback_written", 2);

  const beforeInvalidInbox = readFile(inboxPath);
  const invalidResult = await executor.execute("pkos.inbox.append", {
    captureType: "invalid_capture_type",
    content: "invalid should not start Python",
    source: "manual",
  }, {
    requestedBy: "test",
    confirmed: false,
  });
  assert(invalidResult.status === "error", "invalid input did not return error");
  assert(invalidResult.errorCode === "invalid_input", "invalid input error code mismatch");
  assert(readFile(inboxPath) === beforeInvalidInbox, "invalid input changed inbox file");
  assertLatestToolCallNotCompleted("pkos.inbox.append");

  const unknownResult = await executor.execute("pkos.unknown.write", { value: "nope" }, {
    requestedBy: "test",
    confirmed: false,
  });
  assert(unknownResult.status === "blocked", "unknown tool was not blocked");
  assert(unknownResult.errorCode === "unknown_tool", "unknown tool error code mismatch");

  const forbiddenRegistry = new ToolRegistry();
  forbiddenRegistry.register({
    name: "pkos.objects.write",
    description: "Forbidden authority write fixture",
    permissionLevel: "L3",
    sideEffect: true,
    requiresConfirmation: true,
    validateInput: (input) => input,
    summarizeInput: () => ({ operation: "pkos.objects.write" }),
    execute: async () => ({ status: "written", operation: "pkos.objects.write", message: "must not happen" }),
  });
  const forbiddenExecutor = new ToolExecutor(db, forbiddenRegistry, router, events);
  const forbiddenResult = await forbiddenExecutor.execute("pkos.objects.write", { id: "fact.demo" }, {
    requestedBy: "test",
    confirmed: true,
  });
  assert(forbiddenResult.status === "blocked", "forbidden authority operation was not blocked");
  assert(forbiddenResult.errorCode === "permission_denied", "forbidden authority error code mismatch");

  const failingExecutor = new ToolExecutor(
    db,
    registry,
    new WritebackRouter(new PkosCliClient({ pythonBin: join(dataRoot, "missing-python-bin") })),
    events,
  );
  const beforeCliFailure = readFile(inboxPath);
  const cliFailure = await failingExecutor.execute("pkos.inbox.append", {
    captureType: "note",
    content: "CLI failure must not be written",
    source: "manual",
  }, {
    requestedBy: "test",
    confirmed: false,
  });
  assert(cliFailure.status === "error", "CLI failure did not return error");
  assert(cliFailure.errorCode === "cli_failed", "CLI failure error code mismatch");
  assert(readFile(inboxPath) === beforeCliFailure, "CLI failure changed inbox file");
  assertEventCount("tool_call_failed", 2);
  assertEventCount("writeback_blocked", 2);

  const coreHashesAfter = hashFiles(coreFiles);
  assert(JSON.stringify(coreHashesAfter) === JSON.stringify(coreHashesBefore), "Python core files changed during smoke");

  console.log("WRITEBACK_SMOKE_OK");
} finally {
  db.close();
  rmSync(dataRoot, { recursive: true, force: true });
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function readFile(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function readLines(path: string): string[] {
  return readFile(path)
    .split("\n")
    .filter((line) => line.length > 0);
}

function readAuditBlob(): string {
  const toolCalls = db
    .prepare("SELECT status, input_json, output_json, error_json FROM tool_calls ORDER BY created_at, id")
    .all() as ToolCallRow[];
  const eventsRows = db
    .prepare("SELECT type, payload_json FROM agent_events ORDER BY ts, id")
    .all() as EventRow[];
  return JSON.stringify({ toolCalls, eventsRows });
}

function assertToolCallStatus(toolName: string, status: string): void {
  const row = db
    .prepare("SELECT status, input_json, output_json, error_json FROM tool_calls WHERE tool_name = ? ORDER BY created_at DESC LIMIT 1")
    .get(toolName) as ToolCallRow | undefined;
  if (!row) {
    throw new Error(`missing tool call for ${toolName}`);
  }
  assert(row.status === status, `expected ${toolName} status ${status}, got ${row.status}`);
}

function assertLatestToolCallNotCompleted(toolName: string): void {
  const row = db
    .prepare("SELECT status, input_json, output_json, error_json FROM tool_calls WHERE tool_name = ? ORDER BY created_at DESC LIMIT 1")
    .get(toolName) as ToolCallRow | undefined;
  if (!row) {
    throw new Error(`missing tool call for ${toolName}`);
  }
  assert(row.status !== "completed", `${toolName} unexpectedly completed`);
}

function assertEventCount(type: string, minCount: number): void {
  const row = db.prepare("SELECT COUNT(*) AS count FROM agent_events WHERE type = ?").get(type) as CountRow;
  assert(row.count >= minCount, `expected at least ${minCount} ${type} events, got ${row.count}`);
}

function hashFiles(paths: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const path of paths) {
    result[path] = sha256(readFileSync(path, "utf8"));
  }
  return result;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
