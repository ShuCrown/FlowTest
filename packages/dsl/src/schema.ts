import { z } from "zod";

export const PRESET_NAMES = [
  "page-ready",
  "content-stable",
  "list-ready",
  "dialog-ready",
  "option-ready",
  "save-ready",
] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

export type Strategy =
  | { type: "testid"; value: string }
  | { type: "role"; role: string; name?: string; exact?: boolean }
  | { type: "label"; value: string; exact?: boolean }
  | { type: "placeholder"; value: string }
  | { type: "text"; value: string; exact?: boolean }
  | { type: "name"; value: string }
  | { type: "css"; value: string }
  | { type: "xpath"; value: string };

export type TargetFingerprint = {
  tag?: string;
  role?: string;
  visibleText?: string;
  anchorText?: string;
  testid?: string;
  name?: string;
  placeholder?: string;
};

export interface TargetRef {
  label?: string;
  strategies: Strategy[];
  fingerprint?: TargetFingerprint;
  strict?: boolean;
  nth?: number;
  scope?: TargetRef;
  frame?: { urlContains?: string } | { name?: string };
}

export interface WaitBase {
  timeoutMs?: number;
  optional?: boolean;
}

export type WaitSignal =
  | (WaitBase & {
      kind: "visible" | "hidden" | "attached" | "enabled";
      target: TargetRef;
    })
  | (WaitBase & {
      kind: "count";
      target: TargetRef;
      min?: number;
      max?: number;
      equals?: number;
      stableMs?: number;
    })
  | (WaitBase & {
      kind: "text";
      target: TargetRef;
      equals?: ValueLike;
      contains?: string;
    })
  | (WaitBase & {
      kind: "value";
      target: TargetRef;
      equals: ValueLike;
    })
  | (WaitBase & { kind: "url"; matches: string })
  | (WaitBase & {
      kind: "response";
      urlContains: string;
      method?: string;
      status?: number | number[];
    })
  | (WaitBase & { kind: "domStable"; target?: TargetRef; quietMs?: number; maxMs?: number })
  | (WaitBase & { kind: "loaderGone"; target: TargetRef })
  | (WaitBase & { kind: "all" | "any"; of: WaitSignal[] });

export type SignalRef = WaitSignal | PresetName;

export type GeneratorType =
  | "unique.text"
  | "unique.email"
  | "unique.phone"
  | "unique.orderNo"
  | "faker.name"
  | "faker.email"
  | "faker.phone"
  | "faker.company"
  | "faker.idCard"
  | "sequence";

export type ValueExpr =
  | { kind: "literal"; value: unknown }
  | { kind: "var"; name: string }
  | { kind: "template"; template: string }
  | { kind: "dataset"; column: string }
  | { kind: "env"; name: string }
  | {
      kind: "ref";
      nodeId: string;
      output: "value" | "text" | "attribute";
      attribute?: string;
    }
  | {
      kind: "generator";
      type: GeneratorType;
      scope?: string;
      template?: string;
      unique?: boolean;
      options?: Record<string, unknown>;
    };

/** 输入允许普通标量、数组与 `{ gen: "..." }` 简写，normalize 后统一为 ValueExpr。 */
export type ValueLike =
  | ValueExpr
  | string
  | number
  | boolean
  | null
  | unknown[]
  | { gen: string };

export type Condition =
  | {
      op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "notContains";
      left: ConditionOperand;
      right: ConditionOperand;
    }
  | { op: "in"; left: ConditionOperand; values: ConditionOperand[] }
  | { op: "exists"; left: ConditionOperand }
  | { op: "and" | "or"; of: Condition[] }
  | { op: "not"; of: Condition };

export type ConditionOperand =
  | { column: string }
  | { var: string }
  | { value: unknown };

export interface SystemConfig {
  id: string;
  name: string;
  baseUrl: string;
  auth?:
    | { kind: "none" }
    | { kind: "storageState"; path?: string; env?: string }
    | { kind: "login"; env?: string };
  allowedOrigins?: string[];
}

export interface FlowMeta {
  name: string;
  description?: string;
  tags?: string[];
}

export interface NodeMeta {
  sourceText?: string;
  needsConfirm?: boolean;
  notes?: string;
  [key: string]: unknown;
}

export interface NodeBase {
  id: string;
  type: string;
  name?: string;
  system?: string;
  enabled?: boolean;
  timeoutMs?: number;
  pre?: SignalRef[];
  expect?: SignalRef[];
  meta?: NodeMeta;
}

