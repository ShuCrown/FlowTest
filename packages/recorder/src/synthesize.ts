import {
  normalizeDsl,
  type FlowDsl,
  type FlowNode,
  type PickerNode,
  type SystemConfig,
  type TargetRef,
  type ValueLike,
} from "@flowforge/dsl";
import { fingerprintToTarget, type ElementFingerprint, type RawEvent } from "./collector.js";
import type { InteractionCluster } from "./segment.js";

export interface SynthesisInput {
  clusters: InteractionCluster[];
  rawEvents: RawEvent[];
  system: SystemConfig;
  flowName?: string;
}

export interface SynthesisResult {
  dsl: FlowDsl;
  report: {
    clusters: number;
    nodes: number;
    needsConfirm: number;
    confidence: number;
    warnings: string[];
    evidence: Record<string, number[]>;
  };
}

/**
 * 交互簇 → DSL 草稿。只做规则可判定的部分；pick/commit 等低置信内容标 needsConfirm。
 */
export function synthesizeRecording(input: SynthesisInput): SynthesisResult {
  const nodes: FlowNode[] = [];
  const edges: Array<{ from: string; to: string; when?: "then" | "else" }> = [];
  const warnings: string[] = [];
  const evidence: Record<string, number[]> = {};
  const navigation = navigationNodes(input.rawEvents, input.system);

  for (const nav of navigation) {
    nodes.push(nav);
  }

  let counter = 0;
  let confidenceSum = 0;
  for (const cluster of input.clusters) {
    counter += 1;
    const id = `${cluster.kind}-${counter}`;
    confidenceSum += cluster.confidence;
    if (cluster.kind === "picker") {
      const picker = pickerNode(id, cluster, input.system);
      nodes.push(picker);
      evidence[id] = cluster.evidence;
      if (cluster.needsConfirm) warnings.push(`${id}: 触发器 / 选项定位需要确认`);
    } else if (cluster.filters.length > 0) {
      let index = 0;
      for (const filter of cluster.filters) {
        index += 1;
        const nodeId = `${id}-${index}`;
        const node: FlowNode = {
          id: nodeId,
          type: "interact",
          name: `${filter.kind === "input" ? "输入" : "修改"} ${filter.fp.labelText ?? filter.fp.placeholder ?? filter.fp.tag}`,
          system: input.system.id,
          adapter:
            filter.fp.tag === "select" || filter.fp.role === "combobox" ? "nativeSelect" : "input",
          target: fingerprintToTarget(filter.fp),
          value:
            filter.value !== undefined && !filter.redacted
              ? { kind: "literal", value: filter.value }
              : { kind: "literal", value: "待确认" },
          verify: "readBack",
          meta: {
            sourceText: cluster.kind,
            needsConfirm: filter.redacted || filter.value === undefined,
          },
        };
        nodes.push(node);
        evidence[nodeId] = [filter.evidence];
        if (filter.redacted || filter.value === undefined) {
          warnings.push(`${nodeId}: 值被脱敏或缺失，需要补充绑定`);
        }
      }
    } else {
      const trigger = cluster.trigger;
      if (!trigger) continue;
      const node: FlowNode = {
        id,
        type: "interact",
        name: `点击 ${trigger.target.label ?? trigger.fp.tag}`,
        system: input.system.id,
        adapter: "click",
        target: trigger.target,
        expect: [],
        meta: {
          sourceText: cluster.kind,
          needsConfirm: true,
        },
      };
      nodes.push(node);
      evidence[id] = cluster.evidence;
      warnings.push(`${id}: 点击后的业务期望未自动推断，需要确认`);
    }
  }

  if (nodes.length === 0) {
    throw new Error("采集簇为空，无法合成草稿");
  }
  for (let i = 0; i < nodes.length - 1; i += 1) {
    edges.push({ from: nodes[i]!.id, to: nodes[i + 1]!.id });
  }

  const dsl = normalizeDsl({
    dslVersion: "1.0",
    meta: {
      name: input.flowName ?? `采集草稿 ${new Date().toISOString().slice(11, 16)}`,
      tags: ["captured"],
    },
    systems: [input.system],
    defaults: {
      nodeTimeoutMs: 15000,
      pickerTimeoutMs: 30000,
      screenshot: "onFailure",
      resourcePolicy: "balanced",
      trace: false,
    },
    nodes,
    edges,
    entry: nodes[0]!.id,
  });
  const needsConfirm = nodes.filter((node) => node.meta?.needsConfirm).length;
  return {
    dsl,
    report: {
      clusters: input.clusters.length,
      nodes: nodes.length,
      needsConfirm,
      confidence:
        input.clusters.length > 0
          ? Math.round((confidenceSum / input.clusters.length) * 100) / 100
          : 0,
      warnings,
      evidence,
    },
  };
}

