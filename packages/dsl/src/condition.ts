import type { Condition, ConditionOperand } from "./schema.js";

export interface ConditionContext {
  values: Record<string, unknown>;
  vars: Record<string, unknown>;
  strict?: boolean;
}

export class ConditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConditionError";
  }
}

export function evaluateCondition(condition: Condition, ctx: ConditionContext): boolean {
  switch (condition.op) {
    case "and":
      return condition.of.every((c) => evaluateCondition(c, ctx));
    case "or":
      return condition.of.some((c) => evaluateCondition(c, ctx));
    case "not":
      return !evaluateCondition(condition.of, ctx);
    case "exists": {
      const value = resolveOperand(condition.left, ctx);
      return value !== undefined && value !== null && value !== "";
    }
    case "in": {
      const left = resolveOperand(condition.left, ctx);
      return condition.values.some((operand) => looseEqual(left, resolveOperand(operand, ctx)));
    }
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "contains":
    case "notContains": {
      const left = resolveOperand(condition.left, ctx);
      const right = resolveOperand(condition.right, ctx);
      return compare(condition.op, left, right);
    }
  }
}

export function resolveOperand(operand: ConditionOperand, ctx: ConditionContext): unknown {
  if ("value" in operand) return operand.value;
  if ("column" in operand) {
    if (!(operand.column in ctx.values)) {
      throw new ConditionError(`条件引用了不存在的列: ${operand.column}`);
    }
    return ctx.values[operand.column];
  }
  if (!(operand.var in ctx.vars)) {
    throw new ConditionError(`条件引用了不存在的变量: ${operand.var}`);
  }
  return ctx.vars[operand.var];
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const n = Number(value);
  if (Number.isNaN(n)) throw new ConditionError(`条件比较需要数值，实际为 ${String(value)}`);
  return n;
}

function compare(op: string, left: unknown, right: unknown): boolean {
  switch (op) {
    case "eq":
      return looseEqual(left, right);
    case "neq":
      return !looseEqual(left, right);
    case "gt":
      return toNumber(left) > toNumber(right);
    case "gte":
      return toNumber(left) >= toNumber(right);
    case "lt":
      return toNumber(left) < toNumber(right);
    case "lte":
      return toNumber(left) <= toNumber(right);
    case "contains":
      return String(left ?? "").includes(String(right ?? ""));
    case "notContains":
      return !String(left ?? "").includes(String(right ?? ""));
    default:
      throw new ConditionError(`未知条件操作符: ${op}`);
  }
}

function looseEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (typeof left === "object" || typeof right === "object") {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return String(left) === String(right);
}
