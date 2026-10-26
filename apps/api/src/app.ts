import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import { serveStatic } from "@hono/node-server/serve-static";
import { ZodError } from "zod";
import type { AppDeps } from "./deps.js";
import { ApiError } from "./lib/errors.js";
import { registerAiRoutes } from "./routes/ai.js";
import { registerFlowRoutes } from "./routes/flows.js";
import { registerInspectorRoutes } from "./routes/inspector.js";
import { registerRecordingRoutes } from "./routes/recordings.js";
import { registerRepairRoutes } from "./routes/repair.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerSpecRoutes } from "./routes/spec.js";
import { registerSystemRoutes } from "./routes/systems.js";

export interface AppRuntime {
  app: Hono;
  injectWebSocket: (server: import("node:http").Server) => void;
}

export function createApp(deps: AppDeps): AppRuntime {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(error.toJSON(), error.status as 400);
    }
    if (error instanceof ZodError) {
      return c.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "请求参数不合法",
            details: error.issues,
          },
        },
        400,
      );
    }
    process.stderr.write(`[api] ${error.stack ?? error.message}\n`);
    return c.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: error.message,
        },
      },
      500,
    );
  });

  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: `未知路由: ${c.req.path}` } }, 404),
  );

  registerSystemRoutes(app, deps);
  registerFlowRoutes(app, deps);
  registerRunRoutes(app, deps);
  registerRepairRoutes(app, deps);
  registerInspectorRoutes(app, deps);
  registerRecordingRoutes(app, deps);
  registerSettingsRoutes(app, deps);
  registerSpecRoutes(app, deps);
  registerAiRoutes(app, deps);

  app.get(
    "/api/runs/:id/events",
    upgradeWebSocket((c) => {
      const runId = c.req.param("id") ?? "";
      const origin = c.req.header("origin");
      const allowed =
        !origin ||
        /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin);
      let subscribed = false;
      return {
        onOpen: (_event, ws) => {
          if (!allowed) {
            ws.close(1008, "origin not allowed");
            return;
          }
          const detail = deps.store.getRunDetail(runId);
          if (!detail) {
            ws.send(JSON.stringify({ type: "run.error", error: { code: "RUN_NOT_FOUND" } }));
            ws.close(1008, "run not found");
            return;
          }
          ws.send(JSON.stringify({ type: "run.snapshot", run: detail }));
          deps.broker.subscribe(runId, ws);
          subscribed = true;
        },
        onMessage: (_event, ws) => {
          ws.send(JSON.stringify({ type: "pong", ts: new Date().toISOString() }));
        },
        onClose: (_event, ws) => {
          if (subscribed) deps.broker.unsubscribe(runId, ws);
        },
      };
    }),
  );

  registerWebStatic(app);
  return { app, injectWebSocket };
}

export function registerWebStatic(app: Hono): void {
  const dist = resolve(process.env.FF_WEB_DIST ?? "apps/web/dist");
  if (!existsSync(join(dist, "index.html"))) return;
  app.use("/assets/*", serveStatic({ root: dist }));
  app.get("*", (c, next) => {
    if (c.req.path.startsWith("/api")) return next();
    return serveStatic({ path: join(dist, "index.html") })(c, next);
  });
}