export interface NavigateNode extends NodeBase {
  type: "navigate";
  system: string;
  url: string;
  waitUntil?: "commit" | "domcontentloaded" | "load";
  readySignal?: SignalRef;
}

export type InteractAdapter =
  | "input"
  | "click"
  | "check"
  | "select"
  | "press"
  | "upload"
  | "hover"
  | "nativeSelect";

export interface InteractNode extends NodeBase {
  type: "interact";
  system: string;
  adapter: InteractAdapter;
  target: TargetRef;
  value?: ValueLike;
  checked?: boolean;
  key?: string;
  verify?: "readBack" | "none";
}

export interface PickerFilterStep {
  adapter: "input" | "click" | "check" | "nativeSelect";
  target: TargetRef;
  value?: ValueLike;
  checked?: boolean;
}

export interface PickerPanel {
  scope: { type: "dropdown" | "dialog"; name?: string; target?: TargetRef };
  readySignal?: SignalRef;
  optionResponse?: { urlContains: string; method?: "GET" | "POST"; status?: number };
}

export interface PickerPick {
  strategy: "byText" | "byRow" | "byCondition" | "all";
  byText?: {
    column?: string;
    value?: ValueLike;
    match?: "exact" | "contains";
  };
  byRow?: {
    keyColumn: string;
    keyValue?: ValueLike;
    rowTarget?: TargetRef;
    clickTarget?: TargetRef;
  };
  byCondition?: { columns: Record<string, TargetRef>; condition: Condition };
  multi?: boolean;
}

export interface PickerNode extends NodeBase {
  type: "picker";
  system: string;
  mode: "inline" | "dialog";
  trigger: TargetRef;
  panel: PickerPanel;
  filter?: { steps: PickerFilterStep[] };
  pick: PickerPick;
  commit?: { adapter: "click"; target: TargetRef; waitHidden?: boolean };
  stageTimeouts?: {
    openMs?: number;
    panelMs?: number;
    filterMs?: number;
    refreshMs?: number;
    pickMs?: number;
    commitMs?: number;
  };
}

export interface WaitNode extends NodeBase {
  type: "wait";
  condition: SignalRef;
  message?: string;
}

export interface AssertNode extends NodeBase {
  type: "assert";
  condition: SignalRef;
  message?: string;
}

export interface BranchNode extends NodeBase {
  type: "branch";
  condition: Condition;
}

export interface ApiNode extends NodeBase {
  type: "api";
  system: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  body?: ValueLike;
  expectStatus?: number | number[];
  extract?: Record<string, string>;
}

export type FlowNode =
  | NavigateNode
  | InteractNode
  | PickerNode
  | WaitNode
  | AssertNode
  | BranchNode
  | ApiNode;

export type FlowNodeType = FlowNode["type"];

export interface FlowEdge {
  from: string;
  to: string;
  when?: "then" | "else";
}

export interface Dataset {
  id: string;
  name: string;
  columns: Record<string, ValueLike>;
  meta?: Record<string, unknown>;
}

export type Constraint =
  | { type: "equals"; left: string; right: string }
  | {
      type: "derive";
      target: string;
      from: string;
      op: "localPart" | "domain" | "prefix" | "suffix" | "concat" | "hash";
      template?: string;
    }
  | { type: "unique"; field: string; gen?: string }
  | { type: "range"; field: string; min?: number | string; max?: number | string }
  | { type: "regex"; field: string; pattern: string }
  | { type: "oneOf"; field: string; values: unknown[] };

export interface DuplicatePolicy {
  detect: WaitSignal[];
  rewindTo: string;
  regenerate?: string[];
  maxAttempts?: number;
}

export interface FlowDefaults {
  nodeTimeoutMs?: number;
  pickerTimeoutMs?: number;
  screenshot?: "onFailure" | "always" | "never";
  resourcePolicy?: "balanced" | "fast" | "accurate";
  trace?: boolean;
  onDuplicate?: DuplicatePolicy;
}

