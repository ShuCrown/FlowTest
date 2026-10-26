import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { runFlow, sharedBrowserPool, type RunEvent } from "@flowforge/engine";
import { startFixtureServer, type FixtureServerHandle } from "../../fixtures/server.mjs";
import { MemoryLedger } from "../helpers/ledger.js";
import {
  branchFlow,
  customerCreateFlow,
  filterFlow,
  longPollingFlow,
  missingTargetFlow,
  resetFixture,
  settingsFor,
  tempArtifactDir,
  variantFlow,
} from "../helpers/flows.js";

let fixture: FixtureServerHandle;

before(async () => {
  fixture = await startFixtureServer();
});

after(async () => {
  await sharedBrowserPool.close();
  await fixture.close();
});

function collectEvents(): { events: RunEvent[]; onEvent: (event: RunEvent) => void } {
  const events: RunEvent[] = [];
  return { events, onEvent: (event) => events.push(event) };
}

test("主流程：异步列表 + 弹窗 + 1.2s 下拉搜索多选 + 保存溯源", async () => {
  await resetFixture(fixture.baseUrl);
  const ledger = new MemoryLedger();
  const artifactDir = await tempArtifactDir();
  const { events, onEvent } = collectEvents();
  const result = await runFlow({
    runId: "run_main_1",
    dsl: customerCreateFlow(fixture.baseUrl),
    mode: "single",
    datasetId: "normal",
    settings: settingsFor(artifactDir),
    ledger,
    onEvent,
  });

  assert.equal(result.status, "finished", JSON.stringify(result.error));
  assert.equal(result.readinessLevel, 5);
  assert.ok(result.nodes.every((node) => node.status === "pass" || node.status === "healed"));

  const picker = result.nodes.find((node) => node.nodeId === "pick-region");
  assert.ok(picker);
  const stages = picker.stageTimings.map((stage) => stage.stage);
  assert.ok(stages.includes("open"));
  assert.ok(stages.includes("panel"));
  assert.ok(stages.includes("filter"));
  assert.ok(stages.includes("refresh"));
  assert.ok(stages.includes("pick"));
  assert.ok(stages.includes("commit"));

  assert.equal(events.some((event) => event.type === "run.started"), true);
  assert.equal(events.some((event) => event.type === "run.finished"), true);
  assert.equal(events.some((event) => event.type === "healed"), false);

  const name = String(result.resolvedData.vars.customerName);
  const customers = (await (await fetch(`${fixture.baseUrl}/api/customers`)).json()) as Array<{
    name: string;
    regions: string[];
    needsApproval: boolean;
  }>;
  const created = customers.find((customer) => customer.name === name);
  assert.ok(created, `客户未创建: ${name}`);
  assert.deepEqual(created.regions, ["华东区", "华南区"]);
  assert.equal(created.needsApproval, true);

  const compiled = JSON.parse(await readFile(join(artifactDir, "compiled-plan.json"), "utf8"));
  assert.equal(compiled.dsl.meta.name, "集成测试流程");
  const resolved = JSON.parse(await readFile(join(artifactDir, "resolved-data.json"), "utf8"));
  assert.equal(resolved.values.amount, 100);
  assert.equal(result.metrics.browserColdStart, true);
});

test("筛选面板：三条件 + 600ms 刷新 + 断言", async () => {
  await resetFixture(fixture.baseUrl);
  const ledger = new MemoryLedger();
  const result = await runFlow({
    runId: "run_filter_1",
    dsl: filterFlow(fixture.baseUrl),
    mode: "single",
    datasetId: "east",
    settings: settingsFor(await tempArtifactDir()),
    ledger,
  });
  assert.equal(result.status, "finished", JSON.stringify(result.error));
  const query = result.nodes.find((node) => node.nodeId === "query");
  assert.ok(query);
  const stages = query.stageTimings.map((stage) => stage.stage);
  assert.ok(stages.includes("expect"));
  const response = query.stageTimings.find((stage) => stage.stage === "expect");
  assert.ok((response?.durationMs ?? 0) >= 500, "应等待 600ms 筛选接口");
});

