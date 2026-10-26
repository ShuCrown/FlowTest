import { createHash, randomInt } from "node:crypto";
import { Faker, zh_CN } from "@faker-js/faker";
import {
  normalizeGenerator,
  normalizeValue,
  renderTemplate,
  listTemplateRefs,
  type Constraint,
  type FlowDsl,
  type ValueExpr,
  type ValueLike,
} from "@flowforge/dsl";
import { ERROR_CODES, FlowForgeError } from "./errors.js";
import type { Ledger, ProvenanceEntry, ResolvedData } from "./types.js";

export interface DataDeps {
  runId: string;
  shortId: string;
  startedAt: string;
  ledger: Ledger;
  env: Record<string, string | undefined>;
  seed?: number;
  systemId?: string;
}

export class DataResolutionError extends FlowForgeError {
  constructor(code: string, message: string, pointer?: string, details?: unknown) {
    super(code, message, { pointer, details });
    this.name = "DataResolutionError";
  }
}

/**
 * 数据解析：数据集行 → 生成器 → 模板 → 约束定点求值 → 冻结 ResolvedData。
 * 所有随机性由 seed 控制，唯一值通过账本原子预留。
 */
export class DataResolver {
  readonly dsl: FlowDsl;
  readonly deps: DataDeps;
  readonly seed: number;
  readonly faker: Faker;
  readonly provenance: Record<string, ProvenanceEntry> = {};
  readonly cache = new Map<string, unknown>();
  readonly seqCache = new Map<string, number>();
  readonly run: { id: string; shortId: string; startedAt: string };
  private systemId: string;
  private selectedValues?: Record<string, unknown>;

  constructor(dsl: FlowDsl, deps: DataDeps) {
    this.dsl = dsl;
    this.deps = deps;
    this.seed = deps.seed ?? randomInt(1, 2 ** 31 - 1);
    this.faker = new Faker({ locale: [zh_CN] });
    this.faker.seed(this.seed);
    this.run = { id: deps.runId, shortId: deps.shortId, startedAt: deps.startedAt };
    this.systemId = deps.systemId ?? dsl.systems[0]?.id ?? "_global";
  }

  async prepare(datasetId?: string): Promise<ResolvedData> {
    const dataset = datasetId
      ? (this.dsl.datasets ?? []).find((item) => item.id === datasetId)
      : (this.dsl.datasets ?? [])[0];
    if (datasetId && !dataset) {
      throw new DataResolutionError("DATASET_NOT_FOUND", `数据集不存在: ${datasetId}`, "/datasets");
    }

    const vars: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(this.dsl.vars ?? {})) {
      const resolved = await this.resolveValue(value, `/vars/${name}`, { vars });
      vars[name] = resolved;
      this.provenance[`vars.${name}`] = {
        source: valueSource(value),
        scope: generatorScope(value) ?? `vars.${name}`,
      };
    }

