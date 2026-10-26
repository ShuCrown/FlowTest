import type { ElementFingerprint, RawEvent } from "./collector.js";
import { fingerprintToTarget } from "./collector.js";
import type { TargetRef } from "@flowforge/dsl";

export const SEGMENT_RULE_VERSION = "segment@1";

export interface InteractionCluster {
  id: string;
  kind: "picker" | "interact" | "mixed";
  startT: number;
  endT: number;
  mode?: "inline" | "dialog";
  trigger?: { fp: ElementFingerprint; target: TargetRef };
  panel?: { role: string; title?: string };
  filters: Array<{
    kind: string;
    fp: ElementFingerprint;
    value?: string;
    checked?: boolean;
    redacted?: boolean;
    evidence: number;
  }>;
  picks: Array<{ fp: ElementFingerprint; evidence: number }>;
  commit?: { fp: ElementFingerprint; evidence: number };
  navigate?: { url: string };
  evidence: number[];
  confidence: number;
  needsConfirm: boolean;
}

export interface SegmentResult {
  clusters: InteractionCluster[];
  ruleVersion: string;
  totalEvents: number;
}

const COMMIT_LABEL = /保存|确定|提交|确认|发布|删除/i;

export function segmentEvents(events: RawEvent[]): SegmentResult {
  const browserEvents = events
    .map((event, index) => ({ event, index }))
    .filter(
      (item): item is { event: Extract<RawEvent, { t: number }>; index: number } =>
        !("source" in item.event) && "t" in item.event,
    )
    .sort((a, b) => a.event.t - b.event.t);
  const clusters: InteractionCluster[] = [];
  let counter = 0;
  let i = 0;

  while (i < browserEvents.length) {
    const { event, index } = browserEvents[i]!;

    if (event.kind === "click") {
      const overlay = findOverlayOpen(browserEvents, i + 1, 800);
      if (overlay) {
        const cluster = buildPickerCluster(browserEvents, i, overlay.position);
        cluster.id = `cluster_${++counter}`;
        clusters.push(cluster);
        i = overlay.closePosition >= 0 ? overlay.closePosition + 1 : overlay.position + 1;
        continue;
      }
      clusters.push({
        id: `cluster_${++counter}`,
        kind: "interact",
        startT: event.t,
        endT: event.t,
        trigger: { fp: event.fp, target: fingerprintToTarget(event.fp) },
        filters: [],
        picks: [],
        evidence: [index],
        confidence: 0.8,
        needsConfirm: false,
      });
      i += 1;
      continue;
    }

    if (event.kind === "input" || event.kind === "change") {
      const eventsInCluster: number[] = [index];
      const filters: InteractionCluster["filters"] = [
        {
          kind: event.kind,
          fp: event.fp,
          value: event.value,
          checked: event.checked,
          redacted: event.redacted,
          evidence: index,
        },
      ];
      let endT = event.t;
      let j = i + 1;
      while (j < browserEvents.length) {
        const next = browserEvents[j]!;
        if (next.event.kind !== "input" && next.event.kind !== "change") break;
        if (next.event.t - endT > 2000) break;
        filters.push({
          kind: next.event.kind,
          fp: next.event.fp,
          value: next.event.value,
          checked: next.event.checked,
          redacted: next.event.redacted,
          evidence: next.index,
        });
        eventsInCluster.push(next.index);
        endT = next.event.t;
        j += 1;
      }
      const first = event.fp;
      clusters.push({
        id: `cluster_${++counter}`,
        kind: "interact",
        startT: event.t,
        endT,
        trigger: { fp: first, target: fingerprintToTarget(first) },
        filters,
        picks: [],
        evidence: eventsInCluster,
        confidence: 0.85,
        needsConfirm: false,
      });
      i = j;
      continue;
    }

    i += 1;
  }

  return { clusters, ruleVersion: SEGMENT_RULE_VERSION, totalEvents: events.length };
}

function findOverlayOpen(
  events: Array<{ event: RawEvent; index: number }>,
  from: number,
  windowMs: number,
): { position: number; closePosition: number } | null {
  const startEvent = events[from - 1]?.event;
  if (!startEvent || !("t" in startEvent)) return null;
  for (let pos = from; pos < events.length; pos += 1) {
    const item = events[pos]!;
    if (!("t" in item.event)) break;
    if (item.event.kind === "overlay-open") {
      if (item.event.t - startEvent.t > windowMs) return null;
      let closePosition = -1;
      for (let j = pos + 1; j < events.length; j += 1) {
        const next = events[j]!;
        if ("t" in next.event && next.event.kind === "overlay-close") {
          closePosition = j;
          break;
        }
        if ("t" in next.event && next.event.t - item.event.t > 120000) break;
      }
      return { position: pos, closePosition };
    }
    if ("t" in item.event && item.event.t - startEvent.t > windowMs) return null;
  }
  return null;
}

function buildPickerCluster(
  events: Array<{ event: RawEvent; index: number }>,
  clickPosition: number,
  overlayPosition: number,
): InteractionCluster {
  const click = events[clickPosition]!.event as Extract<RawEvent, { kind: "click" }>;
  const open = events[overlayPosition]!.event as Extract<RawEvent, { kind: "overlay-open" }>;
  const evidence: number[] = [events[clickPosition]!.index, events[overlayPosition]!.index];
  const filters: InteractionCluster["filters"] = [];
  const picks: InteractionCluster["picks"] = [];
  let commit: InteractionCluster["commit"] | undefined;
  let endT = open.t;

  for (let pos = overlayPosition + 1; pos < events.length; pos += 1) {
    const item = events[pos]!;
    if (!("t" in item.event)) continue;
    const event = item.event;
    if (event.kind === "overlay-close") {
      endT = event.t;
      evidence.push(item.index);
      break;
    }
    if (event.t - open.t > 120000) break;
    evidence.push(item.index);
    endT = event.t;

    if (event.kind === "input" || event.kind === "change") {
      filters.push({
        kind: event.kind,
        fp: event.fp,
        value: event.value,
        checked: event.checked,
        redacted: event.redacted,
        evidence: item.index,
      });
    } else if (event.kind === "click") {
      const label = event.fp.text ?? event.fp.ariaLabel ?? event.fp.labelText ?? "";
      const isCommit = COMMIT_LABEL.test(label) && event.fp.tag === "button";
      if (isCommit) {
        commit = { fp: event.fp, evidence: item.index };
      } else {
        picks.push({ fp: event.fp, evidence: item.index });
      }
    }
  }

  return {
    id: "",
    kind: "picker",
    startT: click.t,
    endT,
    mode: open.role === "listbox" || open.role === "menu" ? "inline" : "dialog",
    trigger: { fp: click.fp, target: fingerprintToTarget(click.fp) },
    panel: { role: open.role, title: open.title },
    filters,
    picks,
    commit,
    evidence,
    confidence: 0.65,
    needsConfirm: true,
  };
}
