import { accessSync, constants } from "node:fs";
import { createRequire } from "node:module";
import { z } from "zod";
import type { Hono } from "hono";
import { FlowDslSchema } from "@flowforge/dsl";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../lib/errors.js";

export function registerSpecRoutes(app: Hono, deps: AppDeps): void {
  app.get("/api/spec/schema", (c) => {
    try {
      return c.json(z.toJSONSchema(FlowDslSchema, { io: "input" }));
    } catch (error) {
      throw new ApiError(500, "SCHEMA_FAILED", "JSON Schema 生成失败", {
        details: String(error),
      });
    }
  });

  app.get("/api/health", async (c) => {
    let playwrightVersion = "unknown";
    let chromiumPath: string | null = null;
    try {
      const require = createRequire(import.meta.url);
      playwrightVersion = String(
        (require("playwright/package.json") as { version?: string }).version ?? "unknown",
      );
      const { chromium } = await import("playwright");
      chromiumPath = chromium.executablePath();
    } catch {
      chromiumPath = null;
    }
    let dataWritable = true;
    try {
      accessSync(deps.dataDir, constants.W_OK);
    } catch {
      dataWritable = false;
    }
    let dbOk = true;
    try {
      deps.store.sqlite.prepare("SELECT 1 AS ok").get();
    } catch {
      dbOk = false;
    }
    return c.json({
      ok: dataWritable && dbOk,
      playwright: { version: playwrightVersion, chromium: chromiumPath },
      dataDir: deps.dataDir,
      dataWritable,
      db: { ok: dbOk, path: deps.store.database.dbPath },
      runtime: process.version,
    });
  });
}
