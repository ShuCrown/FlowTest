import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { z } from "zod";
import type { Hono } from "hono";
import type { FlowDsl } from "@flowforge/dsl";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import type { RunJob } from "../queue.js";

const runSchema = z.object({
  datasetId: z.string().optional(),
  mode: z.enum(["probe", "single"]).optional(),
  versionId: z.string().optional(),
  stopAtNodeId: z.string().optional(),
  headless: z.boolean().optional(),
});

const batchSchema = z.object({
  datasetIds: z.array(z.string()).optional(),
  versionId: z.string().optional(),
  stopAtNodeId: z.string().optional(),
  headless: z.boolean().optional(),
});

const confirmSchema = z.object({
  requestId: z.string().min(1),
  action: z.enum(["continue", "abort"]),
  nth: z.number().int().min(0).optional(),
});

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".zip": "application/zip",
  ".txt": "text/plain; charset=utf-8",
};

export function registerRunRoutes(app: Hono, deps: AppDeps): void {
  app.get("/api/runs", (c) => {
    const runs = deps.store.listRuns({
      flowId: c.req.query("flowId"),
      batchId: c.req.query("batchId"),
      limit: Number(c.req.query("limit") ?? 100),
    });
    return c.json({ runs });
  });

  app.get("/api/runs/:id", (c) => {
    const detail = deps.store.getRunDetail(c.req.param("id"));
    if (!detail) throw new ApiError(404, "RUN_NOT_FOUND", "运行不存在");
    return c.json(detail);
  });

  app.post("/api/flows/:id/runs", async (c) => {
    const flow = deps.store.getFlow(c.req.param("id"));
    if (!flow) throw new ApiError(404, "FLOW_NOT_FOUND", "流程不存在");
    const body = runSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      throw new ApiError(400, "RUN_INVALID_BODY", "请求体不合法", {
        details: body.error.issues,
      });
    }
    const mode = body.data.mode ?? "single";
    const source = resolveRunSource(deps, flow.id, flow.dsl, mode, body.data.versionId);
    const runtimeDsl = deps.store.hydrateSystems(source.dsl);
    const datasetId = body.data.datasetId ?? (mode === "single" ? firstDataset(runtimeDsl) : undefined);
    if (mode === "single" && !datasetId) {
      throw new ApiError(400, "DATASET_REQUIRED", "single 模式需要 datasetId");
    }
    const runId = newId("run");
    const artifactDir = join(deps.dataDir, "artifacts", runId);
    deps.store.createRun({
      id: runId,
      flowId: flow.id,
      flowVersionId: source.versionId,
      datasetId,
      mode,
      artifactDir,
    });

    deps.queue.enqueue(
      buildJob(deps, {
        runId,
        flowId: flow.id,
        flowVersionId: source.versionId,
        dsl: runtimeDsl,
        mode,
        datasetId,
        artifactDir,
        body: body.data,
      }),
    );
    return c.json(deps.store.getRun(runId), 202);
  });

  app.post("/api/flows/:id/batches", async (c) => {
    const flow = deps.store.getFlow(c.req.param("id"));
    if (!flow) throw new ApiError(404, "FLOW_NOT_FOUND", "流程不存在");
    const body = batchSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      throw new ApiError(400, "RUN_INVALID_BODY", "请求体不合法", {
        details: body.error.issues,
      });
    }
    const source = resolveRunSource(deps, flow.id, flow.dsl, "matrix", body.data.versionId);
    const runtimeDsl = deps.store.hydrateSystems(source.dsl);
    const datasetIds =
      body.data.datasetIds ?? (runtimeDsl.datasets ?? []).map((dataset) => dataset.id);
    if (datasetIds.length === 0) {
      throw new ApiError(400, "DATASET_REQUIRED", "矩阵运行需要至少一个数据集");
    }
    const batch = deps.store.createBatch({
      flowId: flow.id,
      flowVersionId: source.versionId,
      mode: "matrix",
      datasetIds,
    });
    const jobs: RunJob[] = [];
    for (const datasetId of datasetIds) {
      const runId = newId("run");
      const artifactDir = join(deps.dataDir, "artifacts", runId);
      deps.store.createRun({
        id: runId,
        flowId: flow.id,
        flowVersionId: source.versionId,
        datasetId,
        mode: "matrix",
        batchId: batch.id,
        artifactDir,
      });
      jobs.push(
        buildJob(deps, {
          runId,
          flowId: flow.id,
          flowVersionId: source.versionId,
          dsl: runtimeDsl,
          mode: "matrix",
          datasetId,
          batchId: batch.id,
          artifactDir,
          body: body.data,
        }),
      );
    }
    deps.queue.enqueueBatch(jobs);
    return c.json(
      { batch: { ...batch, datasetIds }, runs: deps.store.listRuns({ batchId: batch.id }) },
      202,
    );
  });

  app.get("/api/batches/:id", (c) => {
    const batchId = c.req.param("id");
    const row = deps.store.sqlite
      .prepare("SELECT * FROM run_batches WHERE id=?")
      .get(batchId) as Record<string, unknown> | undefined;
    if (!row) throw new ApiError(404, "BATCH_NOT_FOUND", "批次不存在");
    return c.json({
      id: row.id,
      flowId: row.flow_id,
      mode: row.mode,
      status: row.status,
      datasetIds: JSON.parse(String(row.dataset_ids_json)),
      summary: row.summary_json ? JSON.parse(String(row.summary_json)) : null,
      runs: deps.store.listRuns({ batchId }),
    });
  });

  app.post("/api/runs/:id/cancel", (c) => {
    const runId = c.req.param("id");
    const run = deps.store.getRun(runId);
    if (!run) throw new ApiError(404, "RUN_NOT_FOUND", "运行不存在");
    const canceled = deps.queue.cancel(runId);
    if (!canceled) {
      if (["finished", "failed", "canceled"].includes(run.status)) {
        return c.json({ ok: true, alreadyTerminal: true });
      }
      throw new ApiError(409, "RUN_NOT_CANCELABLE", `运行状态不可取消: ${run.status}`);
    }
    return c.json({ ok: true });
  });

  app.post("/api/runs/:id/confirm", async (c) => {
    const body = confirmSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      throw new ApiError(400, "CONFIRM_INVALID", "确认请求不合法", {
        details: body.error.issues,
      });
    }
    const ok = deps.queue.confirm(c.req.param("id"), body.data.requestId, {
      action: body.data.action,
      nth: body.data.nth,
    });
    if (!ok) {
      throw new ApiError(409, "CONFIRM_NOT_PENDING", "确认项不存在、已处理或运行已结束");
    }
    return c.json({ ok: true });
  });

  app.post("/api/runs/:id/resume", (c) =>
    c.json(
      { error: { code: "NOT_IMPLEMENTED", message: "失败现场继续在 M5 提供" } },
      501,
    ),
  );

  app.get("/api/runs/:id/artifacts/*", async (c) => {
    const run = deps.store.getRun(c.req.param("id"));
    if (!run?.artifactDir) throw new ApiError(404, "RUN_NOT_FOUND", "运行不存在");
    const marker = "/artifacts/";
    const path = c.req.path;
    const relative = decodeURIComponent(path.slice(path.indexOf(marker) + marker.length));
    const artifactDir = resolve(run.artifactDir);
    const filePath = resolve(artifactDir, relative);
    if (!filePath.startsWith(`${artifactDir}/`) && filePath !== artifactDir) {
      throw new ApiError(400, "ARTIFACT_PATH_INVALID", "非法产物路径");
    }
    try {
      const buffer = await readFile(filePath);
      c.header("content-type", CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream");
      return c.body(buffer);
    } catch {
      throw new ApiError(404, "ARTIFACT_NOT_FOUND", "产物不存在");
    }
  });
}

