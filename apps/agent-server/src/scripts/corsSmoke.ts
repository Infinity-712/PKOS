import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAgentDatabase } from "../db/connection.js";
import { createAgentHttpServer } from "../server/httpServer.js";

type JsonRecord = Record<string, unknown>;

const dataRoot = mkdtempSync(join(tmpdir(), "pkos-agent-cors-smoke-"));
process.env.PKOS_DATA_ROOT = dataRoot;
delete process.env.PKOS_AGENT_DB_PATH;

const db = openAgentDatabase();
const server = createAgentHttpServer({ db });

try {
  const baseUrl = await listen(server);

  await expectAllowed(baseUrl, "http://127.0.0.1:5173", "/health");
  await expectAllowed(baseUrl, "pkos-desktop://app", "/health");
  await expectRejected(baseUrl, "https://example.com", "/health");
  await expectRejected(baseUrl, "null", "/health");
  await expectRejected(baseUrl, "file://", "/health");
  await expectRejected(baseUrl, "pkos-desktop://app.evil", "/health");

  const preflight = await options(baseUrl, "/health", "pkos-desktop://app");
  assert(preflight.status === 204, `desktop preflight expected 204, got ${preflight.status}`);
  assert(preflight.headers.get("access-control-allow-origin") === "pkos-desktop://app", "desktop preflight did not allow exact origin");
  assert((preflight.headers.get("access-control-allow-methods") ?? "").includes("POST"), "preflight methods missing POST");
  assert((preflight.headers.get("access-control-allow-headers") ?? "").includes("Content-Type"), "preflight headers missing Content-Type");

  const rejectedPreflight = await options(baseUrl, "/health", "https://example.com");
  assert(rejectedPreflight.status === 403, `rejected preflight expected 403, got ${rejectedPreflight.status}`);
  assert(rejectedPreflight.headers.get("access-control-allow-origin") === null, "rejected preflight leaked allow-origin");

  const actionPreflight = await options(baseUrl, "/api/actions/inbox-append", "pkos-desktop://app");
  assert(actionPreflight.status === 204, `action preflight expected 204, got ${actionPreflight.status}`);

  const session = await fetchJson<{ session?: { id?: string } }>(baseUrl, "/api/chat/sessions", "pkos-desktop://app", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "pkos-desktop://app" },
    body: JSON.stringify({ title: "cors smoke" }),
  });
  assert(session.status === 201 && typeof session.payload.session?.id === "string", "session setup failed");

  const stream = await fetch(`${baseUrl}/api/chat/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "pkos-desktop://app" },
    body: JSON.stringify({ sessionId: session.payload.session.id, message: "hello" }),
  });
  assert(stream.status === 200, `NDJSON stream expected 200, got ${stream.status}`);
  assert(stream.headers.get("access-control-allow-origin") === "pkos-desktop://app", "NDJSON stream CORS header missing");
  assert((stream.headers.get("content-type") ?? "").includes("application/x-ndjson"), "chat stream content-type changed");

  console.log("AGENT_SERVER_CORS_SMOKE_OK");
} finally {
  await closeServer(server);
  db.close();
  rmSync(dataRoot, { recursive: true, force: true });
}

async function expectAllowed(baseUrl: string, origin: string, path: string): Promise<void> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Origin: origin } });
  assert(response.status === 200, `allowed origin ${origin} expected 200, got ${response.status}`);
  assert(response.headers.get("access-control-allow-origin") === origin, `allowed origin ${origin} missing allow-origin`);
  assert(response.headers.get("vary") === "Origin", `allowed origin ${origin} missing Vary`);
  assert(response.headers.get("x-pkos-received-origin") === origin, `allowed origin ${origin} missing received-origin`);
}

async function expectRejected(baseUrl: string, origin: string, path: string): Promise<void> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Origin: origin } });
  assert(response.status === 200, `plain GET should keep route behavior for rejected ${origin}`);
  assert(response.headers.get("access-control-allow-origin") === null, `rejected origin ${origin} received allow-origin`);
}

async function options(baseUrl: string, path: string, origin: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type",
    },
  });
}

async function fetchJson<T>(baseUrl: string, path: string, _origin: string, init: RequestInit): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  return {
    status: response.status,
    payload: (await response.json()) as T,
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
