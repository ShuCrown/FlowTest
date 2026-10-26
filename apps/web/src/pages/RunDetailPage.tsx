import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  EmptyState,
  KeyValue,
  PageHeader,
  SectionTitle,
  StatusBadge,
  toast,
} from "../components/ui.js";
import { api, ApiClientError } from "../lib/api.js";
import type { RunDetail, RunNode } from "../lib/types.js";

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [liveEvents, setLiveEvents] = useState<Array<Record<string, unknown>>>([]);
  const [wsState, setWsState] = useState<"connecting" | "open" | "closed">("connecting");
  const [confirmNth, setConfirmNth] = useState(0);
  const [confirming, setConfirming] = useState(false);

  const runQuery = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.runs.get(id!),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const data = query.state.data as RunDetail | undefined;
      return data && ["queued", "preparing", "running"].includes(data.status) ? 1500 : false;
    },
  });

  useEffect(() => {
    if (!id) return;
    setLiveEvents([]);
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/api/runs/${id}/events`);
    setWsState("connecting");
    socket.onopen = () => setWsState("open");
    socket.onclose = () => setWsState("closed");
    socket.onerror = () => setWsState("closed");
    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (parsed.type === "run.snapshot") {
          setWsState("open");
          return;
        }
        if (parsed.type === "pong") return;
        setLiveEvents((current) => [...current.slice(-199), parsed]);
        if (parsed.type === "needs_confirm" || parsed.type === "run.finished") {
          void runQuery.refetch();
        }
      } catch {
        // 忽略非 JSON 帧
      }
    };
    return () => socket.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (runQuery.isLoading) {
    return <div className="ff-panel p-10 text-center font-mono text-xs text-forge-400">loading run…</div>;
  }
  if (runQuery.isError || !runQuery.data) {
    return (
      <EmptyState
        title="运行不存在"
        hint={(runQuery.error as Error)?.message}
        action={<Link className="ff-btn" to="/runs">返回运行列表</Link>}
      />
    );
  }
  const run = runQuery.data;
  const pending = run.pendingConfirms?.[0];
  const duration =
    run.startedAt && run.finishedAt
      ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
      : 0;

  const confirm = async (action: "continue" | "abort"): Promise<void> => {
    if (!pending) return;
    setConfirming(true);
    try {
      await api.runs.confirm(run.id, {
        requestId: pending.requestId,
        action,
        nth: action === "continue" ? confirmNth : undefined,
      });
      toast(action === "continue" ? "已确认，运行继续" : "已中止本次运行", "success");
      await runQuery.refetch();
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "CONFIRM_NOT_PENDING") {
        await runQuery.refetch();
      }
      toast((error as Error).message, "error");
    } finally {
      setConfirming(false);
    }
  };

  const cancel = async (): Promise<void> => {
    try {
      await api.runs.cancel(run.id);
      await runQuery.refetch();
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };

  return (
    <>
      <PageHeader
        kicker={`Run / ${run.id}`}
        title={`${run.mode} 运行`}
        description={`dataset=${run.datasetId ?? "—"} · seed=${run.seed ?? "—"} · ${new Date(run.createdAt).toLocaleString()}`}
        actions={
          <>
            <Link className="ff-btn ff-btn-ghost" to="/runs">← 运行列表</Link>
            <StatusBadge status={run.status} />
            <span className={`ff-badge ${wsState === "open" ? "ff-badge-good" : "ff-badge"}`}>
              ws · {wsState}
            </span>
            {["queued", "preparing", "running"].includes(run.status) ? (
              <button className="ff-btn ff-btn-danger" onClick={cancel}>
                取消
              </button>
            ) : null}
          </>
        }
      />

      {run.error ? (
        <div className="mb-5 border border-rust-500/50 bg-rust-500/10 px-4 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#f0a58f]">
            {run.error.code}
          </div>
          <div className="mt-1 text-[13px] text-[#f5c3b4]">{run.error.message}</div>
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="总耗时" value={duration ? `${duration}ms` : "—"} hint="run duration" />
        <Metric label="节点" value={`${run.nodes.length}`} hint="nodes recorded" />
        <Metric label="数据回填" value={`${run.actions.length}`} hint="actions" />
        <Metric
          label="浏览器"
          value={run.metrics ? (run.metrics.browserColdStart ? "cold" : "reused") : "—"}
          hint={`launch ${run.metrics?.browserLaunchMs ?? 0}ms`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <SectionTitle index="01">节点溯源</SectionTitle>
          <div className="space-y-2">
            {run.nodes.length === 0 ? (
              <div className="ff-panel px-4 py-6 text-center font-mono text-[10px] text-forge-400">
                暂无节点记录；运行结束后落库。
              </div>
            ) : (
              run.nodes.map((node) => <NodeTimeline key={node.nodeId} runId={run.id} node={node} />)
            )}
          </div>

          <div className="mb-2 flex items-center justify-between">
            <SectionTitle index="02">数据表</SectionTitle>
            <div className="flex gap-1">
              <a
                className="ff-btn ff-btn-ghost text-[10px]"
                href={`/api/runs/${run.id}/export?format=csv`}
              >
                导出 CSV
              </a>
              <a
                className="ff-btn ff-btn-ghost text-[10px]"
                href={`/api/runs/${run.id}/export?format=json`}
              >
                导出 JSON
              </a>
            </div>
          </div>
          <div className="ff-card overflow-x-auto">
            <table className="ff-table">
              <thead>
                <tr>
                  <th>字段</th>
                  <th>期望值</th>
                  <th>实际值</th>
                  <th>来源</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {run.actions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center font-mono text-[10px] text-forge-400">
                      无数据回填记录
                    </td>
                  </tr>
                ) : (
                  run.actions.map((action, index) => (
                    <tr key={`${action.nodeId}-${index}`}>
                      <td>
                        <div className="text-[12px]">{action.field}</div>
                        <div className="font-mono text-[9px] text-forge-400">{action.nodeId}</div>
                      </td>
                      <td className="max-w-[220px] break-all font-mono text-[10px]">
                        {format(action.expected)}
                      </td>
                      <td className="max-w-[220px] break-all font-mono text-[10px]">
                        {format(action.actual)}
                      </td>
                      <td className="font-mono text-[10px] text-forge-400">{action.valueSource ?? "—"}</td>
                      <td>
                        <StatusBadge status={action.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <SectionTitle index="03">业务请求</SectionTitle>
          <div className="ff-card overflow-x-auto">
            <table className="ff-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>URL</th>
                  <th>Status</th>
                  <th>Body</th>
                </tr>
              </thead>
              <tbody>
                {run.network.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center font-mono text-[10px] text-forge-400">
                      无写请求记录
                    </td>
                  </tr>
                ) : (
                  run.network.map((record, index) => (
                    <tr key={`${record.url}-${index}`}>
                      <td className="font-mono text-[10px] text-ember-400">{record.method}</td>
                      <td className="max-w-[360px] break-all font-mono text-[10px]">{record.url}</td>
                      <td className="font-mono text-[10px]">{record.status ?? "—"}</td>
                      <td className="max-w-[280px] break-all font-mono text-[9px] text-forge-400">
                        {record.reqBody ? format(record.reqBody) : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <SectionTitle index="04">实时事件</SectionTitle>
          <div className="ff-panel max-h-[260px] overflow-auto p-3">
            {liveEvents.length === 0 ? (
              <div className="font-mono text-[10px] text-forge-400">等待事件…</div>
            ) : (
              liveEvents
                .slice()
                .reverse()
                .map((event, index) => (
                  <div key={index} className="flex gap-2 border-b border-forge-700/50 py-1 font-mono text-[9px]">
                    <span className="w-[90px] shrink-0 text-forge-400">
                      {String(event.ts ?? "").slice(11, 19)}
                    </span>
                    <span className="w-[120px] shrink-0 text-ember-400">{String(event.type)}</span>
                    <span className="truncate text-forge-300">{String(event.nodeId ?? "")}</span>
                  </div>
                ))
            )}
          </div>
        </div>

        <aside className="space-y-5">
          {pending ? (
            <div className="ff-card border-ember-500/50 p-4">
              <div className="ff-kicker text-ember-400">Needs Confirm</div>
              <div className="mt-2 text-[13px] leading-5 text-paper">
                {pending.options?.message ?? "目标存在歧义，需要确认"}
              </div>
              <div className="mt-2 font-mono text-[10px] text-forge-400">
                node · {pending.nodeId ?? "unknown"} · {pending.kind}
              </div>
              <div className="mt-3 space-y-1">
                {(pending.options?.candidates ?? []).map((candidate, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between border border-forge-700 px-2 py-1 font-mono text-[9px]"
                  >
                    <span className="truncate text-forge-300">{candidate.strategy}</span>
                    <span className="text-ember-400">{candidate.count}</span>
                  </div>
                ))}
              </div>
              <label className="mt-3 block font-mono text-[10px] text-forge-400">
                nth
                <input
                  className="ff-input mt-1"
                  type="number"
                  min={0}
                  value={confirmNth}
                  onChange={(event) => setConfirmNth(Number(event.target.value))}
                />
              </label>
              <div className="mt-3 flex gap-2">
                <button
                  className="ff-btn ff-btn-primary flex-1"
                  disabled={confirming}
                  onClick={() => confirm("continue")}
                >
                  继续
                </button>
                <button
                  className="ff-btn ff-btn-danger flex-1"
                  disabled={confirming}
                  onClick={() => confirm("abort")}
                >
                  中止
                </button>
              </div>
            </div>
          ) : null}

          <div className="ff-card p-4">
            <SectionTitle index="05">运行数据</SectionTitle>
            {run.resolvedData ? (
              <>
                <KeyValue label="dataset">{run.resolvedData.datasetName ?? run.datasetId}</KeyValue>
                {Object.entries(run.resolvedData.values).map(([key, value]) => (
                  <KeyValue key={key} label={key}>
                    <span className="break-all">{format(value)}</span>
                  </KeyValue>
                ))}
                <div className="mt-3 ff-kicker">vars</div>
                {Object.entries(run.resolvedData.vars).map(([key, value]) => (
                  <KeyValue key={key} label={key}>
                    <span className="break-all">{format(value)}</span>
                  </KeyValue>
                ))}
              </>
            ) : (
              <p className="text-[12px] text-forge-400">暂无数据快照</p>
            )}
          </div>

          <div className="ff-card p-4">
            <SectionTitle index="06">产物</SectionTitle>
            <div className="space-y-1">
              <ArtifactLink runId={run.id} path="compiled-plan.json" label="compiled-plan.json" />
              {run.artifactDir ? (
                <ArtifactLink runId={run.id} path="failure.json" label="failure.json" />
              ) : null}
              {run.nodes
                .filter((node) => node.screenshotPath)
                .map((node) => (
                  <ArtifactLink
                    key={node.nodeId}
                    runId={run.id}
                    path={artifactRelative(node.screenshotPath)}
                    label={`${node.nodeId} · screenshot`}
                  />
                ))}
            </div>
            <div className="mt-3 break-all font-mono text-[9px] text-forge-400">
              {run.artifactDir}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="ff-panel px-4 py-3">
      <div className="ff-kicker">{label}</div>
      <div className="mt-1 font-mono text-xl text-paper">{value}</div>
      <div className="font-mono text-[9px] text-forge-400">{hint}</div>
    </div>
  );
}

function NodeTimeline({ node, runId }: { node: RunNode; runId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ff-card">
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="w-8 font-mono text-[10px] text-forge-400">
          {String(node.index + 1).padStart(2, "0")}
        </span>
        <StatusBadge status={node.status} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-paper">{node.nodeId}</span>
          <span className="font-mono text-[9px] text-forge-400">
            {node.nodeType}
            {node.resolvedTarget ? ` · ${node.resolvedTarget.strategy}` : ""}
            {node.resolvedTarget?.healed ? " · HEALED" : ""}
          </span>
        </span>
        {node.screenshotPath ? (
          <img
            src={`/api/runs/${runId}/artifacts/${artifactRelative(node.screenshotPath)}`}
            alt=""
            className="h-9 w-16 border border-forge-700 object-cover"
          />
        ) : null}
        <span className="w-16 text-right font-mono text-[11px] text-forge-300">
          {node.durationMs}ms
        </span>
      </button>
      {open ? (
        <div className="border-t border-forge-700 px-4 py-3">
          {node.stageTimings.length > 0 ? (
            <div className="space-y-1">
              {node.stageTimings.map((stage, index) => (
                <div key={index} className="grid grid-cols-[1fr_80px_1fr] gap-2 font-mono text-[10px]">
                  <span className={stage.status === "failed" ? "text-[#f0a58f]" : "text-forge-300"}>
                    {stage.stage}
                  </span>
                  <span className="text-right text-forge-400">{stage.durationMs}ms</span>
                  <span className="truncate text-forge-400">{stage.signal ?? ""}</span>
                </div>
              ))}
            </div>
          ) : null}
          {node.error ? (
            <div className="mt-2 border border-rust-500/40 bg-rust-500/5 px-2 py-1 font-mono text-[10px] text-[#f0a58f]">
              {node.error.code}: {node.error.message}
            </div>
          ) : null}
          {node.resolvedTarget ? (
            <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-[9px] text-forge-400">
              <span>matchCount {node.resolvedTarget.matchCount}</span>
              <span>confidence {node.resolvedTarget.confidence}</span>
              <span>strategy index {node.resolvedTarget.index}</span>
              <span>{node.resolvedTarget.healed ? "HEALED" : "primary"}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ArtifactLink({ runId, path, label }: { runId: string; path: string; label: string }) {
  if (!path) return null;
  return (
    <a
      className="block truncate font-mono text-[10px] text-ember-400 hover:text-ember-300"
      href={`/api/runs/${runId}/artifacts/${path}`}
      target="_blank"
      rel="noreferrer"
    >
      ↗ {label}
    </a>
  );
}

function artifactRelative(path: string | null): string {
  if (!path) return "";
  const marker = "/artifacts/";
  const index = path.indexOf(marker);
  if (index >= 0) return path.slice(index + marker.length).split("/").slice(1).join("/");
  return path.split("/").slice(-2).join("/");
}

function format(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
