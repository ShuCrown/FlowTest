import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import {
  computeReadiness,
  lintFlow,
  normalizeDsl,
  type FlowDsl,
  type Readiness,
  type SystemConfig,
} from "@flowforge/dsl";
import { ERROR_CODES, type RunResult } from "@flowforge/engine";
import type { FlowForgeDatabase } from "../db/client.js";
import { ApiError } from "../lib/errors.js";
import { checksum, newId } from "../lib/ids.js";

export interface FlowSummary {
  id: string;
  name: string;
  tags: string[];
  readiness: number;
  revision: number;
  publishedVersion: number | null;
  updatedAt: string;
}

export interface FlowDetail extends FlowSummary {
  dsl: FlowDsl;
  layout: unknown;
  createdAt: string;
}

export interface FlowVersionRow {
  id: string;
  flowId: string;
  version: number;
  dsl: FlowDsl;
  checksum: string;
  createdAt: string;
}

export interface RunRow {
  id: string;
  batchId: string | null;
  flowId: string;
  flowVersionId: string | null;
  datasetId: string | null;
  mode: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  artifactDir: string | null;
  seed: number | null;
  error: unknown;
  metrics: unknown;
  createdAt: string;
}

const DEFAULT_SETTINGS = {
  nodeTimeoutMs: 15000,
  pickerTimeoutMs: 30000,
  screenshot: "onFailure",
  trace: false,
  resourcePolicy: "balanced",
  headless: true,
  retentionDays: 30,
  aiEnabled: false,
};

export class Store {
  readonly sqlite: Database.Database;
  readonly dataDir: string;

  constructor(readonly database: FlowForgeDatabase) {
    this.sqlite = database.sqlite;
    this.dataDir = database.dataDir;
  }

