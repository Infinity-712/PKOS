import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type AgentPaths = {
  coreRoot: string;
  dataRoot: string;
  agentRuntimeDir: string;
  agentDbPath: string;
};

export type ResolveAgentPathOptions = {
  requireDataRoot?: boolean;
};

function inferredCoreRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../../..");
}

export function resolveAgentPaths(env: NodeJS.ProcessEnv = process.env, options: ResolveAgentPathOptions = {}): AgentPaths {
  const coreRoot = resolve(env.PKOS_CORE_ROOT && env.PKOS_CORE_ROOT.trim() ? env.PKOS_CORE_ROOT : inferredCoreRoot());
  const dataRootValue = env.PKOS_DATA_ROOT && env.PKOS_DATA_ROOT.trim() ? env.PKOS_DATA_ROOT : null;
  if (options.requireDataRoot && !dataRootValue) {
    const error = new Error("PKOS_DATA_ROOT_REQUIRED");
    error.name = "PKOS_DATA_ROOT_REQUIRED";
    throw error;
  }
  const dataRoot = resolve(dataRootValue ?? coreRoot);
  const defaultDbPath = join(dataRoot, "runtime", "agent", "agent.sqlite");
  const agentDbPath = resolve(
    env.PKOS_AGENT_DB_PATH && env.PKOS_AGENT_DB_PATH.trim() ? env.PKOS_AGENT_DB_PATH : defaultDbPath,
  );
  return {
    coreRoot,
    dataRoot,
    agentRuntimeDir: dirname(agentDbPath),
    agentDbPath,
  };
}

export function ensureAgentRuntimeDir(paths: AgentPaths = resolveAgentPaths()): void {
  mkdirSync(paths.agentRuntimeDir, { recursive: true });
}
