import { create } from "zustand";
import type {
  Constraint,
  Dataset,
  FlowDsl,
  FlowEdge,
  FlowNode,
  FlowNodeType,
  SystemConfig,
  TargetRef,
} from "@flowforge/dsl";
import type { FlowDetail, Layout } from "../lib/types.js";

interface Snapshot {
  dsl: FlowDsl;
  layout: Layout;
}

export interface EditorState {
  flowId: string | null;
  dsl: FlowDsl | null;
  layout: Layout;
  revision: number;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  undoStack: Snapshot[];
  redoStack: Snapshot[];
  load: (flow: FlowDetail) => void;
  updateNode: (id: string, patch: Record<string, unknown>) => void;
  replaceNode: (id: string, node: FlowNode) => void;
  addNode: (node: FlowNode, position: { x: number; y: number }) => void;
  removeNode: (id: string) => void;
  connect: (from: string, to: string, when?: "then" | "else") => void;
  disconnect: (from: string, to: string, when?: "then" | "else") => void;
  moveNode: (id: string, position: { x: number; y: number }) => void;
  setEntry: (id: string) => void;
  setMeta: (patch: Partial<FlowDsl["meta"]>) => void;
  setDefaults: (patch: Partial<NonNullable<FlowDsl["defaults"]>>) => void;
  setDatasets: (datasets: Dataset[]) => void;
  setConstraints: (constraints: Constraint[]) => void;
  setVars: (vars: Record<string, import("@flowforge/dsl").ValueLike>) => void;
  undo: () => void;
  redo: () => void;
  markSaving: (saving: boolean) => void;
  markSaved: (revision: number, sent: { dsl: string; layout: string }) => void;
  setConflict: (conflict: boolean) => void;
}

const EMPTY_LAYOUT: Layout = { nodes: {} };

export const useEditorStore = create<EditorState>((set, get) => ({
  flowId: null,
  dsl: null,
  layout: EMPTY_LAYOUT,
  revision: 0,
  dirty: false,
  saving: false,
  conflict: false,
  undoStack: [],
  redoStack: [],

  load: (flow) =>
    set({
      flowId: flow.id,
      dsl: structuredClone(flow.dsl),
      layout: flow.layout ?? EMPTY_LAYOUT,
      revision: flow.revision,
      dirty: false,
      saving: false,
      conflict: false,
      undoStack: [],
      redoStack: [],
    }),

  updateNode: (id, patch) => {
    const state = get();
    if (!state.dsl) return;
    mutate(state, (dsl) => {
      dsl.nodes = dsl.nodes.map((node) =>
        node.id === id ? ({ ...node, ...patch } as FlowNode) : node,
      );
    });
  },

  replaceNode: (id, node) => {
    get().updateNode(id, node as unknown as Record<string, unknown>);
  },

  addNode: (node, position) => {
    const state = get();
    if (!state.dsl) return;
    mutate(state, (dsl) => {
      dsl.nodes.push(node);
      if (!dsl.entry) dsl.entry = node.id;
    });
    set((current) => ({
      layout: {
        ...current.layout,
        nodes: { ...current.layout.nodes, [node.id]: position },
      },
    }));
  },

  removeNode: (id) => {
    const state = get();
    if (!state.dsl) return;
    mutate(state, (dsl) => {
      dsl.nodes = dsl.nodes.filter((node) => node.id !== id);
      dsl.edges = dsl.edges.filter((edge) => edge.from !== id && edge.to !== id);
      if (dsl.entry === id) dsl.entry = dsl.nodes[0]?.id ?? "";
    });
    const layout = { ...state.layout.nodes };
    delete layout[id];
    set({ layout: { ...state.layout, nodes: layout } });
  },

  connect: (from, to, when) => {
    const state = get();
    if (!state.dsl) return;
    const source = state.dsl.nodes.find((node) => node.id === from);
    if (!source) return;
    const label = source.type === "branch" ? when : undefined;
    if (source.type === "branch" && !label) return;
    mutate(state, (dsl) => {
      if (source.type !== "branch") {
        dsl.edges = dsl.edges.filter((edge) => edge.from !== from);
      } else {
        dsl.edges = dsl.edges.filter((edge) => !(edge.from === from && edge.when === label));
      }
      dsl.edges.push(label ? { from, to, when: label } : { from, to });
    });
  },

  disconnect: (from, to, when) => {
    const state = get();
    if (!state.dsl) return;
    mutate(state, (dsl) => {
      dsl.edges = dsl.edges.filter(
        (edge) => !(edge.from === from && edge.to === to && edge.when === when),
      );
    });
  },

  moveNode: (id, position) => {
    set((state) => {
      const before = snapshot(state);
      return {
        layout: { ...state.layout, nodes: { ...state.layout.nodes, [id]: position } },
        dirty: true,
        undoStack: [...state.undoStack, before].slice(-50),
        redoStack: [],
      };
    });
  },

  setEntry: (id) => {
    const state = get();
    if (!state.dsl) return;
    mutate(state, (dsl) => {
      dsl.entry = id;
    });
  },

  setMeta: (patch) => {
    const state = get();
    if (!state.dsl) return;
    mutate(state, (dsl) => {
      dsl.meta = { ...dsl.meta, ...patch };
    });
  },

  setDefaults: (patch) => {
    const state = get();
    if (!state.dsl) return;
    mutate(state, (dsl) => {
      dsl.defaults = { ...(dsl.defaults ?? {}), ...patch };
    });
  },

  setDatasets: (datasets) => {
    const state = get();
    if (!state.dsl) return;
    mutate(state, (dsl) => {
      dsl.datasets = datasets;
    });
  },

  setConstraints: (constraints) => {
    const state = get();
    if (!state.dsl) return;
    mutate(state, (dsl) => {
      dsl.constraints = constraints;
    });
  },

  setVars: (vars) => {
    const state = get();
    if (!state.dsl) return;
    mutate(state, (dsl) => {
      dsl.vars = vars;
    });
  },

  undo: () => {
    const state = get();
    const previous = state.undoStack[state.undoStack.length - 1];
    if (!previous) return;
    set({
      dsl: structuredClone(previous.dsl),
      layout: structuredClone(previous.layout),
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, snapshot(state)].slice(-50),
      dirty: true,
    });
  },

  redo: () => {
    const state = get();
    const next = state.redoStack[state.redoStack.length - 1];
    if (!next) return;
    set({
      dsl: structuredClone(next.dsl),
      layout: structuredClone(next.layout),
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, snapshot(state)].slice(-50),
      dirty: true,
    });
  },

  markSaving: (saving) => set({ saving }),
  markSaved: (revision, sent) => {
    const state = get();
    if (!state.dsl) return;
    const unchanged =
      JSON.stringify(state.dsl) === sent.dsl && JSON.stringify(state.layout) === sent.layout;
    set({
      revision,
      saving: false,
      dirty: unchanged ? false : state.dirty,
      conflict: false,
    });
  },
  setConflict: (conflict) => set({ conflict }),
}));

