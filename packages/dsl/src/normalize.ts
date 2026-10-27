import {
  FlowDslSchema,
  type Condition,
  type Dataset,
  type FlowDsl,
  type FlowNode,
  type PickerNode,
  type SignalRef,
  type TargetRef,
  type ValueExpr,
  type ValueLike,
  type WaitSignal,
} from "./schema.js";
import type { z } from "zod";

export class DslNormalizeError extends Error {
  readonly code = "DSL_INVALID";
  readonly pointer: string;

  constructor(message: string, pointer = "") {
    super(message);
    this.name = "DslNormalizeError";
    this.pointer = pointer;
  }
}

const UNIQUE_GENERATORS = new Set([
  "unique.text",
  "unique.email",
  "unique.phone",
  "unique.orderNo",
]);

const FAKER_GENERATORS = new Set([
  "faker.name",
  "faker.email",
  "faker.phone",
  "faker.company",
  "faker.idCard",
]);

export function normalizeValue(input: ValueLike, pointer = ""): ValueExpr {
  if (input === null || typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
    return { kind: "literal", value: input };
  }
  if (Array.isArray(input)) {
    return { kind: "literal", value: input };
  }
  if (typeof input !== "object") {
    return { kind: "literal", value: input };
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj.kind === "string") {
    return input as ValueExpr;
  }
  if (typeof obj.gen === "string") {
    return normalizeGenerator(obj.gen, pointer, obj);
  }
  return { kind: "literal", value: obj };
}

export function normalizeGenerator(
  gen: string,
  pointer = "",
  extra: Record<string, unknown> = {},
): ValueExpr {
  const [family, ...rest] = gen.split(".");
  const suffix = rest.join(".");
  const shared = {
    ...(typeof extra.scope === "string" ? { scope: extra.scope } : {}),
    ...(typeof extra.template === "string" ? { template: extra.template } : {}),
    ...(typeof extra.unique === "boolean" ? { unique: extra.unique } : {}),
    ...(extra.options && typeof extra.options === "object"
      ? { options: extra.options as Record<string, unknown> }
      : {}),
  };
  if (UNIQUE_GENERATORS.has(gen)) {
    return {
      kind: "generator",
      type: gen as "unique.text" | "unique.email" | "unique.phone" | "unique.orderNo",
      unique: true,
      ...shared,
    };
  }
  if (FAKER_GENERATORS.has(gen)) {
    return {
      kind: "generator",
      type: gen as "faker.name" | "faker.email" | "faker.phone" | "faker.company" | "faker.idCard",
      ...shared,
    };
  }
  if (family === "sequence" && suffix) {
    const scope = typeof extra.scope === "string" ? extra.scope : suffix;
    return { kind: "generator", type: "sequence", scope, ...shared };
  }
  throw new DslNormalizeError(`未知取值生成器: ${gen}`, pointer);
}

export function normalizeTarget(input: TargetRef | string): TargetRef {
  if (typeof input === "string") {
    return { label: input, strategies: [{ type: "text", value: input }], strict: true };
  }
  return {
    ...input,
    strategies: input.strategies.map((s) => ({ ...s })),
    scope: input.scope ? normalizeTarget(input.scope) : undefined,
  };
}

export function normalizeSignal(input: SignalRef): SignalRef {
  if (typeof input === "string") return input;
  return normalizeWait(input);
}

function normalizeWait(signal: WaitSignal): WaitSignal {
  switch (signal.kind) {
    case "visible":
    case "hidden":
    case "attached":
    case "enabled":
    case "count":
    case "value":
    case "loaderGone":
      return { ...signal, target: normalizeTarget(signal.target) };
    case "text":
      return {
        ...signal,
        target: normalizeTarget(signal.target),
        equals: signal.equals === undefined ? undefined : normalizeValue(signal.equals),
      };
    case "domStable":
      return { ...signal, target: signal.target ? normalizeTarget(signal.target) : undefined };
    case "url":
    case "response":
      return signal;
    case "all":
    case "any":
      return { ...signal, of: signal.of.map(normalizeWait) };
  }
}

function normalizeCondition(condition: Condition): Condition {
  if (condition.op === "and" || condition.op === "or") {
    return { ...condition, of: condition.of.map(normalizeCondition) };
  }
  if (condition.op === "not") {
    return { ...condition, of: normalizeCondition(condition.of) };
  }
  return condition;
}

function normalizeSignals(signals: SignalRef[] | undefined): SignalRef[] | undefined {
  return signals?.map(normalizeSignal);
}

