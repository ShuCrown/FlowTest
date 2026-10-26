import type { FlowDsl, FlowNode, PickerNode, SignalRef, TargetRef, ValueExpr } from "./schema.js";

export interface ReadinessGap {
  nodeId?: string;
  path: string;
  severity: "error" | "warning" | "info";
  message: string;
  fix: "target" | "data" | "wait" | "structure" | "dataset";
}

export interface Readiness {
  level: 0 | 1 | 2 | 3 | 4 | 5;
  gaps: ReadinessGap[];
}

interface CollectTarget {
  path: string;
  target: TargetRef;
}

export function collectNodeTargets(node: FlowNode, index: number): CollectTarget[] {
  const found: CollectTarget[] = [];
  const base = `/nodes/${index}`;
  const addTarget = (path: string, target: TargetRef | undefined): void => {
    if (!target) return;
    found.push({ path, target });
    if (target.scope) addTarget(`${path}/scope`, target.scope);
  };
  const addSignal = (path: string, ref: SignalRef | undefined): void => {
    if (!ref || typeof ref === "string") return;
    walkSignal(path, ref);
  };
  const walkSignal = (path: string, signal: SignalRef): void => {
    if (typeof signal === "string") return;
    if (signal.kind === "all" || signal.kind === "any") {
      signal.of.forEach((child, i) => walkSignal(`${path}/of/${i}`, child));
      return;
    }
    if (signal.kind === "url" || signal.kind === "response") return;
    if ("target" in signal) addTarget(`${path}/target`, signal.target);
  };

  node.pre?.forEach((signal, i) => addSignal(`${base}/pre/${i}`, signal));
  node.expect?.forEach((signal, i) => addSignal(`${base}/expect/${i}`, signal));

  switch (node.type) {
    case "navigate":
      addSignal(`${base}/readySignal`, node.readySignal);
      break;
    case "interact":
      addTarget(`${base}/target`, node.target);
      break;
    case "picker":
      collectPickerTargets(node, base, addTarget, addSignal);
      break;
    case "wait":
    case "assert":
      addSignal(`${base}/condition`, node.condition);
      break;
    case "branch":
      break;
    case "api":
      break;
  }
  return found;
}

function collectPickerTargets(
  node: PickerNode,
  base: string,
  addTarget: (path: string, target: TargetRef | undefined) => void,
  addSignal: (path: string, ref: SignalRef | undefined) => void,
): void {
  addTarget(`${base}/trigger`, node.trigger);
  addTarget(`${base}/panel/scope/target`, node.panel.scope.target);
  node.filter?.steps.forEach((step, i) => addTarget(`${base}/filter/steps/${i}/target`, step.target));
  addTarget(`${base}/pick/byRow/rowTarget`, node.pick.byRow?.rowTarget);
  addTarget(`${base}/pick/byRow/clickTarget`, node.pick.byRow?.clickTarget);
  Object.entries(node.pick.byCondition?.columns ?? {}).forEach(([key, target]) =>
    addTarget(`${base}/pick/byCondition/columns/${key}`, target),
  );
  addTarget(`${base}/commit/target`, node.commit?.target);
  addSignal(`${base}/panel/readySignal`, node.panel.readySignal);
}

export function collectAllTargets(dsl: FlowDsl): CollectTarget[] {
  return dsl.nodes.flatMap((node, index) => collectNodeTargets(node, index));
}

