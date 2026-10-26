import type { Locator, Page, Response } from "playwright";
import type { SignalRef, TargetRef, WaitSignal } from "@flowforge/dsl";
import { expandSignalRef } from "@flowforge/dsl";
import { domStableElementFn, domStablePageFn } from "./browser-eval.js";
import { ERROR_CODES, FlowForgeError } from "./errors.js";

export interface WaitContext {
  page: Page;
  resolveTarget: (
    target: TargetRef,
    timeoutMs?: number,
    options?: { multiple?: boolean },
  ) => Promise<Locator>;
  resolveValue: (value: unknown) => Promise<unknown>;
  defaultTimeoutMs?: number;
  onWarning?: (message: string) => void;
}

export interface WaitResult {
  warnings: string[];
  signalKinds: string[];
  durationMs: number;
}

export interface PreparedWaits {
  wait: () => Promise<WaitResult>;
  dispose: () => void;
}

interface PreparedResponse {
  signal: Extract<WaitSignal, { kind: "response" }>;
  promise: Promise<Response>;
  timeoutMs: number;
}

export function prepareWaits(signals: SignalRef[], ctx: WaitContext): PreparedWaits {
  const preparedResponses: PreparedResponse[] = [];
  let disposed = false;
  const registerResponses = (signal: WaitSignal): void => {
    if (signal.kind === "response") {
      const timeoutMs = signal.timeoutMs ?? ctx.defaultTimeoutMs ?? 15000;
      const promise = ctx.page.waitForResponse(
        (response) => matchResponse(response, signal),
        { timeout: Math.max(timeoutMs, 1000) },
      );
      promise.catch(() => undefined);
      preparedResponses.push({ signal, promise, timeoutMs });
    }
    if (signal.kind === "all" || signal.kind === "any") {
      signal.of.forEach(registerResponses);
    }
  };

  for (const ref of signals) {
    const signal = expandSignalRef(ref);
    registerResponses(signal);
  }

  return {
    wait: async () => {
      const started = Date.now();
      const warnings: string[] = [];
      const signalKinds: string[] = [];
      for (const ref of signals) {
        const signal = expandSignalRef(ref);
        signalKinds.push(signal.kind);
        if (disposed) break;
        await runSignal(signal, ctx, preparedResponses, warnings);
      }
      return { warnings, signalKinds, durationMs: Date.now() - started };
    },
    dispose: () => {
      disposed = true;
    },
  };
}

export async function runSignal(
  signal: WaitSignal,
  ctx: WaitContext,
  preparedResponses: PreparedResponse[] = [],
  warnings: string[] = [],
): Promise<void> {
  try {
    await executeSignal(signal, ctx, preparedResponses, warnings);
  } catch (error) {
    if (signal.optional) {
      warnings.push(`可选等待 ${signal.kind} 未满足: ${errorMessage(error)}`);
      ctx.onWarning?.(warnings[warnings.length - 1]!);
      return;
    }
    throw error;
  }
}

