import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EmptyState, PageHeader, SectionTitle, StatusBadge, toast } from "../components/ui.js";
import { api } from "../lib/api.js";

export function MatrixPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);

  const flow = useQuery({
    queryKey: ["flow", id],
    queryFn: () => api.flows.get(id!),
    enabled: Boolean(id),
  });
  const matrix = useQuery({
    queryKey: ["matrix", id],
    queryFn: () => api.runs.matrix(id!),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const batch = (query.state.data as { batch: { status: string } | null } | undefined)?.batch;
      return batch && ["queued", "preparing", "running"].includes(batch.status) ? 2000 : false;
    },
  });

  const start = useMutation({
    mutationFn: () => {
      const datasets = flow.data?.dsl.datasets ?? [];
      if (!flow.data?.publishedVersion) throw new Error("矩阵运行前必须先发布流程");
      if (datasets.length === 0) throw new Error("流程没有数据集");
      return api.runs.batch(id!, { datasetIds: datasets.map((dataset) => dataset.id) });
    },
    onSuccess: () => {
      setStarting(false);
      void queryClient.invalidateQueries({ queryKey: ["matrix", id] });
      toast("矩阵批次已启动，串行执行", "success");
    },
    onError: (error: Error) => {
      setStarting(false);
      toast(error.message, "error");
    },
  });

  const batch = matrix.data?.batch;
  const rows = matrix.data?.rows ?? [];
  const datasets = matrix.data?.datasets ?? flow.data?.dsl.datasets ?? [];
  const nodeOrder = useMemo(() => {
    const seen = new Set<string>();
    for (const row of rows) {
      for (const node of row.nodes) seen.add(node.nodeId);
    }
    if (seen.size === 0) {
      return flow.data?.dsl.nodes.map((node) => node.id) ?? [];
    }
    return Array.from(seen);
  }, [rows, flow.data]);

  if (flow.isLoading) {
    return <div className="ff-panel p-10 text-center font-mono text-xs text-forge-400">loading matrix…</div>;
  }
  if (flow.isError || !flow.data) {
    return (
      <EmptyState
        title="流程不存在"
        hint={(flow.error as Error)?.message}
        action={<Link className="ff-btn" to="/">返回流程列表</Link>}
      />
    );
  }

  const runForDataset = (datasetId: string) =>
    rows.find((row) => row.run.datasetId === datasetId);

  return (
    <>
      <PageHeader
        kicker={`Matrix / ${flow.data.id}`}
        title={`${flow.data.dsl.meta.name} · 执行矩阵`}
        description="行 = 数据集，列 = 节点。批次串行执行；负向用例在对应阶段失败，后续节点标记 skipped。"
        actions={
          <>
            <Link className="ff-btn ff-btn-ghost" to={`/flows/${flow.data.id}`}>
              ← 编辑器
            </Link>
            <button
              className="ff-btn ff-btn-primary"
              onClick={() => {
                setStarting(true);
                start.mutate();
              }}
              disabled={starting}
            >
              {starting ? "启动中…" : "▶ 运行矩阵"}
            </button>
          </>
        }
      />

      {!batch ? (
        <EmptyState
          title="还没有矩阵批次"
          hint={`当前 ${datasets.length} 个数据集。发布流程后点击「运行矩阵」。`}
          action={
            <button className="ff-btn ff-btn-primary" onClick={() => start.mutate()}>
              启动矩阵
            </button>
          }
        />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <StatusBadge status={batch.status} />
            <span className="ff-badge">{batch.id}</span>
            <span className="ff-badge">{batch.datasetIds.length} datasets</span>
            {batch.summary ? (
              <>
                <span className="ff-badge ff-badge-good">passed {batch.summary.passed}</span>
                <span className="ff-badge ff-badge-bad">failed {batch.summary.failed}</span>
              </>
            ) : (
              <span className="ff-badge ff-badge-ember">running…</span>
            )}
            <span className="ml-auto font-mono text-[9px] text-forge-400">
              created {new Date(batch.createdAt).toLocaleString()}
            </span>
          </div>

          <SectionTitle index="01">数据集 × 节点</SectionTitle>
          <div className="overflow-auto border border-forge-700">
            <table className="ff-table">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-forge-900">Dataset</th>
                  {nodeOrder.map((nodeId) => (
                    <th key={nodeId} className="min-w-[110px]">
                      {nodeId}
                    </th>
                  ))}
                  <th>Run</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((dataset) => {
                  const row = runForDataset(dataset.id);
                  const nodes = new Map((row?.nodes ?? []).map((node) => [node.nodeId, node]));
                  return (
                    <tr key={dataset.id}>
                      <td className="sticky left-0 z-10 min-w-[180px] bg-forge-900">
                        <div className="text-[12px] text-paper">{dataset.name}</div>
                        <div className="font-mono text-[9px] text-forge-400">{dataset.id}</div>
                      </td>
                      {nodeOrder.map((nodeId) => {
                        const node = nodes.get(nodeId);
                        if (!node) {
                          return (
                            <td key={nodeId}>
                              <span className="font-mono text-[10px] text-forge-400">—</span>
                            </td>
                          );
                        }
                        return (
                          <td
                            key={nodeId}
                            className="cursor-pointer"
                            onClick={() => row && navigate(`/runs/${row.run.id}`)}
                          >
                            <StatusBadge status={node.status} />
                            {node.error ? (
                              <div className="mt-1 font-mono text-[8px] text-[#f0a58f]">
                                {node.error.code}
                              </div>
                            ) : null}
                          </td>
                        );
                      })}
                      <td>
                        {row ? (
                          <button
                            className="ff-btn ff-btn-ghost text-[10px]"
                            onClick={() => navigate(`/runs/${row.run.id}`)}
                          >
                            {row.run.id.slice(-6)}
                          </button>
                        ) : (
                          <span className="font-mono text-[9px] text-forge-400">queued</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap gap-3 font-mono text-[9px] text-forge-400">
            <span>pass → 绿色</span>
            <span>fail → 红色 + 错误码</span>
            <span>skipped → 批次未走到该节点</span>
            <span>— → 该数据集未记录节点</span>
          </div>
        </>
      )}
    </>
  );
}
