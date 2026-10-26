import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { migrate } from "./migrate.js";

export interface FlowForgeDatabase {
  sqlite: Database.Database;
  orm: BetterSQLite3Database<typeof schema>;
  dataDir: string;
  dbPath: string;
}

export function dataDirFromEnv(): string {
  return resolve(process.env.FF_DATA_DIR ?? "data");
}

export function createDatabase(options: { dataDir?: string } = {}): FlowForgeDatabase {
  const dataDir = options.dataDir ?? dataDirFromEnv();
  mkdirSync(dataDir, { recursive: true });
  const dbPath = resolve(dataDir, "flowforge.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite);
  const orm = drizzle(sqlite, { schema });
  return { sqlite, orm, dataDir, dbPath };
}
