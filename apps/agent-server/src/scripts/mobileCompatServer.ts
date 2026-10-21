import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { AgentPaths } from "../config/paths.js";
import { ContextBuilder } from "../context/ContextBuilder.js";
import type { BuiltContext } from "../context/ContextTypes.js";
import { RecentMessagesContextSource } from "../context/RecentMessagesContextSource.js";
import { openAgentDatabase, type AgentDatabase } from "../db/connection.js";
import { ProviderError, type AgentProvider } from "../providers/ProviderTypes.js";
import { builtinProviderProfiles } from "../providers/registry/BuiltinProviderProfiles.js";
import { ProviderProfileRegistry } from "../providers/registry/ProviderProfileRegistry.js";
import { buildRuntimeIdentity } from "../runtime/RuntimeIdentity.js";
import { createSession, sendJson } from "../server/chatRoutes.js";
import { createAgentHttpServer } from "../server/httpServer.js";
import { wrapCompatResponse, type CompatScenario } from "./mobileCompat/transport.js";

export const MOBILE_COMPAT_REPLY = "\u4e2d\u6587\u6d41\u5f0f\u517c\u5bb9\u6d4b\u8bd5\uff1a\u7b2c\u4e00\u6bb5\u3002\n\u7b2c\u4e8c\u6bb5\u5305\u542b emoji \u{1f642}\u3002\nPKOS_MOBILE_STREAM_OK";
const browserOrigin = "http://127.0.0.1:5185";
const scenarios = new Set<CompatScenario>(["normal", "failed", "truncated", "disconnect", "slow"]);
const scope = new AsyncLocalStorage<CompatScenario>();

export type MobileCompatOptions = { browserOrigin?: string };
export type MobileCompatStartOptions = MobileCompatOptions & { port?: number };

class SyntheticRegistry extends ProviderProfileRegistry {
  override listProfiles() {
    return builtinProviderProfiles().filter((profile) => profile.protocol === "dry-run").map((profile) => ({
      ...profile, displayName: "Mobile compatibility mock (synthetic)",
    }));
  }
}

class SyntheticContext extends ContextBuilder {
  constructor(private readonly fixtureDb: AgentDatabase) { super(fixtureDb); }
  override build(sessionId: string): BuiltContext {
    const { items, warnings } = new RecentMessagesContextSource(this.fixtureDb).load(sessionId);
    return {
      schemaVersion: "0.6", sessionId, builtAt: new Date().toISOString(), items, warnings,
      budget: { maxItems: 12, maxChars: 24000, usedItems: items.length, usedChars: items.reduce((n, item) => n + item.estimatedChars, 0), truncated: false },
    };
  }
}

function mockProvider(): AgentProvider {
  const scenario = scope.getStore() ?? "normal";
  return {
    protocol: "dry-run", providerId: "dry-run", profileId: "dry-run", modelId: "dry-run", reasoningPreset: "off", dataEgress: "none",
    async *stream(request) {
      const message = request.messages.filter((item) => item.role === "user").at(-1)?.content ?? "";
      for (const text of MOBILE_COMPAT_REPLY.match(/[^\n]+\n?/g)!) {
        await delay(scenario === "slow" ? 2500 : 350, undefined, { signal: request.signal });
        if (message.startsWith("[compat:failed] ")) throw new ProviderError("provider_stream_error", "synthetic provider failure");
        yield { type: "content_delta", text };
      }
      yield { type: "completed", finishReason: "stop" };
    },
  };
}

function routeAllowed(method: string | undefined, path: string): boolean {
  if (method === "GET") return ["/health", "/api/runtime-info", "/api/chat/provider-status", "/api/chat/sessions", "/__mobile_compat__/info"].includes(path)
    || /^\/api\/chat\/sessions\/[^/]+\/messages$/.test(path);
  return method === "POST" && (path === "/api/chat/send" || /^\/api\/chat\/generations\/[^/]+\/abort$/.test(path));
}

