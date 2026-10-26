import { useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import type { FlowDsl } from "@flowforge/dsl";
import type { Layout } from "../lib/types.js";
import { FlowNodeCard, type EditorNode, type EditorNodeData } from "./nodeTypes.js";
import { useEditorStore } from "./store.js";

const nodeTypes = { flowNode: FlowNodeCard };

export function FlowCanvas({
  dsl,
  layout,
  gapNodeIds,
  onSelect,
}: {
  dsl: FlowDsl;
  layout: Layout;
  gapNodeIds: Set<string>;
  onSelect: (id: string | null) => void;
}) {
  const connect = useEditorStore((state) => state.connect);
  const disconnect = useEditorStore((state) => state.disconnect);
  const removeNode = useEditorStore((state) => state.removeNode);
  const moveNode = useEditorStore((state) => state.moveNode);

  const derivedNodes = useMemo<EditorNode[]>(
    () =>
      dsl.nodes.map((node) => {
        const position = layout.nodes[node.id] ?? { x: 120, y: 120 };
        return {
          id: node.id,
          type: "flowNode",
          position,
          data: {
            node,
            isEntry: dsl.entry === node.id,
            hasGap: gapNodeIds.has(node.id),
          } satisfies EditorNodeData,
        };
      }),
    [dsl, layout, gapNodeIds],
  );

  const derivedEdges = useMemo<Edge[]>(
    () =>
      dsl.edges.map((edge) => ({
        id: `${edge.from}->${edge.to}->${edge.when ?? "next"}`,
        source: edge.from,
        target: edge.to,
        sourceHandle: edge.when,
        label: edge.when,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, color: "#5d6672", width: 14, height: 14 },
        labelStyle: { fill: "#f0a23a", fontFamily: "var(--font-mono)", fontSize: 10 },
        style: { stroke: "#5d6672" },
      })),
    [dsl.edges],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(derivedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(derivedEdges);

  useEffect(() => {
    setNodes(derivedNodes);
  }, [derivedNodes, setNodes]);
  useEffect(() => {
    setEdges(derivedEdges);
  }, [derivedEdges, setEdges]);

  const instanceRef = useRef<ReactFlowInstance | null>(null);
  const nodeCount = dsl.nodes.length;
  useEffect(() => {
    if (!instanceRef.current) return;
    const timer = setTimeout(() => {
      void instanceRef.current?.fitView({ padding: 0.2, minZoom: 0.5, maxZoom: 0.95 });
    }, 380);
    return () => clearTimeout(timer);
  }, [nodeCount]);

  return (
    <div className="ff-panel relative h-[calc(100vh-390px)] min-h-[400px] overflow-hidden">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={(instance) => {
            instanceRef.current = instance;
            setTimeout(() => {
              void instance.fitView({ padding: 0.2, minZoom: 0.5, maxZoom: 0.95 });
            }, 120);
          }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, node) => onSelect(node.id)}
          onNodeDragStop={(_, node) => moveNode(node.id, node.position)}
          onConnect={(connection: Connection) => {
            if (!connection.source || !connection.target) return;
            const when =
              connection.sourceHandle === "then" || connection.sourceHandle === "else"
                ? connection.sourceHandle
                : undefined;
            connect(connection.source, connection.target, when);
            setEdges((current) =>
              addEdge(
                {
                  id: `${connection.source}->${connection.target}->${when ?? "next"}`,
                  source: connection.source!,
                  target: connection.target!,
                  sourceHandle: connection.sourceHandle ?? undefined,
                  label: when,
                  type: "smoothstep",
                  markerEnd: { type: MarkerType.ArrowClosed, color: "#5d6672" },
                },
                current,
              ),
            );
          }}
          onNodesDelete={(deleted) => {
            for (const node of deleted) removeNode(node.id);
          }}
          onEdgesDelete={(deleted) => {
            for (const edge of deleted) {
              const when =
                edge.sourceHandle === "then" || edge.sourceHandle === "else"
                  ? edge.sourceHandle
                  : undefined;
              disconnect(edge.source, edge.target, when);
            }
          }}
          isValidConnection={(connection) => {
            if (!connection.source || !connection.target) return false;
            if (connection.source === connection.target) return false;
            const source = dsl.nodes.find((node) => node.id === connection.source);
            if (source?.type === "branch") {
              return connection.sourceHandle === "then" || connection.sourceHandle === "else";
            }
            return true;
          }}
          onPaneClick={() => onSelect(null)}
          fitView
          fitViewOptions={{ padding: 0.2, minZoom: 0.5, maxZoom: 0.95 }}
          minZoom={0.3}
          maxZoom={1.8}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: "smoothstep" }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#2a3038" />
          <Controls position="bottom-left" showInteractive={false} />
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            style={{ width: 140, height: 100 }}
            nodeColor={(node) => {
              const data = node.data as EditorNodeData | undefined;
              const type = data?.node.type;
              return type === "picker"
                ? "#d36142"
                : type === "interact"
                  ? "#f0a23a"
                  : type === "assert"
                    ? "#64b39f"
                    : "#414852";
            }}
            maskColor="rgba(8,9,11,0.7)"
          />
          {dsl.nodes.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
              <div className="ff-kicker">empty canvas</div>
              <div className="ff-display text-2xl text-paper">从左上角添加第一个节点</div>
              <div className="max-w-sm text-[12px] text-forge-400">
                节点图是无环有向图。branch 节点会有 then / else 两个出边。
              </div>
            </div>
          ) : null}
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