    const values: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(dataset?.columns ?? {})) {
      const resolved = await this.resolveValue(value, `/datasets/${dataset?.id ?? "inline"}/${column}`, {
        vars,
      });
      values[column] = resolved;
      this.provenance[column] = {
        source: valueSource(value),
        scope: generatorScope(value) ?? `dataset.${dataset?.id ?? "inline"}.${column}`,
      };
    }

    await this.applyConstraints(values, vars);
    this.selectedValues = values;

    return {
      datasetId: dataset?.id ?? null,
      datasetName: dataset?.name,
      values,
      vars,
      provenance: this.provenance,
      seed: this.seed,
      secretFields: this.dsl.secretFields ?? [],
    };
  }

  async resolveValue(
    input: ValueLike,
    pointer: string,
    extra: { vars?: Record<string, unknown>; nodeOutputs?: Record<string, unknown> } = {},
  ): Promise<unknown> {
    const expr = normalizeValue(input, pointer);
    if (this.cache.has(pointer)) return this.cache.get(pointer);

    let result: unknown;
    switch (expr.kind) {
      case "literal":
        result = expr.value;
        break;
      case "var": {
        const vars = extra.vars ?? {};
        if (!(expr.name in vars)) {
          throw new DataResolutionError(
            ERROR_CODES.dataUnresolved,
            `变量未定义或尚未求值: ${expr.name}`,
            pointer,
          );
        }
        result = vars[expr.name];
        break;
      }
      case "dataset": {
        const value = await this.datasetColumn(expr.column, pointer);
        result = value;
        break;
      }
      case "env": {
        const value = this.deps.env[expr.name];
        if (value === undefined) {
          throw new DataResolutionError(
            ERROR_CODES.dataUnresolved,
            `环境变量未设置: ${expr.name}`,
            pointer,
          );
        }
        result = value;
        break;
      }
      case "template":
        result = await this.render(expr.template, pointer, extra.vars ?? {});
        break;
      case "ref": {
        const outputs = extra.nodeOutputs ?? {};
        const nodeOutput = outputs[expr.nodeId] as Record<string, unknown> | undefined;
        if (!nodeOutput) {
          throw new DataResolutionError(
            ERROR_CODES.dataUnresolved,
            `节点输出不存在: ${expr.nodeId}`,
            pointer,
          );
        }
        result = nodeOutput[expr.output] ?? nodeOutput.value;
        break;
      }
      case "generator":
        result = await this.generate(expr, pointer);
        break;
    }
    this.cache.set(pointer, result);
    return result;
  }

  private async datasetColumn(column: string, pointer: string): Promise<unknown> {
    if (this.selectedValues && column in this.selectedValues) {
      return this.selectedValues[column];
    }
    const all = this.dsl.datasets ?? [];
    for (const dataset of all) {
      if (column in dataset.columns) {
        return this.resolveValue(dataset.columns[column] as ValueLike, `/datasets/${dataset.id}/${column}`);
      }
    }
    throw new DataResolutionError(
      ERROR_CODES.dataUnresolved,
      `数据集列不存在: ${column}`,
      pointer,
    );
  }

  private async render(
    template: string,
    pointer: string,
    vars: Record<string, unknown>,
  ): Promise<string> {
    const seq: Record<string, number> = {};
    for (const ref of listTemplateRefs(template)) {
      const [root, name] = ref.split(".");
      if (root === "seq" && name) {
        seq[name] = await this.getSequence(name);
      }
      if (root === "vars" && name && !(name in vars)) {
        throw new DataResolutionError(
          ERROR_CODES.dataUnresolved,
          `模板引用了未定义变量: ${name}`,
          pointer,
        );
      }
    }
    const sys: Record<string, string> = {};
    const sysRef = listTemplateRefs(template).find((ref) => ref.startsWith("sys."));
    if (sysRef) {
      const system = this.dsl.systems.find((item) => item.id === this.systemId) ?? this.dsl.systems[0];
      sys.baseUrl = system?.baseUrl ?? "";
    }
    return renderTemplate(template, {
      vars,
      run: this.run,
      seq,
      sys,
      env: this.deps.env,
    });
  }

  private async getSequence(scope: string): Promise<number> {
    const cached = this.seqCache.get(scope);
    if (cached !== undefined) return cached;
    const value = await this.deps.ledger.nextSequence(this.systemId, scope);
    this.seqCache.set(scope, value);
    return value;
  }

  private async nextSequenceFresh(scope: string): Promise<number> {
    const value = await this.deps.ledger.nextSequence(this.systemId, scope);
    this.seqCache.set(scope, value);
    return value;
  }

  private async generate(expr: Extract<ValueExpr, { kind: "generator" }>, pointer: string): Promise<unknown> {
    const scope = expr.scope ?? `node.${pointer.replace(/[^a-zA-Z0-9]+/g, ".")}`;
    if (expr.type === "sequence") {
      return this.getSequence(scope);
    }
    if (expr.type.startsWith("faker.")) {
      return this.generateFaker(expr.type);
    }

    const maxAttempts = 20;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let value: string;
      if (expr.type === "unique.text") {
        if (expr.template) {
          const seq: Record<string, number> = {};
          for (const ref of listTemplateRefs(expr.template)) {
            const [root, name] = ref.split(".");
            if (root === "seq" && name) seq[name] = await this.nextSequenceFresh(name);
          }
          value = renderTemplate(expr.template, {
            vars: {},
            run: this.run,
            seq,
            sys: {},
            env: this.deps.env,
          });
        } else {
          value = `自动值-${await this.nextSequenceFresh(scope)}-${this.run.shortId}`;
        }
      } else if (expr.type === "unique.email") {
        value = `ff-${sanitize(scope)}-${await this.nextSequenceFresh(scope)}-${this.run.shortId}@test.local`;
      } else if (expr.type === "unique.phone") {
        const seq = await this.nextSequenceFresh(scope);
        value = `138${String(seq % 100000000).padStart(8, "0")}`.slice(0, 11);
      } else if (expr.type === "unique.orderNo") {
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const seq = await this.nextSequenceFresh(scope);
        value = `${date}${String(seq).padStart(4, "0")}${this.run.shortId.slice(0, 2)}`;
      } else {
        throw new DataResolutionError(
          ERROR_CODES.dataUnresolved,
          `未知生成器: ${expr.type}`,
          pointer,
        );
      }

      const reserved = await this.deps.ledger.reserve(
        this.systemId,
        expr.scope ?? scope,
        value,
        this.deps.runId,
      );
      if (reserved) {
        this.provenance[pointer] = {
          source: expr.type,
          scope: expr.scope ?? scope,
          ledgerKey: `${this.systemId}|${expr.scope ?? scope}|${value}`,
          generator: expr.type,
        };
        return value;
      }
    }
    throw new DataResolutionError(
      "UNIQUE_EXHAUSTED",
      `唯一值预留失败，已尝试 ${maxAttempts} 次`,
      pointer,
    );
  }

  private generateFaker(type: string): string {
    switch (type) {
      case "faker.name":
        return this.faker.person.fullName();
      case "faker.email":
        return this.faker.internet.email();
      case "faker.phone":
        return this.faker.phone.number();
      case "faker.company":
        return this.faker.company.name();
      case "faker.idCard":
        return this.faker.string.numeric(18);
      default:
        throw new FlowForgeError(ERROR_CODES.dataUnresolved, `未知 faker 生成器: ${type}`);
    }
  }

  private async applyConstraints(
    values: Record<string, unknown>,
    vars: Record<string, unknown>,
  ): Promise<void> {
    const constraints = this.dsl.constraints ?? [];
    const derivation = constraints.filter(
      (c): c is Extract<Constraint, { type: "derive" | "equals" }> =>
        c.type === "derive" || c.type === "equals",
    );
    const unique = constraints.filter(
      (c): c is Extract<Constraint, { type: "unique" }> => c.type === "unique",
    );
    const validation = constraints.filter(
      (c): c is Extract<Constraint, { type: "range" | "regex" | "oneOf" }> =>
        c.type === "range" || c.type === "regex" || c.type === "oneOf",
    );

    let changed = true;
    let rounds = 0;
    while (changed) {
      rounds += 1;
      if (rounds > 10) {
        throw new DataResolutionError(ERROR_CODES.constraintCycle, "约束求值超过 10 轮仍未收敛");
      }
      changed = false;
      for (const constraint of derivation) {
        changed = this.applyDerivation(constraint, values, vars) || changed;
      }
    }

    for (const constraint of unique) {
      await this.applyUnique(constraint, values, vars);
    }

    for (const constraint of validation) {
      this.validateConstraint(constraint, values);
    }
  }

  private applyDerivation(
    constraint: Constraint,
    values: Record<string, unknown>,
    vars: Record<string, unknown>,
  ): boolean {
    if (constraint.type === "equals") {
      const hasLeft = constraint.left in values;
      const hasRight = constraint.right in values;
      if (!hasLeft && !hasRight) return false;
      if (hasLeft && !hasRight) {
        values[constraint.right] = values[constraint.left];
        return true;
      }
      if (!hasLeft && hasRight) {
        values[constraint.left] = values[constraint.right];
        return true;
      }
      if (String(values[constraint.left]) !== String(values[constraint.right])) {
        throw new DataResolutionError(
          ERROR_CODES.constraintFailed,
          `equals 约束失败: ${String(values[constraint.left])} != ${String(values[constraint.right])}`,
          "/constraints",
          { field: constraint.left },
        );
      }
      return false;
    }
    if (constraint.type === "derive") {
      const from = values[constraint.from] ?? vars[constraint.from];
      if (from === undefined) {
        throw new DataResolutionError(
          ERROR_CODES.constraintFailed,
          `derive 约束缺少来源字段: ${constraint.from}`,
          "/constraints",
          { field: constraint.from },
        );
      }
      const result = deriveValue(constraint.op, String(from), constraint.template);
      if (values[constraint.target] !== result) {
        values[constraint.target] = result;
        this.provenance[constraint.target] = { source: `derive.${constraint.op}` };
        return true;
      }
    }
    return false;
  }

  private async applyUnique(
    constraint: Extract<Constraint, { type: "unique" }>,
    values: Record<string, unknown>,
    vars: Record<string, unknown>,
  ): Promise<void> {
    let value = values[constraint.field] ?? vars[constraint.field];
    let generated = false;
    if (value === undefined) {
      if (!constraint.gen) {
        throw new DataResolutionError(
          ERROR_CODES.constraintFailed,
          `unique 约束字段缺少值且未指定生成器: ${constraint.field}`,
          "/constraints",
        );
      }
      const expr = normalizeGenerator(constraint.gen, "/constraints");
      value = await this.generate(
        expr as Extract<ValueExpr, { kind: "generator" }>,
        `/constraints/unique/${constraint.field}`,
      );
      generated = true;
    }
    const text = String(value);
    if (!generated) {
      const ok = await this.deps.ledger.reserve(
        this.systemId,
        `constraint.${constraint.field}`,
        text,
        this.deps.runId,
      );
      if (!ok) {
        throw new DataResolutionError(
          ERROR_CODES.constraintFailed,
          `unique 约束冲突: ${constraint.field} 的值 ${text} 已被占用`,
          "/constraints",
          { field: constraint.field, value: text },
        );
      }
      this.provenance[constraint.field] = {
        source: constraint.gen ?? "unique",
        ledgerKey: `${this.systemId}|constraint.${constraint.field}|${text}`,
      };
    }
    values[constraint.field] = value;
  }

  private validateConstraint(constraint: Constraint, values: Record<string, unknown>): void {
    const value = values[(constraint as { field: string }).field];
    if (value === undefined) {
      throw new DataResolutionError(
        ERROR_CODES.constraintFailed,
        `约束字段不存在: ${(constraint as { field: string }).field}`,
        "/constraints",
      );
    }
    if (constraint.type === "range") {
      const numeric = Number(value);
      if (Number.isNaN(numeric)) {
        throw new DataResolutionError(
          ERROR_CODES.constraintFailed,
          `range 约束需要数值: ${constraint.field}`,
          "/constraints",
        );
      }
      if (constraint.min !== undefined && numeric < Number(constraint.min)) {
        throw new DataResolutionError(
          ERROR_CODES.constraintFailed,
          `range 约束失败: ${constraint.field}=${numeric} < ${constraint.min}`,
          "/constraints",
          { field: constraint.field },
        );
      }
      if (constraint.max !== undefined && numeric > Number(constraint.max)) {
        throw new DataResolutionError(
          ERROR_CODES.constraintFailed,
          `range 约束失败: ${constraint.field}=${numeric} > ${constraint.max}`,
          "/constraints",
          { field: constraint.field },
        );
      }
    }
    if (constraint.type === "regex") {
      if (!new RegExp(constraint.pattern).test(String(value))) {
        throw new DataResolutionError(
          ERROR_CODES.constraintFailed,
          `regex 约束失败: ${constraint.field}=${String(value)}`,
          "/constraints",
          { field: constraint.field },
        );
      }
    }
    if (constraint.type === "oneOf") {
      if (!constraint.values.some((item) => String(item) === String(value))) {
        throw new DataResolutionError(
          ERROR_CODES.constraintFailed,
          `oneOf 约束失败: ${constraint.field}=${String(value)}`,
          "/constraints",
          { field: constraint.field, values: constraint.values },
        );
      }
    }
  }
}

