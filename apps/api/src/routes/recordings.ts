import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Hono } from "hono";
import type { FlowDsl, SystemConfig } from "@flowforge/dsl";
import { segmentEvents, synthesizeRecording, type RawEvent } from "@flowforge/recorder";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { sessionRawPath } from "../services/inspector.js";

const startSchema = z.object({
  systemId: z.string().min(1),
  path: z.string().optional(),
  headless: z.boolean().optional(),
});

export function registerRecordingRoutes(app: Hono, deps: AppDeps): void {
  app.get("/api/recordings", (c) => {
    const recordings = deps.store.listRecordings().map((row) => ({
      id: row.id,
      systemId: row.system_id,
      eventsCount: row.events_count,
      status: row.status,
      ruleVersion: row.rule_version,
      createdAt: row.created_at,
    }));
    return c.json({ recordings });
  });

  app.post("/api/recordings", async (c) => {
    const body = startSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      throw new ApiError(400, "RECORDING_INVALID", "请求体不合法", {
        details: body.error.issues,
      });
    }
    const existing = deps.store
      .listRecordings()
      .find((row) => row.status === "recording");
    if (existing) {
      throw new ApiError(409, "RECORDING_ACTIVE", `已有录制进行中: ${String(existing.id)}`);
    }
    const system = deps.store.getSystem(body.data.systemId);
    if (!system) throw new ApiError(404, "SYSTEM_NOT_FOUND", "系统不存在");
    await deps.inspector.open({
      system,
      path: body.data.path,
      headless: body.data.headless,
    });
    const id = newId("rec");
    const rawPath = sessionRawPath(deps.dataDir, id);
    await mkdir(dirname(rawPath), { recursive: true });
    await writeFile(rawPath, "", { mode: 0o600 });
    await deps.inspector.startRecording(rawPath);
    deps.store.createRecording({ id, systemId: system.id, rawPath, status: "recording" });
    return c.json(
      {
        id,
        sessionId: deps.inspector.current()?.id,
        systemId: system.id,
        status: "recording",
      },
      201,
    );
  });

  app.post("/api/recordings/:id/stop", async (c) => {
    const row = deps.store.getRecording(c.req.param("id"));
    if (!row) throw new ApiError(404, "RECORDING_NOT_FOUND", "录制不存在");
    await deps.inspector.stopRecording();
    const loaded = await loadAndSegment(String(row.raw_path));
    deps.store.updateRecording(String(row.id), {
      eventsCount: loaded.events.length,
      draft: { clusters: loaded.clusters, ruleVersion: loaded.ruleVersion },
      ruleVersion: loaded.ruleVersion,
      status: "stopped",
    });
    return c.json({
      id: row.id,
      systemId: row.system_id,
      status: "stopped",
      events: loaded.events,
      clusters: loaded.clusters,
      ruleVersion: loaded.ruleVersion,
    });
  });

  app.post("/api/recordings/:id/refold", async (c) => {
    const row = deps.store.getRecording(c.req.param("id"));
    if (!row) throw new ApiError(404, "RECORDING_NOT_FOUND", "录制不存在");
    const loaded = await loadAndSegment(String(row.raw_path));
    deps.store.updateRecording(String(row.id), {
      eventsCount: loaded.events.length,
      draft: { clusters: loaded.clusters, ruleVersion: loaded.ruleVersion },
      ruleVersion: loaded.ruleVersion,
    });
    return c.json({
      id: row.id,
      clusters: loaded.clusters,
      events: loaded.events,
      ruleVersion: loaded.ruleVersion,
    });
  });

  app.get("/api/recordings/:id", async (c) => {
    const row = deps.store.getRecording(c.req.param("id"));
    if (!row) throw new ApiError(404, "RECORDING_NOT_FOUND", "录制不存在");
    const events = await readRawEvents(String(row.raw_path));
    const draft = row.draft_dsl_json
      ? (JSON.parse(String(row.draft_dsl_json)) as {
          clusters?: unknown[];
          ruleVersion?: string;
          synthesis?: unknown;
        })
      : {};
    return c.json({
      id: row.id,
      systemId: row.system_id,
      status: row.status,
      createdAt: row.created_at,
      eventsCount: row.events_count,
      ruleVersion: row.rule_version,
      events,
      clusters: draft.clusters ?? [],
      draft: draft.synthesis ?? null,
    });
  });

  app.post("/api/recordings/:id/synthesize", async (c) => {
    const row = deps.store.getRecording(c.req.param("id"));
    if (!row) throw new ApiError(404, "RECORDING_NOT_FOUND", "录制不存在");
    const system = deps.store.getSystem(String(row.system_id));
    if (!system) throw new ApiError(404, "SYSTEM_NOT_FOUND", "采集对应的系统不存在");
    const events = await readRawEvents(String(row.raw_path));
    const segment = segmentEvents(events);
    const result = synthesizeRecording({
      clusters: segment.clusters,
      rawEvents: events,
      system: system as SystemConfig,
      flowName: `采集草稿 ${String(row.id).slice(-6)}`,
    });
    deps.store.updateRecording(String(row.id), {
      eventsCount: events.length,
      ruleVersion: segment.ruleVersion,
      draft: {
        clusters: segment.clusters,
        ruleVersion: segment.ruleVersion,
        synthesis: { dsl: result.dsl, report: result.report },
      },
    });
    return c.json({ ...result, clusters: segment.clusters, ruleVersion: segment.ruleVersion });
  });

  app.post("/api/recordings/:id/replay", async (c) => {
    const row = deps.store.getRecording(c.req.param("id"));
    if (!row) throw new ApiError(404, "RECORDING_NOT_FOUND", "录制不存在");
    const system = deps.store.getSystem(String(row.system_id));
    if (!system) throw new ApiError(404, "SYSTEM_NOT_FOUND", "采集对应的系统不存在");
    const body = (await c.req.json().catch(() => ({}))) as {
      dsl?: FlowDsl;
      flowName?: string;
    };
    let dsl = body.dsl;
    let synthesisReport: unknown;
    if (!dsl) {
      const events = await readRawEvents(String(row.raw_path));
      const segment = segmentEvents(events);
      const result = synthesizeRecording({
        clusters: segment.clusters,
        rawEvents: events,
        system: system as SystemConfig,
        flowName: body.flowName,
      });
      dsl = result.dsl;
      synthesisReport = result.report;
    }
    const runtimeDsl = deps.store.hydrateSystems(dsl);
    const runId = newId("run");
    const artifactDir = join(deps.dataDir, "artifacts", runId);
    deps.store.createRun({
      id: runId,
      flowId: `recording:${row.id}`,
      flowVersionId: null,
      mode: "replay",
      artifactDir,
    });
    const settings = deps.store.getSettings();
    deps.queue.enqueue({
      runId,
      flowId: `recording:${row.id}`,
      flowVersionId: null,
      dsl: runtimeDsl,
      mode: "replay",
      settings: {
        artifactDir,
        headless: Boolean(settings.headless ?? true),
        env: process.env,
        nodeTimeoutMs: Number(settings.nodeTimeoutMs ?? 15000),
        pickerTimeoutMs: Number(settings.pickerTimeoutMs ?? 30000),
        screenshot: (settings.screenshot as "onFailure" | "always" | "never") ?? "onFailure",
        trace: Boolean(settings.trace),
        resourcePolicy:
          (settings.resourcePolicy as "balanced" | "fast" | "accurate") ?? "balanced",
      },
    });

    const deadline = Date.now() + 90000;
    let detail: Record<string, unknown> | undefined;
    while (Date.now() < deadline) {
      await sleep(400);
      detail = deps.store.getRunDetail(runId);
      const status = detail?.status;
      if (status && ["finished", "failed", "canceled"].includes(String(status))) break;
    }
    const nodes = (detail?.nodes ?? []) as Array<Record<string, unknown>>;
    const failed = nodes.filter((node) => node.status === "fail");
    return c.json({
      runId,
      draft: runtimeDsl,
      synthesisReport,
      report: {
        ok: detail?.status === "finished",
        status: detail?.status ?? "timeout",
        nodeCount: nodes.length,
        failed: failed.map((node) => ({
          nodeId: node.nodeId,
          code: (node.error as { code?: string } | null)?.code,
          message: (node.error as { message?: string } | null)?.message,
        })),
        mismatches: failed.map((node) => ({
          nodeId: node.nodeId,
          reason: (node.error as { code?: string } | null)?.code ?? "FAILED",
        })),
      },
    });
  });
}

async function readRawEvents(path: string): Promise<RawEvent[]> {
  try {
    const text = await readFile(path, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RawEvent);
  } catch {
    return [];
  }
}

async function loadAndSegment(path: string): Promise<{
  events: RawEvent[];
  clusters: ReturnType<typeof segmentEvents>["clusters"];
  ruleVersion: string;
}> {
  const events = await readRawEvents(path);
  const result = segmentEvents(events);
  return {
    events,
    clusters: result.clusters,
    ruleVersion: result.ruleVersion,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
