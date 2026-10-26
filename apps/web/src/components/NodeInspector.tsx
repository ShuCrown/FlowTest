import { useState } from "react";
import type { ReactNode } from "react";
import type {
  FlowDsl,
  FlowNode,
  InteractNode,
  PickerNode,
} from "@flowforge/dsl";
import type { InspectorSession } from "../lib/types.js";
import { ConditionEditor } from "./ConditionEditor.js";
import { TargetEditor } from "./TargetEditor.js";
import { ValueEditor } from "./ValueEditor.js";
import { SignalEditor, WaitSignalsEditor } from "./WaitEditor.js";
import { Field, toast } from "./ui.js";

export function NodeInspector({
  node,
  dsl,
  session,
  isEntry,
  onUpdate,
  onReplace,
  onDelete,
  onSetEntry,
  onRunTo,
}: {
  node: FlowNode;
  dsl: FlowDsl;
  session?: InspectorSession | null;
  isEntry: boolean;
  onUpdate: (patch: Record<string, unknown>) => void;
  onReplace: (node: FlowNode) => void;
  onDelete: () => void;
  onSetEntry: () => void;
  onRunTo: () => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="ff-kicker">Node Inspector</div>
          <div className="ff-display mt-1 text-xl text-paper">{node.name ?? node.id}</div>
        </div>
        <span className="ff-badge">{node.type}</span>
      </div>

      <Section title="基本">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Node ID">
            <input className="ff-input font-mono text-[11px]" value={node.id} readOnly />
          </Field>
          <Field label="名称">
            <input
              className="ff-input"
              value={node.name ?? ""}
              onChange={(event) => onUpdate({ name: event.target.value || undefined })}
            />
          </Field>
        </div>
        {node.type !== "branch" && node.type !== "wait" && node.type !== "assert" ? (
          <Field label="System">
            <select
              className="ff-select"
              value={node.system ?? dsl.systems[0]?.id ?? ""}
              onChange={(event) => onUpdate({ system: event.target.value })}
            >
              {dsl.systems.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Field label="节点预算 ms">
            <input
              className="ff-input"
              type="number"
              value={node.timeoutMs ?? ""}
              placeholder="default"
              onChange={(event) =>
                onUpdate({ timeoutMs: event.target.value ? Number(event.target.value) : undefined })
              }
            />
          </Field>
          <label className="mt-5 flex items-center gap-2 font-mono text-[10px] text-forge-300">
            <input
              type="checkbox"
              checked={node.enabled !== false}
              onChange={(event) => onUpdate({ enabled: event.target.checked })}
            />
            enabled
          </label>
        </div>
        <Field label="来源描述 sourceText">
          <input
            className="ff-input"
            value={(node.meta?.sourceText as string) ?? ""}
            onChange={(event) =>
              onUpdate({ meta: { ...(node.meta ?? {}), sourceText: event.target.value } })
            }
            placeholder="用户描述句，用于追溯"
          />
        </Field>
      </Section>

      <TypeSection
        node={node}
        dsl={dsl}
        session={session}
        onUpdate={onUpdate}
        onReplace={onReplace}
      />

      <Section title="动作前 pre">
        <WaitSignalsEditor
          signals={node.pre}
          onChange={(pre) => onUpdate({ pre })}
          label="pre"
          session={session}
        />
      </Section>

      <Section title="动作后 expect">
        <WaitSignalsEditor
          signals={node.expect}
          onChange={(expect) => onUpdate({ expect })}
          label="expect"
          session={session}
        />
      </Section>

      <Section title="元信息">
        <label className="flex items-center gap-2 font-mono text-[10px] text-forge-300">
          <input
            type="checkbox"
            checked={node.meta?.needsConfirm === true}
            onChange={(event) =>
              onUpdate({
                meta: { ...(node.meta ?? {}), needsConfirm: event.target.checked || undefined },
              })
            }
          />
          needsConfirm
        </label>
        <Field label="备注">
          <textarea
            className="ff-textarea h-[60px]"
            value={(node.meta?.notes as string) ?? ""}
            onChange={(event) =>
              onUpdate({ meta: { ...(node.meta ?? {}), notes: event.target.value } })
            }
          />
        </Field>
      </Section>

      <Section title="操作">
        <div className="flex flex-wrap gap-1">
          <button className="ff-btn" onClick={onSetEntry} disabled={isEntry}>
            设为入口
          </button>
          <button className="ff-btn" onClick={onRunTo}>
            运行到此节点
          </button>
          <button className="ff-btn ff-btn-danger" onClick={onDelete}>
            删除节点
          </button>
        </div>
      </Section>

      <Section title="高级 · 原始节点">
        <button className="ff-btn w-full" onClick={() => setAdvanced((value) => !value)}>
          {advanced ? "收起 JSON" : "展开 JSON"}
        </button>
        {advanced ? (
          <RawNodeEditor node={node} onReplace={onReplace} />
        ) : null}
      </Section>
    </div>
  );
}

function TypeSection({
  node,
  dsl,
  session,
  onUpdate,
  onReplace,
}: {
  node: FlowNode;
  dsl: FlowDsl;
  session?: InspectorSession | null;
  onUpdate: (patch: Record<string, unknown>) => void;
  onReplace: (node: FlowNode) => void;
}) {
  switch (node.type) {
    case "navigate":
      return (
        <Section title="导航">
          <Field label="URL（可含模板）">
            <input
              className="ff-input font-mono text-[11px]"
              value={node.url}
              onChange={(event) => onUpdate({ url: event.target.value })}
            />
          </Field>
          <Field label="waitUntil">
            <select
              className="ff-select"
              value={node.waitUntil ?? "domcontentloaded"}
              onChange={(event) => onUpdate({ waitUntil: event.target.value })}
            >
              <option value="domcontentloaded">domcontentloaded</option>
              <option value="load">load</option>
              <option value="commit">commit</option>
            </select>
          </Field>
          <SignalEditor
            title="页面就绪信号"
            signal={node.readySignal ?? "page-ready"}
            onChange={(readySignal) => onUpdate({ readySignal })}
            session={session}
          />
        </Section>
      );
    case "interact":
      return <InteractSection node={node} session={session} onUpdate={onUpdate} onReplace={onReplace} />;
    case "picker":
      return <PickerSection node={node} session={session} onUpdate={onUpdate} onReplace={onReplace} />;
    case "wait":
    case "assert":
      return (
        <Section title={node.type === "wait" ? "等待" : "断言"}>
          <SignalEditor
            signal={node.condition}
            onChange={(condition) => onUpdate({ condition })}
            session={session}
          />
          {node.type === "assert" ? (
            <Field label="失败消息">
              <input
                className="ff-input"
                value={node.message ?? ""}
                onChange={(event) => onUpdate({ message: event.target.value || undefined })}
              />
            </Field>
          ) : null}
        </Section>
      );
    case "branch":
      return (
        <Section title="分支条件">
          <ConditionEditor
            condition={node.condition}
            onChange={(condition) => onUpdate({ condition })}
          />
        </Section>
      );
    case "api":
      return (
        <Section title="接口">
          <div className="grid grid-cols-[100px_1fr] gap-2">
            <Field label="Method">
              <select
                className="ff-select"
                value={node.method}
                onChange={(event) => onUpdate({ method: event.target.value })}
              >
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="URL">
              <input
                className="ff-input font-mono text-[11px]"
                value={node.url}
                onChange={(event) => onUpdate({ url: event.target.value })}
              />
            </Field>
          </div>
          <Field label="期望状态码">
            <input
              className="ff-input"
              value={Array.isArray(node.expectStatus) ? node.expectStatus.join(",") : (node.expectStatus ?? "")}
              onChange={(event) => {
                const parts = event.target.value
                  .split(",")
                  .map((value) => Number(value.trim()))
                  .filter((value) => !Number.isNaN(value));
                onUpdate({ expectStatus: parts.length ? parts : undefined });
              }}
            />
          </Field>
          <ValueEditor
            label="请求体 body"
            value={node.body}
            onChange={(body) => onUpdate({ body })}
          />
          <Field label="extract JSONPath">
            <input
              className="ff-input font-mono text-[11px]"
              value={Object.entries(node.extract ?? {})
                .map(([key, path]) => `${key}=${path}`)
                .join(",")}
              onChange={(event) => {
                const extract = Object.fromEntries(
                  event.target.value
                    .split(",")
                    .map((pair) => pair.split("=").map((part) => part.trim()))
                    .filter(([key, path]) => key && path),
                );
                onUpdate({ extract: Object.keys(extract).length ? extract : undefined });
              }}
            />
          </Field>
        </Section>
      );
  }
}

function InteractSection({
  node,
  session,
  onUpdate,
  onReplace,
}: {
  node: InteractNode;
  session?: InspectorSession | null;
  onUpdate: (patch: Record<string, unknown>) => void;
  onReplace: (node: FlowNode) => void;
}) {
  const needsValue = ["input", "select", "nativeSelect", "upload"].includes(node.adapter);
  return (
    <Section title="交互">
      <Field label="Adapter">
        <select
          className="ff-select"
          value={node.adapter}
          onChange={(event) => onReplace({ ...node, adapter: event.target.value as InteractNode["adapter"] })}
        >
          {[
            "input",
            "click",
            "check",
            "select",
            "nativeSelect",
            "press",
            "upload",
            "hover",
          ].map((adapter) => (
            <option key={adapter} value={adapter}>
              {adapter}
            </option>
          ))}
        </select>
      </Field>
      <TargetEditor
        target={node.target}
        onChange={(target) => onReplace({ ...node, target })}
        session={session}
      />
      {needsValue ? (
        <ValueEditor
          value={node.value}
          onChange={(value) => onReplace({ ...node, value })}
        />
      ) : null}
      {node.adapter === "check" ? (
        <label className="flex items-center gap-2 font-mono text-[10px] text-forge-300">
          <input
            type="checkbox"
            checked={node.checked ?? true}
            onChange={(event) => onReplace({ ...node, checked: event.target.checked })}
          />
          勾选目标状态
        </label>
      ) : null}
      {node.adapter === "press" ? (
        <Field label="按键">
          <input
            className="ff-input"
            value={node.key ?? ""}
            placeholder="Enter"
            onChange={(event) => onReplace({ ...node, key: event.target.value })}
          />
        </Field>
      ) : null}
      <Field label="回读校验">
        <select
          className="ff-select"
          value={node.verify ?? "none"}
          onChange={(event) => onReplace({ ...node, verify: event.target.value as "readBack" | "none" })}
        >
          <option value="none">none</option>
          <option value="readBack">readBack</option>
        </select>
      </Field>
      {node.adapter === "click" ? (
        <p className="text-[11px] leading-5 text-forge-400">
          提交类点击请在 expect 中配置 response 或 toast 文本；否则 lint 会给 warning。
        </p>
      ) : null}
    </Section>
  );
}

function PickerSection({
  node,
  session,
  onUpdate,
  onReplace,
}: {
  node: PickerNode;
  session?: InspectorSession | null;
  onUpdate: (patch: Record<string, unknown>) => void;
  onReplace: (node: FlowNode) => void;
}) {
  return (
    <Section title="复合选择 Picker">
      <Field label="模式">
        <select
          className="ff-select"
          value={node.mode}
          onChange={(event) => onReplace({ ...node, mode: event.target.value as "inline" | "dialog" })}
        >
          <option value="dialog">dialog</option>
          <option value="inline">inline</option>
        </select>
      </Field>

      <TargetEditor
        title="触发器 trigger"
        target={node.trigger}
        onChange={(trigger) => onReplace({ ...node, trigger })}
        session={session}
      />

      <div className="border border-forge-700 bg-forge-900/30 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="ff-kicker">面板 panel</span>
          <select
            className="ff-select w-[110px] py-1 text-[10px]"
            value={node.panel.scope.type}
            onChange={(event) =>
              onReplace({
                ...node,
                panel: {
                  ...node.panel,
                  scope: { ...node.panel.scope, type: event.target.value as "dropdown" | "dialog" },
                },
              })
            }
          >
            <option value="dialog">dialog</option>
            <option value="dropdown">dropdown</option>
          </select>
        </div>
        {node.panel.scope.target ? (
          <TargetEditor
            title="面板容器"
            target={node.panel.scope.target}
            onChange={(target) =>
              onReplace({ ...node, panel: { ...node.panel, scope: { ...node.panel.scope, target } } })
            }
            session={session}
            compact
          />
        ) : (
          <button
            className="ff-btn mb-2 w-full py-1 text-[10px]"
            onClick={() =>
              onReplace({
                ...node,
                panel: {
                  ...node.panel,
                  scope: {
                    ...node.panel.scope,
                    target: {
                      label: "面板",
                      strategies: [
                        {
                          type: "role",
                          role: node.panel.scope.type === "dialog" ? "dialog" : "listbox",
                        },
                      ],
                    },
                  },
                },
              })
            }
          >
            + 指定面板容器 target
          </button>
        )}
        <SignalEditor
          title="面板就绪信号"
          signal={node.panel.readySignal ?? "content-stable"}
          onChange={(readySignal) =>
            onReplace({ ...node, panel: { ...node.panel, readySignal } })
          }
          session={session}
        />
        <div className="mt-2 grid grid-cols-[1fr_90px_80px] gap-2">
          <Field label="options response URL">
            <input
              className="ff-input font-mono text-[10px]"
              value={node.panel.optionResponse?.urlContains ?? ""}
              placeholder="/api/regions"
              onChange={(event) =>
                onReplace({
                  ...node,
                  panel: {
                    ...node.panel,
                    optionResponse: event.target.value
                      ? {
                          urlContains: event.target.value,
                          method: node.panel.optionResponse?.method ?? "GET",
                          status: node.panel.optionResponse?.status ?? 200,
                        }
                      : undefined,
                  },
                })
              }
            />
          </Field>
          <Field label="Method">
            <select
              className="ff-select py-1 text-[10px]"
              value={node.panel.optionResponse?.method ?? "GET"}
              onChange={(event) =>
                onReplace({
                  ...node,
                  panel: {
                    ...node.panel,
                    optionResponse: {
                      urlContains: node.panel.optionResponse?.urlContains ?? "/api/",
                      method: event.target.value as "GET" | "POST",
                      status: node.panel.optionResponse?.status ?? 200,
                    },
                  },
                })
              }
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </select>
          </Field>
          <Field label="Status">
            <input
              className="ff-input py-1 text-[10px]"
              type="number"
              value={node.panel.optionResponse?.status ?? 200}
              onChange={(event) =>
                onReplace({
                  ...node,
                  panel: {
                    ...node.panel,
                    optionResponse: {
                      urlContains: node.panel.optionResponse?.urlContains ?? "/api/",
                      method: node.panel.optionResponse?.method ?? "GET",
                      status: Number(event.target.value),
                    },
                  },
                })
              }
            />
          </Field>
        </div>
      </div>

      <div className="border border-forge-700 bg-forge-900/30 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="ff-kicker">筛选 filter</span>
          <button
            className="ff-btn px-2 py-0.5 text-[10px]"
            onClick={() =>
              onReplace({
                ...node,
                filter: {
                  steps: [
                    ...(node.filter?.steps ?? []),
                    {
                      adapter: "input",
                      target: {
                        label: "筛选输入",
                        strategies: [{ type: "placeholder", value: "搜索" }],
                      },
                      value: { kind: "literal", value: "" },
                    },
                  ],
                },
              })
            }
          >
            + step
          </button>
        </div>
        {(node.filter?.steps ?? []).map((step, index) => (
          <div key={index} className="mb-2 border border-forge-700/60 p-2">
            <div className="mb-1 flex items-center gap-2">
              <select
                className="ff-select py-1 text-[10px]"
                value={step.adapter}
                onChange={(event) =>
                  onReplace({
                    ...node,
                    filter: {
                      steps: node.filter!.steps.map((item, i) =>
                        i === index
                          ? { ...item, adapter: event.target.value as typeof step.adapter }
                          : item,
                      ),
                    },
                  })
                }
              >
                <option value="input">input</option>
                <option value="nativeSelect">nativeSelect</option>
                <option value="check">check</option>
                <option value="click">click</option>
              </select>
              <button
                className="ff-btn ff-btn-ghost ff-btn-danger ml-auto px-1.5 py-0.5 text-[9px]"
                onClick={() =>
                  onReplace({
                    ...node,
                    filter: {
                      steps: node.filter!.steps.filter((_, i) => i !== index),
                    },
                  })
                }
              >
                ×
              </button>
            </div>
            <TargetEditor
              target={step.target}
              onChange={(target) =>
                onReplace({
                  ...node,
                  filter: {
                    steps: node.filter!.steps.map((item, i) =>
                      i === index ? { ...item, target } : item,
                    ),
                  },
                })
              }
              session={session}
              compact
              title={`step ${index + 1}`}
            />
            {step.adapter !== "click" && step.adapter !== "check" ? (
              <ValueEditor
                label="筛选值"
                value={step.value}
                onChange={(value) =>
                  onReplace({
                    ...node,
                    filter: {
                      steps: node.filter!.steps.map((item, i) =>
                        i === index ? { ...item, value } : item,
                      ),
                    },
                  })
                }
              />
            ) : null}
          </div>
        ))}
      </div>

      <div className="border border-forge-700 bg-forge-900/30 p-3">
        <div className="mb-2 ff-kicker">选择 pick</div>
        <Field label="Strategy">
          <select
            className="ff-select"
            value={node.pick.strategy}
            onChange={(event) =>
              onReplace({
                ...node,
                pick: {
                  ...node.pick,
                  strategy: event.target.value as PickerNode["pick"]["strategy"],
                },
              })
            }
          >
            <option value="byText">byText</option>
            <option value="byRow">byRow</option>
            <option value="all">all</option>
            <option value="byCondition">byCondition</option>
          </select>
        </Field>
        {node.pick.strategy === "byText" ? (
          <>
            <Field label="数据列 column">
              <input
                className="ff-input"
                value={node.pick.byText?.column ?? ""}
                placeholder="region"
                onChange={(event) =>
                  onReplace({
                    ...node,
                    pick: {
                      ...node.pick,
                      byText: { ...node.pick.byText, column: event.target.value || undefined },
                    },
                  })
                }
              />
            </Field>
            <ValueEditor
              label="或直接取值"
              value={node.pick.byText?.value}
              onChange={(value) =>
                onReplace({
                  ...node,
                  pick: {
                    ...node.pick,
                    byText: { ...node.pick.byText, value: value ?? undefined },
                  },
                })
              }
            />
            <Field label="Match">
              <select
                className="ff-select"
                value={node.pick.byText?.match ?? "exact"}
                onChange={(event) =>
                  onReplace({
                    ...node,
                    pick: {
                      ...node.pick,
                      byText: {
                        ...node.pick.byText,
                        match: event.target.value as "exact" | "contains",
                      },
                    },
                  })
                }
              >
                <option value="exact">exact</option>
                <option value="contains">contains</option>
              </select>
            </Field>
          </>
        ) : null}
        {node.pick.strategy === "byRow" ? (
          <div className="space-y-2">
            <Field label="Key column">
              <input
                className="ff-input"
                value={node.pick.byRow?.keyColumn ?? ""}
                placeholder="客户名称"
                onChange={(event) =>
                  onReplace({
                    ...node,
                    pick: {
                      ...node.pick,
                      byRow: { ...node.pick.byRow, keyColumn: event.target.value },
                    },
                  })
                }
              />
            </Field>
            <ValueEditor
              label="Key value"
              value={node.pick.byRow?.keyValue}
              onChange={(keyValue) =>
                onReplace({
                  ...node,
                  pick: {
                    ...node.pick,
                    byRow: { ...node.pick.byRow, keyColumn: node.pick.byRow?.keyColumn ?? "", keyValue },
                  },
                })
              }
            />
          </div>
        ) : null}
        {node.pick.strategy === "byCondition" ? (
          <p className="text-[11px] leading-5 text-forge-400">
            byCondition 的条件在高级 JSON 中编辑；单个录制无法推断该条件。
          </p>
        ) : null}
        <label className="mt-2 flex items-center gap-2 font-mono text-[10px] text-forge-300">
          <input
            type="checkbox"
            checked={node.pick.multi === true}
            onChange={(event) =>
              onReplace({
                ...node,
                pick: { ...node.pick, multi: event.target.checked || undefined },
              })
            }
          />
          multi
        </label>
      </div>

      <div className="border border-forge-700 bg-forge-900/30 p-3">
        <label className="flex items-center gap-2 font-mono text-[10px] text-forge-300">
          <input
            type="checkbox"
            checked={Boolean(node.commit)}
            onChange={(event) =>
              onReplace({
                ...node,
                commit: event.target.checked
                  ? {
                      adapter: "click",
                      target: {
                        label: "提交",
                        strategies: [{ type: "role", role: "button", name: "确定" }],
                      },
                    }
                  : undefined,
              })
            }
          />
          配置 commit
        </label>
        {node.commit ? (
          <div className="mt-2">
            <TargetEditor
              title="提交按钮"
              target={node.commit.target}
              onChange={(target) => onReplace({ ...node, commit: { ...node.commit!, target } })}
              session={session}
              compact
            />
            <label className="mt-2 flex items-center gap-2 font-mono text-[10px] text-forge-300">
              <input
                type="checkbox"
                checked={node.commit.waitHidden !== false}
                onChange={(event) =>
                  onReplace({
                    ...node,
                    commit: { ...node.commit!, waitHidden: event.target.checked },
                  })
                }
              />
              waitHidden
            </label>
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["openMs", "open"],
            ["panelMs", "panel"],
            ["filterMs", "filter"],
            ["refreshMs", "refresh"],
            ["pickMs", "pick"],
            ["commitMs", "commit"],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label}>
            <input
              className="ff-input py-1 text-[10px]"
              type="number"
              value={node.stageTimeouts?.[key] ?? ""}
              placeholder="default"
              onChange={(event) =>
                onReplace({
                  ...node,
                  stageTimeouts: {
                    ...(node.stageTimeouts ?? {}),
                    [key]: event.target.value ? Number(event.target.value) : undefined,
                  },
                })
              }
            />
          </Field>
        ))}
      </div>
    </Section>
  );
}

function RawNodeEditor({
  node,
  onReplace,
}: {
  node: FlowNode;
  onReplace: (node: FlowNode) => void;
}) {
  const [text, setText] = useState(JSON.stringify(node, null, 2));
  return (
    <div>
      <textarea
        className="ff-textarea h-[320px]"
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
      />
      <div className="mt-2 flex gap-1">
        <button
          className="ff-btn flex-1"
          onClick={() => {
            try {
              const parsed = JSON.parse(text) as FlowNode;
              if (!parsed.id || !parsed.type) throw new Error("缺少 id / type");
              onReplace(parsed);
              toast("节点已更新", "success");
            } catch (error) {
              toast(`JSON 不合法: ${(error as Error).message}`, "error");
            }
          }}
        >
          应用 JSON
        </button>
        <button className="ff-btn" onClick={() => setText(JSON.stringify(node, null, 2))}>
          重置
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ember-500">
          {title}
        </span>
        <span className="h-px flex-1 bg-forge-700" />
      </div>
      {children}
    </section>
  );
}