  listSystems(): Array<SystemConfig & { createdAt: string }> {
    const rows = this.sqlite.prepare("SELECT * FROM systems ORDER BY created_at DESC").all() as Array<
      Record<string, unknown>
    >;
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      baseUrl: String(row.base_url),
      auth: row.auth_json ? JSON.parse(String(row.auth_json)) : { kind: "none" },
      allowedOrigins: row.allowed_origins ? JSON.parse(String(row.allowed_origins)) : [],
      createdAt: String(row.created_at),
    }));
  }

  getSystem(id: string): (SystemConfig & { createdAt: string }) | undefined {
    return this.listSystems().find((system) => system.id === id);
  }

  createSystem(input: {
    id?: string;
    name: string;
    baseUrl: string;
    auth?: SystemConfig["auth"];
    allowedOrigins?: string[];
  }): SystemConfig {
    let url: URL;
    try {
      url = new URL(input.baseUrl);
    } catch {
      throw new ApiError(400, "SYSTEM_INVALID_URL", "baseUrl 不是合法 URL", {
        pointer: "/baseUrl",
      });
    }
    const id = input.id ?? newId("sys");
    const createdAt = new Date().toISOString();
    this.sqlite
      .prepare(
        `INSERT INTO systems(id, name, base_url, auth_json, allowed_origins, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        url.toString().replace(/\/$/, ""),
        JSON.stringify(input.auth ?? { kind: "none" }),
        JSON.stringify(input.allowedOrigins ?? []),
        createdAt,
      );
    return this.getSystem(id)!;
  }

  updateSystem(id: string, patch: Partial<SystemConfig>): SystemConfig {
    const existing = this.getSystem(id);
    if (!existing) throw new ApiError(404, "SYSTEM_NOT_FOUND", `系统不存在: ${id}`);
    const next = { ...existing, ...patch, id };
    if (patch.baseUrl) {
      try {
        new URL(patch.baseUrl);
      } catch {
        throw new ApiError(400, "SYSTEM_INVALID_URL", "baseUrl 不是合法 URL");
      }
    }
    this.sqlite
      .prepare(
        `UPDATE systems SET name=?, base_url=?, auth_json=?, allowed_origins=? WHERE id=?`,
      )
      .run(
        next.name,
        next.baseUrl,
        JSON.stringify(next.auth ?? { kind: "none" }),
        JSON.stringify(next.allowedOrigins ?? []),
        id,
      );
    return this.getSystem(id)!;
  }

  deleteSystem(id: string): void {
    this.sqlite.prepare("DELETE FROM systems WHERE id=?").run(id);
  }

  listFlows(): FlowSummary[] {
    const rows = this.sqlite
      .prepare("SELECT * FROM flows ORDER BY updated_at DESC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapFlowSummary(row));
  }

  getFlow(id: string): FlowDetail | undefined {
    const row = this.sqlite.prepare("SELECT * FROM flows WHERE id=?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    const summary = this.mapFlowSummary(row);
    return {
      ...summary,
      dsl: JSON.parse(String(row.dsl_json)) as FlowDsl,
      layout: row.layout_json ? JSON.parse(String(row.layout_json)) : null,
      createdAt: String(row.created_at),
    };
  }

  createFlow(input: { name?: string; dsl: unknown; layout?: unknown }): FlowDetail {
    const validation = validateDsl(input.dsl);
    if (!validation.dsl) {
      throw new ApiError(400, "DSL_INVALID", "流程 DSL 校验失败", {
        details: validation.errors,
      });
    }
    const id = newId("flow");
    const now = new Date().toISOString();
    const name = input.name ?? validation.dsl.meta.name;
    this.sqlite
      .prepare(
        `INSERT INTO flows(id, name, dsl_json, layout_json, readiness, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        id,
        name,
        JSON.stringify(validation.dsl),
        input.layout ? JSON.stringify(input.layout) : null,
        validation.readiness.level,
        now,
        now,
      );
    return this.getFlow(id)!;
  }

  updateFlow(
    id: string,
    input: { name?: string; dsl?: unknown; layout?: unknown; revision?: number },
  ): FlowDetail {
    const existing = this.getFlow(id);
    if (!existing) throw new ApiError(404, "FLOW_NOT_FOUND", `流程不存在: ${id}`);
    if (input.revision !== undefined && input.revision !== existing.revision) {
      throw new ApiError(409, "FLOW_REVISION_CONFLICT", "流程已被修改，请重新加载", {
        details: { expected: input.revision, actual: existing.revision },
      });
    }
    let dsl = existing.dsl;
    let readiness = existing.readiness;
    if (input.dsl !== undefined) {
      const validation = validateDsl(input.dsl);
      if (!validation.dsl) {
        throw new ApiError(400, "DSL_INVALID", "流程 DSL 校验失败", {
          details: validation.errors,
        });
      }
      dsl = validation.dsl;
      readiness = validation.readiness.level;
    }
    const nextName = input.name ?? dsl.meta.name;
    const now = new Date().toISOString();
    this.sqlite
      .prepare(
        `UPDATE flows SET name=?, dsl_json=?, layout_json=?, readiness=?, revision=revision+1, updated_at=? WHERE id=?`,
      )
      .run(
        nextName,
        JSON.stringify(dsl),
        input.layout !== undefined ? JSON.stringify(input.layout) : JSON.stringify(existing.layout),
        readiness,
        now,
        id,
      );
    return this.getFlow(id)!;
  }

  deleteFlow(id: string): void {
    this.sqlite.transaction(() => {
      this.sqlite.prepare("DELETE FROM flow_versions WHERE flow_id=?").run(id);
      this.sqlite.prepare("DELETE FROM flows WHERE id=?").run(id);
    })();
  }

  publishFlow(id: string): FlowVersionRow {
    const flow = this.getFlow(id);
    if (!flow) throw new ApiError(404, "FLOW_NOT_FOUND", `流程不存在: ${id}`);
    if (flow.readiness < 4) {
      throw new ApiError(409, "FLOW_NOT_READY", `发布要求 L4，当前 L${flow.readiness}`, {
        details: computeReadiness(flow.dsl),
      });
    }
    const latest = this.sqlite
      .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM flow_versions WHERE flow_id=?")
      .get(id) as { v: number };
    const version = latest.v + 1;
    const versionId = newId("fv");
    const now = new Date().toISOString();
    const hash = checksum(flow.dsl);
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          `INSERT INTO flow_versions(id, flow_id, version, dsl_json, checksum, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(versionId, id, version, JSON.stringify(flow.dsl), hash, now);
      this.sqlite.prepare("UPDATE flows SET published_version=? WHERE id=?").run(version, id);
    })();
    return this.getVersion(id, versionId)!;
  }

  listVersions(flowId: string): FlowVersionRow[] {
    const rows = this.sqlite
      .prepare("SELECT * FROM flow_versions WHERE flow_id=? ORDER BY version DESC")
      .all(flowId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapVersion(row));
  }

  getVersion(flowId: string, versionId: string): FlowVersionRow | undefined {
    const row = this.sqlite
      .prepare("SELECT * FROM flow_versions WHERE flow_id=? AND id=?")
      .get(flowId, versionId) as Record<string, unknown> | undefined;
    return row ? this.mapVersion(row) : undefined;
  }

  getLatestPublishedVersion(flowId: string): FlowVersionRow | undefined {
    const row = this.sqlite
      .prepare("SELECT * FROM flow_versions WHERE flow_id=? ORDER BY version DESC LIMIT 1")
      .get(flowId) as Record<string, unknown> | undefined;
    return row ? this.mapVersion(row) : undefined;
  }

  createBatch(input: {
    flowId: string;
    flowVersionId: string | null;
    mode: string;
    datasetIds: string[];
  }): { id: string; flowId: string; status: string } {
    const id = newId("batch");
    this.sqlite
      .prepare(
        `INSERT INTO run_batches(id, flow_id, flow_version_id, mode, dataset_ids_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
      )
      .run(
        id,
        input.flowId,
        input.flowVersionId,
        input.mode,
        JSON.stringify(input.datasetIds),
        new Date().toISOString(),
      );
    return { id, flowId: input.flowId, status: "queued" };
  }

  updateBatch(id: string, status: string, summary?: unknown): void {
    this.sqlite
      .prepare("UPDATE run_batches SET status=?, summary_json=? WHERE id=?")
      .run(status, summary ? JSON.stringify(summary) : null, id);
  }

  createRun(input: {
    id?: string;
    flowId: string;
    flowVersionId: string | null;
    datasetId?: string;
    mode: string;
    batchId?: string;
    artifactDir: string;
  }): RunRow {
    const id = input.id ?? newId("run");
    const now = new Date().toISOString();
    this.sqlite
      .prepare(
        `INSERT INTO runs(id, batch_id, flow_id, flow_version_id, dataset_id, mode, status, artifact_dir, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
      )
      .run(
        id,
        input.batchId ?? null,
        input.flowId,
        input.flowVersionId,
        input.datasetId ?? null,
        input.mode,
        input.artifactDir,
        now,
      );
    return this.getRun(id)!;
  }

  getRun(id: string): RunRow | undefined {
    const row = this.sqlite.prepare("SELECT * FROM runs WHERE id=?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapRun(row) : undefined;
  }

  listRuns(filter: { flowId?: string; batchId?: string; limit?: number } = {}): RunRow[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.flowId) {
      clauses.push("flow_id=?");
      params.push(filter.flowId);
    }
    if (filter.batchId) {
      clauses.push("batch_id=?");
      params.push(filter.batchId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(filter.limit ?? 100, 500);
    const rows = this.sqlite
      .prepare(`SELECT * FROM runs ${where} ORDER BY created_at DESC LIMIT ${limit}`)
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapRun(row));
  }

  updateRunStatus(
    id: string,
    status: string,
    patch: {
      startedAt?: string;
      finishedAt?: string;
      resolvedData?: unknown;
      seed?: number;
      error?: unknown;
      metrics?: unknown;
      compiledPlanPath?: string;
    } = {},
  ): void {
    const current = this.getRun(id);
    if (!current) return;
    this.sqlite
      .prepare(
        `UPDATE runs SET status=?, started_at=COALESCE(?, started_at), finished_at=COALESCE(?, finished_at),
         resolved_data_json=COALESCE(?, resolved_data_json), seed=COALESCE(?, seed),
         error_json=COALESCE(?, error_json), metrics_json=COALESCE(?, metrics_json),
         compiled_plan_path=COALESCE(?, compiled_plan_path) WHERE id=?`,
      )
      .run(
        status,
        patch.startedAt ?? null,
        patch.finishedAt ?? null,
        patch.resolvedData === undefined ? null : JSON.stringify(patch.resolvedData),
        patch.seed ?? null,
        patch.error === undefined ? null : JSON.stringify(patch.error),
        patch.metrics === undefined ? null : JSON.stringify(patch.metrics),
        patch.compiledPlanPath ?? null,
        id,
      );
  }

  saveRunResult(result: RunResult): void {
    const redacted = redactResolved(result.resolvedData);
    this.sqlite.transaction(() => {
      this.sqlite.prepare("DELETE FROM run_nodes WHERE run_id=?").run(result.runId);
      this.sqlite.prepare("DELETE FROM run_actions WHERE run_id=?").run(result.runId);
      this.sqlite.prepare("DELETE FROM run_network WHERE run_id=?").run(result.runId);
      const insertNode = this.sqlite.prepare(
        `INSERT INTO run_nodes(run_id, node_id, node_type, idx, status, duration_ms,
          resolved_target_json, stage_timings_json, error_json, screenshot_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const node of result.nodes) {
        insertNode.run(
          result.runId,
          node.nodeId,
          node.nodeType,
          node.index,
          node.status,
          Math.round(node.durationMs),
          node.resolvedTarget ? JSON.stringify(node.resolvedTarget) : null,
          JSON.stringify(node.stageTimings),
          node.error ? JSON.stringify(node.error) : null,
          node.screenshotPath ?? null,
        );
      }
      const insertAction = this.sqlite.prepare(
        `INSERT INTO run_actions(run_id, node_id, field, expected_json, actual_json, value_source, status, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const action of result.actions) {
        insertAction.run(
          result.runId,
          action.nodeId,
          action.field,
          action.expected === undefined ? null : JSON.stringify(action.expected),
          action.actual === undefined ? null : JSON.stringify(action.actual),
          action.valueSource ?? null,
          action.status,
          Math.round(action.durationMs),
        );
      }
      const insertNetwork = this.sqlite.prepare(
        `INSERT INTO run_network(run_id, node_id, method, url, status, req_body_json, resp_snippet, redacted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const record of result.network) {
        insertNetwork.run(
          result.runId,
          record.nodeId ?? null,
          record.method,
          record.url,
          record.status ?? null,
          record.reqBody === undefined ? null : JSON.stringify(record.reqBody),
          record.respSnippet ?? null,
          record.redacted ? 1 : 0,
        );
      }
      this.sqlite
        .prepare(
          `UPDATE runs SET status=?, finished_at=?, resolved_data_json=?, seed=?, error_json=?,
           metrics_json=?, compiled_plan_path=? WHERE id=?`,
        )
        .run(
          result.status,
          result.finishedAt,
          JSON.stringify(redacted),
          result.seed,
          result.error ? JSON.stringify(result.error) : null,
          JSON.stringify(result.metrics),
          `${result.artifactDir}/compiled-plan.json`,
          result.runId,
        );
    })();
  }

  insertRunEvent(runId: string, event: {
    type: string;
    nodeId?: string;
    level?: string;
    payload?: unknown;
    ts: string;
  }): number {
    const row = this.sqlite
      .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM run_events WHERE run_id=?")
      .get(runId) as { next: number };
    const seq = row.next;
    this.sqlite
      .prepare(
        `INSERT INTO run_events(run_id, seq, ts, node_id, type, level, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        seq,
        event.ts,
        event.nodeId ?? null,
        event.type,
        event.level ?? null,
        event.payload ? JSON.stringify(event.payload) : null,
      );
    return seq;
  }

  listRunEvents(runId: string, afterSeq = 0): Array<Record<string, unknown>> {
    return this.sqlite
      .prepare("SELECT * FROM run_events WHERE run_id=? AND seq>? ORDER BY seq ASC")
      .all(runId, afterSeq) as Array<Record<string, unknown>>;
  }

  insertPendingConfirm(input: {
    runId: string;
    requestId: string;
    nodeId?: string;
    kind: string;
    options: unknown;
    expiresAt: string;
  }): number {
    const result = this.sqlite
      .prepare(
        `INSERT INTO pending_confirms(run_id, request_id, node_id, kind, options_json, status, expires_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        input.runId,
        input.requestId,
        input.nodeId ?? null,
        input.kind,
        JSON.stringify(input.options),
        input.expiresAt,
      );
    return Number(result.lastInsertRowid);
  }

  getPendingConfirm(
    runId: string,
    requestId: string,
  ): Record<string, unknown> | undefined {
    return this.sqlite
      .prepare("SELECT * FROM pending_confirms WHERE run_id=? AND request_id=?")
      .get(runId, requestId) as Record<string, unknown> | undefined;
  }

  resolvePendingConfirm(
    runId: string,
    requestId: string,
    status: "confirmed" | "aborted" | "expired",
  ): void {
    this.sqlite
      .prepare("UPDATE pending_confirms SET status=? WHERE run_id=? AND request_id=?")
      .run(status, runId, requestId);
  }

  createRecording(input: {
    id: string;
    systemId: string;
    rawPath: string;
    status: string;
  }): void {
    this.sqlite
      .prepare(
        `INSERT INTO record_sessions(id, system_id, raw_path, events_count, rule_version, status, created_at)
         VALUES (?, ?, ?, 0, NULL, ?, ?)`,
      )
      .run(input.id, input.systemId, input.rawPath, input.status, new Date().toISOString());
  }

  updateRecording(
    id: string,
    patch: {
      eventsCount?: number;
      draft?: unknown;
      ruleVersion?: string;
      status?: string;
    },
  ): void {
    const current = this.getRecording(id);
    if (!current) return;
    this.sqlite
      .prepare(
        `UPDATE record_sessions SET events_count=?, draft_dsl_json=?, rule_version=?, status=?
         WHERE id=?`,
      )
      .run(
        patch.eventsCount ?? Number(current.events_count ?? 0),
        patch.draft === undefined
          ? current.draft_dsl_json === null
            ? null
            : JSON.stringify(current.draft_dsl_json)
          : JSON.stringify(patch.draft),
        patch.ruleVersion ?? (current.rule_version as string | null),
        patch.status ?? String(current.status),
        id,
      );
  }

  getRecording(id: string): Record<string, unknown> | undefined {
    return this.sqlite.prepare("SELECT * FROM record_sessions WHERE id=?").get(id) as
      | Record<string, unknown>
      | undefined;
  }

  listRecordings(): Array<Record<string, unknown>> {
    return this.sqlite
      .prepare("SELECT * FROM record_sessions ORDER BY created_at DESC")
      .all() as Array<Record<string, unknown>>;
  }

  getRunDetail(id: string): Record<string, unknown> | undefined {
    const run = this.getRun(id);
    if (!run) return undefined;
    const row = this.sqlite.prepare("SELECT * FROM runs WHERE id=?").get(id) as Record<
      string,
      unknown
    >;
    const nodes = this.sqlite
      .prepare("SELECT * FROM run_nodes WHERE run_id=? ORDER BY idx")
      .all(id) as Array<Record<string, unknown>>;
    const events = this.listRunEvents(id);
    const actions = this.sqlite
      .prepare("SELECT * FROM run_actions WHERE run_id=?")
      .all(id) as Array<Record<string, unknown>>;
    const network = this.sqlite
      .prepare("SELECT * FROM run_network WHERE run_id=?")
      .all(id) as Array<Record<string, unknown>>;
    return {
      ...run,
      resolvedData: row.resolved_data_json ? JSON.parse(String(row.resolved_data_json)) : null,
      compiledPlanPath: row.compiled_plan_path,
      nodes: nodes.map(mapRunNode),
      events: events.map(mapRunEvent),
      actions: actions.map(mapRunAction),
      network: network.map(mapRunNetwork),
      pendingConfirms: this.listPendingConfirms(id),
    };
  }

  listPendingConfirms(runId: string): Array<Record<string, unknown>> {
    const rows = this.sqlite
      .prepare("SELECT * FROM pending_confirms WHERE run_id=? AND status='pending' ORDER BY id")
      .all(runId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      requestId: row.request_id,
      nodeId: row.node_id,
      kind: row.kind,
      options: row.options_json ? JSON.parse(String(row.options_json)) : null,
      expiresAt: row.expires_at,
    }));
  }

  getSettings(): Record<string, unknown> {
    const row = this.sqlite.prepare("SELECT value_json FROM settings WHERE key='defaults'").get() as
      | { value_json: string }
      | undefined;
    return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.value_json) : {}) };
  }

  /** 运行时把系统表中最新的 baseUrl / 鉴权 / 跨域白名单合并进 DSL。 */
  hydrateSystems(dsl: FlowDsl): FlowDsl {
    return {
      ...dsl,
      systems: dsl.systems.map((system) => {
        const registered = this.getSystem(system.id);
        if (!registered) return system;
        return {
          ...system,
          name: registered.name,
          baseUrl: registered.baseUrl,
          auth: registered.auth ?? system.auth,
          allowedOrigins:
            registered.allowedOrigins && registered.allowedOrigins.length > 0
              ? registered.allowedOrigins
              : system.allowedOrigins,
        };
      }),
    };
  }

  patchSettings(patch: Record<string, unknown>): Record<string, unknown> {
    const next = { ...this.getSettings(), ...patch };
    this.sqlite
      .prepare(
        `INSERT INTO settings(key, value_json) VALUES ('defaults', ?)
         ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`,
      )
      .run(JSON.stringify(next));
    return next;
  }

  private mapFlowSummary(row: Record<string, unknown>): FlowSummary {
    const dsl = JSON.parse(String(row.dsl_json)) as FlowDsl;
    return {
      id: String(row.id),
      name: String(row.name),
      tags: dsl.meta.tags ?? [],
      readiness: Number(row.readiness),
      revision: Number(row.revision),
      publishedVersion: row.published_version === null ? null : Number(row.published_version),
      updatedAt: String(row.updated_at),
    };
  }

  private mapVersion(row: Record<string, unknown>): FlowVersionRow {
    return {
      id: String(row.id),
      flowId: String(row.flow_id),
      version: Number(row.version),
      dsl: JSON.parse(String(row.dsl_json)) as FlowDsl,
      checksum: String(row.checksum),
      createdAt: String(row.created_at),
    };
  }

  private mapRun(row: Record<string, unknown>): RunRow {
    return {
      id: String(row.id),
      batchId: row.batch_id ? String(row.batch_id) : null,
      flowId: String(row.flow_id),
      flowVersionId: row.flow_version_id ? String(row.flow_version_id) : null,
      datasetId: row.dataset_id ? String(row.dataset_id) : null,
      mode: String(row.mode),
      status: String(row.status),
      startedAt: row.started_at ? String(row.started_at) : null,
      finishedAt: row.finished_at ? String(row.finished_at) : null,
      artifactDir: row.artifact_dir ? String(row.artifact_dir) : null,
      seed: row.seed === null ? null : Number(row.seed),
      error: row.error_json ? JSON.parse(String(row.error_json)) : null,
      metrics: row.metrics_json ? JSON.parse(String(row.metrics_json)) : null,
      createdAt: String(row.created_at),
    };
  }
}

