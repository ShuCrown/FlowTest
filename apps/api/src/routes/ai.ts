import { z } from "zod";
import type { Hono } from "hono";
import { diffDsl, normalizeDsl, type FlowDsl } from "@flowforge/dsl";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../lib/errors.js";
import {
  buildContextPack,
  chatJson,
  parseDraftContent,
  requireAi,
  templateSearch,
  validateSuggestion,
} from "../services/ai.js";
import { validateDsl } from "../services/store.js";

const draftSchema = z.object({
  description: z.string().min(3),
  flowId: z.string().optional(),
});

const suggestSchema = z.object({
  kind: z.enum(["field", "condition"]),
  text: z.string().min(2),
  context: z.unknown().optional(),
  flowId: z.string().optional(),
});

export function registerAiRoutes(app: Hono, deps: AppDeps): void {
  app.get("/api/ai/context", (c) => {
    const flowId = c.req.query("flowId");
    const pack = buildContextPack(deps.store, flowId);
    return c.json({ context: pack });
  });

  app.post("/api/ai/draft", async (c) => {
    const body = draftSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      throw new ApiError(400, "AI_INVALID_BODY", "请求体不合法", {
        details: body.error.issues,
      });
    }
    const settings = deps.store.getSettings();
    const ai = requireAi(settings);
    const existing = body.data.flowId ? deps.store.getFlow(body.data.flowId) : undefined;
    if (body.data.flowId && !existing) {
      throw new ApiError(404, "FLOW_NOT_FOUND", "流程不存在");
    }
    const context = buildContextPack(deps.store, body.data.flowId);
    const content = await chatJson(ai, [
      {
        role: "system",
        content: `你是 FlowForge DSL 生成器。上下文：${JSON.stringify(context)}\n只输出一个 JSON 对象。`,
      },
      { role: "user", content: body.data.description },
    ]);
    let dsl: FlowDsl;
    try {
      dsl = normalizeDsl(parseDraftContent(JSON.stringify(content)));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, "AI_DSL_INVALID", "AI 草稿归一化失败", {
        details: String(error),
      });
    }
    dsl.nodes = dsl.nodes.map((node) => ({
      ...node,
      meta: { ...(node.meta ?? {}), needsConfirm: true },
    }));
    const validation = validateDsl(dsl);
    const diff = existing ? diffDsl(existing.dsl, dsl) : [];
    return c.json({
      source: "llm",
      needsConfirm: true,
      dsl,
      readiness: validation.readiness,
      lint: validation.lint,
      diff,
      applied: false,
    });
  });

  app.post("/api/ai/suggest", async (c) => {
    const body = suggestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      throw new ApiError(400, "AI_INVALID_BODY", "请求体不合法", {
        details: body.error.issues,
      });
    }
    const settings = deps.store.getSettings();
    const ai = requireAi(settings);
    const context = buildContextPack(deps.store, body.data.flowId);
    const content = await chatJson(ai, [
      {
        role: "system",
        content:
          body.data.kind === "field"
            ? `把字段描述映射成 ValueLike。只能使用上下文中的 vars / 数据集列 / generator。上下文：${JSON.stringify(context)}`
            : `把自然语言转换成 Condition JSON（op eq/neq/gt/gte/lt/lte/in/contains/exists/and/or/not）。上下文：${JSON.stringify(context)}`,
      },
      { role: "user", content: body.data.text },
    ]);
    const wrapper = content as { binding?: unknown; condition?: unknown; confidence?: number };
    const suggestion =
      body.data.kind === "field"
        ? (wrapper.binding ?? wrapper)
        : (wrapper.condition ?? wrapper);
    const validated = validateSuggestion(body.data.kind, suggestion);
    return c.json({
      source: "llm",
      kind: body.data.kind,
      suggestion: validated,
      confidence:
        typeof wrapper.confidence === "number" ? Math.max(0, Math.min(1, wrapper.confidence)) : 0.5,
      needsConfirm: true,
      applied: false,
    });
  });

  app.get("/api/templates/search", (c) => {
    const query = c.req.query("q") ?? "";
    const limit = Math.min(Number(c.req.query("limit") ?? 8), 20);
    return c.json({ query, templates: templateSearch(deps.store, query, limit) });
  });
}
