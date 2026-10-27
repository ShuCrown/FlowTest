import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, Field, SectionTitle, StatusBadge, toast, EmptyState } from "../components/ui.js";
import { api } from "../lib/api.js";

export function SystemsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:4100");
  const [authKind, setAuthKind] = useState<"none" | "storageState">("none");

  const systems = useQuery({ queryKey: ["systems"], queryFn: api.systems.list });
  const inspector = useQuery({
    queryKey: ["inspector"],
    queryFn: api.inspector.current,
    refetchInterval: 3000,
  });

  const create = useMutation({
    mutationFn: () => api.systems.create({ name, baseUrl, auth: { kind: authKind } }),
    onSuccess: () => {
      setName("");
      void queryClient.invalidateQueries({ queryKey: ["systems"] });
      toast("系统已登记", "success");
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const open = useMutation({
    mutationFn: (id: string) => api.systems.openSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inspector"] });
      toast("检查器已打开，可在浏览器中手动登录", "success");
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const save = useMutation({
    mutationFn: (id: string) => api.systems.saveSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["systems"] });
      toast("storageState 已保存（0600）", "success");
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const close = useMutation({
    mutationFn: (id: string) => api.systems.closeSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inspector"] });
      toast("检查器已关闭");
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const session = inspector.data;

  return (
    <>
      <PageHeader
        kicker="System Registry / 目标系统"
        title="系统登记处"
        description="登记目标系统地址、鉴权方式与会话。检查器使用独立 profile；保存的 storageState 供 Run Worker 复用。"
        actions={
          <span className="ff-badge">
            {session ? (
              <>
                <span className="h-1.5 w-1.5 bg-moss-400 ff-pulse" /> inspector · {session.id.slice(-6)}
              </>
            ) : (
              "inspector · idle"
            )}
          </span>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div>
          <SectionTitle index="01">登记列表</SectionTitle>
          {systems.isLoading ? (
            <div className="ff-panel p-8 text-center font-mono text-xs text-forge-400">loading…</div>
          ) : systems.data && systems.data.length > 0 ? (
            <div className="ff-card overflow-hidden">
              <table className="ff-table">
                <thead>
                  <tr>
                    <th>System</th>
                    <th>Base URL</th>
                    <th>Auth</th>
                    <th>Session</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {systems.data.map((system) => {
                    const isCurrent = session?.systemId === system.id;
                    return (
                      <tr key={system.id}>
                        <td>
                          <div className="font-medium text-paper">{system.name}</div>
                          <div className="font-mono text-[10px] text-forge-400">{system.id}</div>
                        </td>
                        <td className="font-mono text-[11px] text-forge-300">{system.baseUrl}</td>
                        <td>
                          <span className="ff-badge">{system.auth?.kind ?? "none"}</span>
                          {system.auth?.path ? (
                            <div
                              className="mt-1 max-w-[220px] truncate font-mono text-[9px] text-forge-400"
                              title={system.auth.path}
                            >
                              {system.auth.path}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {isCurrent ? (
                            <StatusBadge status={session!.status} />
                          ) : (
                            <span className="font-mono text-[10px] text-forge-400">—</span>
                          )}
                        </td>
                        <td>
                          <div className="flex flex-wrap justify-end gap-1">
                            <button
                              className="ff-btn"
                              disabled={open.isPending}
                              onClick={() => open.mutate(system.id)}
                            >
                              打开检查器
                            </button>
                            <button
                              className="ff-btn"
                              disabled={!isCurrent || save.isPending}
                              onClick={() => save.mutate(system.id)}
                            >
                              保存会话
                            </button>
                            <button
                              className="ff-btn ff-btn-ghost"
                              disabled={!isCurrent}
                              onClick={() => close.mutate(system.id)}
                            >
                              关闭
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="还没有目标系统"
              hint="先在右侧登记一个可访问的系统地址，例如本地夹具 http://127.0.0.1:4100。"
            />
          )}

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {[
              ["独立 profile", "检查器使用 data/sessions/<system>/profile，不与运行共享 context。"],
              ["手动登录", "扫码 / SSO / 验证码场景由人工在 headed 浏览器完成，平台不绕过。"],
              ["0600", "storageState 只存本机，路径写入系统鉴权配置，不写入日志。"],
            ].map(([title, hint]) => (
              <div key={title} className="ff-panel p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ember-500">
                  {title}
                </div>
                <p className="mt-2 text-[12px] leading-5 text-forge-400">{hint}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="ff-card p-5">
            <SectionTitle index="02">登记新系统</SectionTitle>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate();
              }}
            >
              <Field label="系统名称">
                <input
                  className="ff-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="CRM 测试环境"
                  required
                />
              </Field>
              <Field label="Base URL">
                <input
                  className="ff-input"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="http://127.0.0.1:4100"
                  required
                />
              </Field>
              <Field label="鉴权策略" hint="storageState 会在保存会话后指向 data/sessions 下的文件。">
                <select
                  className="ff-select"
                  value={authKind}
                  onChange={(event) => setAuthKind(event.target.value as "none" | "storageState")}
                >
                  <option value="none">none</option>
                  <option value="storageState">storageState</option>
                </select>
              </Field>
              <button className="ff-btn ff-btn-primary w-full" type="submit" disabled={create.isPending}>
                {create.isPending ? "写入中…" : "登记系统"}
              </button>
            </form>
          </div>

          <div className="ff-panel p-5">
            <SectionTitle index="03">检查器状态</SectionTitle>
            {session ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-forge-400">SESSION</span>
                  <span className="font-mono text-[11px] text-paper">{session.id}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-forge-400">URL</span>
                  <span className="max-w-[220px] truncate font-mono text-[10px] text-forge-300">
                    {session.url}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-forge-400">MODE</span>
                  <span className="ff-badge">{session.headless ? "headless" : "headed"}</span>
                </div>
                {session.lastPick ? (
                  <div className="border-t border-forge-700 pt-3">
                    <div className="ff-kicker">last pick</div>
                    <div className="mt-1 font-mono text-[11px] text-ember-400">
                      {session.lastPick.target.strategies.length} strategies
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-[12px] leading-5 text-forge-400">
                打开检查器后，可在目标页面里完成登录，再回到这里保存会话。
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
