import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState, PageHeader, StatusBadge } from "../components/ui.js";
import { api } from "../lib/api.js";

export function RunsPage() {
  const navigate = useNavigate();
  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: () => api.runs.list(),
    refetchInterval: 3000,
  });
  const flows = useQuery({ queryKey: ["flows"], queryFn: api.flows.list });
  const flowNames = new Map((flows.data ?? []).map((flow) => [flow.id, flow.name]));

  return (
    <>
      <PageHeader
        kicker="Run Ledger / 运行账本"
        title="运行记录"
        description="每次运行保存数据集快照、seed、节点阶段耗时、数据回填、业务请求与失败现场。"
        actions={<span className="ff-badge">{runs.data?.length ?? 0} runs</span>}
      />
      {runs.isLoading ? (
        <div className="ff-panel p-8 text-center font-mono text-xs text-forge-400">loading…</div>
      ) : runs.data && runs.data.length > 0 ? (
        <div className="ff-card overflow-hidden">
          <table className="ff-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Flow</th>
                <th>Dataset</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Duration</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((run) => (
                <tr key={run.id} className="cursor-pointer" onClick={() => navigate(`/runs/${run.id}`)}>
                  <td className="font-mono text-[11px] text-ember-400">{run.id}</td>
                  <td>
                    <Link to={`/flows/${run.flowId}`} className="hover:text-ember-400">
                      {flowNames.get(run.flowId) ?? run.flowId}
                    </Link>
                  </td>
                  <td className="font-mono text-[11px]">{run.datasetId ?? "—"}</td>
                  <td>
                    <span className="ff-badge">{run.mode}</span>
                  </td>
                  <td>
                    <StatusBadge status={run.status} />
                    {run.error ? (
                      <div className="mt-1 font-mono text-[9px] text-[#f0a58f]">{run.error.code}</div>
                    ) : null}
                  </td>
                  <td className="font-mono text-[11px]">
                    {run.startedAt && run.finishedAt
                      ? `${Math.max(
                          0,
                          new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime(),
                        )}ms`
                      : "—"}
                  </td>
                  <td className="font-mono text-[10px] text-forge-400">
                    {new Date(run.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="还没有运行"
          hint="打开一份流程，用 probe 或 single 模式跑一次；运行记录会在这里出现。"
          action={
            <Link to="/" className="ff-btn ff-btn-primary">
              去流程列表
            </Link>
          }
        />
      )}
    </>
  );
}