function resolveRunSource(
  deps: AppDeps,
  flowId: string,
  draft: FlowDsl,
  mode: "probe" | "single" | "matrix",
  versionId?: string,
): { dsl: FlowDsl; versionId: string | null } {
  if (versionId) {
    const version = deps.store.getVersion(flowId, versionId);
    if (!version) throw new ApiError(404, "FLOW_VERSION_NOT_FOUND", "版本不存在");
    return { dsl: version.dsl, versionId: version.id };
  }
  if (mode === "probe") {
    const latest = deps.store.getLatestPublishedVersion(flowId);
    return { dsl: draft, versionId: latest?.id ?? null };
  }
  const latest = deps.store.getLatestPublishedVersion(flowId);
  if (!latest) {
    throw new ApiError(409, "FLOW_NOT_PUBLISHED", "运行前必须先发布流程版本");
  }
  return { dsl: latest.dsl, versionId: latest.id };
}

function firstDataset(dsl: FlowDsl): string | undefined {
  return dsl.datasets?.[0]?.id;
}

function buildJob(
  deps: AppDeps,
  input: {
    runId: string;
    flowId: string;
    flowVersionId: string | null;
    dsl: FlowDsl;
    mode: "probe" | "single" | "matrix";
    datasetId?: string;
    batchId?: string;
    artifactDir: string;
    body: { headless?: boolean; stopAtNodeId?: string };
  },
): RunJob {
  const settings = deps.store.getSettings();
  return {
    runId: input.runId,
    flowId: input.flowId,
    flowVersionId: input.flowVersionId,
    dsl: input.dsl,
    mode: input.mode,
    datasetId: input.datasetId,
    batchId: input.batchId,
    settings: {
      artifactDir: input.artifactDir,
      headless: input.body.headless ?? Boolean(settings.headless),
      env: process.env,
      nodeTimeoutMs: Number(settings.nodeTimeoutMs ?? 15000),
      pickerTimeoutMs: Number(settings.pickerTimeoutMs ?? 30000),
      screenshot: (settings.screenshot as "onFailure" | "always" | "never") ?? "onFailure",
      trace: Boolean(settings.trace),
      resourcePolicy:
        (settings.resourcePolicy as "balanced" | "fast" | "accurate") ?? "balanced",
      stopAtNodeId: input.body.stopAtNodeId,
    },
  };
}
