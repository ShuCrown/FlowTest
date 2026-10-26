import { z } from "zod";
import type { Hono } from "hono";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../lib/errors.js";

const patchSchema = z.object({
  nodeTimeoutMs: z.number().int().positive().optional(),
  pickerTimeoutMs: z.number().int().positive().optional(),
  screenshot: z.enum(["onFailure", "always", "never"]).optional(),
  trace: z.boolean().optional(),
  resourcePolicy: z.enum(["balanced", "fast", "accurate"]).optional(),
  headless: z.boolean().optional(),
  retentionDays: z.number().int().min(1).optional(),
  aiEnabled: z.boolean().optional(),
});

export function registerSettingsRoutes(app: Hono, deps: AppDeps): void {
  app.get("/api/settings", (c) => c.json({ settings: deps.store.getSettings() }));

  app.patch("/api/settings", async (c) => {
    const body = patchSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      throw new ApiError(400, "SETTINGS_INVALID", "设置项不合法", {
        details: body.error.issues,
      });
    }
    return c.json({ settings: deps.store.patchSettings(body.data) });
  });
}
