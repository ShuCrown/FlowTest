import type { Frame, Locator, Page } from "playwright";
import type { Strategy, TargetRef } from "@flowforge/dsl";
import { collectSimilarElementsFn } from "./browser-eval.js";
import { ERROR_CODES, FlowForgeError } from "./errors.js";
import type { ResolvedTargetInfo } from "./types.js";

export type LocatorRoot = Page | Frame | Locator;

export interface AttemptRecord {
  index: number;
  strategy: Strategy;
  count: number;
  visibleCount: number;
  ambiguous: boolean;
  durationMs: number;
}

export interface ResolveOptions {
  timeoutMs?: number;
  probe?: boolean;
  allowMultiple?: boolean;
  onAmbiguous?: (
    target: TargetRef,
    attempts: AttemptRecord[],
  ) => Promise<TargetRef | null>;
}

export interface ResolvedLocator {
  locator: Locator;
  info: ResolvedTargetInfo;
  attempts: AttemptRecord[];
}

export class LocatorResolver {
  private readonly defaults: ResolveOptions;

  constructor(defaults: ResolveOptions = {}) {
    this.defaults = defaults;
  }

  async resolve(
    page: Page,
    target: TargetRef,
    options: ResolveOptions = {},
  ): Promise<ResolvedLocator> {
    const merged: ResolveOptions = { ...this.defaults, ...options };
    const started = Date.now();
    const timeoutMs = merged.timeoutMs ?? 5000;
    const attempts: AttemptRecord[] = [];
    let root: LocatorRoot = page;

    if (target.frame) {
      const frame = findFrame(page, target.frame);
      if (!frame) {
        throw new FlowForgeError(
          ERROR_CODES.targetNotFound,
          `iframe 不存在: ${JSON.stringify(target.frame)}`,
          { details: { attempts } },
        );
      }
      root = frame;
    }

    if (target.scope) {
      const scopeResult = await this.resolve(page, target.scope, {
        timeoutMs,
        probe: merged.probe,
      });
      root = scopeResult.locator;
    }

    const budgetPerStrategy = Math.min(2000, Math.max(300, timeoutMs));
    for (let index = 0; index < target.strategies.length; index += 1) {
      const strategy = target.strategies[index]!;
      const attemptStart = Date.now();
      let locator: Locator;
      try {
        locator = buildLocator(root, strategy);
      } catch (error) {
        attempts.push({
          index,
          strategy,
          count: 0,
          visibleCount: 0,
          ambiguous: false,
          durationMs: Date.now() - attemptStart,
        });
        continue;
      }
      const count = await countWithRetry(locator, Math.min(budgetPerStrategy, timeoutMs));
      const visible = await visibleIndices(locator, count);
      const attempt: AttemptRecord = {
        index,
        strategy,
        count,
        visibleCount: visible.length,
        ambiguous: visible.length > 1,
        durationMs: Date.now() - attemptStart,
      };
      attempts.push(attempt);

      if (visible.length === 1) {
        return this.result(
          locator.nth(visible[0]!),
          index,
          strategy,
          count,
          started,
          attempts,
        );
      }
      if (merged.allowMultiple && visible.length > 1) {
        return this.result(locator, index, strategy, count, started, attempts);
      }
      if (visible.length > 1) {
        if (target.nth !== undefined) {
          return this.result(
            locator.nth(target.nth),
            index,
            strategy,
            count,
            started,
            attempts,
          );
        }
        if (target.strict === false) {
          return this.result(
            locator.nth(visible[0]!),
            index,
            strategy,
            count,
            started,
            attempts,
          );
        }
        if (merged.probe && merged.onAmbiguous) {
          const chosen = await merged.onAmbiguous(target, attempts);
          if (chosen) {
            return this.resolve(page, { ...chosen, strict: true }, { ...options, probe: false });
          }
        }
        continue;
      }
    }

    const similarElements = await collectSimilarElements(page, target);
    if (merged.probe && merged.onAmbiguous) {
      const chosen = await merged.onAmbiguous(target, attempts);
      if (chosen) {
        return this.resolve(page, { ...chosen, strict: true }, { ...options, probe: false });
      }
    }

    const ambiguous = attempts.some((attempt) => attempt.ambiguous);
    throw new FlowForgeError(
      ambiguous ? ERROR_CODES.targetAmbiguous : ERROR_CODES.targetNotFound,
      ambiguous
        ? `目标存在歧义: ${target.label ?? "未命名目标"}`
        : `目标未找到: ${target.label ?? "未命名目标"}`,
      {
        details: {
          attempts,
          similarElements,
          strategies: target.strategies,
        },
      },
    );
  }

  private result(
    locator: Locator,
    index: number,
    strategy: Strategy,
    count: number,
    started: number,
    attempts: AttemptRecord[],
  ): ResolvedLocator {
    return {
      locator,
      info: {
        strategy: strategyLabel(strategy),
        index,
        matchCount: count,
        durationMs: Date.now() - started,
        healed: index > 0,
        confidence: Math.max(0.5, 0.95 - index * 0.1),
      },
      attempts,
    };
  }
}

export function buildLocator(root: LocatorRoot, strategy: Strategy): Locator {
  switch (strategy.type) {
    case "testid":
      return root.getByTestId(strategy.value);
    case "role":
      return root.getByRole(strategy.role as Parameters<LocatorRoot["getByRole"]>[0], {
        name: strategy.name,
        exact: strategy.exact,
      });
    case "label":
      return root.getByLabel(strategy.value, { exact: strategy.exact });
    case "placeholder":
      return root.getByPlaceholder(strategy.value);
    case "text":
      return root.getByText(strategy.value, { exact: strategy.exact ?? true });
    case "name":
      return root.locator(`[name=${JSON.stringify(strategy.value)}]`);
    case "css":
      return root.locator(strategy.value);
    case "xpath":
      return root.locator(`xpath=${strategy.value}`);
  }
}

function strategyLabel(strategy: Strategy): string {
  switch (strategy.type) {
    case "role":
      return `role=${strategy.role}${strategy.name ? `[name=${strategy.name}]` : ""}`;
    case "testid":
      return `testid=${strategy.value}`;
    default:
      return `${strategy.type}=${"value" in strategy ? strategy.value : ""}`;
  }
}

async function countWithRetry(locator: Locator, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let count = 0;
  do {
    count = await locator.count().catch(() => 0);
    if (count > 0) return count;
    if (Date.now() >= deadline) return count;
    await sleep(100);
  } while (Date.now() < deadline);
  return count;
}

async function visibleIndices(locator: Locator, count: number): Promise<number[]> {
  const visible: number[] = [];
  const limit = Math.min(count, 50);
  for (let index = 0; index < limit; index += 1) {
    const isVisible = await locator
      .nth(index)
      .isVisible()
      .catch(() => false);
    if (isVisible) visible.push(index);
  }
  return visible;
}

export function findFrame(
  page: Page,
  frame: { urlContains?: string } | { name?: string },
): Frame | null {
  if ("name" in frame && frame.name) {
    return page.frame({ name: frame.name });
  }
  const needle = (frame as { urlContains?: string }).urlContains ?? "";
  return page.frames().find((candidate) => candidate.url().includes(needle)) ?? null;
}

async function collectSimilarElements(
  page: Page,
  target: TargetRef,
): Promise<Array<Record<string, unknown>>> {
  const wanted = (target.label ?? target.strategies.find((s) => "value" in s)?.value ?? "").toString();
  if (!wanted) return [];
  try {
    return (await page.evaluate(collectSimilarElementsFn, wanted)) as unknown as Array<
      Record<string, unknown>
    >;
  } catch {
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
