import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAgentDatabase, type AgentDatabase } from "../db/connection.js";
import { createAgentHttpServer } from "../server/httpServer.js";

type JsonRecord = Record<string, unknown>;

type StateTimelinePayload = {
  current?: StateView | null;
  items?: StateView[];
  count?: number;
  filters?: JsonRecord;
  error?: { code?: string; message?: string };
};

type StateView = {
  id?: string;
  energy?: string;
  mood?: string;
  body?: string;
  context?: string;
  mode?: string;
  risk?: JsonRecord;
  note?: string | null;
  createdAt?: string;
  stale?: boolean;
};

type ActionPayload = {
  ok?: boolean;
  requestId?: string;
  replayed?: boolean;
  result?: { status?: string; operation?: string; errorCode?: string };
  error?: { code?: string; message?: string };
};

const NOTE_SECRET = "STATE_TIMELINE_NOTE_SHOULD_NOT_REACH_AUDIT";
const dataRoot = mkdtempSync(join(tmpdir(), "pkos-state-timeline-api-smoke-"));
process.env.PKOS_DATA_ROOT = dataRoot;
delete process.env.PKOS_AGENT_DB_PATH;

const db = openAgentDatabase();
const server = createAgentHttpServer({ db });

try {
  const baseUrl = await listen(server);
  const empty = await getJson<StateTimelinePayload>(baseUrl, "/api/pkos/state-timeline");
  assert(empty.status === 200, `empty state expected 200, got ${empty.status}`);
  assert(empty.payload.current === null, "empty state current was not null");
  assert(Array.isArray(empty.payload.items) && empty.payload.items.length === 0, "empty state items were not empty");

  seedStates(dataRoot);
  const statePath = join(dataRoot, "state", "snapshots.jsonl");
  const beforeAppend = readFileSync(statePath, "utf8");

  const listed = await getJson<StateTimelinePayload>(baseUrl, "/api/pkos/state-timeline?limit=10");
  assert(listed.status === 200, `state timeline expected 200, got ${listed.status}`);
  assert(listed.payload.current?.id === "state.latest", "current was not latest overall state");
  assert(listed.payload.current?.stale === true, "old current state was not marked stale");
  assert(listed.payload.items?.map((item) => item.id).join(",") === "state.latest,state.middle,state.old", "items were not newest first");
  assert(listed.payload.items?.[0]?.createdAt === "2026-07-01T10:00:00Z", "createdAt normalization failed");

  const filtered = await getJson<StateTimelinePayload>(baseUrl, "/api/pkos/state-timeline?energy=low&mood=anxious&mode=recovery&limit=5");
  assert(filtered.status === 200, `filtered state expected 200, got ${filtered.status}`);
  assert(filtered.payload.current?.id === "state.latest", "filter changed current");
  assert(filtered.payload.items?.length === 1 && filtered.payload.items[0]?.id === "state.old", "filters did not apply");

  const limited = await getJson<StateTimelinePayload>(baseUrl, "/api/pkos/state-timeline?limit=2");
  assert(limited.payload.items?.map((item) => item.id).join(",") === "state.latest,state.middle", "limit did not apply");

  const invalidEnum = await getJson<StateTimelinePayload>(baseUrl, "/api/pkos/state-timeline?energy=not_real");
  assert(invalidEnum.status === 400, `invalid enum expected 400, got ${invalidEnum.status}`);

  const invalidLimit = await getJson<StateTimelinePayload>(baseUrl, "/api/pkos/state-timeline?limit=9999");
  assert(invalidLimit.status === 400, `invalid limit expected 400, got ${invalidLimit.status}`);

  const append = await postJson<ActionPayload>(baseUrl, "/api/actions/state-append", {
    requestId: "state-append-refresh-1",
    energy: "medium",
    mood: "calm",
    body: "normal",
    context: "home",
    mode: "life",
    risk: { shortVideo: "low", rumination: "low", overload: "low" },
    source: "web",
    note: NOTE_SECRET,
  });
  assert(append.status === 200, `state append expected 200, got ${append.status}`);
  assert(append.payload.result?.status === "written", "state append did not write");
  const afterAppend = readFileSync(statePath, "utf8");
  assert(afterAppend.startsWith(beforeAppend), "state append rewrote old snapshots");
  assert(lineCount(afterAppend) === lineCount(beforeAppend) + 1, "state append did not add exactly one line");

  const refreshed = await getJson<StateTimelinePayload>(baseUrl, "/api/pkos/state-timeline?limit=1");
  assert(refreshed.payload.current?.note === NOTE_SECRET, "timeline did not return newly appended state note to local UI");
  assert(refreshed.payload.current?.stale === false, "fresh appended state was marked stale");

  const audit = await getJson<JsonRecord>(baseUrl, "/api/audit/events?limit=200");
  assert(JSON.stringify(audit.payload).indexOf(NOTE_SECRET) === -1, "Audit API leaked state note");
  assert(auditBlob(db).indexOf(NOTE_SECRET) === -1, "SQLite audit stored state note");

  writeFileSync(statePath, JSON.stringify(seedSnapshot("state.ok", "low", "calm", "quiet", "2026-07-01T00:00:00Z")) + "\n{bad json\n", "utf8");
  const malformed = await getJson<StateTimelinePayload>(baseUrl, "/api/pkos/state-timeline");
  assert(malformed.status === 500, `malformed state expected 500, got ${malformed.status}`);
  assert(malformed.payload.error?.code === "state_timeline_failed", "malformed state returned wrong error code");
  assert(JSON.stringify(malformed.payload).indexOf("state.ok") === -1, "malformed state returned partial current");

  console.log("STATE_TIMELINE_API_SMOKE_OK");
} finally {
  await closeServer(server);
  db.close();
  rmSync(dataRoot, { recursive: true, force: true });
}