function reject(res: ServerResponse, status: number, code: string): void {
  sendJson(res, status, { ok: false, error: { code, message: code } });
}

function prepareRequest(req: IncomingMessage, res: ServerResponse, origins: Set<string>): { scenario: CompatScenario; stream: boolean } | null {
  const origin = req.headers.origin;
  if (origin !== undefined && !origins.has(origin)) { reject(res, 403, "CORS_ORIGIN_REJECTED"); return null; }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Expose-Headers", "X-PKOS-Received-Origin");
    res.setHeader("X-PKOS-Received-Origin", origin);
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const method = req.method === "OPTIONS" ? req.headers["access-control-request-method"] : req.method;
  if (typeof method !== "string" || !routeAllowed(method, url.pathname)) { reject(res, 404, "NOT_FOUND"); return null; }
  if (req.method === "OPTIONS") {
    const requested = String(req.headers["access-control-request-headers"] ?? "").toLowerCase().split(",").map((item) => item.trim()).filter(Boolean);
    if (!origin || requested.some((name) => name !== "content-type" && !(url.pathname === "/api/chat/send" && name === "x-pkos-compat-scenario"))) {
      reject(res, 403, "CORS_HEADERS_REJECTED"); return null;
    }
    res.setHeader("Access-Control-Allow-Methods", method);
    res.setHeader("Access-Control-Allow-Headers", url.pathname === "/api/chat/send" ? "Content-Type, X-PKOS-Compat-Scenario" : "Content-Type");
    res.writeHead(204); res.end(); return null;
  }
  const raw = req.headers["x-pkos-compat-scenario"];
  if (raw !== undefined && (url.pathname !== "/api/chat/send" || method !== "POST" || typeof raw !== "string" || !scenarios.has(raw as CompatScenario))) {
    reject(res, 400, "INVALID_COMPAT_SCENARIO"); return null;
  }
  return { scenario: (raw as CompatScenario | undefined) ?? "normal", stream: url.pathname === "/api/chat/send" && method === "POST" && url.searchParams.get("stream") !== "false" };
}

export function createMobileCompatFixture(options: MobileCompatOptions = {}) {
  if (options.browserOrigin !== undefined && options.browserOrigin !== browserOrigin) throw new Error("browser origin must be http://127.0.0.1:5185");
  const parent = realpathSync(tmpdir());
  const temporaryRoot = mkdtempSync(join(parent, "pkos-mobile-compat-"));
  const fixtureId = randomUUID();
  const paths: AgentPaths = {
    coreRoot: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.."),
    dataRoot: temporaryRoot, agentRuntimeDir: join(temporaryRoot, "runtime", "agent"),
    agentDbPath: join(temporaryRoot, "runtime", "agent", "agent.sqlite"),
  };
  const removeOwnedRoot = () => {
    if (dirname(temporaryRoot) !== parent || !basename(temporaryRoot).startsWith("pkos-mobile-compat-")
      || lstatSync(temporaryRoot).isSymbolicLink() || realpathSync(temporaryRoot) !== temporaryRoot) throw new Error("unsafe fixture cleanup path");
    rmSync(temporaryRoot, { recursive: true, force: true });
  };
  let db: AgentDatabase;
  try { db = openAgentDatabase(paths); } catch (error) { removeOwnedRoot(); throw error; }
  const active = new Set<Promise<void>>();
  const origins = new Set(["http://localhost", ...(options.browserOrigin ? [options.browserOrigin] : [])]);
  try {
    for (const [index, label] of ["A: synthetic reading", "B: synthetic writing"].entries()) {
      const session = createSession(db, label);
      for (const [offset, role] of ["user", "assistant"].entries()) {
        db.prepare("INSERT INTO chat_messages (id, session_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, NULL, ?)")
          .run(randomUUID(), session.id, role, `${label} / ${role} / ${index === 0 ? "READING_ONLY" : "WRITING_ONLY"}`, new Date(Date.UTC(2026, 0, 1, 0, index, offset)).toISOString());
      }
    }
    const server = createAgentHttpServer({ testDependencies: {
      db, runtimeIdentity: buildRuntimeIdentity({ paths, profileName: "mobile-compat-synthetic" }),
      registry: new SyntheticRegistry(paths, {}), contextBuilder: new SyntheticContext(db), providerFactory: mockProvider,
      async handleRequest(req, res, next) {
        const prepared = prepareRequest(req, res, origins);
        if (!prepared) return;
        if (new URL(req.url!, "http://127.0.0.1").pathname === "/__mobile_compat__/info") {
          sendJson(res, 200, { mode: "synthetic", fixtureId, fixtureVersion: "1" }); return;
        }
        const transport = prepared.stream ? wrapCompatResponse(res, prepared.scenario) : null;
        const work = scope.run(prepared.scenario, async () => { await next(); await transport?.finished(); });
        active.add(work);
        try { await work; } finally { active.delete(work); }
      },
    } });
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => closing ??= (async () => {
      const closed = server.listening ? new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      }) : Promise.resolve();
      server.closeAllConnections();
      await closed;
      await Promise.allSettled([...active]);
      db.close();
      removeOwnedRoot();
    })();
    return { server, fixtureId, temporaryRoot, paths, db, close };
  } catch (error) { db.close(); removeOwnedRoot(); throw error; }
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 8790) throw new Error("port must be 1..65535 excluding production port 8790");
}

