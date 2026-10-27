import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const systems = sqliteTable("systems", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  authJson: text("auth_json"),
  allowedOrigins: text("allowed_origins"),
  createdAt: text("created_at").notNull(),
});

export const flows = sqliteTable("flows", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  dslJson: text("dsl_json").notNull(),
  layoutJson: text("layout_json"),
  readiness: integer("readiness").notNull().default(1),
  revision: integer("revision").notNull().default(1),
  publishedVersion: integer("published_version"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const flowVersions = sqliteTable(
  "flow_versions",
  {
    id: text("id").primaryKey(),
    flowId: text("flow_id").notNull(),
    version: integer("version").notNull(),
    dslJson: text("dsl_json").notNull(),
    checksum: text("checksum").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("flow_versions_flow_version_idx").on(table.flowId, table.version),
    index("flow_versions_flow_idx").on(table.flowId),
  ],
);

export const runBatches = sqliteTable("run_batches", {
  id: text("id").primaryKey(),
  flowId: text("flow_id").notNull(),
  flowVersionId: text("flow_version_id"),
  mode: text("mode").notNull(),
  datasetIdsJson: text("dataset_ids_json").notNull(),
  status: text("status").notNull(),
  summaryJson: text("summary_json"),
  createdAt: text("created_at").notNull(),
});

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id"),
    flowId: text("flow_id").notNull(),
    flowVersionId: text("flow_version_id"),
    datasetId: text("dataset_id"),
    mode: text("mode").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    artifactDir: text("artifact_dir"),
    resolvedDataJson: text("resolved_data_json"),
    compiledPlanPath: text("compiled_plan_path"),
    seed: integer("seed"),
    errorJson: text("error_json"),
    metricsJson: text("metrics_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("runs_flow_idx").on(table.flowId), index("runs_batch_idx").on(table.batchId)],
);

export const runNodes = sqliteTable(
  "run_nodes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id").notNull(),
    nodeId: text("node_id").notNull(),
    nodeType: text("node_type").notNull(),
    idx: integer("idx").notNull(),
    status: text("status").notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    resolvedTargetJson: text("resolved_target_json"),
    stageTimingsJson: text("stage_timings_json"),
    errorJson: text("error_json"),
    screenshotPath: text("screenshot_path"),
  },
  (table) => [index("run_nodes_run_idx").on(table.runId)],
);

export const runEvents = sqliteTable(
  "run_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id").notNull(),
    seq: integer("seq").notNull(),
    ts: text("ts").notNull(),
    nodeId: text("node_id"),
    type: text("type").notNull(),
    level: text("level"),
    payloadJson: text("payload_json"),
  },
  (table) => [uniqueIndex("run_events_run_seq_idx").on(table.runId, table.seq)],
);

export const runActions = sqliteTable("run_actions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull(),
  nodeId: text("node_id").notNull(),
  field: text("field").notNull(),
  expectedJson: text("expected_json"),
  actualJson: text("actual_json"),
  valueSource: text("value_source"),
  status: text("status").notNull(),
  durationMs: integer("duration_ms").notNull().default(0),
});

export const runNetwork = sqliteTable("run_network", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull(),
  nodeId: text("node_id"),
  method: text("method").notNull(),
  url: text("url").notNull(),
  status: integer("status"),
  reqBodyJson: text("req_body_json"),
  respSnippet: text("resp_snippet"),
  redacted: integer("redacted").notNull().default(0),
});

export const valueLedger = sqliteTable(
  "value_ledger",
  {
    systemId: text("system_id").notNull(),
    scope: text("scope").notNull(),
    value: text("value").notNull(),
    runId: text("run_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.systemId, table.scope, table.value] })],
);

export const sequences = sqliteTable(
  "sequences",
  {
    systemId: text("system_id").notNull(),
    scope: text("scope").notNull(),
    nextValue: integer("next_value").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.systemId, table.scope] })],
);

export const recordSessions = sqliteTable("record_sessions", {
  id: text("id").primaryKey(),
  systemId: text("system_id").notNull(),
  rawPath: text("raw_path"),
  eventsCount: integer("events_count").notNull().default(0),
  draftDslJson: text("draft_dsl_json"),
  ruleVersion: text("rule_version"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
});

export const pendingConfirms = sqliteTable("pending_confirms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull(),
  requestId: text("request_id").notNull(),
  nodeId: text("node_id"),
  kind: text("kind").notNull(),
  optionsJson: text("options_json"),
  status: text("status").notNull(),
  expiresAt: text("expires_at"),
});

export const repairActions = sqliteTable("repair_actions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  flowId: text("flow_id").notNull(),
  nodeId: text("node_id").notNull(),
  kind: text("kind").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  createdAt: text("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
});
