import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { computeReadiness, lintFlow, type FlowNode, type FlowNodeType } from "@flowforge/dsl";
import { FlowCanvas } from "../flow/Canvas.js";
import { autoLayout } from "../flow/layout.js";
import { createDefaultNode, NODE_TITLES, useEditorStore } from "../flow/store.js";
import { NodeInspector } from "../components/NodeInspector.js";
import {
  EmptyState,
  Field,
  PageHeader,
  ReadinessBadge,
  SectionTitle,
  StatusBadge,
  toast,
} from "../components/ui.js";
import { api, ApiClientError } from "../lib/api.js";

const NODE_TYPES: FlowNodeType[] = ["navigate", "interact", "picker", "wait", "assert", "branch", "api"];

export function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"probe" | "single">("probe");
  const [datasetId, setDatasetId] = useState<string>("");
  const [publishing, setPublishing] = useState(false);
  const [running, setRunning] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flowQuery = useQuery({
    queryKey: ["flow", id],
    queryFn: () => api.flows.get(id!),
    enabled: Boolean(id),
  });
  const inspectorQuery = useQuery({ queryKey: ["inspector"], queryFn: api.inspector.current });

  const dsl = useEditorStore((state) => state.dsl);
  const layout = useEditorStore((state) => state.layout);
  const revision = useEditorStore((state) => state.revision);
  const dirty = useEditorStore((state) => state.dirty);
  const saving = useEditorStore((state) => state.saving);
  const conflict = useEditorStore((state) => state.conflict);
  const undoStack = useEditorStore((state) => state.undoStack);
  const redoStack = useEditorStore((state) => state.redoStack);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);

  useEffect(() => {
    if (!flowQuery.data) return;
    const store = useEditorStore.getState();
    if (store.flowId === flowQuery.data.id) return;
    store.load(flowQuery.data);
    useEditorStore.setState({ layout: autoLayout(flowQuery.data.dsl, flowQuery.data.layout) });
    setSelectedId(null);
    setMode(flowQuery.data.dsl.datasets?.length ? "single" : "probe");
    setDatasetId(flowQuery.data.dsl.datasets?.[0]?.id ?? "");
  }, [flowQuery.data]);

  useEffect(() => {
    if (!dsl || !dirty || conflict || !id) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const state = useEditorStore.getState();
      if (!state.dsl || !state.dirty) return;
      const sentDsl = JSON.stringify(state.dsl);
      const sentLayout = JSON.stringify(state.layout);
      state.markSaving(true);
      void api.flows
        .update(id, { dsl: state.dsl, layout: state.layout, revision: state.revision })
        .then((updated) => {
          useEditorStore.getState().markSaved(updated.revision, {
            dsl: sentDsl,
            layout: sentLayout,
          });
        })
        .catch((error: Error) => {
          useEditorStore.getState().markSaving(false);
          if (error instanceof ApiClientError && error.code === "FLOW_REVISION_CONFLICT") {
            useEditorStore.getState().setConflict(true);
            toast("流程已被其他窗口修改，请重新加载", "error");
          } else {
            toast(error.message, "error");
          }
        });
    }, 550);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [dsl, layout, dirty, conflict, id]);

  const local = useMemo(() => {
    if (!dsl) return null;
    return { readiness: computeReadiness(dsl), lint: lintFlow(dsl) };
  }, [dsl]);

  const gapNodeIds = useMemo(
    () =>
      new Set(
        (local?.readiness.gaps ?? [])
          .map((gap) => gap.nodeId)
          .filter((nodeId): nodeId is string => Boolean(nodeId)),
      ),
    [local],
  );

  if (flowQuery.isLoading) {
    return <div className="ff-panel p-10 text-center font-mono text-xs text-forge-400">loading flow…</div>;
  }
  if (flowQuery.isError || !flowQuery.data) {
    return (
      <EmptyState
        title="流程不存在"
        hint={(flowQuery.error as Error)?.message}
        action={
          <Link className="ff-btn" to="/">
            返回流程列表
          </Link>
        }
      />
    );
  }
  if (!dsl || !local) {
    return <div className="ff-panel p-10 text-center font-mono text-xs text-forge-400">initializing…</div>;
  }

  const flow = flowQuery.data;
  const selectedNode = dsl.nodes.find((node) => node.id === selectedId) ?? null;
  const levels = { probe: 2, single: 3 } as const;
  const lintErrors = local.lint.errors.length;
  const canRun = local.readiness.level >= levels[mode] && lintErrors === 0;
  const hasDatasets = (dsl.datasets ?? []).length > 0;
  const hasPublished = Boolean(flow.publishedVersion);

  const addNode = (type: FlowNodeType): void => {
    const system = dsl.systems[0];
    if (!system) {
      toast("流程缺少 system，请先在系统页面登记", "error");
      return;
    }
    let index = dsl.nodes.length + 1;
    let nodeId = `${type}-${index}`;
    while (dsl.nodes.some((node) => node.id === nodeId)) {
      index += 1;
      nodeId = `${type}-${index}`;
    }
    const node = createDefaultNode(type, system, nodeId);
    useEditorStore.getState().addNode(node, {
      x: 120 + (dsl.nodes.length % 3) * 290,
      y: 120 + Math.floor(dsl.nodes.length / 3) * 150,
    });
    setSelectedId(node.id);
    setShowAdd(false);
  };

  const publish = async (): Promise<void> => {
    if (local.readiness.level < 4) {
      toast(`发布要求 L4，当前 L${local.readiness.level}`, "error");
      return;
    }
    setPublishing(true);
    try {
      const version = await api.flows.publish(flow.id);
      await queryClient.invalidateQueries({ queryKey: ["flow", flow.id] });
      toast(`已发布 v${version.version}`, "success");
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setPublishing(false);
    }
  };

  const startRun = async (stopAtNodeId?: string): Promise<void> => {
    if (!canRun) {
      toast(`当前就绪度 L${local.readiness.level} 不满足 ${mode} 运行`, "error");
      return;
    }
    if (mode === "single" && !hasDatasets) {
      toast("single 模式需要至少一个数据集；先用 probe 探测试运行", "error");
      return;
    }
    if (mode === "single" && !hasPublished) {
      toast("single 运行需要先发布版本", "error");
      return;
    }
    setRunning(true);
    try {
      const run = await api.runs.start(flow.id, {
        datasetId: mode === "single" ? datasetId || dsl.datasets?.[0]?.id : undefined,
        mode,
        stopAtNodeId,
      });
      navigate(`/runs/${run.id}`);
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setRunning(false);
    }
  };

  const gaps = [...local.readiness.gaps, ...local.lint.errors, ...local.lint.warnings];

  return (
    <>
      <PageHeader
        kicker={`Flow / ${flow.id}`}
        title={dsl.meta.name}
        description={dsl.meta.description ?? "画布与检查器实时同步到同一份 DSL；布局单独存储。"}
        actions={
          <>
            <Link className="ff-btn ff-btn-ghost" to="/">
              ← 流程列表
            </Link>
            <ReadinessBadge level={local.readiness.level} />
            <span className="ff-badge">
              {saving ? "saving…" : dirty ? "dirty" : "saved"} · rev {revision}
            </span>
            {flow.publishedVersion ? <span className="ff-badge">v{flow.publishedVersion}</span> : null}
          </>
        }
      />

      {conflict ? (
        <div className="mb-4 flex items-center justify-between border border-rust-500/50 bg-rust-500/10 px-4 py-3">
          <span className="text-[12px] text-[#f0a58f]">本地草稿与服务器版本冲突。</span>
            <button
              className="ff-btn"
              onClick={async () => {
                try {
                  const latest = await api.flows.get(flow.id);
                  useEditorStore.getState().load(latest);
                  useEditorStore.setState({ layout: autoLayout(latest.dsl, latest.layout) });
                  setSelectedId(null);
                  toast("已加载服务器最新版本", "success");
                } catch (error) {
                  toast((error as Error).message, "error");
                }
              }}
            >
              重新加载
            </button>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <button className="ff-btn ff-btn-primary" onClick={() => setShowAdd((value) => !value)}>
            + 添加节点
          </button>
          {showAdd ? (
            <div className="absolute left-0 top-full z-30 mt-1 w-[230px] border border-forge-600 bg-forge-850 p-1 shadow-2xl">
              {NODE_TYPES.map((type) => (
                <button
                  key={type}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-[12px] hover:bg-forge-800"
                  onClick={() => addNode(type)}
                >
                  <span>{NODE_TITLES[type]}</span>
                  <span className="font-mono text-[9px] text-forge-400">{type}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          className="ff-btn"
          onClick={undo}
          disabled={undoStack.length === 0}
          title="撤销"
        >
          ↶ undo
        </button>
        <button className="ff-btn" onClick={redo} disabled={redoStack.length === 0} title="重做">
          ↷ redo
        </button>
        <span className="h-5 w-px bg-forge-700" />
        <select
          className="ff-select w-[130px] py-1"
          value={mode}
          onChange={(event) => setMode(event.target.value as "probe" | "single")}
        >
          <option value="probe">probe · L2</option>
          <option value="single">single · L3</option>
        </select>
        {mode === "single" ? (
          <select
            className="ff-select w-[150px] py-1"
            value={datasetId}
            onChange={(event) => setDatasetId(event.target.value)}
          >
            {(dsl.datasets ?? []).map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.name}
              </option>
            ))}
          </select>
        ) : null}
        <button
          className="ff-btn ff-btn-primary"
          onClick={() => startRun()}
          disabled={!canRun || running || (mode === "single" && !hasDatasets)}
        >
          {running ? "启动中…" : "▶ 运行"}
        </button>
        <button className="ff-btn" onClick={publish} disabled={publishing}>
          {publishing ? "发布中…" : "发布版本"}
        </button>
        <span className="ml-auto flex items-center gap-2">
          {lintErrors > 0 ? (
            <span className="ff-badge ff-badge-bad">{lintErrors} lint errors</span>
          ) : (
            <span className="ff-badge ff-badge-good">lint clean</span>
          )}
          {hasPublished ? null : <span className="ff-badge">draft · 未发布</span>}
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="min-w-0">
          <FlowCanvas
            dsl={dsl}
            layout={layout}
            gapNodeIds={gapNodeIds}
            onSelect={(nodeId) => {
              setSelectedId(nodeId);
            }}
          />

          <div className="ff-panel mt-3 max-h-[150px] overflow-auto">
            <div className="flex items-center gap-3 border-b border-forge-700 px-4 py-2">
              <span className="ff-kicker">Issue Panel</span>
              <span className="ff-badge">
                {(local.readiness.gaps ?? []).length} gaps
              </span>
              <span className="ff-badge ff-badge-bad">{local.lint.errors.length} errors</span>
              <span className="ff-badge">{local.lint.warnings.length} warnings</span>
            </div>
            <div className="divide-y divide-forge-700/60">
              {gaps.length === 0 ? (
                <div className="px-4 py-4 font-mono text-[10px] text-forge-400">
                  没有发现缺口。L{local.readiness.level} 就绪。
                </div>
              ) : (
                gaps.map((gap, index) => {
                  const item = gap as {
                    nodeId?: string;
                    severity?: string;
                    message: string;
                    path?: string;
                    code?: string;
                    fix?: string;
                  };
                  return (
                    <button
                      key={`${item.path ?? index}-${index}`}
                      className="flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-forge-800/50"
                      onClick={() => {
                        if (item.nodeId) setSelectedId(item.nodeId);
                      }}
                    >
                      <span
                        className={`mt-0.5 ff-badge ${
                          item.severity === "error" || item.code
                            ? "ff-badge-bad"
                            : "ff-badge-ember"
                        }`}
                      >
                        {item.severity ?? item.code ?? "gap"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] text-forge-300">{item.message}</span>
                        <span className="mt-0.5 block font-mono text-[9px] text-forge-400">
                          {item.path}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <aside className="ff-card max-h-[calc(100vh-250px)] overflow-auto p-4">
          {selectedNode ? (
            <NodeInspector
              key={selectedNode.id}
              node={selectedNode}
              dsl={dsl}
              session={inspectorQuery.data ?? null}
              isEntry={dsl.entry === selectedNode.id}
              onUpdate={(patch) => useEditorStore.getState().updateNode(selectedNode.id, patch)}
              onReplace={(node) => useEditorStore.getState().replaceNode(selectedNode.id, node)}
              onDelete={() => {
                useEditorStore.getState().removeNode(selectedNode.id);
                setSelectedId(null);
              }}
              onSetEntry={() => useEditorStore.getState().setEntry(selectedNode.id)}
              onRunTo={() => startRun(selectedNode.id)}
            />
          ) : (
            <FlowInspector
              dsl={dsl}
              flow={flow}
              readiness={local.readiness.level}
              revision={revision}
            />
          )}
        </aside>
      </div>
    </>
  );
}

function FlowInspector({
  dsl,
  flow,
  readiness,
  revision,
}: {
  dsl: NonNullable<ReturnType<typeof useEditorStore.getState>["dsl"]>;
  flow: { id: string; publishedVersion: number | null };
  readiness: number;
  revision: number;
}) {
  const setMeta = useEditorStore((state) => state.setMeta);
  const setDefaults = useEditorStore((state) => state.setDefaults);
  return (
    <div className="space-y-5">
      <div>
        <div className="ff-kicker">Flow Inspector</div>
        <div className="ff-display mt-1 text-xl">{dsl.meta.name}</div>
        <div className="mt-1 flex gap-2">
          <ReadinessBadge level={readiness} />
          <span className="ff-badge">rev {revision}</span>
          {flow.publishedVersion ? <span className="ff-badge">v{flow.publishedVersion}</span> : null}
        </div>
      </div>
      <SectionTitle index="01">流程元信息</SectionTitle>
      <Field label="名称">
        <input
          className="ff-input"
          value={dsl.meta.name}
          onChange={(event) => setMeta({ name: event.target.value })}
        />
      </Field>
      <Field label="描述">
        <textarea
          className="ff-textarea h-[70px]"
          value={dsl.meta.description ?? ""}
          onChange={(event) => setMeta({ description: event.target.value })}
        />
      </Field>
      <Field label="标签（逗号分隔）">
        <input
          className="ff-input"
          value={(dsl.meta.tags ?? []).join(",")}
          onChange={(event) =>
            setMeta({
              tags: event.target.value
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            })
          }
        />
      </Field>
      <SectionTitle index="02">执行默认值</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <Field label="节点预算 ms">
          <input
            className="ff-input"
            type="number"
            value={dsl.defaults?.nodeTimeoutMs ?? 15000}
            onChange={(event) => setDefaults({ nodeTimeoutMs: Number(event.target.value) })}
          />
        </Field>
        <Field label="picker 预算 ms">
          <input
            className="ff-input"
            type="number"
            value={dsl.defaults?.pickerTimeoutMs ?? 30000}
            onChange={(event) => setDefaults({ pickerTimeoutMs: Number(event.target.value) })}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="截图">
          <select
            className="ff-select"
            value={dsl.defaults?.screenshot ?? "onFailure"}
            onChange={(event) =>
              setDefaults({ screenshot: event.target.value as "onFailure" | "always" | "never" })
            }
          >
            <option value="onFailure">onFailure</option>
            <option value="always">always</option>
            <option value="never">never</option>
          </select>
        </Field>
        <Field label="资源策略">
          <select
            className="ff-select"
            value={dsl.defaults?.resourcePolicy ?? "balanced"}
            onChange={(event) =>
              setDefaults({ resourcePolicy: event.target.value as "balanced" | "fast" | "accurate" })
            }
          >
            <option value="balanced">balanced</option>
            <option value="fast">fast</option>
            <option value="accurate">accurate</option>
          </select>
        </Field>
      </div>
      <SectionTitle index="03">数据集</SectionTitle>
      {(dsl.datasets ?? []).length === 0 ? (
        <p className="text-[12px] text-forge-400">尚无数据集；只能 probe 运行，或使用流程变量与字面值。</p>
      ) : (
        <div className="space-y-2">
          {(dsl.datasets ?? []).map((dataset) => (
            <div key={dataset.id} className="border border-forge-700 p-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-paper">{dataset.name}</span>
                <span className="font-mono text-[9px] text-forge-400">{dataset.id}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {Object.keys(dataset.columns).map((column) => (
                  <span key={column} className="ff-badge">
                    {column}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <SectionTitle index="04">系统</SectionTitle>
      {dsl.systems.map((system) => (
        <div key={system.id} className="border border-forge-700 p-2">
          <div className="text-[12px] text-paper">{system.name}</div>
          <div className="font-mono text-[10px] text-forge-400">{system.baseUrl}</div>
        </div>
      ))}
      <div className="border-t border-forge-700 pt-3">
        <div className="ff-kicker">flow id</div>
        <div className="mt-1 break-all font-mono text-[10px] text-forge-400">{flow.id}</div>
      </div>
    </div>
  );
}
