import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { once } from "node:events";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentHttpServer } from "../server/httpServer.js";
import { buildRuntimeIdentity } from "../runtime/RuntimeIdentity.js";

async function api() {
  const name = "./mobileCompatServer.js";
  const module = await import(name).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ERR_MODULE_NOT_FOUND") return null;
    throw error;
  }) as typeof import("./mobileCompatServer.js") | null;
  assert.ok(module?.createMobileCompatFixture, "reusable synthetic fixture factory must exist");
  return module;
}

async function start(options = {}) {
  const fixture = (await api()).createMobileCompatFixture(options);
  fixture.server.listen(0, "127.0.0.1");
  await once(fixture.server, "listening");
  const address = fixture.server.address();
  assert.ok(address && typeof address !== "string");
  return { ...fixture, baseUrl: `http://127.0.0.1:${address.port}` };
}

const headers = { Origin: "http://localhost", "Content-Type": "application/json" };
async function send(base: string, sessionId: string, scenario = "normal", message = "hello") {
  return fetch(`${base}/api/chat/send`, {
    method: "POST", headers: { ...headers, "X-PKOS-Compat-Scenario": scenario },
    body: JSON.stringify({ sessionId, message }),
  });
}
async function json(base: string, path: string) {
  const response = await fetch(base + path, { headers });
  assert.equal(response.status, 200);
  return response.json();
}

test("synthetic fixture uses real identity contract and two isolated persisted histories", async () => {
  const f = await start();
  try {
    const info = await json(f.baseUrl, "/__mobile_compat__/info");
    assert.deepEqual(info, { mode: "synthetic", fixtureId: f.fixtureId, fixtureVersion: "1" });
    const runtime = await json(f.baseUrl, "/api/runtime-info");
    const manifest = JSON.parse(readFileSync(new URL("../../service-capabilities.json", import.meta.url), "utf8"));
    assert.deepEqual(runtime.service.capabilities, [...manifest.capabilities].sort());
    assert.equal(runtime.service.apiContractVersion, manifest.service.apiContractVersion);
    assert.equal(runtime.database.compatible, true);
    assert.equal(runtime.mode, undefined);
    const status = await json(f.baseUrl, "/api/chat/provider-status");
    assert.equal(status.dataEgress, "none");
    assert.equal(status.selection.external, false);
    assert.equal(status.selection.protocol, "dry-run");
    const { sessions } = await json(f.baseUrl, "/api/chat/sessions");
    assert.equal(sessions.length, 2);
    const a = await json(f.baseUrl, `/api/chat/sessions/${sessions[0].id}/messages`);
    const b = await json(f.baseUrl, `/api/chat/sessions/${sessions[1].id}/messages`);
    assert.equal(a.items.length, 2);
    assert.equal(b.items.length, 2);
    assert.notDeepEqual(a.items.map((m: { content: string }) => m.content), b.items.map((m: { content: string }) => m.content));
    assert.deepEqual(a, await json(f.baseUrl, `/api/chat/sessions/${sessions[0].id}/messages`));
    assert.ok(existsSync(f.paths.agentDbPath));
  } finally { await f.close(); }
  assert.equal(existsSync(f.temporaryRoot), false);
  await f.close();
});

