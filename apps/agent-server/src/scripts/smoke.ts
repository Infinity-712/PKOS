import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAgentDatabase } from "../db/connection.js";
import { createAgentHttpServer } from "../server/httpServer.js";

type CountRow = { count: number };
type StatusRow = { status: string };
type RoleRow = { role: string };

const dataRoot = mkdtempSync(join(tmpdir(), "pkos-agent-server-smoke-"));
process.env.PKOS_DATA_ROOT = dataRoot;

const db = openAgentDatabase();
const server = createAgentHttpServer({ db });

try {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind to a TCP port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const sessionResponse = await fetch(`${baseUrl}/api/chat/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Smoke test" }),
  });
  if (!sessionResponse.ok) {
    throw new Error(`session create failed: ${sessionResponse.status}`);
  }
  const sessionPayload = (await sessionResponse.json()) as { session?: { id?: string } };
  const sessionId = sessionPayload.session?.id;
  if (!sessionId) {
    throw new Error("session response missing id");
  }

  const sendResponse = await fetch(`${baseUrl}/api/chat/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message: "dry-run smoke message" }),
  });
  if (!sendResponse.ok) {
    throw new Error(`chat send failed: ${sendResponse.status}`);
  }
  const ndjson = await sendResponse.text();
  const events = ndjson
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type?: string });

  const eventTypes = events.map((event) => event.type);
  for (const required of ["generation_started", "content_delta", "generation_completed"]) {
    if (!eventTypes.includes(required)) {
      throw new Error(`missing event type: ${required}`);
    }
  }

  const sessionCount = db.prepare("SELECT COUNT(*) AS count FROM chat_sessions").get() as CountRow;
  if (sessionCount.count < 1) {
    throw new Error("chat_sessions count was less than 1");
  }

  const roles = db.prepare("SELECT role FROM chat_messages ORDER BY created_at").all() as RoleRow[];
  const roleNames = roles.map((row) => row.role);
  if (!roleNames.includes("user") || !roleNames.includes("assistant")) {
    throw new Error("chat_messages did not include both user and assistant");
  }

  const generation = db.prepare("SELECT status FROM generations ORDER BY created_at DESC LIMIT 1").get() as StatusRow | undefined;
  if (!generation || generation.status !== "completed") {
    throw new Error("latest generation was not completed");
  }

  for (const required of ["generation_started", "content_delta", "generation_completed"]) {
    const count = db.prepare("SELECT COUNT(*) AS count FROM agent_events WHERE type = ?").get(required) as CountRow;
    if (count.count < 1) {
      throw new Error(`agent_events missing ${required}`);
    }
  }

  console.log("AGENT_SERVER_SMOKE_OK");
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  db.close();
  rmSync(dataRoot, { recursive: true, force: true });
}
