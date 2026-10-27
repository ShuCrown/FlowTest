import type { Locator, Page } from "playwright";
import {
  evaluateCondition,
  expandSignalRef,
  type PickerNode,
  type SignalRef,
  type TargetRef,
  type WaitSignal,
} from "@flowforge/dsl";
import { panelTarget } from "./compile.js";
import { checkAbort, type NodeContext } from "./context.js";
import { ERROR_CODES, FlowForgeError } from "./errors.js";
import { buildLocator } from "./locator.js";
import type {
  StageTiming,
} from "./types.js";
import { prepareWaits, type WaitContext } from "./waits.js";

export interface PickerOutcome {
  warnings: string[];
}

const STAGE_LABELS: Record<string, string> = {
  open: "打开面板",
  panel: "面板就绪",
  filter: "筛选",
  refresh: "列表刷新",
  pick: "选择",
  commit: "提交",
  backfill: "回填断言",
};

export async function executePicker(
  ctx: NodeContext,
  node: PickerNode,
): Promise<PickerOutcome> {
  const warnings: string[] = [];
  const t = {
    open: node.stageTimeouts?.openMs ?? 3000,
    panel: node.stageTimeouts?.panelMs ?? 5000,
    filter: node.stageTimeouts?.filterMs ?? 3000,
    refresh: node.stageTimeouts?.refreshMs ?? 12000,
    pick: node.stageTimeouts?.pickMs ?? 3000,
    commit: node.stageTimeouts?.commitMs ?? 5000,
  };
  const panelRef = panelTarget(node);

  const timeStage = async <T>(
    stageName: string,
    signal: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const started = Date.now();
    ctx.emit({ type: "node.stage", nodeId: node.id, payload: { stage: stageName, status: "started" } });
    try {
      const result = await fn();
      ctx.stage({
        stage: stageName,
        durationMs: Date.now() - started,
        status: "completed",
        signal,
      });
      return result;
    } catch (error) {
      ctx.stage({
        stage: stageName,
        durationMs: Date.now() - started,
        status: "failed",
        signal,
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  // stage 1 + 2：response 必须在点击前预注册，再打开并等待面板
  const panelSignals = buildPanelSignals(node, panelRef);
  const prepared = prepareWaits(panelSignals, {
    page: ctx.page,
    resolveTarget: async (target, timeoutMs) =>
      (await ctx.resolver.resolve(ctx.page, target, { timeoutMs })).locator,
    resolveValue: (value) => ctx.resolveValue(value, `/nodes/${node.id}/panel`, {}),
    defaultTimeoutMs: t.panel,
    onWarning: (message) => {
      warnings.push(message);
      ctx.emit({ type: "warning", nodeId: node.id, level: "warning", payload: { message } });
    },
  });

  await timeStage("open", "trigger", async () => {
    await openPanel(ctx, node, panelRef, t.open);
  });
  checkAbort(ctx.signal, "picker.open");

  const ready = await timeStage("panel", "content-stable", async () => prepared.wait());
  warnings.push(...ready.warnings);
  prepared.dispose();

  // stage 3: 筛选
  if (node.filter && node.filter.steps.length > 0) {
    const refreshSignals: WaitSignal[] = [];
    if (node.panel.optionResponse) {
      refreshSignals.push({
        kind: "response",
        urlContains: node.panel.optionResponse.urlContains,
        method: node.panel.optionResponse.method,
        status: node.panel.optionResponse.status ?? 200,
        timeoutMs: t.refresh,
      });
    }
    refreshSignals.push({
      kind: "domStable",
      target: panelRef,
      quietMs: 200,
      maxMs: Math.min(t.refresh, 8000),
      optional: true,
      timeoutMs: t.refresh,
    });
    const refresh = prepareWaits(refreshSignals, waitContext(ctx, node, t.refresh, warnings));
    for (let index = 0; index < node.filter.steps.length; index += 1) {
      const step = node.filter.steps[index]!;
      await timeStage("filter", step.adapter, async () => {
        const target = await ctx.resolver.resolve(ctx.page, step.target, { timeoutMs: t.filter });
        await target.locator.waitFor({ state: "visible", timeout: t.filter });
        const value =
          step.value !== undefined
            ? await ctx.resolveValue(step.value, `/nodes/${node.id}/filter/steps/${index}/value`, {})
            : undefined;
        if (step.adapter === "input") {
          await target.locator.fill(String(value));
          const actual = await target.locator.inputValue();
          if (actual !== String(value)) {
            throw new FlowForgeError(
              ERROR_CODES.readBackMismatch,
              `筛选输入回读不一致: 期望 ${String(value)}，实际 ${actual}`,
              { nodeId: node.id, stage: "filter" },
            );
          }
        } else if (step.adapter === "nativeSelect") {
          await target.locator.selectOption({ label: String(value) });
          const actual = await target.locator.inputValue();
          if (actual !== String(value)) {
            warnings.push(`筛选下拉回读不一致: ${String(value)} != ${actual}`);
          }
        } else if (step.adapter === "check") {
          await target.locator.setChecked(step.checked ?? true);
        } else {
          await target.locator.click();
        }
      });
      checkAbort(ctx.signal, `picker.filter.${index}`);
    }
    await timeStage("refresh", "response|domStable", async () => {
      const result = await refresh.wait();
      warnings.push(...result.warnings);
    });
    refresh.dispose();

    const count = await countOptions(ctx, panelRef);
    if (count === 0) {
      throw new FlowForgeError(
        ERROR_CODES.filterNoResult,
        `筛选后无结果: ${node.name ?? node.id}`,
        { nodeId: node.id, stage: "refresh" },
      );
    }
  }

  // stage 4: 选择
  await timeStage("pick", node.pick.strategy, async () => {
    await pickItems(ctx, node, panelRef, t.pick, warnings);
  });
  checkAbort(ctx.signal, "picker.pick");

  // stage 5: 提交
  if (node.commit) {
    await timeStage("commit", "click→hidden", async () => {
      const target = await ctx.resolver.resolve(ctx.page, node.commit!.target, {
        timeoutMs: t.commit,
      });
      await target.locator.click({ timeout: t.commit });
      if (node.commit?.waitHidden !== false) {
        try {
          await waitHidden(ctx, panelRef, t.commit, "commit");
        } catch (error) {
          throw new FlowForgeError(
            ERROR_CODES.commitTimeout,
            `提交后面板未关闭: ${node.name ?? node.id}`,
            { nodeId: node.id, stage: "commit", details: { cause: error } },
          );
        }
      }
    });
  } else if (node.mode === "dialog") {
    const started = Date.now();
    try {
      await waitHidden(ctx, panelRef, t.commit, "commit");
      ctx.stage({
        stage: "commit",
        durationMs: Date.now() - started,
        status: "completed",
        signal: "hidden",
      });
    } catch {
      warnings.push("dialog 未配置 commit 且面板未自动关闭");
      ctx.stage({
        stage: "commit",
        durationMs: Date.now() - started,
        status: "warning",
        signal: "hidden",
      });
    }
  }

  return { warnings };
}

function waitContext(
  ctx: NodeContext,
  node: PickerNode,
  timeoutMs: number,
  warnings: string[],
): WaitContext {
  return {
    page: ctx.page,
    resolveTarget: async (target, budget, resolveOptions) =>
      (
        await ctx.resolver.resolve(ctx.page, target, {
          timeoutMs: budget,
          allowMultiple: resolveOptions?.multiple,
        })
      ).locator,
    resolveValue: (value) => ctx.resolveValue(value, `/nodes/${node.id}/wait`, {}),
    defaultTimeoutMs: timeoutMs,
    onWarning: (message) => {
      warnings.push(message);
      ctx.emit({ type: "warning", nodeId: node.id, level: "warning", payload: { message } });
    },
  };
}

function buildPanelSignals(node: PickerNode, panelRef: TargetRef): WaitSignal[] {
  const signals: WaitSignal[] = [
    expandSignalRef((node.panel.readySignal ?? "content-stable") as SignalRef, panelRef),
  ];
  if (node.panel.optionResponse) {
    signals.push({
      kind: "response",
      urlContains: node.panel.optionResponse.urlContains,
      method: node.panel.optionResponse.method,
      status: node.panel.optionResponse.status ?? 200,
      timeoutMs: node.stageTimeouts?.panelMs ?? 5000,
    });
  }
  return signals;
}

async function openPanel(
  ctx: NodeContext,
  node: PickerNode,
  panelRef: TargetRef,
  openMs: number,
): Promise<void> {
  const trigger = await ctx.resolver.resolve(ctx.page, node.trigger, { timeoutMs: openMs });
  await trigger.locator.waitFor({ state: "visible", timeout: openMs });
  await trigger.locator.click({ timeout: openMs });
  try {
    await waitVisible(ctx, panelRef, openMs, "open");
  } catch (error) {
    await trigger.locator.click({ timeout: openMs });
    await waitVisible(ctx, panelRef, openMs, "open");
  }
}

async function waitVisible(
  ctx: NodeContext,
  target: TargetRef,
  timeoutMs: number,
  stage: string,
): Promise<Locator> {
  const result = await ctx.resolver.resolve(ctx.page, target, { timeoutMs });
  await result.locator.waitFor({ state: "visible", timeout: timeoutMs });
  return result.locator;
}

async function waitHidden(
  ctx: NodeContext,
  target: TargetRef,
  timeoutMs: number,
  _stage: string,
): Promise<void> {
  const strategy = target.strategies[0];
  if (!strategy) throw new FlowForgeError(ERROR_CODES.targetNotFound, "面板目标缺少策略");
  const locator = buildLocator(ctx.page, strategy);
  await locator.first().waitFor({ state: "hidden", timeout: timeoutMs });
}

async function countOptions(ctx: NodeContext, panelRef: TargetRef): Promise<number> {
  try {
    const panel = (await ctx.resolver.resolve(ctx.page, panelRef, { timeoutMs: 2000 })).locator;
    const options = panel.getByRole("option");
    const count = await options.count();
    if (count > 0) return count;
    return await panel.getByRole("row").count();
  } catch {
    return 0;
  }
}

async function pickItems(
  ctx: NodeContext,
  node: PickerNode,
  panelRef: TargetRef,
  timeoutMs: number,
  warnings: string[],
): Promise<void> {
  const panel = (await ctx.resolver.resolve(ctx.page, panelRef, { timeoutMs })).locator;
  const multi = node.pick.multi === true;

  switch (node.pick.strategy) {
    case "byText": {
      const values = await pickValues(ctx, node);
      if (values.length === 0) {
        throw new FlowForgeError(
          ERROR_CODES.pickNoMatch,
          "byText 缺少可解析的选择值",
          { nodeId: node.id, stage: "pick" },
        );
      }
      if (!multi && values.length > 1) {
        warnings.push("byText 未声明 multi，只选择第一个值");
      }
      for (const value of multi ? values : values.slice(0, 1)) {
        await pickByText(ctx, node, panel, value, timeoutMs);
      }
      return;
    }
    case "byRow": {
      const config = node.pick.byRow!;
      let rawKey: unknown = config.keyValue;
      if (rawKey === undefined && config.keyColumn) {
        rawKey = ctx.resolved.values[config.keyColumn];
      }
      if (rawKey === undefined) {
        throw new FlowForgeError(
          ERROR_CODES.pickNoMatch,
          `byRow 缺少 keyValue: ${config.keyColumn}`,
          { nodeId: node.id, stage: "pick" },
        );
      }
      const resolvedKey = await ctx.resolveValue(
        rawKey,
        `/nodes/${node.id}/pick/byRow/keyValue`,
        {},
      );
      await pickByRow(ctx, node, panel, String(resolvedKey), timeoutMs);
      return;
    }
    case "byCondition": {
      await pickByCondition(ctx, node, panel, timeoutMs);
      return;
    }
    case "all": {
      const options = panel.getByRole("option");
      const count = await options.count();
      if (count === 0) {
        throw new FlowForgeError(
          ERROR_CODES.pickNoMatch,
          "all 未找到任何选项",
          { nodeId: node.id, stage: "pick" },
        );
      }
      for (let index = 0; index < count; index += 1) {
        await options.nth(index).click({ timeout: timeoutMs });
      }
      return;
    }
  }
}

async function pickValues(ctx: NodeContext, node: PickerNode): Promise<string[]> {
  const byText = node.pick.byText;
  if (!byText) return [];
  let value: unknown;
  if (byText.value !== undefined) {
    value = await ctx.resolveValue(byText.value, `/nodes/${node.id}/pick/byText/value`, {});
  } else if (byText.column) {
    value = ctx.resolved.values[byText.column];
  }
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === null) return [];
  return [String(value)];
}

async function pickByText(
  ctx: NodeContext,
  node: PickerNode,
  panel: Locator,
  value: string,
  timeoutMs: number,
): Promise<void> {
  const exact = node.pick.byText?.match !== "contains";
  let options = panel.getByRole("option", { name: value, exact });
  let count = await options.count();
  if (count === 0) {
    options = panel.getByText(value, { exact });
    count = await options.count();
  }
  if (count === 0) {
    const candidates = await listOptionTexts(panel);
    throw new FlowForgeError(
      ERROR_CODES.pickNoMatch,
      `选择项不存在: ${value}`,
      { nodeId: node.id, stage: "pick", details: { candidates } },
    );
  }
  const visible: number[] = [];
  for (let index = 0; index < Math.min(count, 20); index += 1) {
    if (await options.nth(index).isVisible().catch(() => false)) visible.push(index);
  }
  if (visible.length === 0) {
    throw new FlowForgeError(
      ERROR_CODES.pickNoMatch,
      `选择项存在但不可见: ${value}`,
      { nodeId: node.id, stage: "pick" },
    );
  }
  if (visible.length > 1) {
    const candidates = await listOptionTexts(panel);
    throw new FlowForgeError(
      ERROR_CODES.pickAmbiguous,
      `选择项存在歧义: ${value}（命中 ${visible.length} 个）`,
      { nodeId: node.id, stage: "pick", details: { candidates } },
    );
  }
  await options.nth(visible[0]!).click({ timeout: timeoutMs });
  await sleep(80);
}

async function pickByRow(
  ctx: NodeContext,
  node: PickerNode,
  panel: Locator,
  keyValue: string,
  timeoutMs: number,
): Promise<void> {
  const config = node.pick.byRow!;
  const rows = panel.getByRole("row");
  const matched = rows.filter({ hasText: keyValue });
  const count = await matched.count();
  if (count === 0) {
    const candidates = await rows.allInnerTexts().catch(() => [] as string[]);
    throw new FlowForgeError(
      ERROR_CODES.pickNoMatch,
      `未找到行 ${config.keyColumn}=${keyValue}`,
      {
        nodeId: node.id,
        stage: "pick",
        details: { candidates: candidates.slice(0, 10).map(normalize) },
      },
    );
  }
  if (count > 1) {
    throw new FlowForgeError(
      ERROR_CODES.pickAmbiguous,
      `行 ${config.keyColumn}=${keyValue} 命中 ${count} 行`,
      { nodeId: node.id, stage: "pick" },
    );
  }
  const row = matched.first();
  if (config.clickTarget) {
    const strategy = config.clickTarget.strategies[0]!;
    const locator = buildLocator(row, strategy);
    await locator.first().click({ timeout: timeoutMs });
  } else if (config.rowTarget) {
    const strategy = config.rowTarget.strategies[0]!;
    await buildLocator(row, strategy).first().click({ timeout: timeoutMs });
  } else {
    await row.click({ timeout: timeoutMs });
  }
}

async function pickByCondition(
  ctx: NodeContext,
  node: PickerNode,
  panel: Locator,
  timeoutMs: number,
): Promise<void> {
  const config = node.pick.byCondition!;
  const rows = panel.getByRole("row");
  const count = await rows.count();
  const matches: Locator[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const rowValues: Record<string, string> = {};
    for (const [column, target] of Object.entries(config.columns)) {
      const strategy = target.strategies[0]!;
      rowValues[column] = normalize(
        await buildLocator(row, strategy)
          .first()
          .innerText()
          .catch(() => ""),
      );
    }
    if (evaluateCondition(config.condition, { values: rowValues, vars: ctx.resolved.vars })) {
      matches.push(row);
    }
  }
  if (matches.length === 0) {
    throw new FlowForgeError(
      ERROR_CODES.pickNoMatch,
      "byCondition 未匹配到任何行",
      { nodeId: node.id, stage: "pick" },
    );
  }
  if (matches.length > 1) {
    throw new FlowForgeError(
      ERROR_CODES.pickAmbiguous,
      `byCondition 匹配到 ${matches.length} 行`,
      { nodeId: node.id, stage: "pick" },
    );
  }
  await matches[0]!.click({ timeout: timeoutMs });
}

async function listOptionTexts(panel: Locator): Promise<string[]> {
  const options = await panel
    .getByRole("option")
    .allInnerTexts()
    .catch(() => [] as string[]);
  if (options.length > 0) return options.slice(0, 10).map(normalize);
  const rows = await panel
    .getByRole("row")
    .allInnerTexts()
    .catch(() => [] as string[]);
  return rows.slice(0, 10).map(normalize);
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function pickerStageTimings(stages: StageTiming[]): StageTiming[] {
  return stages.map((stage) => ({
    ...stage,
    stage: STAGE_LABELS[stage.stage] ? `${stage.stage}/${STAGE_LABELS[stage.stage]}` : stage.stage,
  }));
}
