import { z } from "zod";
import type { Hono } from "hono";
import { diffDsl } from "@flowforge/dsl";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../lib/errors.js";
import { validateDsl } from "../services/store.js";

const createSchema = z.object({
  name: z.string().min(1).optional(),
  dsl: z.unknown(),
  layout: z.unknown().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  dsl: z.unknown().optional(),
  layout: z.unknown().optional(),
  revision: z.number().int().optional(),
});

const importSchema = z.object({
  dsl: z.unknown(),
  flowId: z.string().optional(),
  save: z.boolean().optional(),
});

export function registerFlowRoutes(app: Hono, deps: AppDeps): void {
  app.get("/api/flows", (c) => c.json({ flows: deps.store.listFlows() }));

  app.post("/api/flows", async (c) => {
    const body = createSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      throw new ApiError(400, "FLOW_INVALID_BODY", "请求体不合法", {
        details: body.error.issues,
      });
    }
    const flow = deps.store.createFlow(body.data);
    return c.json(flow, 201);
  });

  app.post("/api/flows/validate", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { dsl?: unknown };
    if (!body.dsl) throw new ApiError(400, "FLOW_INVALID_BODY", "缺少 dsl");
    return c.json(validationResponse(body.dsl));
  });

  app.post("/api/flows/import", async (c) => {
    const body = importSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      throw new ApiError(400, "FLOW_INVALID_BODY", "请求体不合法", {
        details: body.error.issues,
      });
    }
    const validation = validateDsl(body.data.dsl);
    if (!validation.dsl) {
      return c.json(
        {
          error: {
            code: "DSL_INVALID",
            message: "导入的 DSL 无法解析",
            details: validation.errors,
          },
        },
        400,
      );
    }
    let diff: unknown = undefined;
    if (body.data.flowId) {
      const existing = deps.store.getFlow(body.data.flowId);
      if (!existing) throw new ApiError(404, "FLOW_NOT_FOUND", "流程不存在");
      diff = diffDsl(existing.dsl, validation.dsl);
    }
    const payload = {
      ...validationResponse(body.data.dsl),
      diff,
    };
    if (!body.data.save) return c.json(payload);

    const flow = body.data.flowId
      ? deps.store.updateFlow(body.data.flowId, { dsl: validation.dsl })
      : deps.store.createFlow({ dsl: validation.dsl });
    return c.json({ ...payload, flow }, body.data.flowId ? 200 : 201);
  });

  app.get("/api/flows/:id", (c) => {
    const flow = deps.store.getFlow(c.req.param("id"));
    if (!flow) throw new ApiError(404, "FLOW_NOT_FOUND", "流程不存在");
    return c.json(flow);
  });

  app.patch("/api/flows/:id", async (c) => {
    const body = updateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      throw new ApiError(400, "FLOW_INVALID_BODY", "请求体不合法", {
        details: body.error.issues,
      });
    }
    return c.json(deps.store.updateFlow(c.req.param("id"), body.data));
  });

  app.delete("/api/flows/:id", (c) => {
    deps.store.deleteFlow(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/api/flows/:id/validate", async (c) => {
    const flow = deps.store.getFlow(c.req.param("id"));
    if (!flow) throw new ApiError(404, "FLOW_NOT_FOUND", "流程不存在");
    const body = (await c.req.json().catch(() => ({}))) as { dsl?: unknown };
    return c.json(validationResponse(body.dsl ?? flow.dsl));
  });

  app.post("/api/flows/:id/publish", (c) => {
    const version = deps.store.publishFlow(c.req.param("id"));
    return c.json(version, 201);
  });

  app.get("/api/flows/:id/versions", (c) => {
    const flow = deps.store.getFlow(c.req.param("id"));
    if (!flow) throw new ApiError(404, "FLOW_NOT_FOUND", "流程不存在");
    return c.json({ versions: deps.store.listVersions(flow.id) });
  });

  app.get("/api/flows/:id/versions/:versionId", (c) => {
    const version = deps.store.getVersion(
      c.req.param("id"),
      c.req.param("versionId"),
    );
    if (!version) throw new ApiError(404, "FLOW_VERSION_NOT_FOUND", "版本不存在");
    return c.json(version);
  });

  app.get("/api/flows/:id/export", (c) => {
    const flow = deps.store.getFlow(c.req.param("id"));
    if (!flow) throw new ApiError(404, "FLOW_NOT_FOUND", "流程不存在");
    c.header(
      "content-disposition",
      `attachment; filename="${encodeURIComponent(flow.name)}.flow.json"`,
    );
    return c.json(flow.dsl);
  });

  app.post("/api/flows/:id/matrix/preview", async (c) => {
    const flow = deps.store.getFlow(c.req.param("id"));
    if (!flow) throw new ApiError(404, "FLOW_NOT_FOUND", "流程不存在");
    const body = (await c.req.json().catch(() => ({}))) as {
      mode?: "full" | "pairwise";
      factors?: Record<string, unknown[]>;
      seed?: number;
    };
    const factors = body.factors ?? factorsFromDatasets(flow.dsl.datasets ?? []);
    if (body.mode === "pairwise") {
      throw new ApiError(
        501,
        "PAIRWISE_NOT_IMPLEMENTED",
        "pairwise 生成器在 M3 实现；当前可用 full 预览",
      );
    }
    const rows = fullCombinations(factors);
    if (rows.length > 500) {
      throw new ApiError(400, "MATRIX_TOO_LARGE", "full 组合超过 500 行", {
        details: { rows: rows.length },
      });
    }
    return c.json({ mode: "full", rows, count: rows.length, factors: Object.keys(factors) });
  });
}

function validationResponse(input: unknown): Record<string, unknown> {
  const validation = validateDsl(input);
  return {
    ok: validation.errors.length === 0,
    dsl: validation.dsl,
    readiness: validation.readiness,
    lint: validation.lint,
    errors: validation.errors,
  };
}

function factorsFromDatasets(
  datasets: Array<{ columns: Record<string, unknown> }>,
): Record<string, unknown[]> {
  const factors: Record<string, unknown[]> = {};
  for (const dataset of datasets) {
    for (const [column, value] of Object.entries(dataset.columns)) {
      if (value && typeof value === "object" && !Array.isArray(value)) continue;
      const values = factors[column] ?? [];
      if (!values.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
        values.push(value);
      }
      factors[column] = values;
    }
  }
  return factors;
}

function fullCombinations(factors: Record<string, unknown[]>): Array<Record<string, unknown>> {
  const keys = Object.keys(factors);
  if (keys.length === 0) return [];
  let rows: Array<Record<string, unknown>> = [{}];
  for (const key of keys) {
    const next: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      for (const value of factors[key] ?? []) {
        next.push({ ...row, [key]: value });
      }
    }
    rows = next;
    if (rows.length > 500) return rows;
  }
  return rows;
}