function seedStates(root: string): void {
  const states = [
    seedSnapshot("state.old", "low", "anxious", "recovery", "2026-07-01T08:00:00Z", "old state note"),
    seedSnapshot("state.middle", "medium", "calm", "study", "2026-07-01T09:00:00Z", "middle state note"),
    seedSnapshot("state.latest", "high", "excited", "writing", "2026-07-01T10:00:00Z", "latest state note"),
  ];
  const stateDir = join(root, "state");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "snapshots.jsonl"), states.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
}

function seedSnapshot(id: string, energy: string, mood: string, mode: string, createdAt: string, note = "note"): JsonRecord {
  return {
    schema_version: "0.5-alpha",
    id,
    type: "state_snapshot",
    source: "web",
    energy,
    mood,
    body: energy === "low" ? "tired" : "normal",
    context: mode === "study" ? "library" : "home",
    mode,
    risk: { short_video: "low", rumination: "low", overload: "low" },
    note,
    created_at: createdAt,
  };
}

async function listen(server: ReturnType<typeof createAgentHttpServer>): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: ReturnType<typeof createAgentHttpServer>): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function getJson<T>(baseUrl: string, path: string): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    status: response.status,
    payload: (await response.json()) as T,
  };
}

async function postJson<T>(baseUrl: string, path: string, body: JsonRecord): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    payload: (await response.json()) as T,
  };
}

function lineCount(text: string): number {
  return text.split("\n").filter((line) => line.trim()).length;
}

function auditBlob(database: AgentDatabase): string {
  const toolCalls = database.prepare("SELECT input_json, output_json, error_json FROM tool_calls").all() as JsonRecord[];
  const events = database.prepare("SELECT payload_json FROM agent_events").all() as JsonRecord[];
  const actions = database.prepare("SELECT result_json, error_json FROM action_requests").all() as JsonRecord[];
  return JSON.stringify({ toolCalls, events, actions });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
