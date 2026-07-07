import { resolveAgentPaths } from "./config/paths.js";
import { createAgentHttpServer } from "./server/httpServer.js";

const port = Number.parseInt(process.env.PKOS_AGENT_PORT ?? "8790", 10);
const paths = resolveAgentPaths();
const server = createAgentHttpServer();

server.listen(port, "127.0.0.1", () => {
  console.log(`PKOS Agent Server skeleton listening on http://127.0.0.1:${port}`);
  console.log(`SQLite runtime DB: ${paths.agentDbPath}`);
});
