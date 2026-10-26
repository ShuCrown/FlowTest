import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FlowDsl, FlowNode } from "@flowforge/dsl";
import type { EngineSettings } from "@flowforge/engine";

export async function tempArtifactDir(prefix = "ff-artifacts-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function resetFixture(baseUrl: string): Promise<void> {
  await fetch(`${baseUrl}/api/reset`, { method: "POST" });
}

export function settingsFor(artifactDir: string): EngineSettings {
  return {
    artifactDir,
    headless: true,
    env: {},
    nodeTimeoutMs: 15000,
    pickerTimeoutMs: 30000,
    resourcePolicy: "balanced",
    screenshot: "onFailure",
    trace: false,
  };
}

export function flowFor(baseUrl: string, nodes: FlowNode[], edges: FlowDsl["edges"], extra: Partial<FlowDsl> = {}): FlowDsl {
  return {
    dslVersion: "1.0",
    meta: { name: "集成测试流程", tags: ["fixture"] },
    systems: [{ id: "fixture", name: "Fixture", baseUrl, auth: { kind: "none" } }],
    defaults: {
      nodeTimeoutMs: 15000,
      pickerTimeoutMs: 30000,
      screenshot: "onFailure",
      resourcePolicy: "balanced",
      trace: false,
    },
    nodes,
    edges,
    entry: nodes[0]!.id,
    ...extra,
  };
}

export function customerCreateFlow(baseUrl: string): FlowDsl {
  const nodes: FlowNode[] = [
    {
      id: "open",
      type: "navigate",
      name: "打开客户列表",
      system: "fixture",
      url: "/customers",
      readySignal: "page-ready",
    },
    {
      id: "wait-rows",
      type: "wait",
      name: "等待列表渲染",
      condition: {
        kind: "count",
        target: { label: "客户行", strategies: [{ type: "testid", value: "customer-row" }] },
        min: 1,
        timeoutMs: 5000,
      },
    },
    {
      id: "open-new",
      type: "interact",
      name: "打开新建弹窗",
      system: "fixture",
      adapter: "click",
      target: {
        label: "新建客户",
        strategies: [
          { type: "role", role: "button", name: "新建客户" },
          { type: "testid", value: "customer-new" },
        ],
      },
      expect: [
        {
          kind: "visible",
          target: { label: "客户名称", strategies: [{ type: "label", value: "客户名称" }] },
        },
      ],
    },
    {
      id: "fill-name",
      type: "interact",
      name: "填写唯一客户名",
      system: "fixture",
      adapter: "input",
      target: { label: "客户名称", strategies: [{ type: "label", value: "客户名称" }] },
      value: { kind: "var", name: "customerName" },
      verify: "readBack",
    },
    {
      id: "fill-amount",
      type: "interact",
      name: "填写金额",
      system: "fixture",
      adapter: "input",
      target: { label: "金额", strategies: [{ type: "label", value: "金额" }] },
      value: { kind: "dataset", column: "amount" },
      verify: "readBack",
    },
    {
      id: "pick-region",
      type: "picker",
      name: "选择所属区域",
      system: "fixture",
      mode: "dialog",
      trigger: {
        label: "选择区域",
        strategies: [{ type: "role", role: "button", name: "选择区域" }],
      },
      panel: {
        scope: {
          type: "dialog",
          name: "选择区域",
          target: { label: "区域选择弹窗", strategies: [{ type: "role", role: "dialog", name: "选择区域" }] },
        },
        readySignal: "content-stable",
        optionResponse: { urlContains: "/api/regions", method: "GET", status: 200 },
      },
      filter: {
        steps: [
          {
            adapter: "input",
            target: { label: "搜索区域", strategies: [{ type: "placeholder", value: "搜索区域" }] },
            value: { kind: "dataset", column: "regionSearch" },
          },
        ],
      },
      pick: {
        strategy: "byText",
        byText: { column: "regions", match: "exact" },
        multi: true,
      },
      commit: {
        adapter: "click",
        target: { label: "确定", strategies: [{ type: "role", role: "button", name: "确定" }] },
      },
      expect: [
        {
          kind: "text",
          target: { label: "已选区域", strategies: [{ type: "testid", value: "region-value" }] },
          contains: "华东区",
        },
        {
          kind: "text",
          target: { label: "已选区域", strategies: [{ type: "testid", value: "region-value" }] },
          contains: "华南区",
        },
      ],
    },
    {
      id: "check-approval",
      type: "interact",
      name: "标记需要审批",
      system: "fixture",
      adapter: "check",
      target: { label: "需要审批", strategies: [{ type: "label", value: "需要审批" }] },
      checked: true,
    },
    {
      id: "save",
      type: "interact",
      name: "保存客户",
      system: "fixture",
      adapter: "click",
      target: { label: "保存", strategies: [{ type: "role", role: "button", name: "保存" }] },
      expect: [
        { kind: "response", urlContains: "/api/customers", method: "POST", status: 200 },
        {
          kind: "text",
          target: { label: "保存提示", strategies: [{ type: "role", role: "status" }] },
          contains: "保存成功",
        },
      ],
    },
  ];

  const edges = nodes.slice(0, -1).map((node, index) => ({
    from: node.id,
    to: nodes[index + 1]!.id,
  }));

  return flowFor(baseUrl, nodes, edges, {
    vars: {
      customerName: {
        kind: "generator",
        type: "unique.text",
        scope: "fixture.customer.name",
        template: "自动客户-{{seq.customer}}-{{run.shortId}}",
        unique: true,
      },
    },
    datasets: [
      {
        id: "normal",
        name: "普通",
        columns: { amount: 100, regionSearch: "华", regions: ["华东区", "华南区"] },
      },
      {
        id: "large",
        name: "大额",
        columns: { amount: 5000, regionSearch: "华", regions: ["华东区", "华南区"] },
      },
    ],
    constraints: [{ type: "range", field: "amount", min: 0, max: 100000 }],
  });
}