function navigationNodes(events: RawEvent[], system: SystemConfig): FlowNode[] {
  const urls: string[] = [];
  for (const event of events) {
    if (event.kind !== "navigate" || !event.url) continue;
    try {
      const url = new URL(event.url);
      if (url.origin !== new URL(system.baseUrl).origin) continue;
      const path = `${url.pathname}${url.search}`;
      if (urls[urls.length - 1] === path) continue;
      urls.push(path);
    } catch {
      continue;
    }
  }
  if (urls.length === 0) urls.push("/");
  return urls.slice(0, 5).map((url, index) => ({
    id: `navigate-${index + 1}`,
    type: "navigate",
    name: index === 0 ? "打开页面" : `导航 ${index + 1}`,
    system: system.id,
    url,
    waitUntil: "domcontentloaded",
    readySignal: "page-ready",
  }));
}

function pickerNode(id: string, cluster: InteractionCluster, system: SystemConfig): PickerNode {
  const mode = cluster.mode ?? "dialog";
  const panelRole = cluster.panel?.role ?? (mode === "dialog" ? "dialog" : "listbox");
  const panelTitle = cluster.panel?.name ?? cluster.panel?.title;
  const panelTarget: TargetRef = {
    label: panelTitle ?? panelRole,
    strategies: [
      panelTitle
        ? { type: "role", role: panelRole, name: panelTitle, exact: true }
        : { type: "role", role: panelRole },
    ],
  };
  const trigger: TargetRef = cluster.trigger?.target ?? {
    label: "trigger",
    strategies: [{ type: "role", role: "button" }],
  };
  const filterSteps = cluster.filters.map((filter) => ({
    adapter:
      filter.fp.tag === "select" || filter.fp.role === "combobox"
        ? ("nativeSelect" as const)
        : ("input" as const),
    target: fingerprintToTarget(filter.fp),
    value:
      filter.value !== undefined && !filter.redacted
        ? ({ kind: "literal", value: filter.value } as ValueLike)
        : ({ kind: "literal", value: "待确认" } as ValueLike),
  }));
  const pickTexts = unique(
    cluster.picks
      .map((pick) => pick.fp.ariaLabel ?? pick.fp.text ?? pick.fp.labelText ?? "")
      .filter(Boolean),
  );
  const pickValue: ValueLike =
    pickTexts.length === 0
      ? { kind: "literal", value: "待确认选项" }
      : pickTexts.length === 1
        ? { kind: "literal", value: pickTexts[0] }
        : { kind: "literal", value: pickTexts };
  const commit = cluster.commit
    ? {
        adapter: "click" as const,
        target: fingerprintToTarget(cluster.commit.fp),
      }
    : undefined;
  const duration = Math.max(0, cluster.endT - cluster.startT);
  const timeout = Math.min(20000, Math.max(1000, Math.round(duration * 1.5 + 1500)));
  return {
    id,
    type: "picker",
    name: `选择 ${trigger.label ?? "选项"}`,
    system: system.id,
    mode,
    trigger,
    panel: {
      scope: {
        type: mode === "dialog" ? "dialog" : "dropdown",
        name: panelTitle,
        target: panelTarget,
      },
      readySignal: "content-stable",
    },
    filter: filterSteps.length > 0 ? { steps: filterSteps } : undefined,
    pick: {
      strategy: "byText",
      byText: {
        value: pickValue,
        match: "exact",
      },
      multi: pickTexts.length > 1,
    },
    commit,
    stageTimeouts: {
      openMs: Math.min(20000, timeout),
      panelMs: Math.min(20000, timeout),
      refreshMs: Math.min(20000, Math.max(1500, timeout)),
      pickMs: Math.min(20000, Math.max(1000, timeout)),
      commitMs: Math.min(20000, Math.max(1000, timeout)),
    },
    meta: {
      sourceText: cluster.kind,
      needsConfirm: true,
      notes: `confidence ${cluster.confidence}`,
    },
  };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function fingerprintLabel(fp: ElementFingerprint): string {
  return fp.ariaLabel ?? fp.labelText ?? fp.placeholder ?? fp.text ?? fp.name ?? fp.tag;
}