export interface FlowDsl {
  dslVersion: "1.0";
  meta: FlowMeta;
  systems: SystemConfig[];
  defaults?: FlowDefaults;
  vars?: Record<string, ValueLike>;
  datasets?: Dataset[];
  constraints?: Constraint[];
  secretFields?: string[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  entry: string;
}

export const StrategySchema: z.ZodType<Strategy> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("testid"), value: z.string().min(1) }),
  z.object({
    type: z.literal("role"),
    role: z.string().min(1),
    name: z.string().optional(),
    exact: z.boolean().optional(),
  }),
  z.object({ type: z.literal("label"), value: z.string().min(1), exact: z.boolean().optional() }),
  z.object({ type: z.literal("placeholder"), value: z.string().min(1) }),
  z.object({ type: z.literal("text"), value: z.string().min(1), exact: z.boolean().optional() }),
  z.object({ type: z.literal("name"), value: z.string().min(1) }),
  z.object({ type: z.literal("css"), value: z.string().min(1) }),
  z.object({ type: z.literal("xpath"), value: z.string().min(1) }),
]);

export const TargetRefSchema: z.ZodType<TargetRef> = z.lazy(() =>
  z.object({
    label: z.string().optional(),
    strategies: z.array(StrategySchema).min(1),
    fingerprint: z
      .object({
        tag: z.string().optional(),
        role: z.string().optional(),
        visibleText: z.string().optional(),
        anchorText: z.string().optional(),
        testid: z.string().optional(),
        name: z.string().optional(),
        placeholder: z.string().optional(),
      })
      .optional(),
    strict: z.boolean().optional(),
    nth: z.number().int().min(0).optional(),
    scope: TargetRefSchema.optional(),
    frame: z
      .union([
        z.object({ urlContains: z.string() }),
        z.object({ name: z.string() }),
      ])
      .optional(),
  }),
);

const ValueExprSchema: z.ZodType<ValueExpr> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("literal"), value: z.unknown() }),
    z.object({ kind: z.literal("var"), name: z.string().min(1) }),
    z.object({ kind: z.literal("template"), template: z.string() }),
    z.object({ kind: z.literal("dataset"), column: z.string().min(1) }),
    z.object({ kind: z.literal("env"), name: z.string().min(1) }),
    z.object({
      kind: z.literal("ref"),
      nodeId: z.string().min(1),
      output: z.enum(["value", "text", "attribute"]),
      attribute: z.string().optional(),
    }),
    z.object({
      kind: z.literal("generator"),
      type: z.enum([
        "unique.text",
        "unique.email",
        "unique.phone",
        "unique.orderNo",
        "faker.name",
        "faker.email",
        "faker.phone",
        "faker.company",
        "faker.idCard",
        "sequence",
      ]),
      scope: z.string().optional(),
      template: z.string().optional(),
      unique: z.boolean().optional(),
      options: z.record(z.string(), z.unknown()).optional(),
    }),
  ]),
);

export const ValueLikeSchema: z.ZodType<ValueLike> = z.union([
  ValueExprSchema,
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.object({ gen: z.string().min(1) }),
]);

const ConditionOperandSchema: z.ZodType<ConditionOperand> = z.union([
  z.object({ column: z.string().min(1) }),
  z.object({ var: z.string().min(1) }),
  z.object({ value: z.unknown() }),
]);

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({
      op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "notContains"]),
      left: ConditionOperandSchema,
      right: ConditionOperandSchema,
    }),
    z.object({
      op: z.literal("in"),
      left: ConditionOperandSchema,
      values: z.array(ConditionOperandSchema).min(1),
    }),
    z.object({ op: z.literal("exists"), left: ConditionOperandSchema }),
    z.object({ op: z.enum(["and", "or"]), of: z.array(ConditionSchema).min(1) }),
    z.object({ op: z.literal("not"), of: ConditionSchema }),
  ]),
);

const WaitBaseShape = {
  timeoutMs: z.number().int().positive().optional(),
  optional: z.boolean().optional(),
};

