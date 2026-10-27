import { useState } from "react";
import type { GeneratorType, ValueExpr, ValueLike } from "@flowforge/dsl";
import { Field } from "./ui.js";

type Kind = ValueExpr["kind"] | "unbound";

const KIND_LABEL: Record<Kind, string> = {
  unbound: "未绑定",
  literal: "字面值",
  var: "变量",
  dataset: "数据集列",
  env: "环境变量",
  template: "模板",
  generator: "生成器",
  ref: "节点输出",
};

const GENERATORS: GeneratorType[] = [
  "unique.text",
  "unique.email",
  "unique.phone",
  "unique.orderNo",
  "sequence",
  "faker.name",
  "faker.email",
  "faker.phone",
  "faker.company",
  "faker.idCard",
];

export function ValueEditor({
  value,
  onChange,
  label = "取值绑定",
}: {
  value: ValueLike | undefined;
  onChange: (value: ValueLike | undefined) => void;
  label?: string;
}) {
  const expr = asExpr(value);
  const kind: Kind = expr?.kind ?? (value === undefined ? "unbound" : "literal");
  const [literalText, setLiteralText] = useState(() =>
    expr?.kind === "literal" ? JSON.stringify(expr.value) : typeof value === "string" ? value : JSON.stringify(value ?? ""),
  );

  const changeKind = (next: Kind): void => {
    if (next === "unbound") {
      onChange(undefined);
      return;
    }
    switch (next) {
      case "literal":
        onChange({ kind: "literal", value: "" });
        break;
      case "var":
        onChange({ kind: "var", name: "" });
        break;
      case "dataset":
        onChange({ kind: "dataset", column: "" });
        break;
      case "env":
        onChange({ kind: "env", name: "" });
        break;
      case "template":
        onChange({ kind: "template", template: "{{vars.x}}" });
        break;
      case "generator":
        onChange({ kind: "generator", type: "unique.text", unique: true });
        break;
      case "ref":
        onChange({ kind: "ref", nodeId: "", output: "value" });
        break;
    }
  };

  const update = (patch: Partial<ValueExpr>): void => {
    if (!expr) return;
    onChange({ ...expr, ...patch } as ValueExpr);
  };

  return (
    <div className="space-y-2">
      <Field label={label}>
        <select
          className="ff-select"
          value={kind}
          onChange={(event) => changeKind(event.target.value as Kind)}
        >
          {Object.entries(KIND_LABEL).map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
      </Field>

      {expr?.kind === "literal" ? (
        <div>
          <textarea
            className="ff-textarea h-[64px]"
            value={literalText}
            onChange={(event) => setLiteralText(event.target.value)}
            onBlur={() => {
              try {
                onChange({ kind: "literal", value: JSON.parse(literalText) });
              } catch {
                onChange({ kind: "literal", value: literalText });
              }
            }}
            placeholder='"100" 或 100 或 {"a":1}'
          />
          <div className="mt-1 flex gap-2">
            {[
              ["字符串", "string"],
              ["数字", "number"],
              ["布尔", "boolean"],
              ["null", "null"],
            ].map(([text, type]) => (
              <button
                key={type}
                type="button"
                className="ff-btn ff-btn-ghost px-1.5 py-0.5 text-[9px]"
                onClick={() => {
                  const raw = literalText.trim();
                  const parsed =
                    type === "string"
                      ? raw.replace(/^"|"$/g, "")
                      : type === "number"
                        ? Number(raw) || 0
                        : type === "boolean"
                          ? raw === "true"
                          : null;
                  setLiteralText(type === "string" ? JSON.stringify(parsed) : String(parsed));
                  onChange({ kind: "literal", value: parsed });
                }}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {expr?.kind === "var" ? (
        <input
          className="ff-input"
          value={expr.name}
          placeholder="customerName"
          onChange={(event) => update({ name: event.target.value })}
        />
      ) : null}

      {expr?.kind === "dataset" ? (
        <input
          className="ff-input"
          value={expr.column}
          placeholder="amount"
          onChange={(event) => update({ column: event.target.value })}
        />
      ) : null}

      {expr?.kind === "env" ? (
        <input
          className="ff-input"
          value={expr.name}
          placeholder="FF_CUSTOMER_NAME"
          onChange={(event) => update({ name: event.target.value })}
        />
      ) : null}

      {expr?.kind === "template" ? (
        <input
          className="ff-input font-mono text-[11px]"
          value={expr.template}
          placeholder="{{vars.customerName}}-{{seq.order}}"
          onChange={(event) => update({ template: event.target.value })}
        />
      ) : null}

      {expr?.kind === "ref" ? (
        <div className="grid grid-cols-[1fr_100px] gap-2">
          <input
            className="ff-input"
            value={expr.nodeId}
            placeholder="nodeId"
            onChange={(event) => update({ nodeId: event.target.value })}
          />
          <select
            className="ff-select"
            value={expr.output}
            onChange={(event) => update({ output: event.target.value as "value" | "text" | "attribute" })}
          >
            <option value="value">value</option>
            <option value="text">text</option>
            <option value="attribute">attribute</option>
          </select>
        </div>
      ) : null}

      {expr?.kind === "generator" ? (
        <div className="space-y-2 border border-forge-700/60 p-2">
          <select
            className="ff-select"
            value={expr.type}
            onChange={(event) => update({ type: event.target.value as GeneratorType })}
          >
            {GENERATORS.map((generator) => (
              <option key={generator} value={generator}>
                {generator}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="ff-input py-1 text-[11px]"
              value={expr.scope ?? ""}
              placeholder="scope"
              onChange={(event) => update({ scope: event.target.value || undefined })}
            />
            <label className="flex items-center gap-2 font-mono text-[10px] text-forge-300">
              <input
                type="checkbox"
                checked={expr.unique === true}
                onChange={(event) => update({ unique: event.target.checked })}
              />
              unique
            </label>
          </div>
          <input
            className="ff-input py-1 font-mono text-[11px]"
            value={expr.template ?? ""}
            placeholder="自动客户-{{seq.customer}}-{{run.shortId}}"
            onChange={(event) => update({ template: event.target.value || undefined })}
          />
          <p className="font-mono text-[9px] leading-4 text-forge-400">
            模板仅允许 {"{{seq.x}} / {{run.shortId}} / {{vars.x}} / {{sys.baseUrl}} / {{env.NAME}}"}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function asExpr(value: ValueLike | undefined): ValueExpr | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return { kind: "literal", value };
  }
  if (Array.isArray(value)) return { kind: "literal", value };
  if (typeof value === "object" && "kind" in value && typeof value.kind === "string") {
    return value as ValueExpr;
  }
  if (typeof value === "object" && "gen" in value) {
    return { kind: "generator", type: "unique.text", unique: true };
  }
  return null;
}
