import { z } from "zod";
import type { Hono } from "hono";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../lib/errors.js";

const authSchema = z.union([
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("storageState"),
    path: z.string().optional(),
    env: z.string().optional(),
  }),
  z.object({ kind: z.literal("login"), env: z.string().optional() }),
]);

const createSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  auth: authSchema.optional(),
  allowedOrigins: z.array(z.string().url()).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  auth: authSchema.optional(),
  allowedOrigins: z.array(z.string().url()).optional(),
});

export function registerSystemRoutes(app: Hono, deps: AppDeps): void {
  app.get("/api/systems", (c) => c.json({ systems: deps.store.listSystems() }));

  app.post("/api/systems", async (c) => {
    const body = createSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      throw new ApiError(400, "SYSTEM_INVALID", "系统参数不合法", {
        details: body.error.issues,
      });
    }
    const system = deps.store.createSystem(body.data);
    return c.json(system, 201);
  });

  app.get("/api/systems/:id", (c) => {
    const system = deps.store.getSystem(c.req.param("id"));
    if (!system) throw new ApiError(404, "SYSTEM_NOT_FOUND", "系统不存在");
    return c.json(system);
  });

  app.patch("/api/systems/:id", async (c) => {
    const body = updateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      throw new ApiError(400, "SYSTEM_INVALID", "系统参数不合法", {
        details: body.error.issues,
      });
    }
    return c.json(deps.store.updateSystem(c.req.param("id"), body.data));
  });

  app.delete("/api/systems/:id", (c) => {
    deps.store.deleteSystem(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/api/systems/:id/session", async (c) => {
    const system = deps.store.getSystem(c.req.param("id"));
    if (!system) throw new ApiError(404, "SYSTEM_NOT_FOUND", "系统不存在");
    const body = (await c.req.json().catch(() => ({}))) as { headless?: boolean };
    const session = await deps.inspector.open({
      system,
      headless: body.headless,
    });
    return c.json({ session });
  });

  app.put("/api/systems/:id/session", async (c) => {
    const system = deps.store.getSystem(c.req.param("id"));
    if (!system) throw new ApiError(404, "SYSTEM_NOT_FOUND", "系统不存在");
    const path = await deps.inspector.saveStorageState(system.id);
    const updated = deps.store.updateSystem(system.id, {
      auth: { kind: "storageState", path },
    });
    return c.json({ system: updated, path });
  });

  app.delete("/api/systems/:id/session", async (c) => {
    await deps.inspector.close();
    return c.json({ ok: true });
  });
}