export interface PreparedRunData {
  resolver: DataResolver;
  resolved: ResolvedData;
}

export async function prepareRunData(
  dsl: FlowDsl,
  datasetId: string | undefined,
  deps: DataDeps,
): Promise<PreparedRunData> {
  const resolver = new DataResolver(dsl, deps);
  const resolved = await resolver.prepare(datasetId);
  return { resolver, resolved };
}

function deriveValue(
  op: "localPart" | "domain" | "prefix" | "suffix" | "concat" | "hash",
  from: string,
  template?: string,
): string {
  switch (op) {
    case "localPart":
      return from.includes("@") ? from.split("@")[0] ?? from : from;
    case "domain":
      return from.includes("@") ? from.split("@")[1] ?? "" : "";
    case "prefix":
      return from.slice(0, template ? Number(template) || 6 : 6);
    case "suffix":
      return from.slice(-(template ? Number(template) || 6 : 6));
    case "concat":
      return template ? template.replaceAll("{value}", from) : from;
    case "hash":
      return createHash("sha256").update(from).digest("hex").slice(0, 8);
  }
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "value";
}

function valueSource(value: ValueLike): string {
  if (value && typeof value === "object" && "kind" in value && value.kind === "generator") {
    return value.type;
  }
  return "literal";
}

function generatorScope(value: ValueLike): string | undefined {
  if (value && typeof value === "object" && "kind" in value && value.kind === "generator") {
    return value.scope;
  }
  return undefined;
}

export type { ResolvedData };
