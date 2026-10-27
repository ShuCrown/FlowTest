import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { FlowDsl } from "@flowforge/dsl";
import {
  EmptyState,
  Field,
  PageHeader,
  ReadinessBadge,
  SectionTitle,
  toast,
} from "../components/ui.js";
import { api } from "../lib/api.js";

export function FlowsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showAiContext, setShowAiContext] = useState(false);
  const [aiContext, setAiContext] = useState("");
  const [aiDescription, setAiDescription] = useState("");
  const [templateQuery, setTemplateQuery] = useState("");
  const [name, setName] = useState("");
  const [systemId, setSystemId] = useState("");
  const [importText, setImportText] = useState("");

  const flows = useQuery({ queryKey: ["flows"], queryFn: api.flows.list });
  const systems = useQuery({ queryKey: ["systems"], queryFn: api.systems.list });
  const templates = useQuery({
    queryKey: ["templates", templateQuery],
    queryFn: () => api.templates.search(templateQuery),
    enabled: templateQuery.trim().length > 0,
  });

  const loadContext = useMutation({
    mutationFn: () => api.ai.context(),
    onSuccess: (context) => {
      setAiContext(JSON.stringify(context, null, 2));
      setShowAiContext(true);
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const createFromTemplate = useMutation({
    mutationFn: (template: { name: string; dsl: FlowDsl }) =>
      api.flows.create({ name: `${template.name} · 副本`, dsl: template.dsl }),
    onSuccess: (flow) => {
      void queryClient.invalidateQueries({ queryKey: ["flows"] });
      navigate(`/flows/${flow.id}`);
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const aiDraft = useMutation({
    mutationFn: () => api.ai.draft(aiDescription),
    onSuccess: (result) => {
      setImportText(JSON.stringify(result.dsl, null, 2));
      toast(`AI 草稿已生成：L${result.readiness.level}，所有节点标记待确认`, "success");
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const create = useMutation({
    mutationFn: async () => {
      const system = systems.data?.find((item) => item.id === systemId) ?? systems.data?.[0];
      if (!system) throw new Error("请先登记一个目标系统");
      const flowName = name.trim() || "未命名流程";
      const dsl: FlowDsl = {
        dslVersion: "1.0",
        meta: { name: flowName, tags: [] },
        systems: [
          {
            id: system.id,
            name: system.name,
            baseUrl: system.baseUrl,
            auth: (system.auth as FlowDsl["systems"][number]["auth"]) ?? { kind: "none" },
          },
        ],
        defaults: {
          nodeTimeoutMs: 15000,
          pickerTimeoutMs: 30000,
          screenshot: "onFailure",
          resourcePolicy: "balanced",
        },
        nodes: [
          {
            id: "open",
            type: "navigate",
            name: "打开首页",
            system: system.id,
            url: "/",
            readySignal: "page-ready",
          },
        ],
        edges: [],
        entry: "open",
      };
      return api.flows.create({
        name: flowName,
        dsl,
        layout: { nodes: { open: { x: 120, y: 160 } } },
      });
    },
    onSuccess: (flow) => {
      setShowCreate(false);
      setName("");
      void queryClient.invalidateQueries({ queryKey: ["flows"] });
      navigate(`/flows/${flow.id}`);
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const importFlow = useMutation({
    mutationFn: async () => {
      const parsed = JSON.parse(importText) as unknown;
      const result = await api.flows.import({ dsl: parsed, save: true });
      if (!result.flow) throw new Error("导入失败：未返回流程");
      return result.flow;
    },
    onSuccess: (flow) => {
      setShowImport(false);
      setImportText("");
      void queryClient.invalidateQueries({ queryKey: ["flows"] });
      navigate(`/flows/${flow.id}`);
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.flows.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["flows"] });
      toast("流程已删除");
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const list = flows.data ?? [];
  const l5 = list.filter((flow) => flow.readiness >= 5).length;
  const published = list.filter((flow) => flow.publishedVersion).length;

  return (
    <>
      <PageHeader
        kicker="Flow Registry / 流程仓库"
        title="流程锻造台"
        description="Flow DSL 是唯一执行契约。画布、导入与草稿都落成同一份 JSON；发布后的版本不可变。"
        actions={
          <>
            <button className="ff-btn" onClick={() => loadContext.mutate()}>
              AI 上下文
            </button>
            <button className="ff-btn" onClick={() => setShowImport(true)}>
              导入 JSON
            </button>
            <button className="ff-btn ff-btn-primary" onClick={() => setShowCreate(true)}>
              + 新建流程
            </button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["流程总数", list.length, "total"],
          ["L5 组合", l5, "matrix-ready"],
          ["已发布", published, "immutable"],
          ["系统", systems.data?.length ?? 0, "targets"],
        ].map(([label, value, hint], index) => (
          <div key={label} className="ff-panel ff-fade-up px-4 py-4" style={{ animationDelay: `${index * 50}ms` }}>
            <div className="ff-kicker">{label}</div>
            <div className="mt-2 font-mono text-[26px] leading-none text-paper">{value}</div>
            <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-forge-400">
              {hint}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="ff-kicker">模板检索</div>
        <input
          className="ff-input max-w-[320px]"
          value={templateQuery}
          onChange={(event) => setTemplateQuery(event.target.value)}
          placeholder="按名称 / 标签 / 节点名搜索已有流程"
        />
        {templates.data?.templates.map((template) => (
          <button
            key={template.flow.id}
            className="ff-badge ff-badge-ember"
            title={`相似度 ${template.score}`}
            onClick={() => createFromTemplate.mutate(template.flow)}
          >
            基于「{template.flow.name}」创建 · {Math.round(template.score * 100)}%
          </button>
        ))}
        {templateQuery && templates.data?.templates.length === 0 ? (
          <span className="font-mono text-[10px] text-forge-400">没有相似模板</span>
        ) : null}
      </div>

      <SectionTitle index="01">流程索引</SectionTitle>
      {flows.isLoading ? (
        <div className="ff-panel p-8 text-center font-mono text-xs text-forge-400">loading…</div>
      ) : list.length > 0 ? (
        <div className="space-y-2">
          {list.map((flow, index) => (
            <div
              key={flow.id}
              className="ff-card group flex cursor-pointer items-center gap-4 px-5 py-4 transition-colors hover:border-forge-600"
              onClick={() => navigate(`/flows/${flow.id}`)}
            >
              <div className="w-10 shrink-0 font-mono text-[11px] text-forge-400">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <span className="ff-display truncate text-[19px] text-paper">{flow.name}</span>
                  <ReadinessBadge level={flow.readiness} />
                  {flow.publishedVersion ? (
                    <span className="ff-badge">v{flow.publishedVersion}</span>
                  ) : (
                    <span className="ff-badge text-forge-400">draft</span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-[10px] text-forge-400">
                  <span>{flow.id}</span>
                  {flow.tags.map((tag) => (
                    <span key={tag} className="text-ember-500">#{tag}</span>
                  ))}
                  <span>rev {flow.revision}</span>
                  <span>updated {new Date(flow.updatedAt).toLocaleString()}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <a
                  className="ff-btn ff-btn-ghost"
                  href={`/api/flows/${flow.id}/export`}
                  onClick={(event) => event.stopPropagation()}
                >
                  导出
                </a>
                <button
                  className="ff-btn ff-btn-ghost ff-btn-danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (window.confirm(`删除流程「${flow.name}」及其版本？`)) {
                      remove.mutate(flow.id);
                    }
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="仓库是空的"
          hint="新建一份流程骨架，或粘贴一份 Flow DSL JSON。"
          action={
            <button className="ff-btn ff-btn-primary" onClick={() => setShowCreate(true)}>
              新建第一份流程
            </button>
          }
        />
      )}

      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="ff-panel w-full max-w-lg p-6">
            <div className="ff-kicker">New Flow</div>
            <h2 className="ff-display mt-1 text-2xl">锻造一份新流程</h2>
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate();
              }}
            >
              <Field label="流程名称">
                <input
                  className="ff-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="CRM 建档并按金额分支"
                  autoFocus
                />
              </Field>
              <Field label="目标系统" hint="第一个导航节点会绑定到该系统。">
                <select
                  className="ff-select"
                  value={systemId || systems.data?.[0]?.id || ""}
                  onChange={(event) => setSystemId(event.target.value)}
                >
                  {(systems.data ?? []).map((system) => (
                    <option key={system.id} value={system.id}>
                      {system.name} · {system.baseUrl}
                    </option>
                  ))}
                </select>
              </Field>
              {!systems.data?.length ? (
                <p className="border border-rust-500/40 bg-rust-500/5 px-3 py-2 text-[12px] text-[#f0a58f]">
                  还没有系统。请先在「系统」页面登记目标地址。
                </p>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="ff-btn" onClick={() => setShowCreate(false)}>
                  取消
                </button>
                <button
                  type="submit"
                  className="ff-btn ff-btn-primary"
                  disabled={create.isPending || !systems.data?.length}
                >
                  {create.isPending ? "创建中…" : "创建并打开"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showAiContext ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="ff-panel flex max-h-[88vh] w-full max-w-3xl flex-col p-6">
            <div className="ff-kicker">AI Context Pack</div>
            <h2 className="ff-display mt-1 text-2xl">可复制的上下文包</h2>
            <p className="mt-2 text-[12px] leading-5 text-forge-400">
              包含 schema、节点类型、模板命名空间与系统/数据集摘要；不包含 cookies、env 值、密码与
              storageState 路径。把它和自然语言描述一起交给 Chat，返回 JSON 后走导入预览。
            </p>
            <textarea
              className="ff-textarea mt-4 min-h-[400px] flex-1"
              value={aiContext}
              readOnly
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                className="ff-btn"
                onClick={() => {
                  void navigator.clipboard.writeText(aiContext);
                  toast("上下文已复制", "success");
                }}
              >
                复制
              </button>
              <button className="ff-btn" onClick={() => setShowAiContext(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showImport ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="ff-panel w-full max-w-3xl p-6">
            <div className="ff-kicker">Import DSL</div>
            <h2 className="ff-display mt-1 text-2xl">导入 Flow DSL</h2>
            <p className="mt-2 text-[12px] text-forge-400">
              导入会执行 schema 校验、归一化与就绪度计算；未确认项不会自动运行。
            </p>
            <div className="mt-3 border border-forge-700 bg-forge-900/40 p-3">
              <div className="ff-kicker mb-2">AI 草稿（默认关闭，输出必须确认）</div>
              <div className="flex gap-2">
                <input
                  className="ff-input"
                  value={aiDescription}
                  onChange={(event) => setAiDescription(event.target.value)}
                  placeholder="用一句中文描述流程，例如：打开客户列表，新建客户并选择区域后保存"
                />
                <button
                  className="ff-btn"
                  disabled={aiDescription.trim().length < 3 || aiDraft.isPending}
                  onClick={() => aiDraft.mutate()}
                >
                  {aiDraft.isPending ? "生成中…" : "生成草稿"}
                </button>
              </div>
            </div>
            <textarea
              className="ff-textarea mt-4 h-[420px]"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder='{ "dslVersion": "1.0", ... }'
              spellCheck={false}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button className="ff-btn" onClick={() => setShowImport(false)}>
                取消
              </button>
              <button
                className="ff-btn ff-btn-primary"
                disabled={!importText.trim() || importFlow.isPending}
                onClick={() => importFlow.mutate()}
              >
                {importFlow.isPending ? "校验中…" : "校验并保存"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