test("exact test CORS rejects disallowed actual requests and forbidden routes before side effects", async () => {
  const f = await start();
  try {
    const before = f.db.prepare("SELECT COUNT(*) AS n FROM chat_messages").get();
    for (const origin of ["null", "*", "https://example.com", "http://localhost.evil", "http://127.0.0.1:5185", "pkos-desktop://app"]) {
      for (const method of ["GET", "POST", "OPTIONS"]) {
        const r = await fetch(f.baseUrl + (method === "POST" ? "/api/chat/send" : "/health"), { method, headers: { Origin: origin } });
        assert.equal(r.status, 403, `${method} ${origin}`);
        assert.equal(r.headers.get("access-control-allow-origin"), null);
      }
    }
    const preflight = await fetch(f.baseUrl + "/api/chat/send", { method: "OPTIONS", headers: {
      Origin: "http://localhost", "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type, X-PKOS-Compat-Scenario",
    } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost");
    assert.match(preflight.headers.get("access-control-allow-headers")!, /X-PKOS-Compat-Scenario/i);
    for (const [method, path] of [
      ["POST", "/api/chat/sessions"], ["POST", "/api/chat/provider-selection"],
      ["GET", "/api/chat/provider-profiles"], ["GET", "/api/context/nope"],
      ["GET", "/api/runtime/reminder-notifications"], ["POST", "/api/actions/inbox-append"],
      ["POST", "/api/actions/state-append"], ["GET", "/api/pkos/objects"],
      ["GET", "/api/pkos/tasks"], ["GET", "/api/pkos/review"], ["GET", "/api/pkos/state-timeline"],
    ]) {
      const response = await fetch(f.baseUrl + path, { method, headers });
      assert.equal(response.status, 404, `${method} ${path}`);
    }
    assert.deepEqual(f.db.prepare("SELECT COUNT(*) AS n FROM chat_messages").get(), before);
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n, 0);
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM action_requests").get() as { n: number }).n, 0);
    const invalid = await send(f.baseUrl, "missing", "bad");
    assert.equal(invalid.status, 400);
  } finally { await f.close(); }
});

test("browser origin is explicit and restricted; CLI rejects production ports and unknown options", async () => {
  const mod = await api();
  assert.deepEqual(mod.parseMobileCompatArgs([]), { port: 18790 });
  assert.deepEqual(mod.parseMobileCompatArgs(["--port", "18791", "--browser-origin", "http://127.0.0.1:5185"]), { port: 18791, browserOrigin: "http://127.0.0.1:5185" });
  for (const args of [["--port", "8790"], ["--port", "0"], ["--port", "65536"], ["--host", "0.0.0.0"], ["--browser-origin", "*"], ["--browser-origin", "null"]]) {
    assert.throws(() => mod.parseMobileCompatArgs(args));
  }
  assert.throws(() => mod.createMobileCompatFixture({ browserOrigin: "*" }));
  const f = await start({ browserOrigin: "http://127.0.0.1:5185" });
  try {
    const r = await fetch(f.baseUrl + "/health", { headers: { Origin: "http://127.0.0.1:5185" } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), "http://127.0.0.1:5185");
    const address = f.server.address();
    assert.ok(address && typeof address !== "string");
    await assert.rejects(mod.startMobileCompatServer({ port: address.port }), { code: "EADDRINUSE" });
    assert.equal((await fetch(f.baseUrl + "/health")).status, 200);
  } finally { await f.close(); }
});

test("delayed Chinese and emoji stream uses real events, tail without newline, and SQLite history", async () => {
  const f = await start();
  const writes: Buffer[] = [];
  f.server.prependListener("request", (req, res) => {
    if (req.url !== "/api/chat/send") return;
    const write = res.write.bind(res);
    res.write = ((chunk: string | Uint8Array) => {
      writes.push(Buffer.from(chunk));
      return write(chunk);
    }) as ServerResponse["write"];
  });
  try {
    const { sessions } = await json(f.baseUrl, "/api/chat/sessions");
    const started = Date.now();
    const response = await send(f.baseUrl, sessions[0].id);
    assert.equal(response.status, 200);
    const chunks: Uint8Array[] = [];
    let intermediateAt = 0;
    let text = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for await (const chunk of response.body!) {
      chunks.push(chunk);
      text += decoder.decode(chunk, { stream: true });
      if (!intermediateAt && text.includes('"content_delta"') && text.includes("\n")) intermediateAt = Date.now();
    }
    text += decoder.decode();
    assert.ok(intermediateAt > started);
    assert.ok(Date.now() - intermediateAt >= 100, "must receive content before stream ends");
    assert.ok(chunks.length >= 4);
    assert.equal(text.endsWith("\n"), false);
    const events = text.split("\n").map((line) => JSON.parse(line));
    assert.equal(Buffer.concat(writes).toString("utf8"), text);
    assert.ok(writes.some((bytes) => bytes.toString("utf8").split("\n").length >= 3), "one server write groups multiple JSON lines");
    assert.ok(writes.some((bytes) => {
      try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return false; } catch { return true; }
    }), "at least one write splits a multibyte character");
    const replayed: unknown[] = [];
    // Cross-package integration only; do not expand the server compiler rootDir.
    const parserUrl = new URL("../../../../packages/agent-client/src/NdjsonStreamParser.js", import.meta.url).href;
    const { parseNdjsonStream } = await import(parserUrl) as {
      parseNdjsonStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<unknown>;
    };
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const bytes of writes) controller.enqueue(bytes); controller.close(); } });
    for await (const event of parseNdjsonStream(stream)) replayed.push(event);
    assert.deepEqual(replayed, events, "shared parser reconstructs exact test transport byte cuts");
    assert.equal(events.at(-1).type, "generation_completed");
    const content = events.filter((e) => e.type === "content_delta").map((e) => e.payload.delta).join("");
    assert.equal(content, (await api()).MOBILE_COMPAT_REPLY);
    assert.match(content, /PKOS_MOBILE_STREAM_OK/);
    assert.ok(content.includes("\u4e2d\u6587") && content.includes("\u{1f642}"));
    const history = await json(f.baseUrl, `/api/chat/sessions/${sessions[0].id}/messages`);
    assert.ok(history.items.some((m: { content: string }) => m.content === content));
    const untouched = await json(f.baseUrl, `/api/chat/sessions/${sessions[1].id}/messages`);
    assert.equal(untouched.items.length, 2);
    assert.ok((f.db.prepare("SELECT COUNT(*) AS n FROM agent_events").get() as { n: number }).n >= events.length);
  } finally { await f.close(); }
});