function mutate(state: EditorState, mutator: (dsl: FlowDsl) => void): void {
  if (!state.dsl) return;
  const before = snapshot(state);
  const next = structuredClone(state.dsl);
  mutator(next);
  useEditorStore.setState({
    dsl: next,
    dirty: true,
    undoStack: [...state.undoStack, before].slice(-50),
    redoStack: [],
  });
}

function snapshot(state: EditorState): Snapshot {
  return {
    dsl: state.dsl ? structuredClone(state.dsl) : emptyDsl(),
    layout: structuredClone(state.layout),
  };
}

function emptyDsl(): FlowDsl {
  return {
    dslVersion: "1.0",
    meta: { name: "空流程" },
    systems: [],
    nodes: [],
    edges: [],
    entry: "",
  };
}

export function defaultTarget(label = "未配置目标"): TargetRef {
  return {
    label,
    strategies: [{ type: "label", value: label }],
    strict: true,
  };
}

export function createDefaultNode(
  type: FlowNodeType,
  system: SystemConfig,
  id: string,
): FlowNode {
  const base = { id, name: NODE_TITLES[type], system: system.id, enabled: true };
  switch (type) {
    case "navigate":
      return {
        ...base,
        type,
        url: "/",
        waitUntil: "domcontentloaded",
        readySignal: "page-ready",
      };
    case "interact":
      return {
        ...base,
        type,
        adapter: "click",
        target: defaultTarget(),
        meta: { needsConfirm: true },
      };
    case "picker":
      return {
        ...base,
        type,
        mode: "dialog",
        trigger: defaultTarget("选择触发器"),
        panel: {
          scope: { type: "dialog" },
          readySignal: "content-stable",
        },
        pick: {
          strategy: "byText",
          byText: { value: "未配置选项", match: "exact" },
        },
        meta: { needsConfirm: true },
      };
    case "wait":
      return {
        ...base,
        type,
        system: undefined,
        condition: {
          kind: "visible",
          target: defaultTarget(),
          timeoutMs: 5000,
        },
      };
    case "assert":
      return {
        ...base,
        type,
        system: undefined,
        condition: {
          kind: "text",
          target: defaultTarget(),
          contains: "期望文本",
        },
        message: "断言未配置",
        meta: { needsConfirm: true },
      };
    case "branch":
      return {
        ...base,
        type,
        system: undefined,
        condition: { op: "gt", left: { column: "amount" }, right: { value: 1000 } },
        meta: { needsConfirm: true },
      };
    case "api":
      return {
        ...base,
        type,
        method: "GET",
        url: "/api/health",
        expectStatus: 200,
      };
    default:
      throw new Error(`unknown node type: ${String(type)}`);
  }
}

export const NODE_TITLES: Record<FlowNodeType, string> = {
  navigate: "导航",
  interact: "交互",
  picker: "复合选择",
  wait: "等待",
  assert: "断言",
  branch: "分支",
  api: "接口",
};

export function edgesFor(dsl: FlowDsl): FlowEdge[] {
  return dsl.edges;
}
