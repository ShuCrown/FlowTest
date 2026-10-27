import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Field, PageHeader, SectionTitle, toast } from "../components/ui.js";
import { api } from "../lib/api.js";
import type { Settings } from "../lib/types.js";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10000 });
  const [form, setForm] = useState<Settings | null>(null);

  useEffect(() => {
    if (settingsQuery.data) setForm(settingsQuery.data);
  }, [settingsQuery.data]);

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => api.settings.patch(patch),
    onSuccess: (settings) => {
      setForm(settings);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast("设置已保存", "success");
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  if (!form) {
    return <div className="ff-panel p-10 text-center font-mono text-xs text-forge-400">loading settings…</div>;
  }

  const update = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
    setForm({ ...form, [key]: value });
  };

  return (
    <>
      <PageHeader
        kicker="Configuration / 本地配置"
        title="设置"
        description="单用户、单机、本地优先。API 只监听 127.0.0.1；所有产物、数据库与会话都落在 data/ 下。"
        actions={
          <button className="ff-btn ff-btn-primary" onClick={() => save.mutate(form)} disabled={save.isPending}>
            {save.isPending ? "保存中…" : "保存设置"}
          </button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-8">
          <div>
            <SectionTitle index="01">执行预算</SectionTitle>
            <div className="ff-card grid gap-4 p-5 md:grid-cols-2">
              <Field label="节点总预算 nodeTimeoutMs" hint="单节点默认预算；阶段超时仍独立生效。">
                <input
                  className="ff-input"
                  type="number"
                  value={form.nodeTimeoutMs}
                  onChange={(event) => update("nodeTimeoutMs", Number(event.target.value))}
                />
              </Field>
              <Field label="picker 预算 pickerTimeoutMs">
                <input
                  className="ff-input"
                  type="number"
                  value={form.pickerTimeoutMs}
                  onChange={(event) => update("pickerTimeoutMs", Number(event.target.value))}
                />
              </Field>
              <Field label="截图策略">
                <select
                  className="ff-select"
                  value={form.screenshot}
                  onChange={(event) => update("screenshot", event.target.value as Settings["screenshot"])}
                >
                  <option value="onFailure">onFailure</option>
                  <option value="always">always</option>
                  <option value="never">never</option>
                </select>
              </Field>
              <Field label="资源策略" hint="balanced 拦埋点 / 媒体；fast 再拦图片字体；accurate 不拦。">
                <select
                  className="ff-select"
                  value={form.resourcePolicy}
                  onChange={(event) =>
                    update("resourcePolicy", event.target.value as Settings["resourcePolicy"])
                  }
                >
                  <option value="balanced">balanced</option>
                  <option value="fast">fast</option>
                  <option value="accurate">accurate</option>
                </select>
              </Field>
            </div>
          </div>

          <div>
            <SectionTitle index="02">取证与保留</SectionTitle>
            <div className="ff-card grid gap-4 p-5 md:grid-cols-2">
              <label className="flex items-center gap-2 font-mono text-[11px] text-forge-300">
                <input
                  type="checkbox"
                  checked={form.trace}
                  onChange={(event) => update("trace", event.target.checked)}
                />
                启用 trace（snapshots only）
              </label>
              <label className="flex items-center gap-2 font-mono text-[11px] text-forge-300">
                <input
                  type="checkbox"
                  checked={form.headless}
                  onChange={(event) => update("headless", event.target.checked)}
                />
                Run Worker headless
              </label>
              <Field label="产物保留天数">
                <input
                  className="ff-input"
                  type="number"
                  value={form.retentionDays}
                  onChange={(event) => update("retentionDays", Number(event.target.value))}
                />
              </Field>
              <label className="flex items-center gap-2 font-mono text-[11px] text-forge-300">
                <input
                  type="checkbox"
                  checked={form.aiEnabled}
                  onChange={(event) => update("aiEnabled", event.target.checked)}
                />
                AI 建议（默认关闭，输出必须确认）
              </label>
            </div>
          </div>

          <div>
            <SectionTitle index="03">运行约束</SectionTitle>
            <div className="ff-panel space-y-3 p-5 text-[12px] leading-6 text-forge-400">
              <p>禁止 waitForTimeout / networkidle；等待只允许显式信号或内置预设。</p>
              <p>运行并发固定为 1；矩阵批次串行；浏览器进程跨运行复用，每次运行新建 context。</p>
              <p>API ✅ / WS 只监听 127.0.0.1；没有账号、权限与远程协同。</p>
            </div>
          </div>
        </div>

        <aside className="space-y-5">
          <div className="ff-card p-5">
            <SectionTitle index="04">自检</SectionTitle>
            {health.data ? (
              <div className="space-y-2 font-mono text-[10px]">
                {[
                  ["status", health.data.ok ? "ok" : "degraded"],
                  ["node", health.data.runtime],
                  ["playwright", health.data.playwright.version],
                  ["chromium", health.data.playwright.chromium ?? "missing"],
                  ["dataDir", health.data.dataDir],
                  ["dataWritable", String(health.data.dataWritable)],
                  ["db", health.data.db.path],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-3 border-b border-forge-700/60 pb-2">
                    <span className="text-forge-400">{label}</span>
                    <span className="max-w-[220px] break-all text-right text-forge-200">{value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-forge-400">自检中…</p>
            )}
          </div>
          <div className="ff-panel p-5">
            <SectionTitle index="05">数据目录</SectionTitle>
            <pre className="overflow-auto font-mono text-[10px] leading-5 text-forge-400">
{`data/
  flowforge.db
  artifacts/<runId>/
  recordings/<sessionId>.jsonl
  sessions/<systemId>/storageState.json`}
            </pre>
          </div>
        </aside>
      </div>
    </>
  );
}