export function filterFlow(baseUrl: string): FlowDsl {
  const nodes: FlowNode[] = [
    {
      id: "open",
      type: "navigate",
      system: "fixture",
      url: "/customers",
      readySignal: "page-ready",
    },
    {
      id: "wait-rows",
      type: "wait",
      condition: {
        kind: "count",
        target: { strategies: [{ type: "testid", value: "customer-row" }] },
        min: 1,
        timeoutMs: 5000,
      },
    },
    {
      id: "open-filter",
      type: "interact",
      system: "fixture",
      adapter: "click",
      target: { label: "筛选", strategies: [{ type: "role", role: "button", name: "筛选" }] },
      expect: [
        {
          kind: "visible",
          target: { strategies: [{ type: "role", role: "dialog", name: "筛选条件" }] },
        },
      ],
    },
    {
      id: "filter-region",
      type: "interact",
      system: "fixture",
      adapter: "select",
      target: { label: "区域", strategies: [{ type: "label", value: "区域" }] },
      value: { kind: "dataset", column: "region" },
    },
    {
      id: "filter-min",
      type: "interact",
      system: "fixture",
      adapter: "input",
      target: { label: "金额下限", strategies: [{ type: "label", value: "金额下限" }] },
      value: { kind: "dataset", column: "minAmount" },
      verify: "readBack",
    },
    {
      id: "filter-status",
      type: "interact",
      system: "fixture",
      adapter: "select",
      target: { label: "状态", strategies: [{ type: "label", value: "状态" }] },
      value: { kind: "dataset", column: "status" },
    },
    {
      id: "query",
      type: "interact",
      system: "fixture",
      adapter: "click",
      target: { label: "查询", strategies: [{ type: "role", role: "button", name: "查询" }] },
      expect: [
        { kind: "response", urlContains: "/api/customers", method: "GET", status: 200 },
        {
          kind: "count",
          target: { strategies: [{ type: "testid", value: "customer-row" }] },
          equals: 1,
          timeoutMs: 5000,
        },
      ],
    },
    {
      id: "assert-customer",
      type: "assert",
      condition: {
        kind: "text",
        target: { strategies: [{ type: "testid", value: "customer-row" }] },
        contains: "华东示例客户",
      },
    },
  ];
  const edges = nodes.slice(0, -1).map((node, index) => ({
    from: node.id,
    to: nodes[index + 1]!.id,
  }));
  return flowFor(baseUrl, nodes, edges, {
    datasets: [
      {
        id: "east",
        name: "华东启用大额",
        columns: { region: "华东区", minAmount: 1000, status: "启用" },
      },
    ],
  });
}

