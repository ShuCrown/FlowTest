import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { EmptyState, PageHeader, SectionTitle, StatusBadge, toast } from "../components/ui.js";
import { api } from "../lib/api.js";

export function RepairPage() {
  const queryClient = useQueryClient();
  const [flowId, setFlowId] = useState("");
  const [replaceNode, setReplaceNode] = useState<string | null>(null);
  const [strategyText, setStrategyText] = useState('{"type":"label","value":"客户全称"}');

  const flows = useQuery({ queryKey: ["flows"], queryFn: api.flows.list });
  useEffect(() => {
    if (!flowId && flows.data?.[0]) setFlowId(flows.data[0].id);
  }, [flows.data, flowId]);

  const healed = useQuery({
    queryKey: ["healed", flowId],
    queryFn: () => api.repair.healed(flowId),
    enabled: Boolean(flowId),
  });
  const health = useQuery({
    queryKey: ["health", flowId],
    queryFn: () => api.repair.health(flowId),
    enabled: Boolean(flowId),
  });
  const repairs = useQuery({
    queryKey: ["repairs", flowId],
    queryFn: () => api.repair.repairs(flowId),
    enabled: Boolean(flowId),
  });

  const apply = useMutation({
    mutationFn: (body: Parameters<typeof api.repair.apply>[1]) =>
      api.repair.apply(flowId, body),
    onSuccess: () => {
      setReplaceNode(null);
      void queryClient.invalidateQueries({ queryKey: ["healed", flowId] });
      void queryClient.invalidateQueries({ queryKey: ["repairs", flowId] });
      void queryClient.invalidateQueries({ queryKey: ["health", flowId] });
      void queryClient.invalidateQueries({ queryKey: ["flow", flowId] });
      toast("修复已写入草稿；重跑验证后发布新版本", "success");
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const selectedFlow = flows.data?.find((flow) => flow.id === flowId);

  return (
    <>
      <PageHeader
        kicker="Repair Workbench / 修复工作台"
        title="降级与修复"
        description="后备策略命中只记录 HEALED，绝不自动改写配置。修复动作显式应用、记录审计，重跑通过后再发布。"
        actions={
          <>
            <select
              className="ff-select w-[240px] py-1"
              value={flowId}
              onChange={(event) => setFlowId(event.target.value)}
            >
              {(flows.data ?? []).map((flow) => (
                <option key={flow.id} value={flow.id}>
                  {flow.name}
                </option>
              ))}
            </select>
            {selectedFlow ? (
              <Link className="ff-btn" to={`/flows/${selectedFlow.id}`}>
                去编辑器
              </Link>
            ) : null}
          </>
        }
      />

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <div className="ff-panel p-4">
          <div className="ff-kicker">Recent Runs</div>
          <div className="mt-2 font-mono text-2xl">{health.data?.recentRuns ?? 0}</div>
        </div>
        <div className="ff-panel p-4">
          <div className="ff-kicker">Failed</div>
          <div className="mt-2 font-mono text-2xl text-[#f0a58f]">{health.data?.failed ?? 0}</div>
        </div>
        <div className="ff-panel p-4">
          <div className="ff-kicker">Healed Nodes</div>
          <div className="mt-2 font-mono text-2xl text-ember-400">{health.data?.healed ?? 0}</div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <SectionTitle index="01">HEALED 清单</SectionTitle>
          {healed.data && healed.data.length > 0 ? (
            <div className="space-y-2">
              {healed.data.map((item) => (
                <div key={`${item.runId}-${item.nodeId}`} className="ff-card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={item.status} />
                    <span className="text-[13px] text-paper">{item.nodeId}</span>
                    <span className="ff-badge">{item.nodeType}</span>
                    <span className="ff-badge ff-badge-ember">
                      HEALED · strategy #{item.resolvedTarget?.index ?? "?"}
                    </span>
                    <span className="ml-auto font-mono text-[9px] text-forge-400">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2 font-mono text-[10px] text-forge-300 md:grid-cols-2">
                    <div>
                      <span className="text-forge-400">后备策略 </span>
                      {item.resolvedTarget?.strategy ?? "—"}
                    </div>
                    <div>
                      <span className="text-forge-400">置信度 </span>
                      {item.resolvedTarget?.confidence ?? "—"}
                    </div>
                    <div>
                      <span className="text-forge-400">dataset </span>
                      {item.datasetId ?? "—"}
                    </div>
                    <Link className="text-ember-400" to={`/runs/${item.runId}`}>
                      run {item.runId.slice(-6)} →
                    </Link>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="ff-btn"
                      disabled={apply.isPending}
                      onClick={() =>
                        apply.mutate({
                          nodeId: item.nodeId,
                          action: "promote",
                          targetPath: item.nodeType === "picker" ? "trigger" : "target",
                          strategyIndex: item.resolvedTarget?.index ?? 0,
                        })
                      }
                    >
                      提升后备为首选
                    </button>
                    <button
                      className="ff-btn"
                      onClick={() => setReplaceNode(item.nodeId)}
                    >
                      替换策略
                    </button>
                  </div>
                  {replaceNode === item.nodeId ? (
                    <div className="mt-3 border border-forge-700 bg-forge-950/60 p-3">
                      <div className="ff-kicker mb-1">新策略 JSON</div>
                      <textarea
                        className="ff-textarea h-[80px]"
                        value={strategyText}
                        onChange={(event) => setStrategyText(event.target.value)}
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          className="ff-btn ff-btn-primary"
                          onClick={() => {
                            try {
                              const strategy = JSON.parse(strategyText);
                              apply.mutate({
                                nodeId: item.nodeId,
                                action: "replace",
                                targetPath: item.nodeType === "picker" ? "trigger" : "target",
                                strategyIndex: item.resolvedTarget?.index ?? 0,
                                strategy,
                              });
                            } catch (error) {
                              toast(`策略 JSON 不合法: ${(error as Error).message}`, "error");
                            }
                          }}
                        >
                          应用替换
                        </button>
                        <button className="ff-btn" onClick={() => setReplaceNode(null)}>
                          取消
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="没有 HEALED 记录"
              hint="运行流程后，后备策略命中会在节点上记录 HEALED；这里会列出可修复项。"
            />
          )}
        </div>

        <aside className="space-y-5">
          <div className="ff-card p-4">
            <SectionTitle index="02">修复审计</SectionTitle>
            {repairs.data && repairs.data.length > 0 ? (
              <div className="space-y-2">
                {repairs.data.map((repair) => (
                  <div key={String(repair.id)} className="border border-forge-700 p-2">
                    <div className="flex items-center justify-between font-mono text-[10px]">
                      <span className="text-paper">{String(repair.nodeId)}</span>
                      <span className="ff-badge">{String(repair.kind)}</span>
                    </div>
                    <div className="mt-1 font-mono text-[9px] text-forge-400">
                      {new Date(String(repair.createdAt)).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-forge-400">暂无修复记录。</p>
            )}
          </div>

          <div className="ff-panel p-4">
            <SectionTitle index="03">最近运行</SectionTitle>
            <div className="space-y-1">
              {(health.data?.runs ?? []).slice(0, 8).map((run) => (
                <Link
                  key={run.id}
                  to={`/runs/${run.id}`}
                  className="flex items-center justify-between border-b border-forge-700/60 py-1 font-mono text-[9px]"
                >
                  <span className="text-forge-400">{run.id.slice(-8)}</span>
                  <StatusBadge status={run.status} />
                </Link>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
