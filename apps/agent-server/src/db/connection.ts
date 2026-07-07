import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { ensureAgentRuntimeDir, resolveAgentPaths, type AgentPaths } from "../config/paths.js";

export type AgentDatabase = DatabaseSync;

function schemaPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
}

export function openAgentDatabase(paths: AgentPaths = resolveAgentPaths()): AgentDatabase {
  ensureAgentRuntimeDir(paths);
  const db = new DatabaseSync(paths.agentDbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(readFileSync(schemaPath(), "utf8"));
  return db;
}
