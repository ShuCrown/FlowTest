import { fork, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FlowDsl } from "@flowforge/dsl";
import type { RunResult } from "@flowforge/engine";
import type { RunBroker } from "./events.js";
import type { LedgerService } from "./services/ledger.js";
import type { Store } from "./services/store.js";

export interface RunJob {
  runId: string;
  flowId: string;
  flowVersionId: string | null;
  dsl: FlowDsl;
  mode: "probe" | "single" | "matrix" | "replay";
  datasetId?: string;
  batchId?: string;
  settings: {
    artifactDir: string;
    headless: boolean;
    env: Record<string, string | undefined>;
    nodeTimeoutMs?: number;
    pickerTimeoutMs?: number;
    screenshot?: "onFailure" | "always" | "never";
    trace?: boolean;
    resourcePolicy?: "balanced" | "fast" | "accurate";
    stopAtNodeId?: string;
  };
}

const BUILT_WORKER = fileURLToPath(
  new URL("../../../packages/engine/dist/worker-entry.js", import.meta.url),
);
const DEV_WORKER = fileURLToPath(
  new URL("../../../packages/engine/src/worker-entry.ts", import.meta.url),
);
const WORKER_ENTRY = existsSync(BUILT_WORKER) ? BUILT_WORKER : DEV_WORKER;
const WORKER_EXEC_ARGV = WORKER_ENTRY.endsWith(".ts") ? ["--import", "tsx"] : [];

/**
 * 串行运行队列 + 懒启动 Run Worker。
 * API 不驱动浏览器；worker 通过 IPC 请求唯一值预留与序列递增。
 */
export class RunQueue {
  private child?: ChildProcess;
  private readonly jobs: RunJob[] = [];
  private current?: RunJob;
  private closed = false;

  constructor(
    private readonly deps: {
      store: Store;
      broker: RunBroker;
      ledger: LedgerService;
      dataDir: string;
      onComplete?: (job: RunJob, result: RunResult | null, error?: unknown) => void;
    },
  ) {}

  enqueue(job: RunJob): void {
    this.deps.store.updateRunStatus(job.runId, "queued");
    this.jobs.push(job);
    this.drain();
  }

  enqueueBatch(jobs: RunJob[]): void {
    for (const job of jobs) {
      this.deps.store.updateRunStatus(job.runId, "queued");
      this.jobs.push(job);
    }
    this.drain();
  }

  cancel(runId: string): boolean {
    const index = this.jobs.findIndex((job) => job.runId === runId);
    if (index >= 0) {
      this.jobs.splice(index, 1);
      this.deps.store.updateRunStatus(runId, "canceled", {
        finishedAt: new Date().toISOString(),
      });
      return true;
    }
    if (this.current?.runId === runId) {
      this.child?.send({ type: "cancel", runId });
      return true;
    }
    return false;
  }

