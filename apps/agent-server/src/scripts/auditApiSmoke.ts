import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAgentDatabase, type AgentDatabase } from "../db/connection.js";
import { createAgentHttpServer } from "../server/httpServer.js";

type AuditPayload = {
  items?: Array<{
    id?: string;
    ts?: string;
    type?: string;
    severity?: string;
    sessionId?: string;
    generationId?: string;
    payloadSummary?: Record<string, unknown>;
  }>;
  nextBefore?: string;
  error?: { code?: string; message?: string };
};

const CONTENT_SECRET = "AUDIT_FULL_CONTENT_SHOULD_NOT_LEAK";
const NOTE_SECRET = "AUDIT_FULL_NOTE_SHOULD_NOT_LEAK";
const REASON_SECRET = "AUDIT_FULL_REASON_SHOULD_NOT_LEAK";
const UNKNOWN_SECRET = "AUDIT_UNKNOWN_PAYLOAD_SHOULD_NOT_LEAK";

const dataRoot = mkdtempSync(join(tmpdir(), "pkos-agent-audit-smoke-"));
process.env.PKOS_DATA_ROOT = dataRoot;
delete process.env.PKOS_AGENT_DB_PATH;

const db = openAgentDatabase();
const server = createAgentHttpServer({ db });

try {
  seedEvents(db);
  const baseUrl = await listen(server);

  const first = await getJson(baseUrl, "/api/audit/events?limit=3");
  assert(first.status === 200, `audit list expected 200, got ${first.status}`);
  assert(first.payload.items?.length === 3, "audit limit did not apply");
  assert(typeof first.payload.nextBefore === "string", "audit response missing nextBefore");

  const firstBlob = JSON.stringify(first.payload);
  assert(firstBlob.indexOf(CONTENT_SECRET) === -1, "audit list leaked content");
  assert(firstBlob.indexOf(NOTE_SECRET) === -1, "audit list leaked note");
  assert(firstBlob.indexOf(REASON_SECRET) === -1, "audit list leaked resolution reason");
  assert(firstBlob.indexOf(UNKNOWN_SECRET) === -1, "audit list leaked unknown payload");

  const contentDelta = await getJson(baseUrl, "/api/audit/events?type=content_delta&limit=10");
  assert(contentDelta.status === 200, `content_delta filter expected 200, got ${contentDelta.status}`);
  const deltaSummary = contentDelta.payload.items?.[0]?.payloadSummary ?? {};
  assert(deltaSummary.deltaChars === CONTENT_SECRET.length, "content_delta summary missing deltaChars");
  assert(JSON.stringify(deltaSummary).indexOf(CONTENT_SECRET) === -1, "content_delta summary leaked delta");

  const toolEvents = await getJson(baseUrl, "/api/audit/events?type=tool_call_started&limit=10");
  const toolSummary = toolEvents.payload.items?.[0]?.payloadSummary ?? {};
  assert(toolSummary.toolName === "pkos.inbox.append", "tool summary missing toolName");
  assert(toolSummary.contentChars === CONTENT_SECRET.length, "tool summary missing contentChars");
  assert(JSON.stringify(toolSummary).indexOf(CONTENT_SECRET) === -1, "tool summary leaked content");

  const resolutionEvents = await getJson(baseUrl, "/api/audit/events?type=action_request_resolved&limit=10");
  const resolutionSummary = resolutionEvents.payload.items?.[0]?.payloadSummary ?? {};
  assert(resolutionSummary.reasonChars === REASON_SECRET.length, "resolution summary missing reasonChars");
  assert(JSON.stringify(resolutionSummary).indexOf(REASON_SECRET) === -1, "resolution summary leaked reason");

  const unknownEvents = await getJson(baseUrl, "/api/audit/events?type=unknown_fixture&limit=10");
  assert(JSON.stringify(unknownEvents.payload).indexOf(UNKNOWN_SECRET) === -1, "unknown event leaked payload");
  assert(Object.keys(unknownEvents.payload.items?.[0]?.payloadSummary ?? {}).length === 0, "unknown event summary was not empty");

  const filtered = await getJson(baseUrl, "/api/audit/events?severity=warn&sessionId=session-a&generationId=generation-a&limit=10");
  assert(filtered.status === 200, `filtered audit expected 200, got ${filtered.status}`);
  assert(filtered.payload.items?.every((item) => item.severity === "warn"), "severity filter failed");
  assert(filtered.payload.items?.every((item) => item.sessionId === "session-a"), "sessionId filter failed");
  assert(filtered.payload.items?.every((item) => item.generationId === "generation-a"), "generationId filter failed");

  const pageTwo = await getJson(baseUrl, `/api/audit/events?limit=3&before=${encodeURIComponent(first.payload.nextBefore ?? "")}`);
  assert(pageTwo.status === 200, `before pagination expected 200, got ${pageTwo.status}`);
  assert((pageTwo.payload.items?.length ?? 0) > 0, "before pagination returned no rows");
  assert(pageTwo.payload.items?.[0]?.id !== first.payload.items?.[0]?.id, "before pagination repeated first row");

  const invalid = await getJson(baseUrl, "/api/audit/events?limit=9999");
  assert(invalid.status === 400, `invalid limit expected 400, got ${invalid.status}`);

  console.log("AUDIT_API_SMOKE_OK");
} finally {
  await closeServer(server);
  db.close();
  rmSync(dataRoot, { recursive: true, force: true });
}

