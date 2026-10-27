import type { FlowNode } from "@flowforge/dsl";
import { evaluateCondition } from "@flowforge/dsl";
import { checkAbort, type NodeContext } from "./context.js";
import { ERROR_CODES, FlowForgeError } from "./errors.js";
import { navigateTo } from "./navigation.js";
import { executePicker } from "./picker.js";
import { prepareWaits, runSignal, type WaitContext } from "./waits.js";

export interface NodeOutcome {
  branch?: "then" | "else";
  output?: Record<string, unknown>;
  warnings?: string[];
}

export async function executeNode(ctx: NodeContext, node: FlowNode): Promise<NodeOutcome> {
  checkAbort(ctx.signal, node.id);
  switch (node.type) {
    case "navigate":
      return executeNavigate(ctx, node);
    case "interact":
      return executeInteract(ctx, node);
    case "picker": {
      const outcome = await executePicker(ctx, node);
      return { warnings: outcome.warnings };
    }
    case "wait":
    case "assert":
      return executeCondition(ctx, node);
    case "branch":
      return executeBranch(ctx, node);
    case "api":
      return executeApi(ctx, node);
  }
}

async function executeNavigate(
  ctx: NodeContext,
  node: Extract<FlowNode, { type: "navigate" }>,
): Promise<NodeOutcome> {
  const timeoutMs = node.timeoutMs ?? ctx.settings.nodeTimeoutMs ?? 15000;
  const system = ctx.dsl.systems.find((item) => item.id === node.system);
  if (!system) throw new FlowForgeError(ERROR_CODES.compileFailed, `未知 system: ${node.system}`);
  const rendered = String(
    await ctx.resolveValue({ kind: "template", template: node.url }, `/nodes/${node.id}/url`, {}),
  );
  const url = new URL(rendered, system.baseUrl).toString();
  const started = Date.now();
  const result = await navigateTo(ctx.page, url, {
    waitUntil: node.waitUntil ?? "domcontentloaded",
    timeoutMs,
  });
  ctx.stage({
    stage: "navigate",
    durationMs: Date.now() - started,
    status: "completed",
    signal: result.skipped ? "same-url-skip" : node.waitUntil ?? "domcontentloaded",
  });

  const ready = ctx.plan.nodes[node.id]?.readySignal;
  if (ready) {
    const readyStarted = Date.now();
    const waitCtx = waitContext(ctx, node.id, timeoutMs);
    await runSignal(ready, waitCtx);
    ctx.stage({
      stage: "ready",
      durationMs: Date.now() - readyStarted,
      status: "completed",
      signal: ready.kind,
    });
  }
  return { output: { value: url, text: url } };
}

