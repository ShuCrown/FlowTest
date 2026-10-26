import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EmptyState, Field, PageHeader, SectionTitle, StatusBadge, toast } from "../components/ui.js";
import { api } from "../lib/api.js";
import type { RecordingDetail } from "../lib/types.js";

interface RawEventView {
  kind?: string;
  t?: number;
  ts?: string;
  key?: string;
  role?: string;
  title?: string;
  value?: string;
  url?: string;
  method?: string;
  status?: number;
  redacted?: boolean;
  fp?: {
    tag?: string;
    role?: string;
    text?: string;
    labelText?: string;
    placeholder?: string;
    testid?: string;
    ariaLabel?: string;
  };
}

interface ClusterView {
  id?: string;
  kind?: string;
  mode?: string;
  confidence?: number;
  needsConfirm?: boolean;
  trigger?: { target?: { label?: string }; fp?: { tag?: string } };
  panel?: { role?: string; title?: string };
  filters?: unknown[];
  picks?: unknown[];
  commit?: { fp?: { text?: string } };
  startT?: number;
  endT?: number;
}

export function RecordingsPage() {
  const queryClient = useQueryClient();
  const [systemId, setSystemId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const systems = useQuery({ queryKey: ["systems"], queryFn: api.systems.list });
  const recordings = useQuery({
    queryKey: ["recordings"],
    queryFn: api.recordings.list,
    refetchInterval: 3000,
  });
  const detail = useQuery({
    queryKey: ["recording", selectedId],
    queryFn: () => api.recordings.get(selectedId!),
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    if (!systemId && systems.data?.[0]) setSystemId(systems.data[0].id);
  }, [systems.data, systemId]);

  const start = useMutation({
    mutationFn: () => api.recordings.start(systemId),
    onSuccess: (result) => {
      setSelectedId(result.id);
      void queryClient.invalidateQueries({ queryKey: ["recordings"] });
      toast("录制已开始；在检查器浏览器中操作目标页面", "success");
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const stop = useMutation({
    mutationFn: (id: string) => api.recordings.stop(id),
    onSuccess: (result) => {
      setSelectedId(result.id);
      void queryClient.invalidateQueries({ queryKey: ["recordings"] });
      toast(`录制已停止，共 ${result.events?.length ?? 0} 个事件`, "success");
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const refold = useMutation({
    mutationFn: (id: string) => api.recordings.refold(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recording", selectedId] });
      toast("已按当前规则重新切分，原始事件未改动", "success");
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const recording = recordings.data?.find((item) => item.id === selectedId);
  const events = (detail.data?.events ?? []) as RawEventView[];
  const clusters = (detail.data?.clusters ?? []) as ClusterView[];

  return (
    <>
      <PageHeader
        kicker="Capture Workshop / 采集工作台"
        title="操作采集"
        description="注入式采集器记录原始语义事件与面板开闭；切分规则版本化，原始事件永不删除。M2 只展示交互簇，草稿合成在 M3。"
        actions={
          <>
            <select
              className="ff-select w-[180px] py-1"
              value={systemId}
              onChange={(event) => setSystemId(event.target.value)}
            >
              {(systems.data ?? []).map((system) => (
                <option key={system.id} value={system.id}>
                  {system.name}
                </option>
              ))}
            </select>
            <button
              className="ff-btn ff-btn-primary"
              onClick={() => start.mutate()}
              disabled={!systemId || start.isPending}
            >
              ● 开始录制
            </button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div>
          <SectionTitle index="01">会话索引</SectionTitle>
          {recordings.data && recordings.data.length > 0 ? (
            <div className="space-y-1">
              {recordings.data.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`ff-card flex w-full items-center gap-2 px-3 py-3 text-left ${
                    selectedId === item.id ? "border-ember-500/60" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[10px] text-ember-400">{item.id}</div>
                    <div className="mt-1 flex items-center gap-2 font-mono text-[9px] text-forge-400">
                      <span>{item.eventsCount} events</span>
                      <StatusBadge status={item.status} />
                    </div>
                  </div>
                  {item.status === "recording" ? (
                    <span
                      className="h-2 w-2 bg-rust-500 ff-pulse"
                      onClick={(event) => {
                        event.stopPropagation();
                        stop.mutate(item.id);
                      }}
                    />
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="还没有采集会话"
              hint="点击「开始录制」，在检查器浏览器中完成一次弹窗筛选 + 多选 + 保存。"
            />
          )}
        </div>

        <div className="min-w-0">
          {recording ? (
            <>
              <SectionTitle index="02">交互簇</SectionTitle>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  className="ff-btn"
                  onClick={() => refold.mutate(recording.id)}
                  disabled={refold.isPending}
                >
                  重新切分
                </button>
                {recording.status === "recording" ? (
                  <button
                    className="ff-btn ff-btn-danger"
                    onClick={() => stop.mutate(recording.id)}
                    disabled={stop.isPending}
                  >
                    停止录制
                  </button>
                ) : null}
                <span className="ff-badge">rule {detail.data?.ruleVersion ?? "—"}</span>
                <span className="ff-badge">{events.length} raw events</span>
              </div>

              <div className="mb-6 space-y-2">
                {clusters.length === 0 ? (
                  <div className="ff-panel px-4 py-6 text-center font-mono text-[10px] text-forge-400">
                    尚无交互簇；录制结束后自动切分。
                  </div>
                ) : (
                  clusters.map((cluster, index) => (
                    <div key={cluster.id ?? index} className="ff-card p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] text-forge-400">{cluster.id}</span>
                        <span className="ff-badge ff-badge-ember">{cluster.kind}</span>
                        {cluster.mode ? <span className="ff-badge">{cluster.mode}</span> : null}
                        {cluster.needsConfirm ? (
                          <span className="ff-badge ff-badge-ember">needsConfirm</span>
                        ) : null}
                        <span className="ml-auto font-mono text-[9px] text-forge-400">
                          confidence {cluster.confidence ?? "—"}
                        </span>
                      </div>
                      <div className="mt-2 text-[13px] text-paper">
                        {cluster.trigger?.target?.label ?? "未命名触发"}
                        {cluster.panel?.role ? (
                          <span className="text-forge-400">
                            {" "}
                            → {cluster.panel.role}
                            {cluster.panel.title ? `「${cluster.panel.title}」` : ""}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 font-mono text-[9px] text-forge-400">
                        <span>filters {cluster.filters?.length ?? 0}</span>
                        <span>picks {cluster.picks?.length ?? 0}</span>
                        <span>commit {cluster.commit?.fp?.text ?? "—"}</span>
                        <span>
                          {typeof cluster.startT === "number" && typeof cluster.endT === "number"
                            ? `${Math.round(cluster.endT - cluster.startT)}ms`
                            : ""}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <SectionTitle index="03">原始事件</SectionTitle>
              <div className="ff-card max-h-[520px] overflow-auto">
                <table className="ff-table">
                  <thead>
                    <tr>
                      <th>t</th>
                      <th>Kind</th>
                      <th>Target</th>
                      <th>Value / Meta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event, index) => (
                      <tr key={index}>
                        <td className="font-mono text-[9px] text-forge-400">
                          {event.t !== undefined
                            ? Math.round(event.t)
                            : event.ts
                              ? event.ts.slice(11, 19)
                              : "—"}
                        </td>
                        <td>
                          <span className="ff-badge">{event.kind}</span>
                        </td>
                        <td className="font-mono text-[10px] text-forge-300">
                          {event.fp
                            ? `${event.fp.tag ?? ""}${event.fp.role ? `[role=${event.fp.role}]` : ""} ${
                                event.fp.ariaLabel ??
                                event.fp.labelText ??
                                event.fp.placeholder ??
                                event.fp.text ??
                                event.fp.testid ??
                                ""
                              }`
                            : event.key ?? event.role ?? event.url ?? "—"}
                        </td>
                        <td className="max-w-[280px] break-all font-mono text-[9px] text-forge-400">
                          {event.redacted ? "***" : (event.value ?? event.title ?? event.method ?? "")}
                          {event.status ? ` ${event.status}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <EmptyState title="选择一个采集会话" hint="左侧列表展示原始事件计数与运行状态。" />
          )}
        </div>
      </div>
    </>
  );
}