export function branchFlow(baseUrl: string): FlowDsl {
  const nodes: FlowNode[] = [
    {
      id: "open",
      type: "navigate",
      system: "fixture",
      url: "/branch",
      readySignal: "page-ready",
    },
    {
      id: "fill-amount",
      type: "interact",
      system: "fixture",
      adapter: "input",
      target: { label: "金额", strategies: [{ type: "label", value: "金额" }] },
      value: { kind: "dataset", column: "amount" },
      verify: "readBack",
    },
    {
      id: "branch-amount",
      type: "branch",
      condition: { op: "gt", left: { column: "amount" }, right: { value: 1000 } },
    },
    {
      id: "submit-then",
      type: "interact",
      system: "fixture",
      adapter: "click",
      target: { label: "提交", strategies: [{ type: "role", role: "button", name: "提交" }] },
    },
    {
      id: "submit-else",
      type: "interact",
      system: "fixture",
      adapter: "click",
      target: { label: "提交", strategies: [{ type: "role", role: "button", name: "提交" }] },
    },
    {
      id: "assert-then",
      type: "assert",
      condition: {
        kind: "text",
        target: { strategies: [{ type: "testid", value: "branch-result" }] },
        contains: "大额",
      },
    },
    {
      id: "assert-else",
      type: "assert",
      condition: {
        kind: "text",
        target: { strategies: [{ type: "testid", value: "branch-result" }] },
        contains: "普通",
      },
    },
    {
      id: "api-health",
      type: "api",
      system: "fixture",
      method: "GET",
      url: "/api/health",
      expectStatus: 200,
      extract: { value: "$.ok" },
    },
    {
      id: "fill-note",
      type: "interact",
      system: "fixture",
      adapter: "input",
      target: { label: "备注", strategies: [{ type: "label", value: "备注" }] },
      value: { kind: "ref", nodeId: "api-health", output: "value" },
      verify: "readBack",
    },
    {
      id: "assert-note",
      type: "assert",
      condition: {
        kind: "value",
        target: { strategies: [{ type: "label", value: "备注" }] },
        equals: { kind: "ref", nodeId: "api-health", output: "value" },
      },
    },
  ];
  return flowFor(
    baseUrl,
    nodes,
    [
      { from: "open", to: "fill-amount" },
      { from: "fill-amount", to: "branch-amount" },
      { from: "branch-amount", to: "submit-then", when: "then" },
      { from: "branch-amount", to: "submit-else", when: "else" },
      { from: "submit-then", to: "assert-then" },
      { from: "submit-else", to: "assert-else" },
      { from: "assert-then", to: "api-health" },
      { from: "assert-else", to: "api-health" },
      { from: "api-health", to: "fill-note" },
      { from: "fill-note", to: "assert-note" },
    ],
    {
      datasets: [
        { id: "normal", name: "普通", columns: { amount: 100 } },
        { id: "large", name: "大额", columns: { amount: 5000 } },
      ],
    },
  );
}

export function variantFlow(baseUrl: string): FlowDsl {
  const nodes: FlowNode[] = [
    {
      id: "open",
      type: "navigate",
      system: "fixture",
      url: "/variant",
      readySignal: "page-ready",
    },
    {
      id: "fill-name",
      type: "interact",
      system: "fixture",
      adapter: "input",
      target: {
        label: "客户名称",
        strategies: [
          { type: "label", value: "客户名称" },
          { type: "label", value: "客户全称" },
        ],
      },
      value: { kind: "dataset", column: "name" },
      verify: "readBack",
    },
  ];
  return flowFor(baseUrl, nodes, [{ from: "open", to: "fill-name" }], {
    datasets: [{ id: "only", name: "仅此一行", columns: { name: "变体客户" } }],
  });
}

export function missingTargetFlow(baseUrl: string): FlowDsl {
  const nodes: FlowNode[] = [
    {
      id: "open",
      type: "navigate",
      system: "fixture",
      url: "/customers",
      readySignal: "page-ready",
    },
    {
      id: "click-missing",
      type: "interact",
      system: "fixture",
      adapter: "click",
      target: {
        label: "不存在的按钮",
        strategies: [{ type: "role", role: "button", name: "不存在的按钮" }],
      },
    },
  ];
  return flowFor(baseUrl, nodes, [{ from: "open", to: "click-missing" }], {
    datasets: [{ id: "only", name: "仅此一行", columns: {} }],
  });
}

export function longPollingFlow(baseUrl: string): FlowDsl {
  const nodes: FlowNode[] = [
    {
      id: "open-live",
      type: "navigate",
      system: "fixture",
      url: "/live",
      readySignal: { kind: "domStable", quietMs: 600, maxMs: 8000 },
    },
    {
      id: "assert-live",
      type: "assert",
      condition: {
        kind: "text",
        target: { strategies: [{ type: "testid", value: "live-title" }] },
        contains: "SSE",
      },
    },
  ];
  return flowFor(baseUrl, nodes, [{ from: "open-live", to: "assert-live" }], {
    datasets: [{ id: "only", name: "仅此一行", columns: {} }],
  });
}
