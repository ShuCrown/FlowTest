import type { FlowDsl, TargetRef, WaitSignal } from "@flowforge/dsl";

export type RunMode = "probe" | "single" | "matrix" | "replay";
export type RunStatus = "queued" | "preparing" | "running" | "finished" | "failed" | "canceled";
export type NodeStatus = "pending" | "running" | "pass" | "fail" | "skipped" | "healed";
export type ResourcePolicy = "balanced" | "fast" | "accurate";

export interface EngineSettings {
  artifactDir: string;
  headless?: boolean;
  env?: Record<string, string | undefined>;
  nodeTimeoutMs?: number;
  pickerTimeoutMs?: number;
  screenshot?: "onFailure" | "always" | "never";
  trace?: boolean;
  resourcePolicy?: ResourcePolicy;
  stopAtNodeId?: string;
  keepContextMs?: number;
}

export interface Ledger {
  reserve(systemId: string, scope: string, value: string, runId: string): Promise<boolean>;
  nextSequence(systemId: string, scope: string): Promise<number>;
}

export interface ProvenanceEntry {
  source: string;
  scope?: string;
  ledgerKey?: string;
  generator?: string;
  seed?: number;
}

export interface ResolvedData {
  datasetId: string | null;
  datasetName?: string;
  values: Record<string, unknown>;
  vars: Record<string, unknown>;
  provenance: Record<string, ProvenanceEntry>;
  seed: number;
  secretFields: string[];
}

export interface StageTiming {
  stage: string;
  durationMs: number;
  signal?: string;
  status: "completed" | "failed" | "warning";
  detail?: string;
}

export interface ResolvedTargetInfo {
  strategy: string;
  index: number;
  matchCount: number;
  durationMs: number;
  healed: boolean;
  confidence: number;
}

export interface NodeRecord {
  nodeId: string;
  nodeType: string;
  index: number;
  name?: string;
  status: NodeStatus;
  durationMs: number;
  resolvedTarget?: ResolvedTargetInfo;
  stageTimings: StageTiming[];
  error?: EngineErrorPayload;
  screenshotPath?: string;
}

export interface ActionRecord {
  nodeId: string;
  field: string;
  expected?: unknown;
  actual?: unknown;
  valueSource?: string;
  status: "pass" | "fail";
  durationMs: number;
}

export interface NetworkRecord {
  nodeId?: string;
  method: string;
  url: string;
  status?: number;
  reqBody?: unknown;
  respSnippet?: string;
  redacted?: boolean;
}

export interface EngineErrorPayload {
  code: string;
  message: string;
  nodeId?: string;
  stage?: string;
  pointer?: string;
  details?: unknown;
}

export interface RunEvent {
  type:
    | "run.started"
    | "run.finished"
    | "node.started"
    | "node.finished"
    | "node.stage"
    | "healed"
    | "needs_confirm"
    | "assert.failed"
    | "wait.timeout"
    | "api.call"
    | "duplicate.detected"
    | "run.rewind"
    | "run.error"
    | "warning";
  nodeId?: string;
  level?: "info" | "warning" | "error";
  payload?: Record<string, unknown>;
  ts: string;
}

export interface NeedsConfirmRequest {
  runId: string;
  nodeId: string;
  kind: "target-ambiguous" | "target-missing" | "value-missing";
  target?: TargetRef;
  message: string;
  candidates: Array<{
    strategy: string;
    count: number;
    screenshotPath?: string;
    similarElements?: Array<Record<string, unknown>>;
  }>;
}

export type NeedsConfirmHandler = (request: NeedsConfirmRequest) => Promise<TargetRef | null>;

export interface RunOptions {
  runId: string;
  dsl: FlowDsl;
  mode: RunMode;
  datasetId?: string;
  settings: EngineSettings;
  ledger: Ledger;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
  onNode?: (node: NodeRecord) => void;
  onAction?: (action: ActionRecord) => void;
  onNetwork?: (record: NetworkRecord) => void;
  onNeedsConfirm?: NeedsConfirmHandler;
}

export interface RunMetrics {
  browserColdStart: boolean;
  browserLaunchMs: number;
  blockedRequests: number;
}

export interface RunResult {
  runId: string;
  status: Exclude<RunStatus, "queued" | "preparing" | "running">;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  datasetId: string | null;
  mode: RunMode;
  resolvedData: ResolvedData;
  nodes: NodeRecord[];
  actions: ActionRecord[];
  network: NetworkRecord[];
  error?: EngineErrorPayload;
  artifactDir: string;
  seed: number;
  readinessLevel: number;
  metrics: RunMetrics;
}

export interface CompiledNode {
  nodeId: string;
  type: string;
  pre: WaitSignal[];
  expect: WaitSignal[];
  readySignal?: WaitSignal;
}

export interface CompiledPlan {
  dsl: FlowDsl;
  entry: string;
  datasetId?: string;
  mode: RunMode;
  nodes: Record<string, CompiledNode>;
  outgoing: Record<string, Array<{ to: string; when?: "then" | "else" }>>;
  readinessLevel: number;
  warnings: string[];
  compiledAt: string;
}