export function parseMobileCompatArgs(args: string[]): MobileCompatStartOptions & { port: number } {
  const options: MobileCompatStartOptions & { port: number } = { port: 18790 };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (seen.has(key) || !value) throw new Error("duplicate or missing CLI option");
    seen.add(key);
    if (key === "--port" && /^\d+$/.test(value)) options.port = Number(value);
    else if (key === "--browser-origin" && value === browserOrigin) options.browserOrigin = value;
    else throw new Error("only --port and --browser-origin http://127.0.0.1:5185 are supported");
  }
  validatePort(options.port);
  return options;
}

export async function startMobileCompatServer(options: MobileCompatStartOptions = {}) {
  const port = options.port ?? 18790;
  validatePort(port);
  const fixture = createMobileCompatFixture(options);
  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      const failed = (error: Error) => rejectListen(error);
      fixture.server.once("error", failed);
      fixture.server.listen(port, "127.0.0.1", () => { fixture.server.off("error", failed); resolveListen(); });
    });
    return { ...fixture, baseUrl: `http://127.0.0.1:${port}` };
  } catch (error) { await fixture.close(); throw error; }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const startedWithIpc = typeof process.send === "function";
  try {
    const fixture = await startMobileCompatServer(parseMobileCompatArgs(process.argv.slice(2)));
    let stopping: Promise<void> | undefined;
    const stop = (): void => {
      stopping ??= fixture.close()
        .catch(() => { process.exitCode = 1; })
        .finally(() => { if (process.connected) process.disconnect(); });
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    process.on("message", (message: unknown) => {
      if (message && typeof message === "object" && "type" in message && message.type === "mobile-compat-stop") stop();
    });
    process.once("disconnect", stop);
    // A parent can disappear while the fixture is opening its database/listener.
    if (startedWithIpc && !process.connected) {
      stop();
    } else {
      console.log(JSON.stringify({ mode: "synthetic", fixtureId: fixture.fixtureId, fixtureVersion: "1", baseUrl: fixture.baseUrl, temporaryRoot: fixture.temporaryRoot }));
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    console.error(code === "EADDRINUSE" ? "MOBILE_COMPAT_PORT_OCCUPIED" : error instanceof Error ? error.message : "MOBILE_COMPAT_START_FAILED");
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  }
}
