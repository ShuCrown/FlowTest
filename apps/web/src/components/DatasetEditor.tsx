import { useMemo, useState } from "react";
import {
  generateMatrix,
  type Constraint,
  type Dataset,
  type ValueLike,
} from "@flowforge/dsl";
import { useEditorStore } from "../flow/store.js";
import { Field, SectionTitle, toast } from "./ui.js";

type Tab = "datasets" | "constraints" | "generate" | "vars";

export function DatasetEditor({ onClose }: { onClose: () => void }) {
  const dsl = useEditorStore((state) => state.dsl);
  const setDatasets = useEditorStore((state) => state.setDatasets);
  const setConstraints = useEditorStore((state) => state.setConstraints);
  const setVars = useEditorStore((state) => state.setVars);
  const [tab, setTab] = useState<Tab>("datasets");
  const datasets = dsl?.datasets ?? [];
  const constraints = dsl?.constraints ?? [];
  const columns = useMemo(
    () => Array.from(new Set(datasets.flatMap((dataset) => Object.keys(dataset.columns)))),
    [datasets],
  );

  if (!dsl) return null;

  const updateDataset = (id: string, patch: Partial<Dataset>): void => {
    setDatasets(datasets.map((dataset) => (dataset.id === id ? { ...dataset, ...patch } : dataset)));
  };

  const addDataset = (): void => {
    let index = datasets.length + 1;
    while (datasets.some((dataset) => dataset.id === `dataset-${index}`)) index += 1;
    setDatasets([
      ...datasets,
      { id: `dataset-${index}`, name: `数据集 ${index}`, columns: {} },
    ]);
  };

  const addColumn = (): void => {
    const name = window.prompt("新列名（例如 amount / region）");
    if (!name) return;
    if (columns.includes(name)) {
      toast("列名已存在", "error");
      return;
    }
    setDatasets(
      datasets.map((dataset) => ({
        ...dataset,
        columns: { ...dataset.columns, [name]: "" },
      })),
    );
  };

  const removeColumn = (name: string): void => {
    if (!window.confirm(`删除列 ${name}？`)) return;
    setDatasets(
      datasets.map((dataset) => {
        const next = { ...dataset.columns };
        delete next[name];
        return { ...dataset, columns: next };
      }),
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3">
      <div className="flex h-[88vh] w-full max-w-[1180px] flex-col border border-forge-600 bg-forge-900 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-forge-700 px-5 py-3">
          <div>
            <div className="ff-kicker">Data Workshop / 数据工坊</div>
            <div className="ff-display text-xl text-paper">数据集、约束与组合</div>
          </div>
          <div className="ml-auto flex gap-1">
            {(
              [
                ["datasets", "数据集"],
                ["constraints", "约束"],
                ["generate", "组合生成"],
                ["vars", "变量"],
              ] as Array<[Tab, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                className={`ff-btn ${tab === key ? "ff-btn-primary" : ""}`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
            <button className="ff-btn" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {tab === "datasets" ? (
            <>
              <SectionTitle index="01">显式数据集行（上限 500）</SectionTitle>
              <div className="mb-2 flex gap-2">
                <button className="ff-btn" onClick={addDataset}>
                  + 数据集
                </button>
                <button className="ff-btn" onClick={addColumn}>
                  + 列
                </button>
                <span className="ff-badge">{datasets.length} rows · {columns.length} cols</span>
              </div>
              <div className="overflow-x-auto border border-forge-700">
                <table className="ff-table">
                  <thead>
                    <tr>
                      <th className="sticky left-0 bg-forge-900">数据集</th>
                      {columns.map((column) => (
                        <th key={column}>
                          <div className="flex items-center gap-1">
                            {column}
                            <button
                              className="text-[9px] text-forge-400 hover:text-[#f0a58f]"
                              onClick={() => removeColumn(column)}
                            >
                              ×
                            </button>
                          </div>
                        </th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {datasets.map((dataset) => (
                      <tr key={dataset.id}>
                        <td className="sticky left-0 min-w-[180px] bg-forge-900">
                          <input
                            className="ff-input py-1 text-[11px]"
                            value={dataset.name}
                            onChange={(event) => updateDataset(dataset.id, { name: event.target.value })}
                          />
                          <div className="mt-1 font-mono text-[9px] text-forge-400">{dataset.id}</div>
                        </td>
                        {columns.map((column) => (
                          <td key={column} className="min-w-[150px]">
                            <CellEditor
                              value={dataset.columns[column]}
                              onChange={(value) =>
                                updateDataset(dataset.id, {
                                  columns: { ...dataset.columns, [column]: value },
                                })
                              }
                            />
                          </td>
                        ))}
                        <td>
                          <button
                            className="ff-btn ff-btn-ghost ff-btn-danger text-[10px]"
                            onClick={() => setDatasets(datasets.filter((item) => item.id !== dataset.id))}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-forge-400">
                单元格支持字面值、JSON 对象与 <code>{"{gen: \"unique.email\"}"}</code> 简写。生成器在运行前展开并写入唯一值账本。
              </p>
            </>
          ) : null}

          {tab === "constraints" ? (
            <ConstraintsEditor
              constraints={constraints}
              onChange={setConstraints}
            />
          ) : null}

          {tab === "generate" ? (
            <GeneratorPanel
              datasets={datasets}
              variables={Object.keys(dsl.vars ?? {})}
              onApply={(rows, meta) =>
                setDatasets(
                  rows.map((row, index) => ({
                    id: `matrix-${index + 1}`,
                    name: `组合 ${index + 1}`,
                    columns: row as Record<string, ValueLike>,
                    meta,
                  })),
                )
              }
            />
          ) : null}

          {tab === "vars" ? (
            <VarsEditor
              vars={dsl.vars ?? {}}
              onChange={(vars) => setVars(vars)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CellEditor({
  value,
  onChange,
}: {
  value: ValueLike | undefined;
  onChange: (value: ValueLike) => void;
}) {
  const initial =
    value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  const [text, setText] = useState(initial);
  return (
    <input
      className="ff-input py-1 font-mono text-[10px]"
      value={text}
      title={typeof value === "object" ? JSON.stringify(value) : String(value ?? "")}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        try {
          onChange(JSON.parse(text));
        } catch {
          onChange(text);
        }
      }}
    />
  );
}

function ConstraintsEditor({
  constraints,
  onChange,
}: {
  constraints: Constraint[];
  onChange: (constraints: Constraint[]) => void;
}) {
  const add = (): void => {
    onChange([...constraints, { type: "range", field: "amount", min: 0 }]);
  };
  const update = (index: number, next: Constraint): void => {
    onChange(constraints.map((item, i) => (i === index ? next : item)));
  };
  return (
    <>
      <SectionTitle index="02">约束（保存后立即求值预览）</SectionTitle>
      <button className="ff-btn mb-3" onClick={add}>
        + 约束
      </button>
      <div className="space-y-2">
        {constraints.length === 0 ? (
          <div className="ff-panel px-4 py-6 text-center font-mono text-[10px] text-forge-400">
            暂无约束。约束在数据集展开、变量生成后、浏览器启动前求值。
          </div>
        ) : (
          constraints.map((constraint, index) => (
            <div key={index} className="ff-card p-3">
              <div className="mb-2 flex items-center gap-2">
                <select
                  className="ff-select w-[140px] py-1 text-[11px]"
                  value={constraint.type}
                  onChange={(event) =>
                    update(index, defaultConstraint(event.target.value as Constraint["type"]))
                  }
                >
                  {["equals", "derive", "unique", "range", "regex", "oneOf"].map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <button
                  className="ff-btn ff-btn-ghost ff-btn-danger ml-auto text-[10px]"
                  onClick={() => onChange(constraints.filter((_, i) => i !== index))}
                >
                  删除
                </button>
              </div>
              <ConstraintFields constraint={constraint} onChange={(next) => update(index, next)} />
            </div>
          ))
        )}
      </div>
    </>
  );
}

function ConstraintFields({
  constraint,
  onChange,
}: {
  constraint: Constraint;
  onChange: (constraint: Constraint) => void;
}) {
  switch (constraint.type) {
    case "equals":
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="left">
            <input className="ff-input" value={constraint.left} onChange={(event) => onChange({ ...constraint, left: event.target.value })} />
          </Field>
          <Field label="right">
            <input className="ff-input" value={constraint.right} onChange={(event) => onChange({ ...constraint, right: event.target.value })} />
          </Field>
        </div>
      );
    case "derive":
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="target">
            <input className="ff-input" value={constraint.target} onChange={(event) => onChange({ ...constraint, target: event.target.value })} />
          </Field>
          <Field label="from">
            <input className="ff-input" value={constraint.from} onChange={(event) => onChange({ ...constraint, from: event.target.value })} />
          </Field>
          <Field label="op">
            <select className="ff-select" value={constraint.op} onChange={(event) => onChange({ ...constraint, op: event.target.value as typeof constraint.op })}>
              {["localPart", "domain", "prefix", "suffix", "concat", "hash"].map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
          </Field>
          <Field label="template（可选）">
            <input className="ff-input" value={constraint.template ?? ""} onChange={(event) => onChange({ ...constraint, template: event.target.value || undefined })} />
          </Field>
        </div>
      );
    case "unique":
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="field">
            <input className="ff-input" value={constraint.field} onChange={(event) => onChange({ ...constraint, field: event.target.value })} />
          </Field>
          <Field label="gen">
            <input className="ff-input" value={constraint.gen ?? ""} placeholder="sequence.orderNo" onChange={(event) => onChange({ ...constraint, gen: event.target.value || undefined })} />
          </Field>
        </div>
      );
    case "range":
      return (
        <div className="grid grid-cols-[1fr_100px_100px] gap-2">
          <Field label="field">
            <input className="ff-input" value={constraint.field} onChange={(event) => onChange({ ...constraint, field: event.target.value })} />
          </Field>
          <Field label="min">
            <input className="ff-input" type="number" value={constraint.min ?? ""} onChange={(event) => onChange({ ...constraint, min: event.target.value === "" ? undefined : Number(event.target.value) })} />
          </Field>
          <Field label="max">
            <input className="ff-input" type="number" value={constraint.max ?? ""} onChange={(event) => onChange({ ...constraint, max: event.target.value === "" ? undefined : Number(event.target.value) })} />
          </Field>
        </div>
      );
    case "regex":
      return (
        <div className="grid grid-cols-[1fr_2fr] gap-2">
          <Field label="field">
            <input className="ff-input" value={constraint.field} onChange={(event) => onChange({ ...constraint, field: event.target.value })} />
          </Field>
          <Field label="pattern">
            <input className="ff-input font-mono text-[11px]" value={constraint.pattern} onChange={(event) => onChange({ ...constraint, pattern: event.target.value })} />
          </Field>
        </div>
      );
    case "oneOf":
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="field">
            <input className="ff-input" value={constraint.field} onChange={(event) => onChange({ ...constraint, field: event.target.value })} />
          </Field>
          <Field label="values（逗号分隔）">
            <input
              className="ff-input"
              value={constraint.values.map(String).join(",")}
              onChange={(event) =>
                onChange({
                  ...constraint,
                  values: event.target.value.split(",").map((value) => value.trim()),
                })
              }
            />
          </Field>
        </div>
      );
  }
}

function defaultConstraint(type: Constraint["type"]): Constraint {
  switch (type) {
    case "equals":
      return { type, left: "password", right: "confirmPassword" };
    case "derive":
      return { type, target: "username", from: "email", op: "localPart" };
    case "unique":
      return { type, field: "orderNo", gen: "sequence.orderNo" };
    case "range":
      return { type, field: "amount", min: 0, max: 100000 };
    case "regex":
      return { type, field: "phone", pattern: "^1\\d{10}$" };
    case "oneOf":
      return { type, field: "region", values: ["华东区", "华南区"] };
  }
}

function GeneratorPanel({
  datasets,
  variables,
  onApply,
}: {
  datasets: Dataset[];
  variables: string[];
  onApply: (rows: Array<Record<string, unknown>>, meta: Record<string, unknown>) => void;
}) {
  const derivedFactors = useMemo(() => {
    const factors: Record<string, unknown[]> = {};
    for (const dataset of datasets) {
      for (const [column, value] of Object.entries(dataset.columns)) {
        if (value && typeof value === "object") continue;
        const values = factors[column] ?? [];
        if (!values.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
          values.push(value);
        }
        factors[column] = values;
      }
    }
    return factors;
  }, [datasets]);
  const [mode, setMode] = useState<"full" | "pairwise">("pairwise");
  const [seed, setSeed] = useState(20261026);
  const [factorsText, setFactorsText] = useState(JSON.stringify(derivedFactors, null, 2));
  const [mandatoryText, setMandatoryText] = useState("[]");
  const [preview, setPreview] = useState<ReturnType<typeof generateMatrix> | null>(null);

  const run = (): ReturnType<typeof generateMatrix> | null => {
    try {
      return generateMatrix({
        mode,
        factors: JSON.parse(factorsText) as Record<string, unknown[]>,
        mandatoryRows: JSON.parse(mandatoryText) as Array<Record<string, unknown>>,
        seed,
      });
    } catch (error) {
      toast((error as Error).message, "error");
      return null;
    }
  };

  return (
    <>
      <SectionTitle index="03">组合生成器（编辑期生成显式行）</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Field label="模式">
              <select className="ff-select" value={mode} onChange={(event) => setMode(event.target.value as "full" | "pairwise")}>
                <option value="pairwise">pairwise</option>
                <option value="full">full</option>
              </select>
            </Field>
            <Field label="seed">
              <input className="ff-input" type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} />
            </Field>
            <Field label="变量">
              <div className="flex h-[34px] items-center font-mono text-[9px] text-forge-400">
                {variables.length ? variables.join(", ") : "none"}
              </div>
            </Field>
          </div>
          <Field label="因子（JSON：列 → 取值数组）">
            <textarea className="ff-textarea h-[180px]" value={factorsText} onChange={(event) => setFactorsText(event.target.value)} />
          </Field>
          <Field label="必测组合（JSON 数组）">
            <textarea className="ff-textarea h-[90px]" value={mandatoryText} onChange={(event) => setMandatoryText(event.target.value)} />
          </Field>
          <div className="flex gap-2">
            <button className="ff-btn" onClick={() => setPreview(run())}>
              预览
            </button>
            <button
              className="ff-btn ff-btn-primary"
              onClick={() => {
                const result = run();
                if (!result) return;
                onApply(result.rows, {
                  generatedBy: result.generatedBy,
                  seed: result.seed,
                  pairCoverage: result.pairCoverage,
                });
                toast(`已写入 ${result.count} 行显式数据集`, "success");
              }}
            >
              应用为数据集
            </button>
          </div>
        </div>
        <div className="border border-forge-700 bg-forge-950/60 p-3">
          {preview ? (
            <>
              <div className="flex flex-wrap gap-2">
                <span className="ff-badge ff-badge-ember">{preview.mode}</span>
                <span className="ff-badge">{preview.count} rows</span>
                <span className="ff-badge">seed {preview.seed}</span>
                {preview.pairCoverage ? (
                  <span className="ff-badge ff-badge-good">
                    pair {Math.round(preview.pairCoverage.ratio * 1000) / 10}%
                  </span>
                ) : null}
              </div>
              <div className="mt-2 max-h-[330px] overflow-auto">
                <table className="ff-table">
                  <thead>
                    <tr>
                      {preview.factors.map((factor) => (
                        <th key={factor}>{factor}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 12).map((row, index) => (
                      <tr key={index}>
                        {preview.factors.map((factor) => (
                          <td key={factor} className="font-mono text-[10px]">
                            {String(row[factor] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.count > 12 ? (
                <p className="mt-1 font-mono text-[9px] text-forge-400">
                  仅展示前 12 行，共 {preview.count} 行
                </p>
              ) : null}
            </>
          ) : (
            <div className="flex h-full items-center justify-center font-mono text-[10px] text-forge-400">
              预览会显示行数、pair 覆盖率与组合样例
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function VarsEditor({
  vars,
  onChange,
}: {
  vars: Record<string, ValueLike>;
  onChange: (vars: Record<string, ValueLike>) => void;
}) {
  const [text, setText] = useState(JSON.stringify(vars, null, 2));
  return (
    <>
      <SectionTitle index="04">流程变量</SectionTitle>
      <p className="mb-2 text-[11px] text-forge-400">
        变量在数据集展开后求值；生成器会写入唯一值账本。模板仅允许 vars / run / seq / sys / env。
      </p>
      <textarea className="ff-textarea h-[420px]" value={text} onChange={(event) => setText(event.target.value)} />
      <button
        className="ff-btn mt-2"
        onClick={() => {
          try {
            onChange(JSON.parse(text) as Record<string, ValueLike>);
            toast("变量已应用", "success");
          } catch (error) {
            toast(`JSON 不合法: ${(error as Error).message}`, "error");
          }
        }}
      >
        应用变量
      </button>
    </>
  );
}