test("default factory retains original CORS, routes, and provider without test dependencies", async () => {
  const fixture = (await api()).createMobileCompatFixture();
  const keys = ["PKOS_DATA_ROOT", "PKOS_AGENT_DB_PATH"] as const;
  const previous = keys.map((key) => process.env[key]);
  process.env.PKOS_DATA_ROOT = fixture.paths.dataRoot;
  process.env.PKOS_AGENT_DB_PATH = fixture.paths.agentDbPath;
  const server = createAgentHttpServer({ db: fixture.db, runtimeIdentity: buildRuntimeIdentity({ paths: fixture.paths, profileName: "default-factory-smoke" }) });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    for (const origin of ["http://localhost", "http://127.0.0.1:5185", "null", "*"]) {
      const get = await fetch(base + "/health", { headers: { Origin: origin } });
      assert.equal(get.status, 200, "production still permits actual requests without CORS access");
      assert.equal(get.headers.get("access-control-allow-origin"), null);
      assert.equal((await fetch(base + "/health", { method: "OPTIONS", headers: { Origin: origin } })).status, 403);
    }
    assert.equal((await fetch(base + "/__mobile_compat__/info")).status, 404);
    const created = await fetch(base + "/api/chat/sessions", { method: "POST", headers, body: JSON.stringify({ title: "default factory" }) });
    assert.equal(created.status, 201);
    const { session } = await created.json();
    const response = await send(base, session.id);
    const text = await response.text();
    const content = text.trim().split("\n").map((line) => JSON.parse(line))
      .filter((event) => event.type === "content_delta").map((event) => event.payload.delta).join("");
    assert.match(content, /dry-run PKOS agent server skeleton/);
    assert.doesNotMatch(text, /PKOS_MOBILE_STREAM_OK/);
    assert.equal(text.endsWith("\n"), true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    await fixture.close();
  }
});

test("synthetic fixture ignores process-selected paths and profiles without changing them", async () => {
  const mod = await api();
  const first = mod.createMobileCompatFixture();
  const keys = ["PKOS_DATA_ROOT", "PKOS_AGENT_DB_PATH", "PKOS_RUNTIME_PROFILE_NAME"] as const;
  const previous = keys.map((key) => process.env[key]);
  try {
    process.env.PKOS_DATA_ROOT = first.paths.agentDbPath;
    process.env.PKOS_AGENT_DB_PATH = first.temporaryRoot;
    process.env.PKOS_RUNTIME_PROFILE_NAME = "must-not-be-used";
    const f = await start();
    try {
      assert.notEqual(f.paths.dataRoot, first.paths.agentDbPath);
      assert.notEqual(f.paths.agentDbPath, first.temporaryRoot);
      assert.equal((await json(f.baseUrl, "/api/runtime-info")).profileName, "mobile-compat-synthetic");
      const { sessions } = await json(f.baseUrl, "/api/chat/sessions");
      assert.match(await (await send(f.baseUrl, sessions[0].id)).text(), /PKOS_MOBILE_STREAM_OK/);
      assert.equal(process.env.PKOS_DATA_ROOT, first.paths.agentDbPath);
      assert.equal(process.env.PKOS_AGENT_DB_PATH, first.temporaryRoot);
      assert.equal(process.env.PKOS_RUNTIME_PROFILE_NAME, "must-not-be-used");
    } finally { await f.close(); }
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    await first.close();
  }
});

test("HTTP 200 failure and damaged transports never produce a completed client stream", async () => {
  const f = await start();
  try {
    const { sessions } = await json(f.baseUrl, "/api/chat/sessions");
    const failed = await send(f.baseUrl, sessions[0].id, "failed", "[compat:failed] hello");
    assert.equal(failed.status, 200);
    const text = await failed.text();
    assert.match(text, /generation_failed/);
    assert.doesNotMatch(text, /generation_completed/);
    const truncated = await send(f.baseUrl, sessions[0].id, "truncated");
    const damaged = await truncated.text();
    assert.throws(() => JSON.parse(damaged.split("\n").at(-1)!));
    assert.doesNotMatch(damaged, /generation_completed/);
    const disconnected = await send(f.baseUrl, sessions[0].id, "disconnect");
    await assert.rejects(disconnected.text());
  } finally { await f.close(); }
});

