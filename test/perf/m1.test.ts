import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { runFlow, sharedBrowserPool } from "@flowforge/engine";
import type { FlowDsl, FlowNode } from "@flowforge/dsl";
import { startFixtureServer, type FixtureServerHandle } from "../../fixtures/server.mjs";
import { MemoryLedger } from "../helpers/ledger.js";
import {
  customerCreateFlow,
  flowFor,
  resetFixture,
  settingsFor,
  tempArtifactDir,
} from "../helpers/flows.js";

let fixture: FixtureServerHandle;

before(async () => {
  fixture = await startFixtureServer();
});

after(async () => {
  await sharedBrowserPool.close();
  await fixture.close();
});

test("同一进程连续 10 次运行唯一字段零冲突、浏览器复用", async () => {
  await resetFixture(fixture.baseUrl);
  const ledger = new MemoryLedger();
  const dsl = customerCreateFlow(fixture.baseUrl);
  const names: string[] = [];
  let firstColdStart: boolean | undefined;
  let secondColdStart: boolean | undefined;
  for (let index = 0; index < 10; index += 1) {
    const started = Date.now();
    const result = await runFlow({
      runId: `perf_unique_${index}`,
      dsl,
      mode: "single",
      datasetId: "normal",
      settings: settingsFor(await tempArtifactDir()),
      ledger,
    });
    assert.equal(result.status, "finished", JSON.stringify(result.error));
    assert.ok(Date.now() - started < 25000, `第 ${index + 1} 次运行超过 25s`);
    const name = String(result.resolvedData.vars.customerName);
    assert.equal(names.includes(name), false, `唯一值重复: ${name}`);
    names.push(name);
    if (index === 0) firstColdStart = result.metrics.browserColdStart;
    if (index === 1) secondColdStart = result.metrics.browserColdStart;
  }
  assert.equal(firstColdStart, true);
  assert.equal(secondColdStart, false);
  assert.equal(ledger.sequence("fixture", "customer"), 10);
  for (const name of names) {
    assert.equal(ledger.has("fixture", "fixture.customer.name", name), true);
  }
});

test("8 节点 / 3 次导航夹具预算 ≤ 25s", async () => {
  const ledger = new MemoryLedger();
  const nodes: FlowNode[] = [
    { id: "n1", type: "navigate", system: "fixture", url: "/customers", readySignal: "page-ready" },
    {
      id: "w1",
      type: "wait",
      condition: {
        kind: "count",
        target: { strategies: [{ type: "testid", value: "customer-row" }] },
        min: 1,
        timeoutMs: 5000,
      },
    },
    { id: "n2", type: "navigate", system: "fixture", url: "/branch", readySignal: "page-ready" },
    {
      id: "f1",
      type: "interact",
      system: "fixture",
      adapter: "input",
      target: { strategies: [{ type: "label", value: "金额" }] },
      value: { kind: "dataset", column: "amount" },
      verify: "readBack",
    },
    {
      id: "c1",
      type: "interact",
      system: "fixture",
      adapter: "click",
      target: { strategies: [{ type: "role", role: "button", name: "提交" }] },
    },
    {
      id: "a1",
      type: "assert",
      condition: {
        kind: "text",
        target: { strategies: [{ type: "testid", value: "branch-result" }] },
        contains: "大额",
      },
    },
    { id: "n3", type: "navigate", system: "fixture", url: "/variant", readySignal: "page-ready" },
    {
      id: "f2",
      type: "interact",
      system: "fixture",
      adapter: "input",
      target: { strategies: [{ type: "label", value: "客户全称" }] },
      value: { kind: "dataset", column: "name" },
      verify: "readBack",
    },
  ];
  const edges = nodes.slice(0, -1).map((node, index) => ({
    from: node.id,
    to: nodes[index + 1]!.id,
  }));
  const dsl: FlowDsl = flowFor(fixture.baseUrl, nodes, edges, {
    datasets: [{ id: "only", name: "仅此一行", columns: { amount: 5000, name: "预算客户" } }],
  });
  const started = Date.now();
  const result = await runFlow({
    runId: "perf_8_nodes",
    dsl,
    mode: "single",
    datasetId: "only",
    settings: { ...settingsFor(await tempArtifactDir()), resourcePolicy: "fast" },
    ledger,
  });
  const elapsed = Date.now() - started;
  assert.equal(result.status, "finished", JSON.stringify(result.error));
  assert.ok(elapsed <= 25000, `8 节点 / 3 导航耗时 ${elapsed}ms`);
  assert.equal(result.nodes.filter((node) => node.nodeType === "navigate").length, 3);
});

test("资源策略拦截埋点且不破坏页面", async () => {
  const ledger = new MemoryLedger();
  const nodes: FlowNode[] = [
    { id: "open", type: "navigate", system: "fixture", url: "/heavy", readySignal: "page-ready" },
    {
      id: "assert",
      type: "assert",
      condition: {
        kind: "text",
        target: { strategies: [{ type: "testid", value: "heavy-title" }] },
        contains: "重资源页",
      },
    },
  ];
  const dsl = flowFor(fixture.baseUrl, nodes, [{ from: "open", to: "assert" }], {
    datasets: [{ id: "only", name: "仅此一行", columns: {} }],
  });
  const result = await runFlow({
    runId: "perf_resource",
    dsl,
    mode: "single",
    datasetId: "only",
    settings: { ...settingsFor(await tempArtifactDir()), resourcePolicy: "fast" },
    ledger,
  });
  assert.equal(result.status, "finished", JSON.stringify(result.error));
  assert.ok(result.metrics.blockedRequests >= 1, "应拦截 analytics 脚本");
});