function normalizeNode(node: FlowNode): FlowNode {
  const base = {
    ...node,
    pre: normalizeSignals(node.pre),
    expect: normalizeSignals(node.expect),
  };
  switch (base.type) {
    case "navigate":
      return { ...base, readySignal: base.readySignal ? normalizeSignal(base.readySignal) : undefined };
    case "interact":
      return {
        ...base,
        target: normalizeTarget(base.target),
        value: base.value === undefined ? undefined : normalizeValue(base.value),
      };
    case "picker":
      return normalizePicker(base);
    case "wait":
      return { ...base, condition: normalizeSignal(base.condition) };
    case "assert":
      return { ...base, condition: normalizeSignal(base.condition) };
    case "branch":
      return { ...base, condition: normalizeCondition(base.condition) };
    case "api":
      return {
        ...base,
        body: base.body === undefined ? undefined : normalizeValue(base.body),
      };
  }
}

function normalizePicker(node: PickerNode): PickerNode {
  const filter = node.filter
    ? {
        steps: node.filter.steps.map((step) => ({
          ...step,
          target: normalizeTarget(step.target),
          value: step.value === undefined ? undefined : normalizeValue(step.value),
        })),
      }
    : undefined;
  const pick = { ...node.pick };
  if (pick.byText) {
    pick.byText = {
      ...pick.byText,
      value: pick.byText.value === undefined ? undefined : normalizeValue(pick.byText.value),
    };
  }
  if (pick.byRow) {
    pick.byRow = {
      ...pick.byRow,
      keyValue: pick.byRow.keyValue === undefined ? undefined : normalizeValue(pick.byRow.keyValue),
      rowTarget: pick.byRow.rowTarget ? normalizeTarget(pick.byRow.rowTarget) : undefined,
      clickTarget: pick.byRow.clickTarget ? normalizeTarget(pick.byRow.clickTarget) : undefined,
    };
  }
  if (pick.byCondition) {
    pick.byCondition = {
      columns: Object.fromEntries(
        Object.entries(pick.byCondition.columns).map(([k, v]) => [k, normalizeTarget(v)]),
      ),
      condition: normalizeCondition(pick.byCondition.condition),
    };
  }
  return {
    ...node,
    trigger: normalizeTarget(node.trigger),
    panel: {
      ...node.panel,
      scope: {
        ...node.panel.scope,
        target: node.panel.scope.target ? normalizeTarget(node.panel.scope.target) : undefined,
      },
      readySignal: node.panel.readySignal ? normalizeSignal(node.panel.readySignal) : undefined,
    },
    filter,
    pick,
    commit: node.commit
      ? { ...node.commit, target: normalizeTarget(node.commit.target) }
      : undefined,
  };
}

function normalizeDataset(dataset: Dataset): Dataset {
  return {
    ...dataset,
    columns: Object.fromEntries(
      Object.entries(dataset.columns).map(([key, value]) => [
        key,
        normalizeValue(value, `/datasets/${dataset.id}/${key}`),
      ]),
    ),
  };
}

export function normalizeDsl(raw: unknown): FlowDsl {
  if (!raw || typeof raw !== "object") throw new DslNormalizeError("流程 DSL 必须是对象");
  const input = raw as Partial<FlowDsl>;
  const partial: unknown = {
    ...input,
    vars: input.vars
      ? Object.fromEntries(
          Object.entries(input.vars).map(([key, value]) => [
            key,
            normalizeValue(value, `/vars/${key}`),
          ]),
        )
      : undefined,
    datasets: input.datasets?.map(normalizeDataset),
    constraints: input.constraints,
    nodes: input.nodes?.map((node) => normalizeNode(node as FlowNode)),
    edges: input.edges,
  };
  return FlowDslSchema.parse(partial) as FlowDsl;
}

export function parseFlow(raw: unknown): { ok: true; dsl: FlowDsl } | { ok: false; errors: z.core.$ZodIssue[] } {
  try {
    const dsl = normalizeDsl(raw);
    return { ok: true, dsl };
  } catch (error) {
    if (error instanceof DslNormalizeError) {
      return {
        ok: false,
        errors: [
          {
            code: "custom",
            message: error.message,
            path: [error.pointer],
          } as unknown as z.core.$ZodIssue,
        ],
      };
    }
    if (error instanceof Error && error.name === "ZodError") {
      const issues = (error as unknown as { issues: z.core.$ZodIssue[] }).issues;
      return { ok: false, errors: issues };
    }
    throw error;
  }
}

export function normalizeString(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
