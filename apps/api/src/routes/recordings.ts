import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { Hono } from "hono";
import { segmentEvents, type RawEvent } from "@flowforge/recorder";
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
