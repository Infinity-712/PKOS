import { existsSync } from "node:fs";

import { openAgentDatabase } from "./db/connection.js";
import { resolveAgentPaths } from "./config/paths.js";
import { AgentRunner } from "./runtime/AgentRunner.js";
import { ContextBuilder } from "./context/ContextBuilder.js";
import { EventStore } from "./events/EventStore.js";
import { GenerationManager } from "./runtime/GenerationManager.js";
import { ProviderProfileRegistry } from "./providers/registry/ProviderProfileRegistry.js";
import { buildRuntimeIdentity, logRuntimeStartup } from "./runtime/RuntimeIdentity.js";
import { createAgentHttpServer } from "./server/httpServer.js";

const port = Number.parseInt(process.env.PKOS_AGENT_PORT ?? "8790", 10);
const host = "127.0.0.1";
let paths;
try {
  paths = resolveAgentPaths(process.env, { requireDataRoot: true });
} catch (error) {
  if (error instanceof Error && error.name === "PKOS_DATA_ROOT_REQUIRED") {
    console.error("PKOS_DATA_ROOT_REQUIRED");
    process.exit(1);
  }
  throw error;
}
const dbExistedAtStartup = existsSync(paths.agentDbPath);
const db = openAgentDatabase(paths);
const identity = buildRuntimeIdentity({ paths });
const server = createAgentHttpServer({ db, runtimeIdentity: identity });

server.listen(port, host, () => {
  const events = new EventStore(db);
  const runner = new AgentRunner(db, new GenerationManager(db, events), new ProviderProfileRegistry(), events, new ContextBuilder(db));
  logRuntimeStartup({ identity, db, host, port, providerStatus: safeProviderStatus(runner), dbExistedAtStartup });
  console.log(`PKOS Agent Server skeleton listening on http://127.0.0.1:${port}`);
  console.log(`SQLite runtime DB: ${paths.agentDbPath}`);
});

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
