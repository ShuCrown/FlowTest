import type { FlowDsl, FlowNode } from "@flowforge/dsl";

export interface FlowSummary {
  id: string;
  name: string;
  tags: string[];
  readiness: number;
  revision: number;
  publishedVersion: number | null;
  updatedAt: string;
}

export interface FlowDetail extends FlowSummary {
  dsl: FlowDsl;
  layout: Layout | null;
  createdAt: string;
}

export interface Layout {
  nodes: Record<string, { x: number; y: number }>;
  viewport?: { x: number; y: number; zoom: number };
}

export interface SystemRow {
  id: string;
  name: string;
  baseUrl: string;
  auth?: { kind: string; path?: string; env?: string };
  allowedOrigins?: string[];
  createdAt?: string;
}

export interface InspectorSession {
  id: string;
  systemId: string;
  url: string;
  headless: boolean;
  status: "opening" | "open" | "closed";
  openedAt: string;
  lastPick?: {
    target: import("@flowforge/dsl").TargetRef;
    fingerprint?: unknown;
    frameUrl?: string;
  };
}

export interface RunRow {
  id: string;
  batchId: string | null;
  flowId: string;
  flowVersionId: string | null;
  datasetId: string | null;
  mode: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  artifactDir: string | null;
  seed: number | null;
  error: { code: string; message: string } | null;
  metrics: {
    browserColdStart: boolean;
    browserLaunchMs: number;
    blockedRequests: number;
  } | null;
  createdAt: string;
}

export interface RunNode {
  nodeId: string;
  nodeType: string;
  index: number;
  status: string;
  durationMs: number;
  resolvedTarget: {
    strategy: string;
    index: number;
    matchCount: number;
    durationMs: number;
    healed: boolean;
    confidence: number;
  } | null;
  stageTimings: Array<{
    stage: string;
    durationMs: number;
    signal?: string;
    status: string;
    detail?: string;
  }>;
  error: { code: string; message: string; stage?: string; details?: unknown } | null;
  screenshotPath: string | null;
}

export interface RunAction {
  nodeId: string;
  field: string;
  expected: unknown;
  actual: unknown;
  valueSource: string | null;
  status: string;
  durationMs: number;
}

export interface RunNetwork {
  nodeId: string | null;
  method: string;
  url: string;
  status: number | null;
  reqBody: unknown;
  respSnippet: string | null;
  redacted: boolean;
}

export interface RunDetail extends RunRow {
  resolvedData: {
    datasetId: string | null;
    datasetName?: string;
    values: Record<string, unknown>;
    vars: Record<string, unknown>;
    provenance: Record<string, unknown>;
    seed: number;
  } | null;
  compiledPlanPath: string | null;
  nodes: RunNode[];
  events: Array<{
    seq: number;
    ts: string;
    nodeId: string | null;
    type: string;
    level: string | null;
    payload: unknown;
  }>;
  actions: RunAction[];
  network: RunNetwork[];
  pendingConfirms?: Array<{
    requestId: string;
    nodeId: string | null;
    kind: string;
    options: {
      message?: string;
      target?: import("@flowforge/dsl").TargetRef;
      candidates?: Array<{ strategy: string; count: number; similarElements?: unknown[] }>;
    };
    expiresAt: string;
  }>;
}

export interface RecordingRow {
  id: string;
  systemId: string;
  eventsCount: number;
  status: string;
  ruleVersion: string | null;
  createdAt: string;
}

export interface RecordingDetail extends RecordingRow {
  events: unknown[];
  clusters: unknown[];
}

export interface Settings {
  nodeTimeoutMs: number;
  pickerTimeoutMs: number;
  screenshot: "onFailure" | "always" | "never";
  trace: boolean;
  resourcePolicy: "balanced" | "fast" | "accurate";
  headless: boolean;
  retentionDays: number;
  aiEnabled: boolean;
}

export type FlowNodeType = FlowNode["type"];