export function validateDsl(input: unknown): {
  dsl?: FlowDsl;
  readiness: Readiness;
  lint: ReturnType<typeof lintFlow>;
  errors: unknown[];
} {
  try {
    const dsl = normalizeDsl(input);
    const lint = lintFlow(dsl);
    const readiness = computeReadiness(dsl);
    return { dsl, readiness, lint, errors: lint.errors };
  } catch (error) {
    return {
      readiness: { level: 0, gaps: [] },
      lint: { errors: [], warnings: [], infos: [] },
      errors: [
        {
          code: "DSL_INVALID",
          message: error instanceof Error ? error.message : String(error),
          path: (error as { pointer?: string }).pointer,
        },
      ],
    };
  }
}

export function redactResolved(resolved: RunResult["resolvedData"]): unknown {
  const secret = new Set(resolved.secretFields ?? []);
  const redact = (obj: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, secret.has(key) ? "***" : value]),
    );
  return {
    ...resolved,
    values: redact(resolved.values),
    vars: redact(resolved.vars),
  };
}

export function dslChecksum(dsl: FlowDsl): string {
  return createHash("sha256").update(JSON.stringify(dsl)).digest("hex");
}

export { DEFAULT_SETTINGS };
export { ERROR_CODES };

function mapRunNode(row: Record<string, unknown>): Record<string, unknown> {
  return {
    nodeId: row.node_id,
    nodeType: row.node_type,
    index: row.idx,
    status: row.status,
    durationMs: row.duration_ms,
    resolvedTarget: row.resolved_target_json ? JSON.parse(String(row.resolved_target_json)) : null,
    stageTimings: row.stage_timings_json ? JSON.parse(String(row.stage_timings_json)) : [],
    error: row.error_json ? JSON.parse(String(row.error_json)) : null,
    screenshotPath: row.screenshot_path ?? null,
  };
}

function mapRunEvent(row: Record<string, unknown>): Record<string, unknown> {
  return {
    seq: row.seq,
    ts: row.ts,
    nodeId: row.node_id ?? null,
    type: row.type,
    level: row.level ?? null,
    payload: row.payload_json ? JSON.parse(String(row.payload_json)) : null,
  };
}

function mapRunAction(row: Record<string, unknown>): Record<string, unknown> {
  return {
    nodeId: row.node_id,
    field: row.field,
    expected: row.expected_json ? JSON.parse(String(row.expected_json)) : null,
    actual: row.actual_json ? JSON.parse(String(row.actual_json)) : null,
    valueSource: row.value_source ?? null,
    status: row.status,
    durationMs: row.duration_ms,
  };
}

function mapRunNetwork(row: Record<string, unknown>): Record<string, unknown> {
  return {
    nodeId: row.node_id ?? null,
    method: row.method,
    url: row.url,
    status: row.status ?? null,
    reqBody: row.req_body_json ? JSON.parse(String(row.req_body_json)) : null,
    respSnippet: row.resp_snippet ?? null,
    redacted: Boolean(row.redacted),
  };
}
