import { useState } from "react";
import type { Strategy, TargetRef } from "@flowforge/dsl";
import type { InspectorSession } from "../lib/types.js";
import { api } from "../lib/api.js";
import { Field, toast } from "./ui.js";

const STRATEGY_TYPES: Array<{ value: Strategy["type"]; label: string }> = [
  { value: "testid", label: "testid" },
  { value: "role", label: "role" },
  { value: "label", label: "label" },
  { value: "placeholder", label: "placeholder" },
  { value: "text", label: "text" },
  { value: "name", label: "name" },
  { value: "css", label: "css" },
  { value: "xpath", label: "xpath" },
];

export function TargetEditor({
  target,
  onChange,
  session,
  compact = false,
  title = "目标定位",
}: {
  target: TargetRef;
  onChange: (target: TargetRef) => void;
  session?: InspectorSession | null;
  compact?: boolean;
  title?: string;
}) {
  const [attempts, setAttempts] = useState<
    Array<{ strategy: string; count: number; error?: string }> | null
  >(null);
  const [busy, setBusy] = useState<"test" | "pick" | null>(null);

  const update = (patch: Partial<TargetRef>): void => onChange({ ...target, ...patch });

  const updateStrategy = (index: number, next: Strategy): void => {
    const strategies = target.strategies.map((strategy, i) => (i === index ? next : strategy));
    update({ strategies });
  };

  const testTarget = async (): Promise<void> => {
    if (!session) {
      toast("先打开检查器会话", "error");
      return;
    }
    setBusy("test");
    try {
      const result = await api.inspector.testTarget(session.id, target);
      setAttempts(result.attempts);
      toast(result.ok ? "解析命中" : "没有唯一命中", result.ok ? "success" : "error");
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const pick = async (): Promise<void> => {
    if (!session) {
      toast("先打开检查器会话", "error");
      return;
    }
    setBusy("pick");
    toast("请在检查器浏览器中点击目标元素（Esc 取消）");
    try {
      const result = await api.inspector.pick(session.id);
      if (result.ok && result.target) {
        onChange(result.target);
        toast("已拾取元素并生成候选链", "success");
      } else {
        toast(result.reason === "canceled" ? "已取消拾取" : "拾取失败", "error");
      }
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={compact ? "" : "border border-forge-700 bg-forge-900/40 p-3"}>
      <div className="mb-2 flex items-center justify-between">
        <span className="ff-kicker">{title}</span>
        <div className="flex gap-1">
          <button
            type="button"
            className="ff-btn ff-btn-ghost px-2 py-1 text-[10px]"
            onClick={testTarget}
            disabled={busy !== null}
          >
            {busy === "test" ? "测试中…" : "测试解析"}
          </button>
          <button
            type="button"
            className="ff-btn ff-btn-ghost px-2 py-1 text-[10px]"
            onClick={pick}
            disabled={busy !== null}
          >
            {busy === "pick" ? "拾取中…" : "拾取"}
          </button>
        </div>
      </div>

      <Field label="语义名称">
        <input
          className="ff-input"
          value={target.label ?? ""}
          onChange={(event) => update({ label: event.target.value || undefined })}
          placeholder="客户名称"
        />
      </Field>

      <div className="mt-3 space-y-2">
        {target.strategies.map((strategy, index) => (
          <div key={`${strategy.type}-${index}`} className="border border-forge-700/70 bg-forge-950/50 p-2">
            <div className="mb-2 flex items-center gap-1">
              <span className="font-mono text-[9px] text-forge-400">{index + 1}</span>
              <select
                className="ff-select py-1 text-[11px]"
                value={strategy.type}
                onChange={(event) =>
                  updateStrategy(index, defaultStrategy(event.target.value as Strategy["type"]))
                }
              >
                {STRATEGY_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ff-btn ff-btn-ghost px-1.5 py-0.5"
                onClick={() => {
                  if (index === 0) return;
                  const strategies = [...target.strategies];
                  [strategies[index - 1], strategies[index]] = [strategies[index]!, strategies[index - 1]!];
                  update({ strategies });
                }}
              >
                ↑
              </button>
              <button
                type="button"
                className="ff-btn ff-btn-ghost px-1.5 py-0.5"
                onClick={() => {
                  if (index === target.strategies.length - 1) return;
                  const strategies = [...target.strategies];
                  [strategies[index + 1], strategies[index]] = [strategies[index]!, strategies[index + 1]!];
                  update({ strategies });
                }}
              >
                ↓
              </button>
              <button
                type="button"
                className="ff-btn ff-btn-ghost ff-btn-danger px-1.5 py-0.5"
                onClick={() =>
                  update({ strategies: target.strategies.filter((_, i) => i !== index) })
                }
              >
                ×
              </button>
            </div>
            {strategy.type === "role" ? (
              <div className="grid grid-cols-[1fr_1fr] gap-2">
                <input
                  className="ff-input py-1 text-[11px]"
                  value={strategy.role}
                  placeholder="button"
                  onChange={(event) => updateStrategy(index, { ...strategy, role: event.target.value })}
                />
                <input
                  className="ff-input py-1 text-[11px]"
                  value={strategy.name ?? ""}
                  placeholder="可访问名"
                  onChange={(event) =>
                    updateStrategy(index, { ...strategy, name: event.target.value || undefined })
                  }
                />
              </div>
            ) : (
              <input
                className="ff-input py-1 text-[11px]"
                value={"value" in strategy ? strategy.value : ""}
                placeholder={strategy.type}
                onChange={(event) =>
                  updateStrategy(index, { ...strategy, value: event.target.value } as Strategy)
                }
              />
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        className="ff-btn mt-2 w-full py-1 text-[10px]"
        onClick={() =>
          update({
            strategies: [
              ...target.strategies,
              { type: "label", value: "新策略", exact: true },
            ],
          })
        }
      >
        + 添加候选策略
      </button>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2 font-mono text-[10px] text-forge-300">
          <input
            type="checkbox"
            checked={target.strict !== false}
            onChange={(event) => update({ strict: event.target.checked })}
          />
          strict
        </label>
        <label className="flex items-center gap-2 font-mono text-[10px] text-forge-300">
          nth
          <input
            className="ff-input py-1 text-[11px]"
            type="number"
            min={0}
            value={target.nth ?? ""}
            placeholder="—"
            onChange={(event) =>
              update({ nth: event.target.value === "" ? undefined : Number(event.target.value) })
            }
          />
        </label>
      </div>

      {target.scope ? (
        <div className="mt-3 border-l-2 border-ember-500/30 pl-2">
          <TargetEditor
            target={target.scope}
            onChange={(scope) => update({ scope })}
            session={session}
            compact
            title="容器作用域"
          />
          <button
            type="button"
            className="ff-btn ff-btn-ghost mt-1 text-[10px]"
            onClick={() => update({ scope: undefined })}
          >
            移除作用域
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="ff-btn ff-btn-ghost mt-2 text-[10px]"
          onClick={() => update({ scope: { label: "容器", strategies: [{ type: "role", role: "dialog" }] } })}
        >
          + 添加容器作用域
        </button>
      )}

      {attempts ? (
        <div className="mt-2 space-y-1 border-t border-forge-700 pt-2">
          {attempts.map((attempt, index) => (
            <div key={index} className="flex items-center justify-between font-mono text-[10px]">
              <span className="truncate text-forge-400">{attempt.strategy}</span>
              <span className={attempt.count === 1 ? "text-moss-400" : "text-[#f0a58f]"}>
                {attempt.error ?? attempt.count}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function defaultStrategy(type: Strategy["type"]): Strategy {
  switch (type) {
    case "role":
      return { type: "role", role: "button", name: "", exact: true };
    case "testid":
    case "label":
    case "placeholder":
    case "text":
    case "name":
    case "css":
    case "xpath":
      return { type, value: "" } as Strategy;
  }
}