test("branch 两条路径 + api GET extract + ref 回填", async () => {
  const ledger = new MemoryLedger();
  const normal = await runFlow({
    runId: "run_branch_normal",
    dsl: branchFlow(fixture.baseUrl),
    mode: "single",
    datasetId: "normal",
    settings: settingsFor(await tempArtifactDir()),
    ledger,
  });
  assert.equal(normal.status, "finished", JSON.stringify(normal.error));
  const thenNode = normal.nodes.find((node) => node.nodeId === "assert-else");
  assert.equal(thenNode?.status, "pass");
  assert.equal(normal.nodes.find((node) => node.nodeId === "submit-then")?.status, "skipped");

  const large = await runFlow({
    runId: "run_branch_large",
    dsl: branchFlow(fixture.baseUrl),
    mode: "single",
    datasetId: "large",
    settings: settingsFor(await tempArtifactDir()),
    ledger,
  });
  assert.equal(large.status, "finished", JSON.stringify(large.error));
  assert.equal(large.nodes.find((node) => node.nodeId === "assert-then")?.status, "pass");

  const api = large.network.find((item) => item.url.includes("/api/health"));
  assert.ok(api);
  assert.equal(api.status, 200);
  const note = large.actions.find((action) => action.field === "备注");
  assert.equal(note?.actual, "true");
});

test("后备策略命中记录 HEALED，节点状态 healed", async () => {
  const ledger = new MemoryLedger();
  const { events, onEvent } = collectEvents();
  const result = await runFlow({
    runId: "run_healed",
    dsl: variantFlow(fixture.baseUrl),
    mode: "single",
    datasetId: "only",
    settings: settingsFor(await tempArtifactDir()),
    ledger,
    onEvent,
  });
  assert.equal(result.status, "finished", JSON.stringify(result.error));
  const node = result.nodes.find((item) => item.nodeId === "fill-name");
  assert.equal(node?.status, "healed");
  const healed = events.find((event) => event.type === "healed");
  assert.ok(healed);
  assert.equal(healed.nodeId, "fill-name");
});

test("定位失败输出截图、ARIA 快照与相似元素", async () => {
  const ledger = new MemoryLedger();
  const artifactDir = await tempArtifactDir();
  const result = await runFlow({
    runId: "run_missing",
    dsl: missingTargetFlow(fixture.baseUrl),
    mode: "single",
    datasetId: "only",
    settings: settingsFor(artifactDir),
    ledger,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "TARGET_NOT_FOUND");
  const node = result.nodes.find((item) => item.nodeId === "click-missing");
  assert.ok(node?.screenshotPath);
  const failure = JSON.parse(await readFile(join(artifactDir, "failure.json"), "utf8"));
  assert.equal(failure.failure.code, "TARGET_NOT_FOUND");
  assert.ok(failure.nodes);
  const aria = await readFile(join(artifactDir, "failure-click-missing.yml"), "utf8").catch(() => "");
  assert.ok(aria.length > 0);
});

test("长轮询页 domStable 最迟 8s 放行，不因 idle 卡死", async () => {
  const ledger = new MemoryLedger();
  const started = Date.now();
  const result = await runFlow({
    runId: "run_live",
    dsl: longPollingFlow(fixture.baseUrl),
    mode: "single",
    datasetId: "only",
    settings: settingsFor(await tempArtifactDir()),
    ledger,
  });
  const elapsed = Date.now() - started;
  assert.equal(result.status, "finished", JSON.stringify(result.error));
  assert.ok(elapsed < 20000, `长轮询页耗时 ${elapsed}ms`);
  assert.ok(elapsed >= 7000, `domStable 应在最长 8s 后放行，实际 ${elapsed}ms`);
});
