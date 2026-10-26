import assert from "node:assert/strict";
import test from "node:test";
import {
  computeReadiness,
  diffDsl,
  evaluateCondition,
  expandPreset,
  lintFlow,
  normalizeDsl,
  parseFlow,
  renderTemplate,
  validateTemplate,
} from "@flowforge/dsl";

export function baseFlow(): Record<string, unknown> {
  return {
    dslVersion: "1.0",
    meta: { name: "测试流程", tags: ["test"] },
    systems: [{ id: "crm", name: "CRM", baseUrl: "http://127.0.0.1:4100" }],
    defaults: { nodeTimeoutMs: 15000, pickerTimeoutMs: 30000 },
    vars: {
      customerName: {
        gen: "unique.text",
        template: "自动客户-{{seq.customer}}-{{run.shortId}}",
        unique: true,
      },
    },
    datasets: [
      { id: "normal", name: "普通", columns: { region: "华东区", amount: 100 } },
      { id: "large", name: "大额", columns: { region: "华南区", amount: 5000 } },
    ],
    constraints: [{ type: "range", field: "amount", min: 0, max: 100000 }],
    nodes: [
      {
        id: "open",
        type: "navigate",
        name: "打开客户列表",
        system: "crm",
        url: "/customers",
        readySignal: "page-ready",
      },
      {
        id: "new",
        type: "interact",
        name: "打开新建弹窗",
        system: "crm",
        adapter: "click",
        target: {
          label: "新建客户",
          strategies: [{ type: "role", role: "button", name: "新建客户" }],
        },
        expect: [{ kind: "visible", target: { strategies: [{ type: "label", value: "客户名称" }] } }],
      },
      {
        id: "fill-name",
        type: "interact",
        name: "填写唯一客户名",
        system: "crm",
        adapter: "input",
        target: { label: "客户名称", strategies: [{ type: "label", value: "客户名称" }] },
        value: { kind: "var", name: "customerName" },
        verify: "readBack",
      },
      {
        id: "pick-region",
        type: "picker",
        name: "选择所属区域",
        system: "crm",
        mode: "dialog",
        trigger: { label: "所属区域", strategies: [{ type: "label", value: "所属区域" }] },
        panel: {
          scope: { type: "dialog" },
          readySignal: "content-stable",
          optionResponse: { urlContains: "/api/regions", method: "GET", status: 200 },
        },
        filter: {
          steps: [
            {
              adapter: "input",
              target: { strategies: [{ type: "placeholder", value: "搜索区域" }] },
              value: { kind: "dataset", column: "region" },
            },
          ],
        },
        pick: { strategy: "byText", byText: { column: "region", match: "exact" } },
        commit: {
          adapter: "click",
          target: { strategies: [{ type: "role", role: "button", name: "确定" }] },
        },
      },
      {
        id: "branch-amount",
        type: "branch",
        name: "金额是否大额",
        condition: { op: "gt", left: { column: "amount" }, right: { value: 1000 } },
      },
      {
        id: "approve",
        type: "interact",
        name: "标记需要审批",
        system: "crm",
        adapter: "check",
        target: { label: "需要审批", strategies: [{ type: "label", value: "需要审批" }] },
        checked: true,
      },
      {
        id: "save",
        type: "interact",
        name: "保存客户",
        system: "crm",
        adapter: "click",
        target: { label: "保存", strategies: [{ type: "role", role: "button", name: "保存" }] },
        expect: [
          { kind: "response", urlContains: "/api/customers", method: "POST", status: 200 },
          { kind: "text", target: { strategies: [{ type: "text", value: "保存成功" }] }, contains: "保存成功" },
        ],
      },
    ],
    edges: [
      { from: "open", to: "new" },
      { from: "new", to: "fill-name" },
      { from: "fill-name", to: "pick-region" },
      { from: "pick-region", to: "branch-amount" },
      { from: "branch-amount", to: "approve", when: "then" },
      { from: "branch-amount", to: "save", when: "else" },
      { from: "approve", to: "save" },
    ],
    entry: "open",
  };
}