async function executeInteract(
  ctx: NodeContext,
  node: Extract<FlowNode, { type: "interact" }>,
): Promise<NodeOutcome> {
  const timeoutMs = node.timeoutMs ?? ctx.settings.nodeTimeoutMs ?? 15000;
  const resolveStarted = Date.now();
  const target = await ctx.resolver.resolve(ctx.page, node.target, { timeoutMs });
  ctx.recordTarget(target.info, node.id);
  if (target.info.healed) ctx.recordHealed(node.id, target.info);
  ctx.stage({
    stage: "resolve",
    durationMs: Date.now() - resolveStarted,
    status: "completed",
    signal: target.info.strategy,
  });

  const locator = target.locator;
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  const actionStarted = Date.now();
  const actionStage = `action:${node.adapter}`;
  try {
    switch (node.adapter) {
      case "input": {
        const value = String(
          await ctx.resolveValue(node.value, `/nodes/${node.id}/value`, {}),
        );
        await locator.fill(value, { timeout: timeoutMs });
        const actual = await locator.inputValue();
        ctx.recordAction({
          nodeId: node.id,
          field: node.target.label ?? node.name ?? node.id,
          expected: value,
          actual,
          valueSource: sourceOf(node.value),
          status: actual === value ? "pass" : "fail",
          durationMs: Date.now() - actionStarted,
        });
        if (node.verify === "readBack" && actual !== value) {
          throw new FlowForgeError(
            ERROR_CODES.readBackMismatch,
            `输入回读不一致: 期望 ${value}，实际 ${actual}`,
            { nodeId: node.id, stage: "action" },
          );
        }
        break;
      }
      case "click": {
        await locator.click({ timeout: timeoutMs });
        ctx.recordAction({
          nodeId: node.id,
          field: node.target.label ?? node.name ?? node.id,
          status: "pass",
          durationMs: Date.now() - actionStarted,
        });
        break;
      }
      case "check": {
        const expected = node.checked ?? true;
        await locator.setChecked(expected, { timeout: timeoutMs });
        const actual = await locator.isChecked();
        ctx.recordAction({
          nodeId: node.id,
          field: node.target.label ?? node.name ?? node.id,
          expected,
          actual,
          status: actual === expected ? "pass" : "fail",
          durationMs: Date.now() - actionStarted,
        });
        if (actual !== expected) {
          throw new FlowForgeError(
            ERROR_CODES.readBackMismatch,
            `勾选状态回读不一致`,
            { nodeId: node.id, stage: "action" },
          );
        }
        break;
      }
      case "select":
      case "nativeSelect": {
        const value = String(await ctx.resolveValue(node.value, `/nodes/${node.id}/value`, {}));
        await locator.selectOption({ label: value }, { timeout: timeoutMs });
        const actual = await locator.inputValue();
        ctx.recordAction({
          nodeId: node.id,
          field: node.target.label ?? node.name ?? node.id,
          expected: value,
          actual,
          valueSource: sourceOf(node.value),
          status: actual === value ? "pass" : "fail",
          durationMs: Date.now() - actionStarted,
        });
        if (actual !== value) {
          throw new FlowForgeError(
            ERROR_CODES.readBackMismatch,
            `下拉回读不一致: 期望 ${value}，实际 ${actual}`,
            { nodeId: node.id, stage: "action" },
          );
        }
        break;
      }
      case "press": {
        if (!node.key) {
          throw new FlowForgeError(ERROR_CODES.actionFailed, "press 缺少 key", {
            nodeId: node.id,
            stage: "action",
          });
        }
        await locator.press(node.key, { timeout: timeoutMs });
        break;
      }
      case "upload": {
        const value = await ctx.resolveValue(node.value, `/nodes/${node.id}/value`, {});
        const files = Array.isArray(value) ? value.map(String) : [String(value)];
        await locator.setInputFiles(files, { timeout: timeoutMs });
        break;
      }
      case "hover": {
        await locator.hover({ timeout: timeoutMs });
        break;
      }
    }
  } catch (error) {
    if (error instanceof FlowForgeError) throw error;
    throw new FlowForgeError(
      ERROR_CODES.actionFailed,
      `动作失败 (${node.adapter}): ${error instanceof Error ? error.message : String(error)}`,
      { nodeId: node.id, stage: "action", details: { cause: String(error) } },
    );
  }
  ctx.stage({
    stage: actionStage,
    durationMs: Date.now() - actionStarted,
    status: "completed",
  });

  const value =
    node.adapter === "input" || node.adapter === "select" || node.adapter === "nativeSelect"
      ? await locator.inputValue().catch(() => "")
      : undefined;
  const text =
    value !== undefined ? String(value) : (node.target.label ?? node.name ?? "");
  return { output: { value, text } };
}

async function executeCondition(
  ctx: NodeContext,
  node: Extract<FlowNode, { type: "wait" | "assert" }>,
): Promise<NodeOutcome> {
  const timeoutMs = node.timeoutMs ?? ctx.settings.nodeTimeoutMs ?? 15000;
  const prepared = prepareWaits([node.condition], waitContext(ctx, node.id, timeoutMs));
  const started = Date.now();
  try {
    await prepared.wait();
    ctx.stage({
      stage: node.type,
      durationMs: Date.now() - started,
      status: "completed",
      signal: typeof node.condition === "string" ? node.condition : node.condition.kind,
    });
    return {};
  } catch (error) {
    if (node.type === "assert") {
      ctx.emit({
        type: "assert.failed",
        nodeId: node.id,
        level: "error",
        payload: { message: node.message ?? "断言失败" },
      });
      throw new FlowForgeError(
        ERROR_CODES.assertionFailed,
        node.message ?? `断言失败: ${error instanceof Error ? error.message : String(error)}`,
        { nodeId: node.id, stage: "assert" },
      );
    }
    throw error;
  } finally {
    prepared.dispose();
  }
}

async function executeBranch(
  ctx: NodeContext,
  node: Extract<FlowNode, { type: "branch" }>,
): Promise<NodeOutcome> {
  try {
    const result = evaluateCondition(node.condition, {
      values: ctx.resolved.values,
      vars: ctx.resolved.vars,
    });
    return { branch: result ? "then" : "else" };
  } catch (error) {
    throw new FlowForgeError(
      ERROR_CODES.branchEvalFailed,
      `分支条件求值失败: ${error instanceof Error ? error.message : String(error)}`,
      { nodeId: node.id, stage: "branch" },
    );
  }
}

