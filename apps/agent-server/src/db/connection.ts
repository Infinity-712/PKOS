import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { ensureAgentRuntimeDir, resolveAgentPaths, type AgentPaths } from "../config/paths.js";
import { runMigrations } from "./MigrationRunner.js";

export type AgentDatabase = DatabaseSync;

function migrationsPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "migrations");
}

export function openAgentDatabase(paths: AgentPaths = resolveAgentPaths()): AgentDatabase {
  ensureAgentRuntimeDir(paths);
  const db = new DatabaseSync(paths.agentDbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db, migrationsPath());
  return db;
}
