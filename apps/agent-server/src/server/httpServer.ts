import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { handleActionRoutes } from "../actions/ActionRoutes.js";
import { handleAuditRoutes } from "../audit/AuditRoutes.js";
import { resolveAgentPaths } from "../config/paths.js";
import { ContextBuilder } from "../context/ContextBuilder.js";
import { openAgentDatabase, type AgentDatabase } from "../db/connection.js";
import { EventStore } from "../events/EventStore.js";
import { handleInboxReviewRoutes } from "../pkos/InboxReviewRoutes.js";
import { handleObjectRoutes } from "../pkos/ObjectRoutes.js";
import { handleReminderRoutes } from "../pkos/ReminderRoutes.js";
import { handleReviewRoutes } from "../pkos/ReviewRoutes.js";
import { handleStateTimelineRoutes } from "../pkos/StateTimelineRoutes.js";
import { handleTaskRoutes } from "../pkos/TaskRoutes.js";
import { ProviderProfileRegistry } from "../providers/registry/ProviderProfileRegistry.js";
import type { createProviderFromSnapshot } from "../providers/ProviderFactory.js";
import { handleReminderRuntimeRoutes } from "../reminders/ReminderRuntimeRoutes.js";
import { ReminderScheduler } from "../reminders/ReminderScheduler.js";
import { GenerationManager } from "../runtime/GenerationManager.js";
import { AgentRunner } from "../runtime/AgentRunner.js";
import { buildRuntimeIdentity, createHealthPayload, createRuntimeInfoPayload, type RuntimeIdentity } from "../runtime/RuntimeIdentity.js";
import { ToolExecutor } from "../tools/ToolExecutor.js";
import { createDefaultToolRegistry } from "../tools/ToolRegistry.js";
import { WritebackRouter } from "../writeback/WritebackRouter.js";
import { handleChatRoutes, sendJson } from "./chatRoutes.js";
import { applyCors, handleCorsPreflight } from "./cors.js";

export type AgentHttpServerOptions = {
  db?: AgentDatabase;
  runtimeIdentity?: RuntimeIdentity;
  testDependencies?: {
    db: AgentDatabase;
    runtimeIdentity: RuntimeIdentity;
    registry: ProviderProfileRegistry;
    contextBuilder: ContextBuilder;
    providerFactory: typeof createProviderFromSnapshot;
    // Test-only policy/transport boundary. Production CORS and routes stay unchanged.
    handleRequest?: (req: IncomingMessage, res: ServerResponse, next: () => Promise<void>) => Promise<void>;
  };
};

export function createAgentHttpServer(options: AgentHttpServerOptions = {}): Server {
  const testDeps = options.testDependencies;
  const db = testDeps?.db ?? options.db ?? openAgentDatabase();
  const events = new EventStore(db);
  const generations = new GenerationManager(db, events);
  const contextBuilder = testDeps?.contextBuilder ?? new ContextBuilder(db);
  const runner = new AgentRunner(db, generations, testDeps?.registry ?? new ProviderProfileRegistry(), events, contextBuilder, testDeps?.providerFactory);
  const registry = testDeps ? null : createDefaultToolRegistry();
  const toolExecutor = registry ? new ToolExecutor(db, registry, new WritebackRouter(), events) : null;
  const runtimeIdentity = testDeps?.runtimeIdentity ?? options.runtimeIdentity ?? buildRuntimeIdentity({ paths: resolveAgentPaths() });
  const reminderScheduler = testDeps ? null : new ReminderScheduler(db, runtimeIdentity, { events });

  if (!testDeps?.handleRequest) return createServer(dispatch);

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await testDeps.handleRequest!(req, res, () => dispatch(req, res));
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { ok: false, error: { code: "REQUEST_FAILED", message } });
    }
  });

  async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!testDeps?.handleRequest) {
        if (handleCorsPreflight(req, res)) return;
        applyCors(req, res);
      }

      if (req.method === "GET" && (req.url === "/health" || req.url?.startsWith("/health?"))) {
        sendJson(res, 200, createHealthPayload(runtimeIdentity, db));
        return;
      }

      if (req.method === "GET" && (req.url === "/api/runtime-info" || req.url?.startsWith("/api/runtime-info?"))) {
        sendJson(res, 200, createRuntimeInfoPayload(runtimeIdentity, db, safeProviderStatus(runner)));
        return;
      }

      if (reminderScheduler && await handleReminderRuntimeRoutes(req, res, reminderScheduler)) {
        return;
      }

      if (await handleChatRoutes(req, res, { db, runner, contextBuilder })) {
        return;
      }

      if (testDeps) {
        sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "route not found" } });
        return;
      }

      if (await handleTaskRoutes(req, res)) {
        return;
      }

      if (await handleReminderRoutes(req, res)) {
        return;
      }

      if (await handleReviewRoutes(req, res)) {
        return;
      }

      if (await handleObjectRoutes(req, res)) {
        return;
      }

      if (registry && toolExecutor && await handleActionRoutes(req, res, { db, registry, executor: toolExecutor, events })) {
        return;
      }

      if (await handleInboxReviewRoutes(req, res)) {
        return;
      }

      if (await handleStateTimelineRoutes(req, res)) {
        return;
      }

      if (await handleAuditRoutes(req, res, { db })) {
        return;
      }

      sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "route not found" } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { ok: false, error: { code: "REQUEST_FAILED", message } });
    }
  }
}

function safeProviderStatus(runner: AgentRunner) {
  try {
    return runner.getProviderStatus();
  } catch {
    return {
      selection: {
        profileId: "unknown",
        modelId: null,
        reasoningPreset: "unknown",
        keyConfigured: false,
      },
    };
  }
}
