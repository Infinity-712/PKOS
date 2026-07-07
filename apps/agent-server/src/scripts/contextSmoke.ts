import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ContextBuilder } from "../context/ContextBuilder.js";
import type { BuiltContext } from "../context/ContextTypes.js";
import { openAgentDatabase } from "../db/connection.js";
import { EventStore } from "../events/EventStore.js";
import { nowIso } from "../events/AgentEvent.js";
import { AgentRunner } from "../runtime/AgentRunner.js";
import { GenerationManager } from "../runtime/GenerationManager.js";
import { createSession } from "../server/chatRoutes.js";
import { createAgentHttpServer } from "../server/httpServer.js";

type EventRow = { type: string; payload_json: string };
type GenerationRow = { status: string };
type MessageRow = { content: string };

const RAW_SAMPLE = "RAW_SAMPLE_ITEM_FULLTEXT_SHOULD_NOT_APPEAR";
const SECRET_MARKER = "SECRET_SHOULD_NOT_APPEAR";
const LONG_MARKER = "LONG_MESSAGE_TAIL_SHOULD_STAY_IN_DB";

const dataRoot = mkdtempSync(join(tmpdir(), "pkos-agent-context-smoke-"));
process.env.PKOS_DATA_ROOT = dataRoot;

const db = openAgentDatabase();
const builder = new ContextBuilder(db);

try {
  const flowPath = join(dataRoot, "runtime", "agent_context.json");
  writeFlowContext(flowPath);

  const currentSession = createSession(db, "Context smoke");
  const otherSession = createSession(db, "Other session");
  seedMessages(currentSession.id, otherSession.id);

  const context = builder.build(currentSession.id);
  assert(context.items.some((item) => item.kind === "system_boundary"), "missing static policy item");
  assert(context.items.some((item) => item.kind === "current_state"), "missing current_state item");
  assert(context.items.some((item) => item.kind === "review_gate"), "missing review_gate item");
  assert(context.items.some((item) => item.kind === "write_policy"), "missing write_policy item");
  assert(JSON.stringify(context).indexOf(RAW_SAMPLE) === -1, "context included raw sample item fulltext");
  assert(JSON.stringify(context).indexOf(SECRET_MARKER) === -1, "context included forbidden secret-like field");
  assertMessages(context, currentSession.id);

  const originalLong = readLongMessage();
  assert(originalLong.indexOf(LONG_MARKER) !== -1, "fixture long message missing marker before context build");
  assert(JSON.stringify(context).indexOf(LONG_MARKER) === -1, "context included untruncated long message tail");
  assert(readLongMessage() === originalLong, "context build modified original chat message");

  const budgeted = builder.build(currentSession.id, { maxItems: 3, maxChars: 12000 });
  assert(budgeted.budget.truncated === true, "budget did not mark truncated");
  assert(budgeted.items.some((item) => item.kind === "system_boundary"), "budget dropped policy item");
  assert(!budgeted.items.some((item) => item.kind === "recent_message"), "budget kept low-priority recent messages");

  rmSync(flowPath, { force: true });
  const missing = builder.build(currentSession.id);
  assert(missing.warnings.includes("flow_hub_context_missing"), "missing flow hub warning not emitted");

  writeFileSync(flowPath, "{not valid json", "utf8");
  const invalid = builder.build(currentSession.id);
  assert(invalid.warnings.includes("flow_hub_context_invalid"), "invalid flow hub warning not emitted");

  writeFlowContext(flowPath);
  const events = new EventStore(db);
  const generations = new GenerationManager(db, events);
  const runner = new AgentRunner(db, generations, undefined, events, builder);
  const result = await runner.run({ sessionId: currentSession.id, message: "context integration smoke" });
  assert(result.events.some((event) => event.type === "context_built"), "AgentRunner did not emit context_built");
  assert(result.assistantMessage.indexOf("Context items:") !== -1, "dry-run response did not include context summary");

  const latestGeneration = db.prepare("SELECT status FROM generations ORDER BY created_at DESC LIMIT 1").get() as GenerationRow;
  assert(latestGeneration.status === "completed", "latest generation was not completed");

  const contextEvent = db
    .prepare("SELECT type, payload_json FROM agent_events WHERE type = 'context_built' ORDER BY ts DESC LIMIT 1")
    .get() as EventRow | undefined;
  assert(contextEvent !== undefined, "context_built event not persisted");
  const contextPayload = JSON.parse(contextEvent.payload_json) as Record<string, unknown>;
  assert(typeof contextPayload.itemCount === "number", "context_built payload missing itemCount");
  assert(!("items" in contextPayload), "context_built payload leaked full context items");
  assert(JSON.stringify(contextPayload).indexOf("current_state") === -1, "context_built payload leaked context content");

  const endpointContext = await fetchContextEndpoint(db, currentSession.id);
  assert(endpointContext.sessionId === currentSession.id, "context endpoint returned wrong session");

  console.log("CONTEXT_BUILDER_SMOKE_OK");
} finally {
  db.close();
  rmSync(dataRoot, { recursive: true, force: true });
}