async function executeApi(
  ctx: NodeContext,
  node: Extract<FlowNode, { type: "api" }>,
): Promise<NodeOutcome> {
  const system = ctx.dsl.systems.find((item) => item.id === node.system);
  if (!system) throw new FlowForgeError(ERROR_CODES.compileFailed, `未知 system: ${node.system}`);
  const rendered = String(
    await ctx.resolveValue({ kind: "template", template: node.url }, `/nodes/${node.id}/url`, {}),
  );
  const url = new URL(rendered, system.baseUrl);
  const origin = new URL(system.baseUrl).origin;
  const allowed = new Set([origin, ...(system.allowedOrigins ?? [])]);
  if (!allowed.has(url.origin)) {
    throw new FlowForgeError(
      ERROR_CODES.apiCrossOrigin,
      `api 跨域未授权: ${url.origin}`,
      { nodeId: node.id, stage: "api" },
    );
  }

  let data: unknown;
  if (node.body !== undefined) {
    data = await ctx.resolveValue(node.body, `/nodes/${node.id}/body`, {});
  }

  const started = Date.now();
  const response = await ctx.context.request.fetch(url.toString(), {
    method: node.method,
    data: data as string | Record<string, unknown> | undefined,
    headers: { accept: "application/json" },
    failOnStatusCode: false,
    timeout: node.timeoutMs ?? ctx.settings.nodeTimeoutMs ?? 15000,
  });
  const status = response.status();
  const text = (await response.text()).slice(0, 2 * 1024 * 1024);
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }

  ctx.recordNetwork({
    nodeId: node.id,
    method: node.method,
    url: url.toString(),
    status,
    reqBody: data,
    respSnippet: text.slice(0, 4000),
  });
  ctx.emit({
    type: "api.call",
    nodeId: node.id,
    payload: { method: node.method, url: url.toString(), status },
  });
  ctx.stage({
    stage: "api",
    durationMs: Date.now() - started,
    status: "completed",
    signal: `${node.method} ${status}`,
  });

  const expected = node.expectStatus ?? [200, 201, 204];
  const expectedList = Array.isArray(expected) ? expected : [expected];
  if (!expectedList.includes(status)) {
    throw new FlowForgeError(
      ERROR_CODES.apiFailed,
      `接口状态码不符合预期: ${node.method} ${url.pathname} -> ${status}`,
      {
        nodeId: node.id,
        stage: "api",
        details: { status, snippet: text.slice(0, 500) },
      },
    );
  }

  const output: Record<string, unknown> = {};
  for (const [name, path] of Object.entries(node.extract ?? {})) {
    const value = jsonPathGet(parsed, path);
    if (value === undefined) {
      throw new FlowForgeError(
        ERROR_CODES.apiFailed,
        `extract 路径不存在: ${path}`,
        { nodeId: node.id, stage: "api" },
      );
    }
    output[name] = value;
  }
  return { output };
}

export function jsonPathGet(value: unknown, path: string): unknown {
  if (!path.startsWith("$")) return undefined;
  let current: unknown = value;
  const tokens = path
    .slice(1)
    .match(/\.([A-Za-z0-9_$-]+)|\[(\d+)\]/g)
    ?.map((token) =>
      token.startsWith("[") ? Number(token.slice(1, -1)) : token.slice(1),
    );
  if (path !== "$" && !tokens) return undefined;
  for (const token of tokens ?? []) {
    if (current === undefined || current === null) return undefined;
    if (typeof token === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[token];
    } else {
      if (typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[token];
    }
  }
  return current;
}

function waitContext(ctx: NodeContext, nodeId: string, timeoutMs: number): WaitContext {
  return {
    page: ctx.page,
    resolveTarget: async (target, budget, resolveOptions) =>
      (
        await ctx.resolver.resolve(ctx.page, target, {
          timeoutMs: budget,
          allowMultiple: resolveOptions?.multiple,
        })
      ).locator,
    resolveValue: (value) => ctx.resolveValue(value, `/nodes/${nodeId}/wait`, {}),
    defaultTimeoutMs: timeoutMs,
    onWarning: (message) => {
      ctx.emit({ type: "warning", nodeId, level: "warning", payload: { message } });
    },
  };
}

function sourceOf(value: unknown): string {
  if (value && typeof value === "object" && "kind" in value) {
    return String((value as { kind: unknown }).kind);
  }
  return "literal";
}
