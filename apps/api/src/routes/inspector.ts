import { z } from "zod";
import type { Hono } from "hono";
import { TargetRefSchema } from "@flowforge/dsl";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../lib/errors.js";

const openSchema = z.object({
  systemId: z.string().min(1),
  path: z.string().optional(),
  headless: z.boolean().optional(),
});

const targetSchema = z.object({
  target: TargetRefSchema,
});

export function registerInspectorRoutes(app: Hono, deps: AppDeps): void {
  app.get("/api/inspector/current", (c) => {
    const session = deps.inspector.current();
    return c.json({ session: session && session.status === "open" ? session : null });
  });

  app.post("/api/inspector/open", async (c) => {
    const body = openSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      throw new ApiError(400, "INSPECTOR_INVALID", "请求体不合法", {
        details: body.error.issues,
      });
    }
    const system = deps.store.getSystem(body.data.systemId);
    if (!system) throw new ApiError(404, "SYSTEM_NOT_FOUND", "系统不存在");
    const session = await deps.inspector.open({
      system,
      path: body.data.path,
      headless: body.data.headless,
    });
    return c.json({ session });
  });

  app.post("/api/inspector/:id/pick", async (c) => {
    const result = await deps.inspector.pick(c.req.param("id"));
    return c.json(result);
  });

  app.post("/api/inspector/:id/test-target", async (c) => {
    const body = targetSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      throw new ApiError(400, "TARGET_INVALID", "target 不合法", {
        details: body.error.issues,
      });
    }
    const result = await deps.inspector.testTarget(c.req.param("id"), body.data.target);
    return c.json(result);
  });

  app.post("/api/inspector/:id/close", async (c) => {
    await deps.inspector.close();
    return c.json({ ok: true });
  });
}