async function executeSignal(
  signal: WaitSignal,
  ctx: WaitContext,
  preparedResponses: PreparedResponse[],
  warnings: string[],
): Promise<void> {
  const timeoutMs = signal.timeoutMs ?? ctx.defaultTimeoutMs ?? 15000;
  switch (signal.kind) {
    case "visible":
    case "hidden":
    case "attached": {
      const locator = await ctx.resolveTarget(signal.target, timeoutMs);
      await withTimeout(
        locator.waitFor({ state: signal.kind, timeout: timeoutMs }),
        timeoutMs + 500,
        `等待 ${signal.kind} 超时: ${signal.target.label ?? "目标"}`,
        signal,
      );
      return;
    }
    case "enabled": {
      const locator = await ctx.resolveTarget(signal.target, timeoutMs);
      await poll(
        async () => (await locator.isEnabled().catch(() => false)) === true,
        timeoutMs,
        `等待元素可操作超时: ${signal.target.label ?? "目标"}`,
        signal,
      );
      return;
    }
    case "count": {
      const locator = await ctx.resolveTarget(signal.target, timeoutMs, { multiple: true });
      await waitCount(locator, signal, timeoutMs);
      return;
    }
    case "text": {
      const locator = await ctx.resolveTarget(signal.target, timeoutMs);
      const expected = signal.equals !== undefined ? await ctx.resolveValue(signal.equals) : undefined;
      await poll(
        async () => {
          const text = normalizeText(await locator.innerText().catch(() => ""));
          if (signal.contains !== undefined) return text.includes(normalizeText(signal.contains));
          if (expected !== undefined) return text === normalizeText(String(expected));
          return text.length > 0;
        },
        timeoutMs,
        `等待文本条件超时: ${signal.target.label ?? "目标"}`,
        signal,
        { expected, contains: signal.contains },
      );
      return;
    }
    case "value": {
      const locator = await ctx.resolveTarget(signal.target, timeoutMs);
      const expected = String(await ctx.resolveValue(signal.equals));
      await poll(
        async () => (await locator.inputValue().catch(() => "")) === expected,
        timeoutMs,
        `等待值回读一致超时: ${signal.target.label ?? "目标"}`,
        signal,
        { expected },
      );
      return;
    }
    case "url": {
      await withTimeout(
        ctx.page.waitForURL((url) => url.toString().includes(signal.matches), { timeout: timeoutMs }),
        timeoutMs + 500,
        `等待 URL 超时: ${signal.matches}`,
        signal,
      );
      return;
    }
    case "response": {
      const prepared = preparedResponses.find((item) => sameResponseSignal(item.signal, signal));
      if (!prepared) {
        throw new FlowForgeError(
          ERROR_CODES.waitTimeout,
          "response 信号缺少预注册，无法避免竞态",
        );
      }
      try {
        await withTimeout(
          prepared.promise,
          prepared.timeoutMs + 500,
          `等待响应超时: ${signal.urlContains}`,
          signal,
        );
      } finally {
        const index = preparedResponses.indexOf(prepared);
        if (index >= 0) preparedResponses.splice(index, 1);
      }
      return;
    }
    case "domStable": {
      const quietMs = signal.quietMs ?? 200;
      const maxMs = signal.maxMs ?? 8000;
      let ok = false;
      try {
        if (signal.target) {
          const locator = await ctx.resolveTarget(signal.target, maxMs + 1000);
          ok = await locator.evaluate(domStableElementFn, { quietMs, maxMs });
        } else {
          ok = await ctx.page.evaluate(domStablePageFn, { quietMs, maxMs });
        }
      } catch (error) {
        warnings.push(`domStable 失败，按尽力而为放行: ${errorMessage(error)}`);
        ctx.onWarning?.(warnings[warnings.length - 1]!);
        return;
      }
      if (!ok) {
        warnings.push(`domStable 在 ${maxMs}ms 内未安静，按尽力而为放行`);
        ctx.onWarning?.(warnings[warnings.length - 1]!);
      }
      return;
    }
    case "loaderGone": {
      const locator = await ctx.resolveTarget(signal.target, timeoutMs);
      await withTimeout(
        locator.waitFor({ state: "hidden", timeout: timeoutMs }),
        timeoutMs + 500,
        `等待加载指示器消失超时: ${signal.target.label ?? "目标"}`,
        signal,
      );
      return;
    }
    case "all": {
      const results = await Promise.all(
        signal.of.map((child) => executeSignal(child, ctx, preparedResponses, warnings)),
      );
      return results as unknown as void;
    }
    case "any": {
      try {
        await Promise.any(
          signal.of.map((child) => executeSignal(child, ctx, preparedResponses, warnings)),
        );
      } catch {
        throw new FlowForgeError(
          ERROR_CODES.waitTimeout,
          "any 等待条件全部超时",
          { details: { signal } },
        );
      }
      return;
    }
  }
}

async function waitCount(
  locator: Locator,
  signal: Extract<WaitSignal, { kind: "count" }>,
  timeoutMs: number,
): Promise<void> {
  const stableMs = signal.stableMs ?? 0;
  let lastCount = -1;
  let stableSince = Date.now();
  await poll(
    async () => {
      const count = await locator.count().catch(() => 0);
      if (count !== lastCount) {
        lastCount = count;
        stableSince = Date.now();
      }
      if (signal.equals !== undefined && count !== signal.equals) return false;
      if (signal.min !== undefined && count < signal.min) return false;
      if (signal.max !== undefined && count > signal.max) return false;
      if (signal.equals === undefined && signal.min === undefined && signal.max === undefined) {
        return false;
      }
      return Date.now() - stableSince >= stableMs;
    },
    timeoutMs,
    `等待元素数量条件超时 (实际 ${lastCount})`,
    signal,
    { lastCount },
    100,
  );
}

async function poll(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  message: string,
  signal: WaitSignal,
  details?: unknown,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await predicate().catch(() => false)) return;
    await sleep(intervalMs);
  } while (Date.now() < deadline);
  throw new FlowForgeError(ERROR_CODES.waitTimeout, message, {
    details: { signal, ...((details as object) ?? {}) },
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  signal: WaitSignal,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new FlowForgeError(ERROR_CODES.waitTimeout, message, { details: { signal } })),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function matchResponse(
  response: Response,
  signal: Extract<WaitSignal, { kind: "response" }>,
): boolean {
  const url = response.url();
  if (!url.includes(signal.urlContains)) return false;
  if (signal.method && response.request().method() !== signal.method.toUpperCase()) return false;
  if (signal.status !== undefined) {
    const statuses = Array.isArray(signal.status) ? signal.status : [signal.status];
    if (!statuses.includes(response.status())) return false;
  }
  return true;
}

function sameResponseSignal(
  a: Extract<WaitSignal, { kind: "response" }>,
  b: Extract<WaitSignal, { kind: "response" }>,
): boolean {
  return (
    a.urlContains === b.urlContains &&
    a.method === b.method &&
    JSON.stringify(a.status) === JSON.stringify(b.status)
  );
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