export const WaitSignalSchema: z.ZodType<WaitSignal> = z.lazy(() =>
  z.union([
    z.object({
      ...WaitBaseShape,
      kind: z.enum(["visible", "hidden", "attached", "enabled"]),
      target: TargetRefSchema,
    }),
    z.object({
      ...WaitBaseShape,
      kind: z.literal("count"),
      target: TargetRefSchema,
      min: z.number().int().min(0).optional(),
      max: z.number().int().min(0).optional(),
      equals: z.number().int().min(0).optional(),
      stableMs: z.number().int().min(0).optional(),
    }),
    z.object({
      ...WaitBaseShape,
      kind: z.literal("text"),
      target: TargetRefSchema,
      equals: ValueLikeSchema.optional(),
      contains: z.string().optional(),
    }),
    z.object({
      ...WaitBaseShape,
      kind: z.literal("value"),
      target: TargetRefSchema,
      equals: ValueLikeSchema,
    }),
    z.object({ ...WaitBaseShape, kind: z.literal("url"), matches: z.string().min(1) }),
    z.object({
      ...WaitBaseShape,
      kind: z.literal("response"),
      urlContains: z.string().min(1),
      method: z.string().optional(),
      status: z.union([z.number().int(), z.array(z.number().int())]).optional(),
    }),
    z.object({
      ...WaitBaseShape,
      kind: z.literal("domStable"),
      target: TargetRefSchema.optional(),
      quietMs: z.number().int().min(0).optional(),
      maxMs: z.number().int().min(0).optional(),
    }),
    z.object({ ...WaitBaseShape, kind: z.literal("loaderGone"), target: TargetRefSchema }),
    z.object({
      ...WaitBaseShape,
      kind: z.enum(["all", "any"]),
      of: z.array(WaitSignalSchema).min(1),
    }),
  ]),
);

export const SignalRefSchema: z.ZodType<SignalRef> = z.union([
  WaitSignalSchema,
  z.enum(PRESET_NAMES),
]);

const NodeBaseShape = {
  id: z.string().min(1),
  name: z.string().optional(),
  system: z.string().optional(),
  enabled: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
  pre: z.array(SignalRefSchema).optional(),
  expect: z.array(SignalRefSchema).optional(),
  meta: z
    .object({
      sourceText: z.string().optional(),
      needsConfirm: z.boolean().optional(),
      notes: z.string().optional(),
    })
    .catchall(z.unknown())
    .optional(),
};

const NavigateSchema = z.object({
  ...NodeBaseShape,
  type: z.literal("navigate"),
  system: z.string().min(1),
  url: z.string().min(1),
  waitUntil: z.enum(["commit", "domcontentloaded", "load"]).optional(),
  readySignal: SignalRefSchema.optional(),
});

const InteractSchema = z.object({
  ...NodeBaseShape,
  type: z.literal("interact"),
  system: z.string().min(1),
  adapter: z.enum(["input", "click", "check", "select", "press", "upload", "hover", "nativeSelect"]),
  target: TargetRefSchema,
  value: ValueLikeSchema.optional(),
  checked: z.boolean().optional(),
  key: z.string().optional(),
  verify: z.enum(["readBack", "none"]).optional(),
});

const FilterStepSchema = z.object({
  adapter: z.enum(["input", "click", "check", "nativeSelect"]),
  target: TargetRefSchema,
  value: ValueLikeSchema.optional(),
  checked: z.boolean().optional(),
});

const PickerSchema = z.object({
  ...NodeBaseShape,
  type: z.literal("picker"),
  system: z.string().min(1),
  mode: z.enum(["inline", "dialog"]),
  trigger: TargetRefSchema,
  panel: z.object({
    scope: z.object({
      type: z.enum(["dropdown", "dialog"]),
      name: z.string().optional(),
      target: TargetRefSchema.optional(),
    }),
    readySignal: SignalRefSchema.optional(),
    optionResponse: z
      .object({
        urlContains: z.string().min(1),
        method: z.enum(["GET", "POST"]).optional(),
        status: z.number().int().optional(),
      })
      .optional(),
  }),
  filter: z.object({ steps: z.array(FilterStepSchema).min(1) }).optional(),
  pick: z.object({
    strategy: z.enum(["byText", "byRow", "byCondition", "all"]),
    byText: z
      .object({
        column: z.string().optional(),
        value: ValueLikeSchema.optional(),
        match: z.enum(["exact", "contains"]).optional(),
      })
      .optional(),
    byRow: z
      .object({
        keyColumn: z.string().min(1),
        keyValue: ValueLikeSchema.optional(),
        rowTarget: TargetRefSchema.optional(),
        clickTarget: TargetRefSchema.optional(),
      })
      .optional(),
    byCondition: z
      .object({
        columns: z.record(z.string(), TargetRefSchema),
        condition: ConditionSchema,
      })
      .optional(),
    multi: z.boolean().optional(),
  }),
  commit: z
    .object({
      adapter: z.literal("click"),
      target: TargetRefSchema,
      waitHidden: z.boolean().optional(),
    })
    .optional(),
  stageTimeouts: z
    .object({
      openMs: z.number().int().positive().optional(),
      panelMs: z.number().int().positive().optional(),
      filterMs: z.number().int().positive().optional(),
      refreshMs: z.number().int().positive().optional(),
      pickMs: z.number().int().positive().optional(),
      commitMs: z.number().int().positive().optional(),
    })
    .optional(),
});

