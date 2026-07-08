import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { handleActionRoutes } from "../actions/ActionRoutes.js";
import { handleAuditRoutes } from "../audit/AuditRoutes.js";
import { ContextBuilder } from "../context/ContextBuilder.js";
import { openAgentDatabase, type AgentDatabase } from "../db/connection.js";
import { EventStore } from "../events/EventStore.js";
import { GenerationManager } from "../runtime/GenerationManager.js";
import { AgentRunner } from "../runtime/AgentRunner.js";
import { ToolExecutor } from "../tools/ToolExecutor.js";
import { createDefaultToolRegistry } from "../tools/ToolRegistry.js";
import { WritebackRouter } from "../writeback/WritebackRouter.js";
import { handleChatRoutes, sendJson } from "./chatRoutes.js";

export type AgentHttpServerOptions = {
  db?: AgentDatabase;
};

export function createAgentHttpServer(options: AgentHttpServerOptions = {}): Server {
  const db = options.db ?? openAgentDatabase();
  const events = new EventStore(db);
  const generations = new GenerationManager(db, events);
  const contextBuilder = new ContextBuilder(db);
  const runner = new AgentRunner(db, generations, undefined, events, contextBuilder);
  const registry = createDefaultToolRegistry();
  const writebackRouter = new WritebackRouter();
  const toolExecutor = new ToolExecutor(db, registry, writebackRouter, events);

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.method === "GET" && (req.url === "/health" || req.url?.startsWith("/health?"))) {
        sendJson(res, 200, { ok: true, service: "pkos-agent-server", mode: "dry-run" });
        return;
      }

      if (await handleChatRoutes(req, res, { db, runner, contextBuilder })) {
        return;
      }

      if (await handleActionRoutes(req, res, { db, registry, executor: toolExecutor, events })) {
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
  });
}
