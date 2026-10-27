import type { PresetName, SignalRef, TargetRef, WaitSignal } from "./schema.js";

/**
 * 内置等待预设展开。preset 在不指定 target 时退化为页面级 DOM 稳定。
 * 预设是编译期概念，DSL 中只保存预设名。
 */
export function expandSignalRef(ref: SignalRef, target?: TargetRef): WaitSignal {
  if (typeof ref !== "string") return ref;
  return expandPreset(ref, target);
}

export function expandPreset(name: PresetName, target?: TargetRef): WaitSignal {
  switch (name) {
    case "page-ready":
      return {
        kind: "all",
        of: [
          { kind: "domStable", quietMs: 600, maxMs: 8000 },
          ...(target ? [{ kind: "visible" as const, target, optional: true }] : []),
        ],
      };
    case "content-stable":
      return { kind: "domStable", quietMs: 200, maxMs: 8000, target };
    case "list-ready":
      return {
        kind: "all",
        of: [
          { kind: "domStable", quietMs: 200, maxMs: 8000, target },
          ...(target
            ? [{ kind: "count" as const, target, min: 1, stableMs: 400, optional: true }]
            : []),
        ],
      };
    case "dialog-ready":
      return {
        kind: "all",
        of: [
          target
            ? { kind: "visible", target }
            : { kind: "visible", target: { strategies: [{ type: "role", role: "dialog" }] } },
          { kind: "domStable", quietMs: 200, maxMs: 8000, target },
        ],
      };
    case "option-ready":
      return {
        kind: "all",
        of: [
          ...(target ? [{ kind: "visible" as const, target }] : []),
          { kind: "domStable", quietMs: 150, maxMs: 8000, target },
        ],
      };
    case "save-ready":
      return {
        kind: "all",
        of: [
          { kind: "domStable", quietMs: 200, maxMs: 8000 },
          ...(target ? [{ kind: "text" as const, target, contains: "" }] : []),
        ],
      };
  }
}

export const PRESET_DESCRIPTIONS: Record<PresetName, string> = {
  "page-ready": "DOM 稳定 600ms（最长 8s），可选关键元素可见",
  "content-stable": "DOM 稳定 200ms（最长 8s）",
  "list-ready": "列表至少 1 项且数量稳定 400ms",
  "dialog-ready": "dialog 可见 + DOM 稳定",
  "option-ready": "选项容器可见 + 选项数量稳定 300ms",
  "save-ready": "DOM 稳定 + 可选 toast",
};
