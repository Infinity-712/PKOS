import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentDatabase } from "./connection.js";

type UserVersionRow = {
  user_version: number;
};

type Migration = {
  version: number;
  filename: string;
  sql: string;
};

export function runMigrations(db: AgentDatabase, migrationsDir: string): void {
  const migrations = loadMigrations(migrationsDir);
  let currentVersion = getUserVersion(db);

  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue;
    }
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
      currentVersion = migration.version;
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`migration failed: ${migration.filename}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function loadMigrations(migrationsDir: string): Migration[] {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .map((filename) => {
      const version = Number.parseInt(filename.slice(0, 4), 10);
      if (!Number.isFinite(version)) {
        throw new Error(`invalid migration filename: ${filename}`);
      }
      return {
        version,
        filename,
        sql: readFileSync(join(migrationsDir, filename), "utf8"),
      };
    })
    .sort((a, b) => a.version - b.version);
}

function getUserVersion(db: AgentDatabase): number {
  const row = db.prepare("PRAGMA user_version").get() as UserVersionRow;
  return row.user_version;
}
