import { useState } from "react";
import type { PresetName, SignalRef, TargetRef, WaitSignal } from "@flowforge/dsl";
import type { InspectorSession } from "../lib/types.js";
import { defaultTarget } from "../flow/store.js";
import { TargetEditor } from "./TargetEditor.js";
import { ValueEditor } from "./ValueEditor.js";
import { Field, toast } from "./ui.js";

export const PRESETS: PresetName[] = [
  "page-ready",
  "content-stable",
  "list-ready",
  "dialog-ready",
  "option-ready",
  "save-ready",
];

const KINDS: Array<WaitSignal["kind"]> = [
  "visible",
  "hidden",
  "attached",
  "enabled",
  "count",
  "text",
  "value",
  "url",
  "response",
  "domStable",
  "loaderGone",
  "all",
  "any",
];

export function SignalEditor({
  signal,
  onChange,
  session,
  title = "等待 / 断言信号",
}: {
  signal: SignalRef;
  onChange: (signal: SignalRef) => void;
  session?: InspectorSession | null;
  title?: string;
}) {
  if (typeof signal === "string") {
    return (
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="ff-kicker">{title}</span>
          <button
            type="button"
            className="ff-btn ff-btn-ghost px-2 py-0.5 text-[10px]"
            onClick={() => onChange({ kind: "visible", target: defaultTarget() })}
          >
            改为自定义
          </button>
        </div>
        <select
          className="ff-select"
          value={signal}
          onChange={(event) => onChange(event.target.value as PresetName)}
        >
          {PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="border border-forge-700 bg-forge-900/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="ff-kicker flex-1">{title}</span>
        <select
          className="ff-select w-[130px] py-1 text-[11px]"
          value={signal.kind}
          onChange={(event) => onChange(convertKind(signal, event.target.value as WaitSignal["kind"]))}
        >
          {KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </div>

      {signal.kind === "url" ? (
        <Field label="URL 包含">
          <input
            className="ff-input"
            value={signal.matches}
            onChange={(event) => onChange({ ...signal, matches: event.target.value })}
          />
        </Field>
      ) : signal.kind === "response" ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="URL 包含">
            <input
              className="ff-input"
              value={signal.urlContains}
              onChange={(event) => onChange({ ...signal, urlContains: event.target.value })}
            />
          </Field>
          <Field label="Method">
            <input
              className="ff-input"
              value={signal.method ?? ""}
              placeholder="POST"
              onChange={(event) => onChange({ ...signal, method: event.target.value || undefined })}
            />
          </Field>
          <Field label="Status">
            <input
              className="ff-input"
              value={Array.isArray(signal.status) ? signal.status.join(",") : (signal.status ?? "")}
              placeholder="200"
              onChange={(event) =>
                onChange({
                  ...signal,
                  status: event.target.value ? Number(event.target.value) : undefined,
                })
              }
            />
          </Field>
        </div>
      ) : signal.kind === "all" || signal.kind === "any" ? (
        <JsonSignalsEditor signal={signal} onChange={onChange} />
      ) : (
        <>
          {signal.kind === "domStable" ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="quietMs">
                <input
                  className="ff-input"
                  type="number"
                  value={signal.quietMs ?? 200}
                  onChange={(event) => onChange({ ...signal, quietMs: Number(event.target.value) })}
                />
              </Field>
              <Field label="maxMs">
                <input
                  className="ff-input"
                  type="number"
                  value={signal.maxMs ?? 8000}
                  onChange={(event) => onChange({ ...signal, maxMs: Number(event.target.value) })}
                />
              </Field>
            </div>
          ) : null}
          {"target" in signal && signal.target ? (
            <TargetEditor
              target={signal.target}
              onChange={(target) => onChange({ ...signal, target } as WaitSignal)}
              session={session}
              compact
              title="信号目标"
            />
          ) : null}
          {signal.kind === "text" ? (
            <>
              <div className="mt-2">
                <ValueEditor
                  label="期望文本 equals"
                  value={signal.equals}
                  onChange={(equals) => onChange({ ...signal, equals })}
                />
              </div>
              <Field label="包含 contains" className="mt-2">
                <input
                  className="ff-input"
                  value={signal.contains ?? ""}
                  onChange={(event) =>
                    onChange({ ...signal, contains: event.target.value || undefined })
                  }
                />
              </Field>
            </>
          ) : null}
          {signal.kind === "value" ? (
            <div className="mt-2">
              <ValueEditor
                label="期望值 equals"
                value={signal.equals}
                onChange={(equals) => onChange({ ...signal, equals: equals ?? "" })}
              />
            </div>
          ) : null}
          {signal.kind === "count" ? (
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Field label="min">
                <input
                  className="ff-input"
                  type="number"
                  value={signal.min ?? ""}
                  onChange={(event) =>
                    onChange({ ...signal, min: event.target.value === "" ? undefined : Number(event.target.value) })
                  }
                />
              </Field>
              <Field label="equals">
                <input
                  className="ff-input"
                  type="number"
                  value={signal.equals ?? ""}
                  onChange={(event) =>
                    onChange({ ...signal, equals: event.target.value === "" ? undefined : Number(event.target.value) })
                  }
                />
              </Field>
              <Field label="stableMs">
                <input
                  className="ff-input"
                  type="number"
                  value={signal.stableMs ?? ""}
                  onChange={(event) =>
                    onChange({ ...signal, stableMs: event.target.value === "" ? undefined : Number(event.target.value) })
                  }
                />
              </Field>
            </div>
          ) : null}
        </>
      )}

      <div className="mt-2 flex items-center gap-4">
        <label className="flex items-center gap-2 font-mono text-[10px] text-forge-300">
          <input
            type="checkbox"
            checked={signal.optional === true}
            onChange={(event) => onChange({ ...signal, optional: event.target.checked || undefined } as WaitSignal)}
          />
          optional
        </label>
        <label className="flex items-center gap-2 font-mono text-[10px] text-forge-300">
          timeoutMs
          <input
            className="ff-input w-[90px] py-1 text-[11px]"
            type="number"
            value={signal.timeoutMs ?? ""}
            placeholder="default"
            onChange={(event) =>
              onChange({
                ...signal,
                timeoutMs: event.target.value === "" ? undefined : Number(event.target.value),
              } as WaitSignal)
            }
          />
        </label>
        <label className="flex items-center gap-2 font-mono text-[10px] text-forge-300">
          <input
            type="checkbox"
            checked={signal.optional === true}
            onChange={() => onChange({ ...signal, optional: undefined } as WaitSignal)}
          />
          <span className="text-forge-400">clear</span>
        </label>
      </div>
    </div>
  );
}

export function WaitSignalsEditor({
  signals,
  onChange,
  label,
  session,
}: {
  signals: SignalRef[] | undefined;
  onChange: (signals: SignalRef[]) => void;
  label: string;
  session?: InspectorSession | null;
}) {
  const list = signals ?? [];
  const [addValue, setAddValue] = useState("visible");
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="ff-kicker flex-1">{label}</span>
        <select
          className="ff-select w-[130px] py-1 text-[10px]"
          value={addValue}
          onChange={(event) => setAddValue(event.target.value)}
        >
          <optgroup label="presets">
            {PRESETS.map((preset) => (
              <option key={preset} value={`preset:${preset}`}>
                {preset}
              </option>
            ))}
          </optgroup>
          <optgroup label="signals">
            {KINDS.map((kind) => (
              <option key={kind} value={`kind:${kind}`}>
                {kind}
              </option>
            ))}
          </optgroup>
        </select>
        <button
          type="button"
          className="ff-btn px-2 py-1 text-[10px]"
          onClick={() => {
            if (addValue.startsWith("preset:")) {
              onChange([...list, addValue.slice(7) as PresetName]);
            } else {
              onChange([...list, blankSignal(addValue.slice(5) as WaitSignal["kind"])]);
            }
          }}
        >
          + 添加
        </button>
      </div>
      {list.length === 0 ? (
        <div className="border border-dashed border-forge-700 px-3 py-3 text-center font-mono text-[10px] text-forge-400">
          none
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((item, index) => (
            <div key={index} className="relative border border-forge-700/60 p-2">
              <button
                type="button"
                className="absolute right-1 top-1 z-10 ff-btn ff-btn-ghost ff-btn-danger px-1.5 py-0.5 text-[9px]"
                onClick={() => onChange(list.filter((_, i) => i !== index))}
              >
                ×
              </button>
              <SignalEditor
                signal={item}
                onChange={(next) => onChange(list.map((entry, i) => (i === index ? next : entry)))}
                session={session}
                title={`${label} #${index + 1}`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function convertKind(signal: WaitSignal, kind: WaitSignal["kind"]): WaitSignal {
  const base = blankSignal(kind);
  const preserved: Record<string, unknown> = {};
  if ("target" in signal) preserved.target = signal.target;
  if (signal.timeoutMs !== undefined) preserved.timeoutMs = signal.timeoutMs;
  if (signal.optional !== undefined) preserved.optional = signal.optional;
  return { ...base, ...preserved } as WaitSignal;
}

function blankSignal(kind: WaitSignal["kind"]): WaitSignal {
  switch (kind) {
    case "url":
      return { kind: "url", matches: "/" };
    case "response":
      return { kind: "response", urlContains: "/api/", method: "GET", status: 200 };
    case "domStable":
      return { kind: "domStable", quietMs: 200, maxMs: 8000 };
    case "all":
    case "any":
      return { kind, of: [{ kind: "domStable", quietMs: 200, maxMs: 8000 }] };
    case "count":
      return { kind, target: defaultTarget(), min: 1, stableMs: 300, timeoutMs: 5000 };
    case "text":
      return { kind, target: defaultTarget(), contains: "文本", timeoutMs: 5000 };
    case "value":
      return { kind, target: defaultTarget(), equals: "", timeoutMs: 5000 };
    case "loaderGone":
      return { kind, target: defaultTarget(), timeoutMs: 5000 };
    default:
      return { kind, target: defaultTarget(), timeoutMs: 5000 } as WaitSignal;
  }
}

function JsonSignalsEditor({
  signal,
  onChange,
}: {
  signal: Extract<WaitSignal, { kind: "all" | "any" }>;
  onChange: (signal: WaitSignal) => void;
}) {
  const [text, setText] = useState(JSON.stringify(signal.of, null, 2));
  return (
    <div>
      <p className="mb-1 font-mono text-[10px] text-forge-400">嵌套信号数组（JSON）</p>
      <textarea
        className="ff-textarea h-[120px]"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button
        type="button"
        className="ff-btn mt-1 w-full py-1 text-[10px]"
        onClick={() => {
          try {
            const parsed = JSON.parse(text) as WaitSignal[];
            if (!Array.isArray(parsed)) throw new Error("必须是数组");
            onChange({ ...signal, of: parsed });
          } catch (error) {
            toast(`JSON 不合法: ${(error as Error).message}`, "error");
          }
        }}
      >
        应用嵌套信号
      </button>
    </div>
  );
}

export function defaultSignalTarget(): TargetRef {
  return defaultTarget();
}