export function computeReadiness(dsl: FlowDsl): Readiness {
  const gaps: ReadinessGap[] = [];
  const structural = collectStructuralErrors(dsl);
  for (const error of structural) {
    gaps.push({
      path: error.path,
      nodeId: error.nodeId,
      severity: "error",
      message: error.message,
      fix: "structure",
    });
  }
  if (structural.length > 0) return { level: 1, gaps };

  for (const { path, target, } of collectAllTargets(dsl)) {
    if (target.strategies.length === 0) {
      gaps.push({
        path: `${path}/strategies`,
        severity: "error",
        message: `目标 ${target.label ?? path} 缺少定位策略`,
        fix: "target",
      });
    }
  }
  if (gaps.some((g) => g.severity === "error")) return { level: 1, gaps };

  const varNames = new Set(Object.keys(dsl.vars ?? {}));
  const datasetColumns = new Set(
    (dsl.datasets ?? []).flatMap((dataset) => Object.keys(dataset.columns)),
  );
  const nodeIds = new Set(dsl.nodes.map((n) => n.id));
  const dataIssues: ReadinessGap[] = [];

  const checkValue = (value: unknown, path: string, availableVars = varNames): void => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const expr = value as ValueExpr;
    if (typeof expr.kind !== "string") return;
    if (expr.kind === "var" && !availableVars.has(expr.name)) {
      dataIssues.push({
        path,
        severity: "error",
        message: `引用了未定义变量 ${expr.name}`,
        fix: "data",
      });
    }
    if (expr.kind === "dataset" && !datasetColumns.has(expr.column)) {
      dataIssues.push({
        path,
        severity: "error",
        message: `引用了不存在的数据集列 ${expr.column}`,
        fix: "data",
      });
    }
    if (expr.kind === "ref" && !nodeIds.has(expr.nodeId)) {
      dataIssues.push({
        path,
        severity: "error",
        message: `引用了不存在的节点输出 ${expr.nodeId}`,
        fix: "data",
      });
    }
    if (expr.kind === "env" && !expr.name) {
      dataIssues.push({ path, severity: "error", message: "env 取值缺少变量名", fix: "data" });
    }
  };

  dsl.nodes.forEach((node, index) => {
    if (node.type === "interact") {
      if (
        ["input", "select", "nativeSelect", "upload"].includes(node.adapter) &&
        node.value === undefined
      ) {
        dataIssues.push({
          nodeId: node.id,
          path: `/nodes/${index}/value`,
          severity: "error",
          message: `节点 ${node.name ?? node.id} 缺少输入值绑定`,
          fix: "data",
        });
      }
      checkValue(node.value, `/nodes/${index}/value`);
    }
    if (node.type === "picker") {
      node.filter?.steps.forEach((step, i) => {
        if (["input", "nativeSelect"].includes(step.adapter) && step.value === undefined) {
          dataIssues.push({
            nodeId: node.id,
            path: `/nodes/${index}/filter/steps/${i}/value`,
            severity: "error",
            message: "筛选步骤缺少取值绑定",
            fix: "data",
          });
        }
        checkValue(step.value, `/nodes/${index}/filter/steps/${i}/value`);
      });
      const byText = node.pick.byText;
      if (byText && byText.value === undefined && !byText.column) {
        dataIssues.push({
          nodeId: node.id,
          path: `/nodes/${index}/pick/byText`,
          severity: "error",
          message: "byText 选择缺少 value 或 column",
          fix: "data",
        });
      }
      checkValue(byText?.value, `/nodes/${index}/pick/byText/value`);
      checkValue(node.pick.byRow?.keyValue, `/nodes/${index}/pick/byRow/keyValue`);
    }
    if (node.type === "api") checkValue(node.body, `/nodes/${index}/body`);
  });

  if (dataIssues.length > 0) {
    gaps.push(...dataIssues);
    return { level: 2, gaps };
  }

  dsl.nodes.forEach((node, index) => {
    if (node.type === "navigate" && !node.readySignal) {
      gaps.push({
        nodeId: node.id,
        path: `/nodes/${index}/readySignal`,
        severity: "info",
        message: "未显式声明页面就绪信号，编译期使用 page-ready 预设",
        fix: "wait",
      });
    }
    if (node.type === "picker" && !node.panel.readySignal) {
      gaps.push({
        nodeId: node.id,
        path: `/nodes/${index}/panel/readySignal`,
        severity: "info",
        message: "未显式声明面板就绪信号，编译期使用 content-stable 预设",
        fix: "wait",
      });
    }
    if (node.type === "picker" && node.mode === "dialog" && !node.commit) {
      gaps.push({
        nodeId: node.id,
        path: `/nodes/${index}/commit`,
        severity: "warning",
        message: "dialog picker 未配置 commit，运行依赖面板自动关闭",
        fix: "wait",
      });
    }
  });

  if (!dsl.datasets || dsl.datasets.length === 0) {
    gaps.push({
      path: "/datasets",
      severity: "info",
      message: "尚无数据集，只能单路径运行；补齐数据集可到 L5",
      fix: "dataset",
    });
    return { level: 4, gaps };
  }

  for (const node of dsl.nodes) {
    if (node.type !== "branch") continue;
    const edges = dsl.edges.filter((edge) => edge.from === node.id);
    const thenEdge = edges.find((edge) => edge.when === "then");
    const elseEdge = edges.find((edge) => edge.when === "else");
    if (!thenEdge || !elseEdge) continue;
    const outcome = evaluateStaticBranch(dsl, node);
    if (outcome === "unknown") {
      gaps.push({
        nodeId: node.id,
        path: `/nodes/${dsl.nodes.indexOf(node)}/condition`,
        severity: "info",
        message: "分支条件依赖运行时生成值，无法静态判定覆盖",
        fix: "dataset",
      });
      continue;
    }
    if (outcome.coveredThen === 0) {
      gaps.push({
        nodeId: node.id,
        path: "/datasets",
        severity: "warning",
        message: "没有数据集覆盖 then 分支",
        fix: "dataset",
      });
    }
    if (outcome.coveredElse === 0) {
      gaps.push({
        nodeId: node.id,
        path: "/datasets",
        severity: "warning",
        message: "没有数据集覆盖 else 分支",
        fix: "dataset",
      });
    }
  }

  return { level: 5, gaps };
}

