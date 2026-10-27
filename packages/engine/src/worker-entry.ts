import type { FlowDsl, TargetRef } from "@flowforge/dsl";
import { runFlow, sharedBrowserPool, type Ledger, type RunResult } from "./index.js";

interface RunMessage {
  type: "run";
  runId: string;
  dsl: FlowDsl;
  mode: "probe" | "single" | "matrix" | "replay";
  datasetId?: string;
  settings: {
    artifactDir: string;
    headless?: boolean;
    env?: Record<string, string | undefined>;
    nodeTimeoutMs?: number;
    pickerTimeoutMs?: number;
    screenshot?: "onFailure" | "always" | "never";
    trace?: boolean;
    resourcePolicy?: "balanced" | "fast" | "accurate";
    stopAtNodeId?: string;
  };
}

interface LedgerReply {
  type: "ledger.result" | "seq.result";
  id: string;
  ok?: boolean;
  value?: number;
}

type Inbound =
  | RunMessage
  | { type: "cancel"; runId: string }
  | { type: "shutdown" }
  | { type: "confirm.result"; requestId: string; target: TargetRef | null }
  | LedgerReply;

let controller: AbortController | undefined;
let running: string | undefined;
let counter = 0;
const pending = new Map<string, (reply: LedgerReply) => void>();
const pendingConfirms = new Map<string, (target: TargetRef | null) => void>();

function send(message: unknown): void {
  process.send?.(message);
}

function request<T extends LedgerReply>(message: Record<string, unknown>): Promise<T> {
  const id = `ipc_${++counter}`;
  return new Promise<T>((resolve) => {
    pending.set(id, resolve as (reply: LedgerReply) => void);
    send({ ...message, id });
  });
}

const ledger: Ledger = {
  async reserve(systemId, scope, value, runId) {
    const reply = await request<LedgerReply>({
      type: "ledger.reserve",
      systemId,
      scope,
      value,
      runId,
    });
    return reply.ok === true;
  },
  async nextSequence(systemId, scope) {
    const reply = await request<LedgerReply>({
      type: "seq.next",
      systemId,
      scope,
    });
    return reply.value ?? 1;
  },
};

async function handleRun(message: RunMessage): Promise<void> {
  running = message.runId;
  controller = new AbortController();
  try {
    const result: RunResult = await runFlow({
      runId: message.runId,
      dsl: message.dsl,
      mode: message.mode,
      datasetId: message.datasetId,
      settings: {
        ...message.settings,
        headless: message.settings.headless ?? true,
        env: message.settings.env ?? process.env,
      },
      ledger,
      signal: controller.signal,
      onEvent: (event) => send({ type: "event", runId: message.runId, event }),
      onNode: (node) => send({ type: "node", runId: message.runId, node }),
      onAction: (action) => send({ type: "action", runId: message.runId, action }),
      onNetwork: (record) => send({ type: "network", runId: message.runId, record }),
      onNeedsConfirm: async (requestInfo) => {
        const requestId = `cf_${++counter}`;
        send({ type: "needs_confirm", runId: message.runId, requestId, request: requestInfo });
        return new Promise<TargetRef | null>((resolve) => {
          const timer = setTimeout(() => {
            pendingConfirms.delete(requestId);
            resolve(null);
          }, 5 * 60 * 1000);
          pendingConfirms.set(requestId, (target) => {
            clearTimeout(timer);
            pendingConfirms.delete(requestId);
            resolve(target);
          });
        });
      },
    });
    send({ type: "done", runId: message.runId, result });
  } catch (error) {
    send({
      type: "run_failed",
      runId: message.runId,
      error: {
        code: (error as { code?: string }).code ?? "WORKER_ERROR",
        message: error instanceof Error ? error.message : String(error),
        details: (error as { details?: unknown }).details,
      },
    });
  } finally {
    running = undefined;
    controller = undefined;
  }
}

process.on("message", (message: Inbound) => {
  if (message.type === "ledger.result" || message.type === "seq.result") {
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
    return;
  }
  if (message.type === "run") {
    void handleRun(message);
    return;
  }
  if (message.type === "cancel" && running === message.runId) {
    controller?.abort();
  }
  if (message.type === "confirm.result") {
    const resolve = pendingConfirms.get(message.requestId);
    if (resolve) {
      resolve(message.target);
    }
    return;
  }
  if (message.type === "shutdown") {
    controller?.abort();
    void sharedBrowserPool.close().finally(() => process.exit(0));
  }
});

process.on("disconnect", () => {
  void sharedBrowserPool.close().finally(() => process.exit(0));
});

process.on("uncaughtException", (error) => {
  send({ type: "worker_fatal", error: { message: error.message, stack: error.stack } });
  process.exit(1);
});
