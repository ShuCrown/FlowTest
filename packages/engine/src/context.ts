import type { BrowserContext, Page } from "playwright";
import type { FlowDsl } from "@flowforge/dsl";
import { FlowForgeError } from "./errors.js";
import type { LocatorResolver } from "./locator.js";
import type { DataResolver } from "./data.js";
import type {
  ActionRecord,
  CompiledPlan,
  EngineSettings,
  NeedsConfirmHandler,
  NetworkRecord,
  NodeRecord,
  ResolvedData,
  ResolvedTargetInfo,
  RunEvent,
  RunMode,
  StageTiming,
} from "./types.js";

export interface NodeContext {
  runId: string;
  mode: RunMode;
  dsl: FlowDsl;
  plan: CompiledPlan;
  page: Page;
  pages: Map<string, Page>;
  context: BrowserContext;
  resolved: ResolvedData;
  data: DataResolver;
  resolver: LocatorResolver;
  settings: EngineSettings;
  nodeOutputs: Record<string, Record<string, unknown>>;
  signal?: AbortSignal;
  emit: (event: Omit<RunEvent, "ts">) => void;
  stage: (timing: StageTiming) => void;
  recordTarget: (info: ResolvedTargetInfo, nodeId: string) => void;
  recordAction: (action: ActionRecord) => void;
  recordNetwork: (record: NetworkRecord) => void;
  recordHealed: (nodeId: string, info: ResolvedTargetInfo) => void;
  onNeedsConfirm?: NeedsConfirmHandler;
  nodeRecord?: NodeRecord;
  pageForSystem: (systemId: string) => Page;
  resolveValue: (
    value: unknown,
    pointer: string,
    extra?: { vars?: Record<string, unknown> },
  ) => Promise<unknown>;
}

export function checkAbort(signal?: AbortSignal, stage?: string): void {
  if (signal?.aborted) {
    throw new FlowForgeError("RUN_CANCELED", "运行已取消", { stage });
  }
}
