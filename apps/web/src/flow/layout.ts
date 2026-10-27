import dagre from "@dagrejs/dagre";
import type { FlowDsl } from "@flowforge/dsl";
import type { Layout } from "../lib/types.js";

const NODE_WIDTH = 240;
const NODE_HEIGHT = 104;

export function autoLayout(dsl: FlowDsl, existing: Layout | null): Layout {
  const nodes = { ...(existing?.nodes ?? {}) };
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", nodesep: 48, ranksep: 100, marginx: 60, marginy: 60 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of dsl.nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of dsl.edges) {
    if (dsl.nodes.some((node) => node.id === edge.from) && dsl.nodes.some((node) => node.id === edge.to)) {
      graph.setEdge(edge.from, edge.to);
    }
  }
  dagre.layout(graph);

  const hasManualLayout = Object.keys(nodes).length > 0;
  if (!hasManualLayout && dsl.nodes.length > 4) {
    // 长链默认折成 4 列蛇形，避免 fitView 把单行流程压到不可读的缩放。
    const ordered = [...dsl.nodes].sort((a, b) => {
      const left = graph.node(a.id) as { x?: number; y?: number } | undefined;
      const right = graph.node(b.id) as { x?: number; y?: number } | undefined;
      return (left?.x ?? 0) - (right?.x ?? 0) || (left?.y ?? 0) - (right?.y ?? 0);
    });
    const columns = 3;
    ordered.forEach((node, index) => {
      const row = Math.floor(index / columns);
      const rawColumn = index % columns;
      const column = row % 2 === 0 ? rawColumn : columns - 1 - rawColumn;
      nodes[node.id] = {
        x: 80 + column * 290,
        y: 70 + row * 180,
      };
    });
    return { ...(existing ?? { nodes: {} }), nodes };
  }

  dsl.nodes.forEach((node, index) => {
    if (nodes[node.id]) return;
    const laid = graph.node(node.id) as { x?: number; y?: number } | undefined;
    if (laid?.x !== undefined && laid?.y !== undefined) {
      nodes[node.id] = { x: laid.x - NODE_WIDTH / 2, y: laid.y - NODE_HEIGHT / 2 };
    } else {
      nodes[node.id] = { x: 120 + index * 60, y: 120 + index * 40 };
    }
  });
  return { ...(existing ?? { nodes: {} }), nodes };
}
