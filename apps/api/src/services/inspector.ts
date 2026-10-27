import { existsSync, statSync } from "node:fs";
import { fork, type ChildProcess } from "node:child_process";
import { join, resolve } from "node:path";
import type { SystemConfig, TargetRef } from "@flowforge/dsl";
import { ApiError } from "../lib/errors.js";
import { newId } from "../lib/ids.js";

const BUILT_WORKER = resolve(process.cwd(), "packages/recorder/dist/inspector-entry.js");
const DEV_WORKER = resolve(process.cwd(), "packages/recorder/src/inspector-entry.ts");
const WORKER_ENTRY = pickNewer(BUILT_WORKER, DEV_WORKER);
const WORKER_EXEC_ARGV = WORKER_ENTRY.endsWith(".ts") ? ["--import", "tsx"] : [];

function pickNewer(built: string, dev: string): string {
  const builtExists = existsSync(built);
  const devExists = existsSync(dev);
  if (builtExists && devExists) {
    return statSync(built).mtimeMs >= statSync(dev).mtimeMs ? built : dev;
  }
  return builtExists ? built : dev;
}

export interface InspectorSession {
  id: string;
  systemId: string;
  url: string;
  headless: boolean;
  status: "opening" | "open" | "closed";
  lastPick?: {
    target: TargetRef;
    fingerprint?: unknown;
    frameUrl?: string;
  };
  openedAt: string;
}

interface PendingRequest {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Inspector Worker：headed Chromium、元素拾取、手动登录会话、target 试探。
 * 同一时间只维护一个检查器会话。
 */
export class InspectorService {
  private child?: ChildProcess;
  private session?: InspectorSession;
  private readonly pending = new Map<string, PendingRequest>();
  private counter = 0;

  constructor(private readonly dataDir: string) {}

  current(): InspectorSession | undefined {
    return this.session;
  }

  async open(options: {
    system: SystemConfig;
    path?: string;
    headless?: boolean;
  }): Promise<InspectorSession> {
    if (this.session && this.session.status === "open") {
      if (this.session.systemId === options.system.id) return this.session;
      throw new ApiError(
        409,
        "INSPECTOR_BUSY",
        `检查器已打开另一个系统: ${this.session.systemId}`,
      );
    }
    const id = newId("insp");
    const url = new URL(options.path ?? "/", options.system.baseUrl).toString();
    const headless = options.headless ?? !process.env.DISPLAY;
    this.session = {
      id,
      systemId: options.system.id,
      url,
      headless,
      status: "opening",
      openedAt: new Date().toISOString(),
    };
    const child = this.ensureWorker();
    const result = await this.request(
      {
        type: "open",
        sessionId: id,
        url,
        profileDir: resolve(this.dataDir, "sessions", options.system.id, "profile"),
        headless,
      },
      45000,
    );
    if (!result.ok) {
      this.session.status = "closed";
      throw new ApiError(500, "INSPECTOR_OPEN_FAILED", String(result.error ?? "检查器打开失败"));
    }
    this.session.status = "open";
    const session = result.session as { url?: string } | undefined;
    if (session?.url) this.session.url = session.url;
    void child;
    return this.session;
  }

  async pick(sessionId: string): Promise<{
    ok: boolean;
    reason?: string;
    target?: TargetRef;
    fingerprint?: unknown;
    frameUrl?: string;
  }> {
    this.assertSession(sessionId);
    const result = await this.request({ type: "pick" }, 70000);
    if (result.ok && result.target) {
      this.session!.lastPick = {
        target: result.target as TargetRef,
        fingerprint: result.fingerprint,
        frameUrl: result.frameUrl as string | undefined,
      };
    }
    return {
      ok: Boolean(result.ok),
      reason: result.reason as string | undefined,
      target: result.target as TargetRef | undefined,
      fingerprint: result.fingerprint,
      frameUrl: result.frameUrl as string | undefined,
    };
  }

  async testTarget(
    sessionId: string,
    target: TargetRef,
  ): Promise<{ ok: boolean; attempts: Array<{ strategy: string; count: number; error?: string }> }> {
    this.assertSession(sessionId);
    const result = await this.request({ type: "testTarget", target }, 15000);
    return {
      ok: Boolean(result.ok),
      attempts: (result.attempts as Array<{ strategy: string; count: number; error?: string }>) ?? [],
    };
  }

  async saveStorageState(systemId: string): Promise<string> {
    this.assertSession(this.session?.id ?? "");
    const path = resolve(this.dataDir, "sessions", systemId, "storageState.json");
    const result = await this.request({ type: "storageState", path }, 15000);
    if (!result.ok) {
      throw new ApiError(500, "SESSION_SAVE_FAILED", String(result.error ?? "保存会话失败"));
    }
    return path;
  }

  async startRecording(rawPath: string): Promise<void> {
    this.assertSession(this.session?.id ?? "");
    const result = await this.request({ type: "record.start", rawPath }, 15000);
    if (!result.ok) {
      throw new ApiError(500, "RECORD_START_FAILED", String(result.error ?? "录制启动失败"));
    }
  }

  async stopRecording(): Promise<{ count: number }> {
    if (!this.child) return { count: 0 };
    const result = await this.request({ type: "record.stop" }, 15000);
    return { count: Number(result.count ?? 0) };
  }

  async close(): Promise<void> {
    const session = this.session;
    const child = this.child;
    if (!session) return;
    try {
      if (child?.connected) {
        await this.request({ type: "close" }, 10000);
        await new Promise<void>((resolve) => {
          if (!child.connected) return resolve();
          const timer = setTimeout(() => resolve(), 3000);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    } catch {
      // 忽略关闭失败
    }
    if (child?.connected) child.kill();
    if (this.child === child) this.child = undefined;
    this.session = { ...session, status: "closed" };
  }

  async shutdown(): Promise<void> {
    await this.close();
  }

  private assertSession(sessionId: string): void {
    if (!this.session || this.session.id !== sessionId || this.session.status !== "open") {
      throw new ApiError(404, "INSPECTOR_NOT_OPEN", "检查器会话不存在或已关闭");
    }
    if (!this.child?.connected) {
      throw new ApiError(409, "INSPECTOR_DISCONNECTED", "检查器进程已退出");
    }
  }

  private ensureWorker(): ChildProcess {
    if (this.child?.connected) return this.child;
    const child = fork(WORKER_ENTRY, [], {
      execArgv: WORKER_EXEC_ARGV,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      env: process.env,
    });
    child.on("message", (message: Record<string, unknown>) => {
      if (message.type !== "result") return;
      const id = String(message.id);
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.resolve(message);
    });
    child.on("exit", () => {
      if (this.child === child) this.child = undefined;
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new ApiError(409, "INSPECTOR_DISCONNECTED", "检查器进程已退出"));
        this.pending.delete(id);
      }
      if (this.session && this.session.status === "open") {
        this.session.status = "closed";
      }
    });
    this.child = child;
    return child;
  }

  private request(payload: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    const child = this.ensureWorker();
    const id = `insp_req_${++this.counter}`;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ApiError(504, "INSPECTOR_TIMEOUT", `检查器请求超时: ${String(payload.type)}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      child.send({ ...payload, id });
    });
  }
}

export function sessionRawPath(dataDir: string, recordingId: string): string {
  return join(dataDir, "recordings", `${recordingId}.jsonl`);
}
