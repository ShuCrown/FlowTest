import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { FlowNode } from "@flowforge/dsl";
import { NODE_TITLES } from "./store.js";

export type EditorNodeData = {
  node: FlowNode;
  isEntry: boolean;
  hasGap: boolean;
  [key: string]: unknown;
};

export type EditorNode = Node<EditorNodeData, "flowNode">;

const TYPE_LABEL: Record<string, string> = {
  navigate: "NAV",
  interact: "ACT",
  picker: "PCK",
  wait: "WAI",
  assert: "AST",
  branch: "BRN",
  api: "API",
};

const TYPE_COLOR: Record<string, string> = {
  navigate: "#6ea8c9",
  interact: "#f0a23a",
  picker: "#d36142",
  wait: "#8b929d",
  assert: "#64b39f",
  branch: "#c9a227",
  api: "#7f8fd0",
};

export function FlowNodeCard({ data, selected }: NodeProps<EditorNode>) {
  const node = data.node;
  const color = TYPE_COLOR[node.type] ?? "#8b929d";
  const summary = nodeSummary(node);
  return (
    <div
      className="ff-node-card w-[240px] border border-forge-600 bg-forge-850/95 text-left shadow-xl transition-shadow"
      style={{ borderLeft: `3px solid ${color}`, opacity: node.enabled === false ? 0.5 : 1 }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center justify-between border-b border-forge-700/70 px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-[10px] tracking-[0.16em]"
            style={{ color }}
          >
            {TYPE_LABEL[node.type] ?? node.type}
          </span>
          <span className="font-mono text-[9px] text-forge-400">{node.id}</span>
        </div>
        <div className="flex items-center gap-1">
          {data.isEntry ? (
            <span className="border border-ember-500/50 bg-ember-500/10 px-1 font-mono text-[8px] text-ember-400">
              ENTRY
            </span>
          ) : null}
          {data.hasGap ? (
            <span className="border border-rust-500/60 bg-rust-500/10 px-1 font-mono text-[8px] text-[#f0a58f]">
              GAP
            </span>
          ) : null}
          {node.meta?.needsConfirm ? (
            <span className="border border-ember-500/60 bg-ember-500/10 px-1 font-mono text-[8px] text-ember-400">
              ?
            </span>
          ) : null}
        </div>
      </div>
      <div className="px-3 py-2.5">
        <div className="truncate text-[15px] font-medium text-paper">
          {node.name ?? NODE_TITLES[node.type]}
        </div>
        <div className="mt-1 truncate font-mono text-[11px] text-forge-400">{summary}</div>
        {node.type !== "branch" && node.type !== "wait" && node.type !== "assert" ? (
          <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-forge-400/70">
            {node.system ?? "—"}
          </div>
        ) : null}
      </div>
      {node.type === "branch" ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="then"
            style={{ top: "36%", background: "#64b39f", borderColor: "#64b39f" }}
          />
          <span className="pointer-events-none absolute right-[-20px] top-[28%] font-mono text-[9px] text-moss-400">
            T
          </span>
          <Handle
            type="source"
            position={Position.Right}
            id="else"
            style={{ top: "68%", background: "#d36142", borderColor: "#d36142" }}
          />
          <span className="pointer-events-none absolute right-[-20px] top-[60%] font-mono text-[9px] text-[#f0a58f]">
            E
          </span>
        </>
      ) : (
        <Handle type="source" position={Position.Right} />
      )}
      {selected ? <div className="absolute inset-0 border border-ember-500/50" /> : null}
    </div>
  );
}

function nodeSummary(node: FlowNode): string {
  switch (node.type) {
    case "navigate":
      return `${node.waitUntil ?? "domcontentloaded"} · ${node.url}`;
    case "interact": {
      const target = node.target.label ?? node.target.strategies[0]?.type ?? "target";
      return `${node.adapter} · ${target}`;
    }
    case "picker":
      return `${node.mode} · ${node.pick.strategy} · ${node.trigger.label ?? "trigger"}`;
    case "wait":
      return typeof node.condition === "string" ? node.condition : node.condition.kind;
    case "assert":
      return typeof node.condition === "string" ? node.condition : node.condition.kind;
    case "branch":
      return `${node.condition.op} · ${
        "left" in node.condition && node.condition.left && "column" in node.condition.left
          ? node.condition.left.column
          : "value"
      }`;
    case "api":
      return `${node.method} ${node.url}`;
  }
}
