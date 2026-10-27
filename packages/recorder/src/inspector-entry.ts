import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { Strategy, TargetRef } from "@flowforge/dsl";
import { buildLocator, findFrame } from "@flowforge/engine";
import {
  COLLECTOR_SCRIPT,
  PICK_SCRIPT,
  fingerprintToTarget,
  type ElementFingerprint,
  type RawEvent,
} from "./collector.js";

interface OpenCommand {
  type: "open";
  id: string;
  sessionId: string;
  url: string;
  profileDir: string;
  headless: boolean;
}

interface PickCommand {
  type: "pick";
  id: string;
}

interface StorageStateCommand {
  type: "storageState";
  id: string;
  path: string;
}

interface TestTargetCommand {
  type: "testTarget";
  id: string;
  target: TargetRef;
}

interface RecordingCommand {
  type: "record.start" | "record.stop";
  id: string;
  rawPath?: string;
}

interface CloseCommand {
  type: "close";
  id: string;
}

type Command =
  | OpenCommand
  | PickCommand
  | StorageStateCommand
  | TestTargetCommand
  | RecordingCommand
  | CloseCommand;

let context: BrowserContext | undefined;
let page: Page | undefined;
let sessionId: string | undefined;
let recording: { rawPath: string; count: number } | undefined;
let pickResolver: ((value: { ok: boolean; fp?: ElementFingerprint; reason?: string }) => void) | undefined;
const requests = new Map<string, (payload: Record<string, unknown>) => void>();

function reply(id: string, payload: Record<string, unknown>): void {
  process.send?.({ type: "result", id, ...payload });
}

function writeRaw(event: RawEvent): void {
  if (!recording) return;
  try {
    appendFileSync(recording.rawPath, `${JSON.stringify(event)}\n`);
    recording.count += 1;
  } catch {
    // 采集写盘失败不影响浏览器操作
  }
}

function attachPage(target: Page): void {
  target.on("framenavigated", (frame) => {
    if (frame !== target.mainFrame()) return;
    writeRaw({
      kind: "navigate",
      ts: new Date().toISOString(),
      url: frame.url(),
      source: "playwright",
    });
  });
  target.on("response", (response) => {
    const request = response.request();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) return;
    writeRaw({
      kind: "request",
      ts: new Date().toISOString(),
      method: request.method(),
      url: request.url(),
      status: response.status(),
      source: "playwright",
    });
  });
}

async function open(command: OpenCommand): Promise<void> {
  if (context) await context.close().catch(() => undefined);
  mkdirSync(command.profileDir, { recursive: true });
  context = await chromium.launchPersistentContext(command.profileDir, {
    headless: command.headless,
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  await context.exposeBinding("__ffPush", (_source, payload) => {
    writeRaw(payload as RawEvent);
  });
  await context.exposeBinding("__ffPick", (_source, payload) => {
    if (pickResolver) {
      const resolve = pickResolver;
      pickResolver = undefined;
      resolve(payload as { ok: boolean; fp?: ElementFingerprint; reason?: string });
    }
  });
  await context.addInitScript({ content: COLLECTOR_SCRIPT });
  context.on("page", (created) => {
    attachPage(created);
    if (!page) page = created;
  });
  page = context.pages()[0] ?? (await context.newPage());
  attachPage(page);
  sessionId = command.sessionId;
  await page.goto(command.url, { waitUntil: "domcontentloaded", timeout: 30000 });
  reply(command.id, {
    ok: true,
    session: {
      id: sessionId,
      url: page.url(),
      title: await page.title().catch(() => ""),
    },
  });
}

async function saveStorageState(path: string): Promise<{ ok: boolean; path: string; error?: string }> {
  if (!context) return { ok: false, path, error: "检查器未打开" };
  const state = await context.storageState();
  mkdirSync(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state), { mode: 0o600 });
  await chmod(path, 0o600);
  return { ok: true, path };
}

process.on("message", (raw: Command) => {
  void handle(raw);
});

async function handle(command: Command): Promise<void> {
  try {
    switch (command.type) {
      case "open":
        await open(command);
        return;
      case "pick": {
        if (!page) {
          reply(command.id, { ok: false, error: "检查器未打开" });
          return;
        }
        const result = await pickElement(page);
        reply(command.id, {
          ok: result.ok,
          reason: result.reason,
          fingerprint: result.fp,
          target: result.fp ? fingerprintToTarget(result.fp) : undefined,
          frameUrl: result.fp?.frameUrl,
        });
        return;
      }
      case "storageState": {
        const result = await saveStorageState(command.path);
        reply(command.id, result);
        return;
      }
      case "testTarget": {
        if (!page) {
          reply(command.id, { ok: false, error: "检查器未打开" });
          return;
        }
        const attempts: Array<{ strategy: string; count: number; error?: string }> = [];
        for (const strategy of command.target.strategies) {
          let root: Page | import("playwright").Frame | import("playwright").Locator = page;
          if (command.target.frame) {
            const frame = findFrame(page, command.target.frame);
            if (!frame) {
              attempts.push({ strategy: labelStrategy(strategy), count: 0, error: "frame not found" });
              continue;
            }
            root = frame;
          }
          if (command.target.scope) {
            const scope = buildLocator(root, command.target.scope.strategies[0]!);
            root = scope;
          }
          try {
            const locator = buildLocator(root, strategy);
            attempts.push({ strategy: labelStrategy(strategy), count: await locator.count() });
          } catch (error) {
            attempts.push({
              strategy: labelStrategy(strategy),
              count: 0,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        reply(command.id, {
          ok: attempts.some((attempt) => attempt.count === 1),
          attempts,
        });
        return;
      }
      case "record.start": {
        if (!command.rawPath) {
          reply(command.id, { ok: false, error: "缺少 rawPath" });
          return;
        }
        mkdirSync(dirname(command.rawPath), { recursive: true });
        rmSync(command.rawPath, { force: true });
        writeFileSync(command.rawPath, "", { mode: 0o600 });
        recording = { rawPath: command.rawPath, count: 0 };
        reply(command.id, { ok: true, recording: true });
        return;
      }
      case "record.stop": {
        const count = recording?.count ?? 0;
        recording = undefined;
        reply(command.id, { ok: true, count });
        return;
      }
      case "close": {
        await context?.close().catch(() => undefined);
        context = undefined;
        page = undefined;
        reply(command.id, { ok: true });
        setTimeout(() => process.exit(0), 50);
        return;
      }
    }
  } catch (error) {
    reply(command.id, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

async function pickElement(
  target: Page,
): Promise<{ ok: boolean; fp?: ElementFingerprint; reason?: string }> {
  await target.evaluate(PICK_SCRIPT);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pickResolver = undefined;
      resolve({ ok: false, reason: "pick timeout" });
    }, 60000);
    pickResolver = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
  });
}

function labelStrategy(strategy: Strategy): string {
  switch (strategy.type) {
    case "role":
      return `role=${strategy.role}${strategy.name ? `[name=${strategy.name}]` : ""}`;
    case "testid":
      return `testid=${strategy.value}`;
    default:
      return `${strategy.type}=${"value" in strategy ? strategy.value : ""}`;
  }
}

process.on("disconnect", () => {
  void context?.close().finally(() => process.exit(0));
});
process.on("uncaughtException", (error) => {
  process.send?.({ type: "worker_fatal", error: { message: error.message, stack: error.stack } });
  process.exit(1);
});

// 导出供测试复用
export { pickElement, saveStorageState };