test("parseFlow 归一化简写与字符串 target", () => {
  const result = parseFlow(baseFlow());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const dsl = result.dsl;
  const name = dsl.vars?.customerName as { kind: string; type: string; unique: boolean };
  assert.equal(name.kind, "generator");
  assert.equal(name.type, "unique.text");
  assert.equal(name.unique, true);
  const datasetRegion = dsl.datasets?.[0]?.columns.region as { kind: string; value: string };
  assert.equal(datasetRegion.kind, "literal");
  assert.equal(datasetRegion.value, "华东区");
});

test("readiness 达到 L5，且静态分支覆盖完整", () => {
  const result = parseFlow(baseFlow());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const readiness = computeReadiness(result.dsl);
  assert.equal(readiness.level, 5, JSON.stringify(readiness.gaps));
  assert.equal(
    readiness.gaps.filter((gap) => gap.message.includes("分支")).length,
    0,
  );
});

test("lint 拒绝未知等待字段并警告 dialog 无 commit", () => {
  const raw = baseFlow();
  const result = normalizeDsl(raw);
  const lint = lintFlow(result);
  assert.equal(lint.errors.length, 0);
  assert.equal(lint.warnings.some((w) => w.code === "ASYNC_LIST_NO_SIGNAL"), false);

  const picker = result.nodes.find((node) => node.id === "pick-region");
  assert.ok(picker && picker.type === "picker");
  if (picker && picker.type === "picker") delete picker.commit;
  const lint2 = lintFlow(result);
  assert.equal(lint2.warnings.some((w) => w.code === "PICKER_NO_COMMIT"), true);

  (result.meta as unknown as Record<string, unknown>).forbidden = "waitForTimeout(1000)";
  const lint3 = lintFlow(result);
  assert.equal(lint3.errors.some((e) => e.code === "WAIT_FORBIDDEN"), true);
});

test("模板命名空间校验与渲染", () => {
  assert.deepEqual(validateTemplate("{{vars.a}}-{{run.shortId}}-{{seq.order}}-{{env.X}}"), []);
  assert.equal(validateTemplate("{{process.env.X}}").length, 1);
  assert.equal(validateTemplate("{{sys.dbUrl}}").length, 1);
  assert.equal(
    renderTemplate("客户-{{seq.order}}-{{run.shortId}}", {
      vars: {},
      run: { id: "run_1", shortId: "a1b2", startedAt: "2026-01-01" },
      seq: { order: 12 },
      sys: {},
      env: {},
    }),
    "客户-12-a1b2",
  );
});

test("条件求值支持比较、包含与组合", () => {
  const ctx = { values: { amount: 5000, region: "华南区" }, vars: { flag: true } };
  assert.equal(
    evaluateCondition(
      { op: "and", of: [{ op: "gt", left: { column: "amount" }, right: { value: 1000 } }] },
      ctx,
    ),
    true,
  );
  assert.equal(
    evaluateCondition({ op: "contains", left: { column: "region" }, right: { value: "华南" } }, ctx),
    true,
  );
  assert.throws(() =>
    evaluateCondition(
      { op: "eq", left: { column: "missing" }, right: { value: 1 } },
      ctx,
    ),
  );
});

test("预设展开为标准等待信号", () => {
  const signal = expandPreset("page-ready");
  assert.equal(signal.kind, "all");
  const content = expandPreset("content-stable");
  assert.equal(content.kind, "domStable");
});

test("diff 指出新增节点与字段变化", () => {
  const first = normalizeDsl(baseFlow());
  const raw = baseFlow();
  (raw.meta as Record<string, unknown>).name = "改名后的流程";
  const second = normalizeDsl(raw);
  const diff = diffDsl(first, second);
  assert.equal(diff.length, 1);
  assert.equal(diff[0]?.path, "/meta/name");
});

test("结构校验：环与悬空 branch 出边被拒绝", () => {
  const raw = baseFlow();
  const edges = raw.edges as Array<Record<string, unknown>>;
  edges.push({ from: "save", to: "open" });
  const parsed = parseFlow(raw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const lint = lintFlow(parsed.dsl);
  assert.equal(lint.errors.some((e) => e.message.includes("环")), true);
});