test("slow scenario supports real abort API and concurrent normal request is unaffected", async () => {
  const f = await start();
  try {
    const { sessions } = await json(f.baseUrl, "/api/chat/sessions");
    const slow = await send(f.baseUrl, sessions[0].id, "slow");
    const reader = slow.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("\n")) text += decoder.decode((await reader.read()).value, { stream: true });
    const generationId = JSON.parse(text.split("\n")[0]).generationId;
    const normal = await send(f.baseUrl, sessions[1].id);
    assert.match(await normal.text(), /generation_completed/);
    const aborted = await fetch(`${f.baseUrl}/api/chat/generations/${generationId}/abort`, { method: "POST", headers });
    assert.equal(aborted.status, 202);
    assert.equal((await aborted.json()).status, "aborted");
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    assert.doesNotMatch(text, /generation_completed/);
    assert.equal((f.db.prepare("SELECT status FROM generations WHERE id = ?").get(generationId) as { status: string }).status, "aborted");
    const history = await json(f.baseUrl, `/api/chat/sessions/${sessions[0].id}/messages`);
    assert.equal(history.items.filter((m: { role: string }) => m.role === "assistant").length, 1);
  } finally { await f.close(); }
});

test("cleanup aborts active requests and only removes its own temporary fixture", async () => {
  const a = await start();
  const b = await start();
  try {
    assert.notEqual(a.fixtureId, b.fixtureId);
    const { sessions } = await json(a.baseUrl, "/api/chat/sessions");
    const response = await send(a.baseUrl, sessions[0].id, "slow");
    const drained = response.text().catch(() => "disconnected");
    await a.close();
    await drained;
    await delay(25);
    assert.equal(existsSync(a.temporaryRoot), false);
    assert.equal(existsSync(b.temporaryRoot), true);
  } finally { await a.close(); await b.close(); }
});

for (const reason of ["stop-message", "parent-disconnect"] as const) {
  test(`CLI IPC ${reason} exits, cleans owned temporary root, and releases port`, async () => {
    const owner = (await api()).createMobileCompatFixture();
    const probe = createNetServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const address = probe.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((resolveClose) => probe.close(() => resolveClose()));
    const env: NodeJS.ProcessEnv = {};
    for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"]) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    Object.assign(env, {
      TEMP: owner.temporaryRoot, TMP: owner.temporaryRoot, TMPDIR: owner.temporaryRoot,
      PKOS_DATA_ROOT: join(owner.temporaryRoot, "unused-data"),
      PKOS_AGENT_DB_PATH: join(owner.temporaryRoot, "unused.sqlite"),
    });
    const child = spawn(process.execPath, ["--import", "tsx", "src/scripts/mobileCompatServer.ts", "--port", String(port)], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)), env,
      stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true,
    });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
      child.once("exit", (code, signal) => resolveExit({ code, signal }));
    });
    const ready = new Promise<{ temporaryRoot: string; baseUrl: string }>((resolveReady, rejectReady) => {
      let stdout = "";
      child.once("error", rejectReady);
      child.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
        stdout += chunk;
        const line = stdout.split("\n")[0];
        if (stdout.includes("\n")) {
          try { resolveReady(JSON.parse(line)); } catch (error) { rejectReady(error); }
        }
      });
    });
    let drained: Promise<string> | undefined;
    try {
      const info = await withDeadline(ready, 8000, "CLI readiness");
      assert.equal(dirname(info.temporaryRoot), owner.temporaryRoot);
      assert.ok(existsSync(info.temporaryRoot));
      assert.equal(info.baseUrl, `http://127.0.0.1:${port}`);
      const { sessions } = await json(info.baseUrl, "/api/chat/sessions");
      const response = await send(info.baseUrl, sessions[0].id, "slow");
      drained = response.text().catch(() => "disconnected");
      if (reason === "stop-message") {
        child.send({ type: "mobile-compat-stop" }, () => {});
        child.send({ type: "mobile-compat-stop" }, () => {});
      } else {
        child.disconnect();
      }
      const result = await withDeadline(exited, 4000, `CLI ${reason} exit`);
      assert.deepEqual(result, { code: 0, signal: null });
      assert.equal(existsSync(info.temporaryRoot), false);
      assert.equal(existsSync(owner.temporaryRoot), true);
      probe.listen(port, "127.0.0.1");
      await once(probe, "listening");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(); // Only this test's child, as failure cleanup after the assertion.
        await withDeadline(exited, 4000, "owned child fallback exit");
      }
      await drained;
      if (probe.listening) await new Promise<void>((resolveClose) => probe.close(() => resolveClose()));
      await owner.close();
    }
  });
}

async function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