export interface StructuralError {
  path: string;
  nodeId?: string;
  message: string;
}

export function collectStructuralErrors(dsl: FlowDsl): StructuralError[] {
  const errors: StructuralError[] = [];
  const ids = new Set<string>();
  dsl.nodes.forEach((node, index) => {
    if (ids.has(node.id)) {
      errors.push({ nodeId: node.id, path: `/nodes/${index}/id`, message: `重复节点 id: ${node.id}` });
    }
    ids.add(node.id);
  });
  if (!ids.has(dsl.entry)) {
    errors.push({ path: "/entry", message: `entry 节点不存在: ${dsl.entry}` });
  }
  const systemIds = new Set(dsl.systems.map((s) => s.id));
  dsl.nodes.forEach((node, index) => {
    if (node.type === "branch") return;
    if (!node.system) {
      errors.push({ nodeId: node.id, path: `/nodes/${index}/system`, message: "节点缺少 system" });
    } else if (!systemIds.has(node.system)) {
      errors.push({
        nodeId: node.id,
        path: `/nodes/${index}/system`,
        message: `未知 system: ${node.system}`,
      });
    }
  });
  dsl.edges.forEach((edge, index) => {
    if (!ids.has(edge.from)) {
      errors.push({ path: `/edges/${index}/from`, message: `边起点不存在: ${edge.from}` });
    }
    if (!ids.has(edge.to)) {
      errors.push({ path: `/edges/${index}/to`, message: `边终点不存在: ${edge.to}` });
    }
  });
  dsl.nodes.forEach((node, index) => {
    if (node.type === "branch") {
      const outs = dsl.edges.filter((edge) => edge.from === node.id);
      if (outs.length !== 2 || !outs.some((e) => e.when === "then") || !outs.some((e) => e.when === "else")) {
        errors.push({
          nodeId: node.id,
          path: `/nodes/${index}`,
          message: "branch 必须恰好有 then / else 两条出边",
        });
      }
      return;
    }
    const outs = dsl.edges.filter((edge) => edge.from === node.id);
    if (outs.length > 1) {
      errors.push({
        nodeId: node.id,
        path: `/nodes/${index}`,
        message: `非分支节点最多一条出边，实际 ${outs.length} 条`,
      });
    }
  });
  const cycle = findCycle(dsl);
  if (cycle) {
    errors.push({ path: "/edges", message: `流程存在环: ${cycle.join(" → ")}` });
  }
  const reachable = reachableNodes(dsl);
  dsl.nodes.forEach((node, index) => {
    if (!reachable.has(node.id)) {
      errors.push({
        nodeId: node.id,
        path: `/nodes/${index}/id`,
        message: `节点从 entry 不可达: ${node.id}`,
      });
    }
  });
  return errors;
}