function writeFlowContext(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        schema_version: "0.5-beta",
        profile: "moonlolo",
        generated_at: nowIso(),
        current_state: {
          energy: "low",
          mood: "calm",
          body: "tired",
          context: "home",
          mode: "recovery",
          updated_at: nowIso(),
          tone_hint: "soft_low_pressure",
        },
        weekly_review_gate: {
          cadence: "weekly",
          unprocessed_inbox_count: 2,
          archived_this_week: 1,
          converted_this_week: 0,
          review_required_before_weekly_summary: true,
          sample_items: [{ id: "inbox.fixture", content_excerpt: RAW_SAMPLE, content: RAW_SAMPLE }],
        },
        task_flow_stub: {
          enabled: false,
          reason: "task_system_not_implemented",
        },
        write_policy: {
          allowed_writes: ["inbox_append", "state_append"],
          forbidden_writes: ["trusted", "objects", "tasks", "secret_reading"],
          authority: "runtime context only; not source of truth",
          secret: SECRET_MARKER,
        },
        learning_flow: SECRET_MARKER,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function seedMessages(currentSessionId: string, otherSessionId: string): void {
  insertMessage(otherSessionId, "user", "other session must not appear", "2026-07-01T00:00:00.000Z");
  insertMessage(currentSessionId, "system", "system message must be ignored", "2026-07-01T00:00:01.000Z");
  for (let index = 0; index < 14; index += 1) {
    const content =
      index === 13
        ? "long message ".repeat(220) + LONG_MARKER
        : `current session message ${index.toString().padStart(2, "0")}`;
    insertMessage(currentSessionId, index % 2 === 0 ? "user" : "assistant", content, `2026-07-01T00:${(index + 2).toString().padStart(2, "0")}:00.000Z`);
  }
}

function insertMessage(sessionId: string, role: string, content: string, createdAt: string): void {
  db.prepare(
    `INSERT INTO chat_messages
      (id, session_id, role, content, metadata_json, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  ).run(randomUUID(), sessionId, role, content, createdAt);
}

function assertMessages(context: BuiltContext, sessionId: string): void {
  const messages = context.items.filter((item) => item.kind === "recent_message");
  assert(messages.length === 12, `expected 12 recent messages, got ${messages.length}`);
  for (const item of messages) {
    assert(item.source.type === "sqlite", "recent message source was not sqlite");
    assert(item.source.table === "chat_messages", "recent message table metadata missing");
    assert(item.content !== "other session must not appear", "context included another session");
    const content = item.content as { role?: string; content?: string; truncated?: boolean };
    assert(content.role === "user" || content.role === "assistant", "context included unsupported role");
    assert(typeof content.content === "string" && content.content.length <= 2000, "message was not bounded");
  }
  assert(context.sessionId === sessionId, "context session id mismatch");
}

function readLongMessage(): string {
  const row = db
    .prepare("SELECT content FROM chat_messages WHERE content LIKE ? LIMIT 1")
    .get(`%${LONG_MARKER}%`) as MessageRow | undefined;
  if (!row) {
    throw new Error("long message row missing");
  }
  return row.content;
}

async function fetchContextEndpoint(database: typeof db, sessionId: string): Promise<BuiltContext> {
  const server = createAgentHttpServer({ db: database });
  try {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("server did not bind");
    }
    const response = await fetch(`http://127.0.0.1:${address.port}/api/context/${encodeURIComponent(sessionId)}`);
    assert(response.status === 200, `context endpoint returned ${response.status}`);
    const payload = (await response.json()) as { context?: BuiltContext };
    if (!payload.context) {
      throw new Error("context endpoint missing context");
    }
    return payload.context;
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
