import type { FlowDsl, FlowNode, TargetRef, ValueExpr } from "./schema.js";
import { validateTemplate } from "./templates.js";
import { collectStructuralErrors, evaluateStaticBranch } from "./readiness.js";

export type LintLevel = "error" | "warning" | "info";

export interface LintIssue {
  code: string;
  level: LintLevel;
  path: string;
  nodeId?: string;
  message: string;
}

export interface LintResult {
  errors: LintIssue[];
  warnings: LintIssue[];
  infos: LintIssue[];
}

const SUBMIT_LABEL = /保存|提交|确认|删除|发布|submit|save|delete/i;

export function lintFlow(dsl: FlowDsl): LintResult {
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];
  const infos: LintIssue[] = [];

  for (const issue of collectStructuralErrors(dsl)) {
    errors.push({
      code: "STRUCTURE",
      level: "error",
      path: issue.path,
      nodeId: issue.nodeId,
      message: issue.message,
    });
  }

  dsl.nodes.forEach((node, index) => {
    const base = `/nodes/${index}`;
    lintTargets(node, base, errors, warnings);
    lintNode(node, base, dsl, errors, warnings, infos);
  });

  for (const item of walkStrings(dsl)) {
    if (/networkidle|waitForTimeout|waitForLoadState\s*\(\s*["']networkidle/.test(item.value)) {
      errors.push({
        code: "WAIT_FORBIDDEN",
        level: "error",
        path: item.path,
        message: "禁止使用 networkidle / waitForTimeout，请改为显式等待信号",
      });
    }
    if (item.value.includes("{{")) {
      for (const error of validateTemplate(item.value)) {
        errors.push({
          code: "TEMPLATE_INVALID",
          level: "error",
          path: item.path,
          message: error,
        });
      }
    }
  }

  if ((dsl.datasets ?? []).length > 500) {
    errors.push({
      code: "DATASET_TOO_LARGE",
      level: "error",
      path: "/datasets",
      message: "数据集行数超过 500 上限",
    });
  }

  for (const node of dsl.nodes) {
    if (node.type !== "branch") continue;
    const outcome = evaluateStaticBranch(dsl, node);
    if (outcome === "unknown") continue;
    const index = dsl.nodes.indexOf(node);
    if (outcome.coveredThen === 0) {
      warnings.push({
        code: "BRANCH_UNCOVERED",
        level: "warning",
        path: `/nodes/${index}/condition`,
        nodeId: node.id,
        message: "没有数据集覆盖 then 分支",
      });
    }
    if (outcome.coveredElse === 0) {
      warnings.push({
        code: "BRANCH_UNCOVERED",
        level: "warning",
        path: `/nodes/${index}/condition`,
        nodeId: node.id,
        message: "没有数据集覆盖 else 分支",
      });
    }
  }

  return { errors, warnings, infos };
}

function lintTargets(
  node: FlowNode,
  base: string,
  errors: LintIssue[],
  warnings: LintIssue[],
): void {
  const targets: Array<{ path: string; target: TargetRef }> = [];
  const add = (path: string, target: TargetRef | undefined): void => {
    if (!target) return;
    targets.push({ path, target });
    if (target.scope) add(`${path}/scope`, target.scope);
  };
  const addSignalTargets = (path: string, ref: unknown): void => {
    if (!ref || typeof ref !== "object") return;
    const signal = ref as { kind?: string; target?: TargetRef; of?: unknown[] };
    if (signal.kind === "all" || signal.kind === "any") {
      (signal.of ?? []).forEach((child, i) => addSignalTargets(`${path}/of/${i}`, child));
      return;
    }
    if (signal.kind === "url" || signal.kind === "response") return;
    add(`${path}/target`, signal.target);
  };

  node.pre?.forEach((signal, i) => addSignalTargets(`${base}/pre/${i}`, signal));
  node.expect?.forEach((signal, i) => addSignalTargets(`${base}/expect/${i}`, signal));

  switch (node.type) {
    case "navigate":
      addSignalTargets(`${base}/readySignal`, node.readySignal);
      break;
    case "interact":
      add(`${base}/target`, node.target);
      break;
    case "picker":
      add(`${base}/trigger`, node.trigger);
      add(`${base}/panel/scope/target`, node.panel.scope.target);
      node.filter?.steps.forEach((step, i) => add(`${base}/filter/steps/${i}/target`, step.target));
      add(`${base}/pick/byRow/rowTarget`, node.pick.byRow?.rowTarget);
      add(`${base}/pick/byRow/clickTarget`, node.pick.byRow?.clickTarget);
      Object.entries(node.pick.byCondition?.columns ?? {}).forEach(([key, target]) =>
        add(`${base}/pick/byCondition/columns/${key}`, target),
      );
      add(`${base}/commit/target`, node.commit?.target);
      addSignalTargets(`${base}/panel/readySignal`, node.panel.readySignal);
      break;
    case "wait":
    case "assert":
      addSignalTargets(`${base}/condition`, node.condition);
      break;
    case "branch":
    case "api":
      break;
  }

  for (const { path, target } of targets) {
    if (target.strategies.length === 0) {
      errors.push({
        code: "TARGET_NO_STRATEGY",
        level: "error",
        path: `${path}/strategies`,
        nodeId: node.id,
        message: "target 至少需要 1 条定位策略",
      });
    }
    if (target.strategies.every((s) => s.type === "css" || s.type === "xpath")) {
      warnings.push({
        code: "TARGET_CSS_ONLY",
        level: "warning",
        path: `${path}/strategies`,
        nodeId: node.id,
        message: "目标只有 CSS/XPath 策略，建议补充语义定位",
      });
    }
    if (target.strict === false) {
      warnings.push({
        code: "TARGET_NOT_STRICT",
        level: "warning",
        path: `${path}/strict`,
        nodeId: node.id,
        message: "strict: false 只建议用于探测模式",
      });
    }
  }
}

function lintNode(
  node: FlowNode,
  base: string,
  dsl: FlowDsl,
  errors: LintIssue[],
  warnings: LintIssue[],
  infos: LintIssue[],
): void {
  if (node.type === "picker") {
    if (node.mode === "dialog" && !node.commit) {
      warnings.push({
        code: "PICKER_NO_COMMIT",
        level: "warning",
        path: `${base}/commit`,
        nodeId: node.id,
        message: "dialog picker 未配置 commit，保存按钮不会被点击",
      });
    }
    if (node.filter && !node.panel.optionResponse) {
      warnings.push({
        code: "ASYNC_LIST_NO_SIGNAL",
        level: "warning",
        path: `${base}/panel/optionResponse`,
        nodeId: node.id,
        message: "异步筛选列表未配置业务 response 信号，建议补充 optionResponse",
      });
    }
    if (node.pick.strategy === "byCondition" && !node.pick.byCondition) {
      errors.push({
        code: "PICKER_BYCONDITION_INCOMPLETE",
        level: "error",
        path: `${base}/pick/byCondition`,
        nodeId: node.id,
        message: "byCondition 选择缺少条件配置",
      });
    }
    if (node.pick.strategy === "byText" && !node.pick.byText) {
      errors.push({
        code: "PICKER_BYTEXT_INCOMPLETE",
        level: "error",
        path: `${base}/pick/byText`,
        nodeId: node.id,
        message: "byText 选择缺少配置",
      });
    }
    if (node.pick.strategy === "byRow" && !node.pick.byRow) {
      errors.push({
        code: "PICKER_BYROW_INCOMPLETE",
        level: "error",
        path: `${base}/pick/byRow`,
        nodeId: node.id,
        message: "byRow 选择缺少配置",
      });
    }
  }

  if (node.type === "interact" && node.adapter === "click") {
    const label = node.target.label ?? node.name ?? "";
    if (SUBMIT_LABEL.test(label) && (!node.expect || node.expect.length === 0)) {
      warnings.push({
        code: "SUBMIT_NO_EXPECT",
        level: "warning",
        path: `${base}/expect`,
        nodeId: node.id,
        message: "提交类点击未声明 expect 信号",
      });
    }
  }

  if (node.type === "api") {
    if (/^https?:\/\//.test(node.url)) {
      try {
        const url = new URL(node.url);
        const system = dsl.systems.find((s) => s.id === node.system);
        const allowed = new Set([
          ...(system?.allowedOrigins ?? []),
          ...(system ? [new URL(system.baseUrl).origin] : []),
        ]);
        if (!allowed.has(url.origin)) {
          errors.push({
            code: "API_CROSS_ORIGIN",
            level: "error",
            path: `${base}/url`,
            nodeId: node.id,
            message: `api 跨域未授权: ${url.origin}`,
          });
        }
      } catch {
        // 模板 URL 无法静态判定，运行期校验
      }
    }
  }

  if (node.type === "navigate" && typeof node.readySignal === "string") {
    infos.push({
      code: "PRESET_USED",
      level: "info",
      path: `${base}/readySignal`,
      nodeId: node.id,
      message: `使用内置等待预设 ${node.readySignal}`,
    });
  }

  if (node.timeoutMs && node.timeoutMs > 10000) {
    infos.push({
      code: "NODE_SLOW",
      level: "info",
      path: `${base}/timeoutMs`,
      nodeId: node.id,
      message: "节点预算超过 10s",
    });
  }

  const values: Array<{ path: string; value: unknown }> = [];
  if (node.type === "interact") values.push({ path: `${base}/value`, value: node.value });
  if (node.type === "picker") {
    node.filter?.steps.forEach((step, i) =>
      values.push({ path: `${base}/filter/steps/${i}/value`, value: step.value }),
    );
    values.push({ path: `${base}/pick/byText/value`, value: node.pick.byText?.value });
    values.push({ path: `${base}/pick/byRow/keyValue`, value: node.pick.byRow?.keyValue });
  }
  for (const { path, value } of values) {
    if (!value || typeof value !== "object") continue;
    const expr = value as ValueExpr;
    if (expr.kind === "generator" && !expr.unique && expr.type !== "sequence") {
      infos.push({
        code: "GENERATOR_NOT_UNIQUE",
        level: "info",
        path,
        nodeId: node.id,
        message: "生成器值未声明 unique",
      });
    }
  }
}

export function walkStrings(value: unknown, basePath = ""): Array<{ path: string; value: string }> {
  const result: Array<{ path: string; value: string }> = [];
  const walk = (node: unknown, path: string): void => {
    if (typeof node === "string") {
      result.push({ path, value: node });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${path}/${index}`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        walk(child, `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`);
      }
    }
  };
  walk(value, basePath);
  return result;
}

export function hasErrors(result: LintResult): boolean {
  return result.errors.length > 0;
}