const WaitNodeSchema = z.object({
  ...NodeBaseShape,
  type: z.literal("wait"),
  condition: SignalRefSchema,
  message: z.string().optional(),
});

const AssertNodeSchema = z.object({
  ...NodeBaseShape,
  type: z.literal("assert"),
  condition: SignalRefSchema,
  message: z.string().optional(),
});

const BranchSchema = z.object({
  ...NodeBaseShape,
  type: z.literal("branch"),
  condition: ConditionSchema,
});

const ApiSchema = z.object({
  ...NodeBaseShape,
  type: z.literal("api"),
  system: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  url: z.string().min(1),
  body: ValueLikeSchema.optional(),
  expectStatus: z.union([z.number().int(), z.array(z.number().int())]).optional(),
  extract: z.record(z.string(), z.string()).optional(),
});

export const FlowNodeSchema: z.ZodType<FlowNode> = z.discriminatedUnion("type", [
  NavigateSchema,
  InteractSchema,
  PickerSchema,
  WaitNodeSchema,
  AssertNodeSchema,
  BranchSchema,
  ApiSchema,
]);

const SystemSchema: z.ZodType<SystemConfig> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  auth: z
    .union([
      z.object({ kind: z.literal("none") }),
      z.object({
        kind: z.literal("storageState"),
        path: z.string().optional(),
        env: z.string().optional(),
      }),
      z.object({ kind: z.literal("login"), env: z.string().optional() }),
    ])
    .optional(),
  allowedOrigins: z.array(z.string()).optional(),
});

const DatasetSchema: z.ZodType<Dataset> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  columns: z.record(z.string(), ValueLikeSchema),
  meta: z.record(z.string(), z.unknown()).optional(),
});

const ConstraintSchema: z.ZodType<Constraint> = z.union([
  z.object({ type: z.literal("equals"), left: z.string(), right: z.string() }),
  z.object({
    type: z.literal("derive"),
    target: z.string(),
    from: z.string(),
    op: z.enum(["localPart", "domain", "prefix", "suffix", "concat", "hash"]),
    template: z.string().optional(),
  }),
  z.object({ type: z.literal("unique"), field: z.string(), gen: z.string().optional() }),
  z.object({
    type: z.literal("range"),
    field: z.string(),
    min: z.union([z.number(), z.string()]).optional(),
    max: z.union([z.number(), z.string()]).optional(),
  }),
  z.object({ type: z.literal("regex"), field: z.string(), pattern: z.string() }),
  z.object({ type: z.literal("oneOf"), field: z.string(), values: z.array(z.unknown()) }),
]);

const DuplicatePolicySchema = z.object({
  detect: z.array(WaitSignalSchema),
  rewindTo: z.string(),
  regenerate: z.array(z.string()).optional(),
  maxAttempts: z.number().int().min(1).optional(),
});

const EdgeSchema: z.ZodType<FlowEdge> = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  when: z.enum(["then", "else"]).optional(),
});

export const FlowDslSchema: z.ZodType<FlowDsl> = z.object({
  dslVersion: z.literal("1.0"),
  meta: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
  systems: z.array(SystemSchema).min(1),
  defaults: z
    .object({
      nodeTimeoutMs: z.number().int().positive().optional(),
      pickerTimeoutMs: z.number().int().positive().optional(),
      screenshot: z.enum(["onFailure", "always", "never"]).optional(),
      resourcePolicy: z.enum(["balanced", "fast", "accurate"]).optional(),
      trace: z.boolean().optional(),
      onDuplicate: DuplicatePolicySchema.optional(),
    })
    .optional(),
  vars: z.record(z.string(), ValueLikeSchema).optional(),
  datasets: z.array(DatasetSchema).optional(),
  constraints: z.array(ConstraintSchema).optional(),
  secretFields: z.array(z.string()).optional(),
  nodes: z.array(FlowNodeSchema).min(1),
  edges: z.array(EdgeSchema),
  entry: z.string().min(1),
});

export type ParseResult =
  | { ok: true; dsl: FlowDsl }
  | { ok: false; errors: z.core.$ZodIssue[] };