function seedEvents(database: AgentDatabase): void {
  const rows = [
    {
      id: "event-01-generation-started",
      ts: "2026-07-01T00:00:01.000Z",
      type: "generation_started",
      severity: "info",
      sessionId: "session-a",
      generationId: "generation-a",
      payload: { status: "running", message: CONTENT_SECRET },
    },
    {
      id: "event-02-content-delta",
      ts: "2026-07-01T00:00:02.000Z",
      type: "content_delta",
      severity: "debug",
      sessionId: "session-a",
      generationId: "generation-a",
      payload: { delta: CONTENT_SECRET },
    },
    {
      id: "event-03-context-built",
      ts: "2026-07-01T00:00:03.000Z",
      type: "context_built",
      severity: "info",
      sessionId: "session-a",
      generationId: "generation-a",
      payload: { itemCount: 3, usedChars: 120, truncated: false, warnings: ["w1"], sourceCounts: { static: 1, sqlite: 1, flow_hub: 1 }, items: [{ content: CONTENT_SECRET }] },
    },
    {
      id: "event-04-tool-started",
      ts: "2026-07-01T00:00:04.000Z",
      type: "tool_call_started",
      severity: "warn",
      sessionId: "session-a",
      generationId: "generation-a",
      payload: { toolName: "pkos.inbox.append", inputSummary: { contentLength: CONTENT_SECRET.length, contentSha256: "abc", content: CONTENT_SECRET } },
    },
    {
      id: "event-05-writeback",
      ts: "2026-07-01T00:00:05.000Z",
      type: "writeback_written",
      severity: "info",
      sessionId: "session-b",
      generationId: "generation-b",
      payload: { result: { operation: "pkos.inbox.append", status: "written", target: "inbox/items.jsonl", note: NOTE_SECRET } },
    },
    {
      id: "event-06-resolution",
      ts: "2026-07-01T00:00:06.000Z",
      type: "action_request_resolved",
      severity: "warn",
      sessionId: "session-a",
      generationId: "generation-a",
      payload: { requestId: "req-1", actionName: "inbox-append", resolution: "confirmed_written", resolvedBy: "local_user", reason: REASON_SECRET, reasonChars: REASON_SECRET.length },
    },
    {
      id: "event-07-unknown",
      ts: "2026-07-01T00:00:07.000Z",
      type: "unknown_fixture",
      severity: "info",
      sessionId: null,
      generationId: null,
      payload: { secret: UNKNOWN_SECRET },
    },
  ];
  for (const row of rows) {
    database
      .prepare(
        `INSERT INTO agent_events
          (id, ts, session_id, generation_id, type, severity, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.ts, row.sessionId, row.generationId, row.type, row.severity, JSON.stringify(row.payload));
  }
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
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function getJson(baseUrl: string, path: string): Promise<{ status: number; payload: AuditPayload }> {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    status: response.status,
    payload: (await response.json()) as AuditPayload,
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
