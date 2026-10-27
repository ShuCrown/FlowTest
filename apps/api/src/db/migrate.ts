import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

const MIGRATION_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS systems (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_json TEXT,
  allowed_origins TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dsl_json TEXT NOT NULL,
  layout_json TEXT,
  readiness INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  published_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flow_versions (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  dsl_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS flow_versions_flow_version_idx ON flow_versions(flow_id, version);
CREATE INDEX IF NOT EXISTS flow_versions_flow_idx ON flow_versions(flow_id);

CREATE TABLE IF NOT EXISTS run_batches (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  flow_version_id TEXT,
  mode TEXT NOT NULL,
  dataset_ids_json TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  batch_id TEXT,
  flow_id TEXT NOT NULL,
  flow_version_id TEXT,
  dataset_id TEXT,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  artifact_dir TEXT,
  resolved_data_json TEXT,
  compiled_plan_path TEXT,
  seed INTEGER,
  error_json TEXT,
  metrics_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_flow_idx ON runs(flow_id);
CREATE INDEX IF NOT EXISTS runs_batch_idx ON runs(batch_id);

CREATE TABLE IF NOT EXISTS run_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  idx INTEGER NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  resolved_target_json TEXT,
  stage_timings_json TEXT,
  error_json TEXT,
  screenshot_path TEXT
);
CREATE INDEX IF NOT EXISTS run_nodes_run_idx ON run_nodes(run_id);

CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts TEXT NOT NULL,
  node_id TEXT,
  type TEXT NOT NULL,
  level TEXT,
  payload_json TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS run_events_run_seq_idx ON run_events(run_id, seq);

CREATE TABLE IF NOT EXISTS run_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  field TEXT NOT NULL,
  expected_json TEXT,
  actual_json TEXT,
  value_source TEXT,
  status TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS run_network (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  node_id TEXT,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  status INTEGER,
  req_body_json TEXT,
  resp_snippet TEXT,
  redacted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS value_ledger (
  system_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  value TEXT NOT NULL,
  run_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (system_id, scope, value)
);

CREATE TABLE IF NOT EXISTS sequences (
  system_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  next_value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (system_id, scope)
);

CREATE TABLE IF NOT EXISTS record_sessions (
  id TEXT PRIMARY KEY,
  system_id TEXT NOT NULL,
  raw_path TEXT,
  events_count INTEGER NOT NULL DEFAULT 0,
  draft_dsl_json TEXT,
  rule_version TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_confirms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  node_id TEXT,
  kind TEXT NOT NULL,
  options_json TEXT,
  status TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS repair_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flow_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

INSERT OR IGNORE INTO settings(key, value_json) VALUES (
  'defaults',
  '{"nodeTimeoutMs":15000,"pickerTimeoutMs":30000,"screenshot":"onFailure","trace":false,"resourcePolicy":"balanced","headless":true,"retentionDays":30,"aiEnabled":false}'
);
`;

export function migrate(sqlite: Database.Database): void {
  sqlite.exec(MIGRATION_SQL);
}

if (
  process.argv[1] &&
  process.argv[1].includes("migrate") &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  const dataDir = resolve(process.env.FF_DATA_DIR ?? "data");
  mkdirSync(dataDir, { recursive: true });
  const dbPath = resolve(dataDir, "flowforge.db");
  const sqlite = new Database(dbPath);
  migrate(sqlite);
  sqlite.close();
  console.log(`migrated ${dbPath}`);
}

export function ensureDirFor(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}