export function reachableNodes(dsl: FlowDsl): Set<string> {
  const seen = new Set<string>();
  const stack = [dsl.entry];
  const outgoing = new Map<string, string[]>();
  for (const edge of dsl.edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    for (const next of outgoing.get(id) ?? []) stack.push(next);
  }
  return seen;
}

export function findCycle(dsl: FlowDsl): string[] | null {
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const outgoing = new Map<string, string[]>();
  for (const edge of dsl.edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }
  const visit = (id: string): string[] | null => {
    state.set(id, 1);
    stack.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const s = state.get(next) ?? 0;
      if (s === 1) {
        const from = stack.indexOf(next);
        return [...stack.slice(from), next];
      }
      if (s === 0) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const node of dsl.nodes) {
    if ((state.get(node.id) ?? 0) === 0) {
      const found = visit(node.id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 静态分支覆盖：只对仅引用字面值 / 数据集列的条件做判定。
 * 条件依赖生成器、变量、ref 时返回 unknown。
 */
export function evaluateStaticBranch(
  dsl: FlowDsl,
  node: Extract<FlowNode, { type: "branch" }>,
): { coveredThen: number; coveredElse: number } | "unknown" {
  if (!isStaticallyDecidable(node.condition, dsl)) return "unknown";
  let coveredThen = 0;
  let coveredElse = 0;
  for (const dataset of dsl.datasets ?? []) {
    const values: Record<string, unknown> = {};
    let resolvable = true;
    for (const [key, value] of Object.entries(dataset.columns)) {
      if (value && typeof value === "object" && "kind" in value) {
        if (value.kind === "literal") values[key] = value.value;
        else resolvable = false;
      } else {
        values[key] = value;
      }
    }
    if (!resolvable) continue;
    try {
      const result = evaluateBranchCondition(node.condition, values);
      if (result) coveredThen += 1;
      else coveredElse += 1;
    } catch {
      return "unknown";
    }
  }
  return { coveredThen, coveredElse };
}

function isStaticallyDecidable(condition: unknown, dsl: FlowDsl): boolean {
  if (!condition || typeof condition !== "object") return false;
  const c = condition as Record<string, unknown>;
  if (c.op === "and" || c.op === "or") {
    return (c.of as unknown[]).every((child) => isStaticallyDecidable(child, dsl));
  }
  if (c.op === "not") return isStaticallyDecidable(c.of, dsl);
  const operands = [c.left, c.right, ...((c.values as unknown[]) ?? [])].filter(Boolean);
  for (const operand of operands) {
    if (!operand || typeof operand !== "object") continue;
    const o = operand as Record<string, unknown>;
    if ("var" in o) return false;
    const column = o.column;
    if (typeof column === "string" && !(dsl.datasets ?? []).every((d) => column in d.columns)) {
      return false;
    }
  }
  return true;
}

function evaluateBranchCondition(condition: unknown, values: Record<string, unknown>): boolean {
  const c = condition as {
    op: string;
    left?: { column?: string; value?: unknown };
    right?: { column?: string; value?: unknown };
    values?: Array<{ column?: string; value?: unknown }>;
    of?: unknown;
  };
  const resolve = (operand?: { column?: string; value?: unknown }): unknown => {
    if (operand && "column" in operand && operand.column) return values[operand.column];
    return operand?.value;
  };
  if (c.op === "and") return (c.of as unknown[]).every((child) => evaluateBranchCondition(child, values));
  if (c.op === "or") return (c.of as unknown[]).some((child) => evaluateBranchCondition(child, values));
  if (c.op === "not") return !evaluateBranchCondition(c.of, values);
  const left = resolve(c.left);
  const right = resolve(c.right);
  switch (c.op) {
    case "eq":
      return String(left) === String(right);
    case "neq":
      return String(left) !== String(right);
    case "gt":
      return Number(left) > Number(right);
    case "gte":
      return Number(left) >= Number(right);
    case "lt":
      return Number(left) < Number(right);
    case "lte":
      return Number(left) <= Number(right);
    case "contains":
      return String(left ?? "").includes(String(right ?? ""));
    case "exists":
      return left !== undefined && left !== null;
    case "in":
      return (c.values ?? []).some((v) => String(resolve(v)) === String(left));
    default:
      throw new Error(`unknown op ${c.op}`);
  }
}
