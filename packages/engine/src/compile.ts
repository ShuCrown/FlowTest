import {
  computeReadiness,
  expandSignalRef,
  lintFlow,
  normalizeDsl,
  type FlowDsl,
  type FlowNode,
  type PickerNode,
  type SignalRef,
  type WaitSignal,
} from "@flowforge/dsl";
import { ERROR_CODES, FlowForgeError } from "./errors.js";
import type { CompiledNode, CompiledPlan, RunMode } from "./types.js";

export interface CompileOptions {
  mode?: RunMode;
  datasetId?: string;
}

export interface CompileOutput {
  plan: CompiledPlan;
  readiness: ReturnType<typeof computeReadiness>;
  warnings: string[];
}

export function compileFlow(input: unknown, options: CompileOptions = {}): CompileOutput {
  let dsl: FlowDsl;
  try {
    dsl = normalizeDsl(input);
  } catch (error) {
    throw new FlowForgeError(
      ERROR_CODES.compileFailed,
      error instanceof Error ? error.message : String(error),
      { details: (error as { issues?: unknown }).issues },
    );
  }

  const lint = lintFlow(dsl);
  const readiness = computeReadiness(dsl);
  const mode = options.mode ?? "single";

  if (lint.errors.length > 0) {
    throw new FlowForgeError(ERROR_CODES.compileFailed, "流程 DSL 校验失败", {
      details: { issues: lint.errors },
    });
  }

  const minLevel = mode === "probe" ? 2 : mode === "single" || mode === "matrix" ? 3 : 2;
  if (readiness.level < minLevel) {
    throw new FlowForgeError(
      ERROR_CODES.readinessTooLow,
      `流程就绪度 L${readiness.level} 低于 ${mode} 模式要求 L${minLevel}`,
      { details: { readiness } },
    );
  }

  const nodes: Record<string, CompiledNode> = {};
  for (const node of dsl.nodes) {
    nodes[node.id] = compileNode(node);
  }

  const outgoing: CompiledPlan["outgoing"] = {};
  for (const edge of dsl.edges) {
    const list = outgoing[edge.from] ?? [];
    list.push({ to: edge.to, when: edge.when });
    outgoing[edge.from] = list;
  }

  const warnings = [
    ...lint.warnings.map((w) => `${w.path}: ${w.message}`),
    ...readiness.gaps
      .filter((gap) => gap.severity === "warning")
      .map((gap) => `${gap.path}: ${gap.message}`),
  ];

  return {
    plan: {
      dsl,
      entry: dsl.entry,
      datasetId: options.datasetId,
      mode,
      nodes,
      outgoing,
      readinessLevel: readiness.level,
      warnings,
      compiledAt: new Date().toISOString(),
    },
    readiness,
    warnings,
  };
}

function compileNode(node: FlowNode): CompiledNode {
  const pre = expandSignals(node.pre, labelTarget(node));
  const expect = expandSignals(node.expect, labelTarget(node));
  const compiled: CompiledNode = {
    nodeId: node.id,
    type: node.type,
    pre,
    expect,
  };
  if (node.type === "navigate") {
    compiled.readySignal = expandSignalRef(node.readySignal ?? "page-ready");
  }
  if (node.type === "picker") {
    compiled.readySignal = expandSignalRef(
      node.panel.readySignal ?? "content-stable",
      panelTarget(node),
    );
  }
  return compiled;
}

function expandSignals(
  signals: SignalRef[] | undefined,
  target?: import("@flowforge/dsl").TargetRef,
): WaitSignal[] {
  return (signals ?? []).map((signal) => expandSignalRef(signal, target));
}

function labelTarget(node: FlowNode): import("@flowforge/dsl").TargetRef | undefined {
  if (node.type === "interact") return node.target;
  if (node.type === "picker") return node.trigger;
  return undefined;
}

export function panelTarget(node: PickerNode): import("@flowforge/dsl").TargetRef {
  if (node.panel.scope.target) return node.panel.scope.target;
  const role = node.panel.scope.type === "dialog" ? "dialog" : "listbox";
  return {
    label: node.panel.scope.name ?? role,
    strategies: [{ type: "role", role }],
  };
}
