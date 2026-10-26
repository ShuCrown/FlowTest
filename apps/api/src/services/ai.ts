import { z } from "zod";
import {
  ConditionSchema,
  FlowDslSchema,
  normalizeDsl,
  ValueLikeSchema,
  type FlowDsl,
  type SystemConfig,
} from "@flowforge/dsl";
import { ApiError } from "../lib/errors.js";
import type { Store } from "./store.js";

interface AiSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function aiSettings(settings: Record<string, unknown>): AiSettings {
  const enabled =
    Boolean(settings.aiEnabled) ||
    process.env.FF_AI_ENABLED === "1" ||
    Boolean(process.env.FF_AI_API_KEY);
  return {
    enabled,
    baseUrl: process.env.FF_AI_BASE_URL ?? "",
    apiKey: process.env.FF_AI_API_KEY ?? "",
    model: process.env.FF_AI_MODEL ?? "",
  };
}

export function requireAi(settings: Record<string, unknown>): AiSettings {
  const ai = aiSettings(settings);
  if (!ai.enabled) {
    throw new ApiError(400, "AI_DISABLED", "AI 未开启；核心链路不依赖 AI，可继续手动配置");
  }
  if (!ai.baseUrl || !ai.apiKey || !ai.model) {
    throw new ApiError(
      400,
      "AI_NOT_CONFIGURED",
      "缺少 FF_AI_BASE_URL / FF_AI_API_KEY / FF_AI_MODEL",
    );
  }
  return ai;
}

export async function chatJson(
  ai: AiSettings,
  messages: Array<{ role: "system" | "user"; content: string }>,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(`${ai.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ai.apiKey}`,
      },
      body: JSON.stringify({
        model: ai.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 600);
      throw new ApiError(502, "AI_UPSTREAM_FAILED", `AI 接口失败 ${response.status}`, {
        details: text,
      });
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    return parseJsonContent(content);
  } finally {
    clearTimeout(timer);
  }
}

export function buildContextPack(store: Store, flowId?: string): Record<string, unknown> {
  const flow = flowId ? store.getFlow(flowId) : undefined;
  const dsl = flow?.dsl;
  const secret = new Set(dsl?.secretFields ?? []);
  const redact = (key: string, value: unknown): unknown => {
    if (secret.has(key) || /password|token|secret|cookie/i.test(key)) return "***";
    return value;
  };
  let schema: unknown = undefined;
  try {
    schema = z.toJSONSchema(FlowDslSchema, { io: "input" });
  } catch {
    schema = undefined;
  }
  return {
    role: "FlowForge DSL draft generator",
    instructions:
      "只输出单个 JSON 对象 FlowDsl，不要 Markdown / 代码块 / 解释。dslVersion 必须是 1.0；" +
      "target.strategies 优先 testid → role → label → placeholder → text → name → css → xpath；" +
      "禁止 waitForTimeout / networkidle；branch 节点必须有 then / else 两条出边；" +
      "不要编造 CSS/XPath，定位来自页面拾取或用户确认；不确定的节点标记 meta.needsConfirm=true。",
    dslVersion: "1.0",
    nodeTypes: ["navigate", "interact", "picker", "wait", "assert", "branch", "api"],
    targetStrategies: ["testid", "role", "label", "placeholder", "text", "name", "css", "xpath"],
    waitPresets: [
      "page-ready",
      "content-stable",
      "list-ready",
      "dialog-ready",
      "option-ready",
      "save-ready",
    ],
    valueKinds: ["literal", "var", "template", "dataset", "env", "ref", "generator"],
    generatorTypes: [
      "unique.text",
      "unique.email",
      "unique.phone",
      "unique.orderNo",
      "sequence",
      "faker.name",
      "faker.email",
      "faker.phone",
      "faker.company",
      "faker.idCard",
    ],
    templateNamespaces: ["vars.*", "run.id", "run.shortId", "run.startedAt", "seq.*", "sys.baseUrl", "env.NAME"],
    limits: { nodes: 500, edges: 1000, datasets: 500, sizeMb: 5 },
    systems: (dsl?.systems ?? store.listSystems()).map((system: SystemConfig) => ({
      id: system.id,
      name: system.name,
      baseUrl: system.baseUrl,
      authKind: system.auth?.kind ?? "none",
    })),
    datasets: (dsl?.datasets ?? []).map((dataset) => ({
      id: dataset.id,
      name: dataset.name,
      columns: Object.fromEntries(
        Object.entries(dataset.columns).map(([key, value]) => [
          key,
          secret.has(key) ? "***" : value,
        ]),
      ),
    })),
    vars: Object.fromEntries(
      Object.entries(dsl?.vars ?? {}).map(([key, value]) => [
        key,
        redact(key, typeof value === "object" && value && "kind" in value ? value.kind : "literal"),
      ]),
    ),
    constraints: dsl?.constraints ?? [],
    schema,
  };
}

export function templateSearch(
  store: Store,
  query: string,
  limit = 8,
): Array<{ flow: Record<string, unknown>; score: number }> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const results = store.listFlows().map((flow) => {
    const detail = store.getFlow(flow.id)!;
    const haystack = [
      flow.name,
      detail.dsl.meta.description ?? "",
      (flow.tags ?? []).join(" "),
      detail.dsl.nodes.map((node) => node.name ?? node.type).join(" "),
    ]
      .join(" ")
      .toLowerCase();
    let score = 0;
    if (haystack.includes(normalized)) score += 0.6;
    score += trigramSimilarity(normalized, haystack) * 0.4;
    return {
      flow: {
        id: flow.id,
        name: flow.name,
        tags: flow.tags,
        readiness: flow.readiness,
        publishedVersion: flow.publishedVersion,
        dsl: detail.dsl,
        score,
      },
      score: Math.round(score * 100) / 100,
    };
  });
  return results
    .filter((item) => item.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function trigramSimilarity(a: string, b: string): number {
  const grams = (value: string): Set<string> => {
    const set = new Set<string>();
    const text = ` ${value} `;
    for (let i = 0; i < text.length - 2; i += 1) set.add(text.slice(i, i + 3));
    return set;
  };
  const left = grams(a);
  const right = grams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const gram of left) if (right.has(gram)) intersection += 1;
  return (2 * intersection) / (left.size + right.size);
}

export function parseDraftContent(content: string): FlowDsl {
  const parsed = parseJsonContent(content);
  try {
    return normalizeDsl(parsed);
  } catch (error) {
    throw new ApiError(400, "AI_DSL_INVALID", "AI 返回的 DSL 不符合 schema", {
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

export function parseJsonContent(content: string): unknown {
  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    throw new ApiError(400, "AI_JSON_INVALID", "AI 返回的不是合法 JSON", {
      details: String(error),
    });
  }
}

export function validateSuggestion(kind: "field" | "condition", suggestion: unknown): unknown {
  if (kind === "field") {
    const parsed = ValueLikeSchema.safeParse(suggestion);
    if (!parsed.success) {
      throw new ApiError(400, "AI_SUGGESTION_INVALID", "AI 取值建议不合法", {
        details: parsed.error.issues,
      });
    }
    return parsed.data;
  }
  const parsed = ConditionSchema.safeParse(suggestion);
  if (!parsed.success) {
    throw new ApiError(400, "AI_SUGGESTION_INVALID", "AI 条件建议不合法", {
      details: parsed.error.issues,
    });
  }
  return parsed.data;
}