  activeRunId(): string | undefined {
    return this.current?.runId;
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    this.jobs.length = 0;
    const child = this.child;
    this.child = undefined;
    if (child) {
      child.send({ type: "shutdown" });
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 3000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  private drain(): void {
    if (this.closed || this.current) return;
    const job = this.jobs.shift();
    if (!job) return;
    this.current = job;
    const child = this.ensureWorker();
    if (!child) {
      this.failJob(job, new Error("Run Worker 启动失败"));
      return;
    }
    this.deps.store.updateRunStatus(job.runId, "preparing", {
      startedAt: new Date().toISOString(),
    });
    child.send({
      type: "run",
      runId: job.runId,
      dsl: job.dsl,
      mode: job.mode,
      datasetId: job.datasetId,
      settings: job.settings,
    });
  }

  private ensureWorker(): ChildProcess | undefined {
    if (this.child?.connected) return this.child;
    if (this.closed) return undefined;
    try {
      const child = fork(WORKER_ENTRY, [], {
        execArgv: WORKER_EXEC_ARGV,
        stdio: ["ignore", "inherit", "inherit", "ipc"],
        env: process.env,
      });
      child.on("message", (message: Record<string, unknown>) => {
        void this.onMessage(message);
      });
      child.on("exit", (code) => {
        if (this.child === child) this.child = undefined;
        if (this.current) {
          const job = this.current;
          this.current = undefined;
          this.deps.store.updateRunStatus(job.runId, "failed", {
            finishedAt: new Date().toISOString(),
            error: {
              code: "WORKER_CRASHED",
              message: `Run Worker 退出（code=${code}）`,
            },
          });
          this.deps.onComplete?.(job, null, new Error("worker exited"));
          this.drain();
        }
      });
      child.on("error", (error) => {
        process.stderr.write(`[worker] ${error.message}\n`);
      });
      this.child = child;
      return child;
    } catch (error) {
      process.stderr.write(`[queue] fork worker failed: ${String(error)}\n`);
      return undefined;
    }
  }

  private async onMessage(message: Record<string, unknown>): Promise<void> {
    const type = String(message.type);
    if (type === "ledger.reserve") {
      const ok = await this.deps.ledger.reserve(
        String(message.systemId),
        String(message.scope),
        String(message.value),
        String(message.runId),
      );
      this.child?.send({ type: "ledger.result", id: message.id, ok });
      return;
    }
    if (type === "seq.next") {
      const value = await this.deps.ledger.nextSequence(
        String(message.systemId),
        String(message.scope),
      );
      this.child?.send({ type: "seq.result", id: message.id, value });
      return;
    }
    const job = this.current;
    if (!job || message.runId !== job.runId) return;

    if (type === "event") {
      const event = message.event as {
        type: string;
        ts: string;
        nodeId?: string;
        level?: string;
        payload?: unknown;
      };
      const seq = this.deps.store.insertRunEvent(job.runId, event);
      if (event.type === "run.started") {
        this.deps.store.updateRunStatus(job.runId, "running");
      }
      this.deps.broker.publish({
        runId: job.runId,
        seq,
        ts: event.ts,
        type: event.type,
        nodeId: event.nodeId,
        level: event.level,
        payload: event.payload,
      });
      return;
    }
    if (type === "done") {
      const result = message.result as RunResult;
      this.deps.store.saveRunResult(result);
      this.finishJob(job, result);
      this.deps.onComplete?.(job, result);
      this.finishBatch(job);
      this.current = undefined;
      this.drain();
      return;
    }
    if (type === "run_failed") {
      const error = message.error as { code?: string; message?: string; details?: unknown };
      this.deps.store.updateRunStatus(job.runId, "failed", {
        finishedAt: new Date().toISOString(),
        error,
      });
      this.deps.onComplete?.(job, null, error);
      this.finishBatch(job);
      this.current = undefined;
      this.drain();
      return;
    }
  }

  private failJob(job: RunJob, error: unknown): void {
    this.deps.store.updateRunStatus(job.runId, "failed", {
      finishedAt: new Date().toISOString(),
      error: {
        code: "WORKER_UNAVAILABLE",
        message: error instanceof Error ? error.message : String(error),
      },
    });
    this.deps.onComplete?.(job, null, error);
    this.current = undefined;
    this.drain();
  }

  private finishJob(job: RunJob, result: RunResult): void {
    // 结果已由 store.saveRunResult 落库，这里只保留扩展点
    void job;
    void result;
  }

  private finishBatch(job: RunJob): void {
    if (!job.batchId) return;
    const runs = this.deps.store.listRuns({ batchId: job.batchId, limit: 500 });
    const terminal = new Set(["finished", "failed", "canceled"]);
    if (runs.every((run) => terminal.has(run.status))) {
      const summary = {
        total: runs.length,
        passed: runs.filter((run) => run.status === "finished").length,
        failed: runs.filter((run) => run.status === "failed").length,
        canceled: runs.filter((run) => run.status === "canceled").length,
      };
      const status = summary.failed > 0 ? "failed" : summary.canceled > 0 ? "canceled" : "finished";
      this.deps.store.updateBatch(job.batchId, status, summary);
    }
  }
}
