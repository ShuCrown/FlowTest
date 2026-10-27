import { useState } from "react";
import type { Condition, ConditionOperand } from "@flowforge/dsl";
import { Field, toast } from "./ui.js";

type SimpleCondition = Exclude<Condition, { op: "and" | "or" | "not" }>;

const OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "exists", "in"] as const;

export function ConditionEditor({
  condition,
  onChange,
}: {
  condition: Condition;
  onChange: (condition: Condition) => void;
}) {
  if (condition.op === "and" || condition.op === "or" || condition.op === "not") {
    return <JsonConditionEditor condition={condition} onChange={onChange} />;
  }
  const simple = condition as SimpleCondition;
  return (
    <div className="space-y-2">
      <Field label="操作符">
        <select
          className="ff-select"
          value={simple.op}
          onChange={(event) => {
            const op = event.target.value as (typeof OPS)[number];
            if (op === "exists") {
              onChange({ op, left: simple.left });
              return;
            }
            if (op === "in") {
              onChange({ op, left: simple.left, values: [{ value: "值" }] });
              return;
            }
            onChange({
              op,
              left: simple.left,
              right: "right" in simple ? simple.right : { value: 0 },
            } as Condition);
          }}
        >
          {OPS.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
      </Field>

      <OperandEditor
        label="左侧"
        operand={simple.left}
        onChange={(left) => onChange({ ...simple, left } as Condition)}
      />

      {simple.op !== "exists" && simple.op !== "in" ? (
        <OperandEditor
          label="右侧"
          operand={simple.right}
          onChange={(right) => onChange({ ...simple, right } as Condition)}
        />
      ) : null}

      {simple.op === "in" ? (
        <Field label="候选值（逗号分隔）">
          <input
            className="ff-input"
            value={simple.values
              .map((operand) => ("value" in operand ? String(operand.value) : ""))
              .join(",")}
            onChange={(event) =>
              onChange({
                ...simple,
                values: event.target.value.split(",").map((value) => ({ value })),
              })
            }
          />
        </Field>
      ) : null}
    </div>
  );
}

function OperandEditor({
  label,
  operand,
  onChange,
}: {
  label: string;
  operand: ConditionOperand;
  onChange: (operand: ConditionOperand) => void;
}) {
  const kind = "column" in operand ? "column" : "var" in operand ? "var" : "value";
  const value =
    "column" in operand ? operand.column : "var" in operand ? operand.var : String(operand.value);
  return (
    <div className="grid grid-cols-[70px_1fr] items-end gap-2">
      <Field label={label}>
        <select
          className="ff-select py-1 text-[11px]"
          value={kind}
          onChange={(event) =>
            onChange(
              event.target.value === "column"
                ? { column: "amount" }
                : event.target.value === "var"
                  ? { var: "customerName" }
                  : { value: 0 },
            )
          }
        >
          <option value="column">列</option>
          <option value="var">变量</option>
          <option value="value">值</option>
        </select>
      </Field>
      <input
        className="ff-input py-1 text-[11px]"
        value={value}
        onChange={(event) => {
          if (kind === "column") onChange({ column: event.target.value });
          else if (kind === "var") onChange({ var: event.target.value });
          else {
            const raw = event.target.value;
            const parsed =
              raw !== "" && !Number.isNaN(Number(raw))
                ? Number(raw)
                : raw === "true"
                  ? true
                  : raw === "false"
                    ? false
                    : raw;
            onChange({ value: parsed });
          }
        }}
      />
    </div>
  );
}

function JsonConditionEditor({
  condition,
  onChange,
}: {
  condition: Condition;
  onChange: (condition: Condition) => void;
}) {
  const [text, setText] = useState(JSON.stringify(condition, null, 2));
  return (
    <div>
      <p className="mb-1 font-mono text-[10px] text-forge-400">
        组合条件（and / or / not）使用 JSON 编辑
      </p>
      <textarea
        className="ff-textarea h-[150px]"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button
        type="button"
        className="ff-btn mt-1 w-full py-1 text-[10px]"
        onClick={() => {
          try {
            onChange(JSON.parse(text) as Condition);
          } catch (error) {
            toast(`JSON 不合法: ${(error as Error).message}`, "error");
          }
        }}
      >
        应用条件
      </button>
    </div>
  );
}
