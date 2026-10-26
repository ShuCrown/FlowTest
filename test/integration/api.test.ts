import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import type { FlowNode } from "@flowforge/dsl";
import { startServer, type Runtime } from "../../apps/api/src/index.js";
import { customerCreateFlow, flowFor, resetFixture } from "../helpers/flows.js";
import { startFixtureServer, type FixtureServerHandle } from "../../fixtures/server.mjs";

let fixture: FixtureServerHandle;
let api: Awaited<ReturnType<typeof startServer>>;
let runtime: Runtime;
let mainRunId = "";

before(async () => {
  fixture = await startFixtureServer();
  const dataDir = await mkdtemp(join(tmpdir(), "flowforge-api-"));
  api = await startServer({ port: 0, dataDir });
  runtime = api.runtime;
});

after(async () => {
  await api.close();
  await fixture.close();
});

async function jsonRequest(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${api.url}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  return { status: response.status, body: await response.json() };
}

test("health 返回 Playwright/Chromium/DB 状态", async () => {
  const health = await jsonRequest("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.playwright.version, "1.64.1");
  assert.ok(String(health.body.playwright.chromium).length > 0);
  assert.equal(health.body.db.ok, true);
});

test("校验接口按 JSON 错误返回，不落库", async () => {
  const bad = await jsonRequest("/api/flows/validate", {
    method: "POST",
    body: JSON.stringify({ dsl: { dslVersion: "1.0" } }),
  });
  assert.equal(bad.status, 200);
  assert.equal(bad.body.ok, false);
  assert.ok(bad.body.errors.length > 0);
});

test("系统与流程 CRUD、发布版本、运行 worker 全链路", async () => {
  await resetFixture(fixture.baseUrl);
  const system = await jsonRequest("/api/systems", {
    method: "POST",
    body: JSON.stringify({
      id: "fixture",
      name: "Fixture",
      baseUrl: fixture.baseUrl,
      auth: { kind: "none" },
    }),
  });
  assert.equal(system.status, 201);
  assert.equal(system.body.id, "fixture");

  const created = await jsonRequest("/api/flows", {
    method: "POST",
    body: JSON.stringify({ dsl: customerCreateFlow(fixture.baseUrl) }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.readiness, 5);
  const flowId = created.body.id as string;

  const exported = await fetch(`${api.url}/api/flows/${flowId}/export`);
  assert.equal(exported.status, 200);
  assert.equal((await exported.json()).meta.name, "集成测试流程");

  const version = await jsonRequest(`/api/flows/${flowId}/publish`, { method: "POST" });
  assert.equal(version.status, 201, JSON.stringify(version.body));
  assert.equal(version.body.version, 1);

  const started = await jsonRequest(`/api/flows/${flowId}/runs`, {
    method: "POST",
    body: JSON.stringify({ datasetId: "normal", headless: true }),
  });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  const runId = started.body.id as string;
  mainRunId = runId;

  let detail: any;
  const deadline = Date.now() + 30000;
  do {
    await sleep(300);
    const response = await jsonRequest(`/api/runs/${runId}`);
    detail = response.body;
    if (["finished", "failed", "canceled"].includes(detail.status)) break;
  } while (Date.now() < deadline);

  assert.equal(detail.status, "finished", JSON.stringify(detail.error));
  assert.ok(detail.nodes.length >= 8);
  assert.ok(detail.nodes.every((node: any) => node.status === "pass" || node.status === "healed"));
  assert.ok(detail.events.some((event: any) => event.type === "run.started"));
  assert.ok(detail.events.some((event: any) => event.type === "run.finished"));
  assert.ok(detail.actions.some((action: any) => action.field === "客户名称"));
  assert.ok(detail.resolvedData.values.amount === 100);
  assert.equal(detail.seed > 0, true);

  const compiled = await fetch(`${api.url}/api/runs/${runId}/artifacts/compiled-plan.json`);
  assert.equal(compiled.status, 200);

  const csv = await fetch(`${api.url}/api/runs/${runId}/export?format=csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(await csv.text(), /客户名称/);
  const exportedData = await (await fetch(`${api.url}/api/runs/${runId}/export?format=json`)).json();
  assert.equal(exportedData.runId, runId);
  assert.ok(exportedData.rows.length > 0);

  const ws = new WebSocket(`ws://127.0.0.1:${new URL(api.url).port}/api/runs/${runId}/events`);
  const snapshot = await new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WS 快照超时")), 5000);
    ws.addEventListener("message", (event) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(event.data)));
    });
    ws.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(new Error(`WS 错误: ${String(event)}`));
    });
  });
  assert.equal(snapshot.type, "run.snapshot");
  assert.equal(snapshot.run.id, runId);
  ws.close();

  const runs = await jsonRequest(`/api/runs?flowId=${flowId}`);
  assert.equal(runs.body.runs.length, 1);
  assert.equal(runtime.store.getRun(runId)?.status, "finished");
});

test("矩阵批次串行运行两个数据集", async () => {
  const flows = await jsonRequest("/api/flows");
  const flowId = (flows.body.flows[0] as { id: string }).id;
  const batch = await jsonRequest(`/api/flows/${flowId}/batches`, {
    method: "POST",
    body: JSON.stringify({ datasetIds: ["normal", "large"], headless: true }),
  });
  assert.equal(batch.status, 202, JSON.stringify(batch.body));
  const batchId = batch.body.batch.id as string;

  let response: any;
  const deadline = Date.now() + 40000;
  do {
    await sleep(500);
    response = await jsonRequest(`/api/batches/${batchId}`);
    if (["finished", "failed", "canceled"].includes(response.body.status)) break;
  } while (Date.now() < deadline);
  assert.equal(response.body.status, "finished", JSON.stringify(response.body));
  assert.equal(response.body.runs.length, 2);
  assert.ok(response.body.runs.every((run: any) => run.status === "finished"));
  assert.equal(response.body.summary.passed, 2);

  const matrix = await jsonRequest(`/api/flows/${flowId}/matrix`);
  assert.equal(matrix.status, 200);
  assert.equal(matrix.body.batch.id, batchId);
  assert.equal(matrix.body.rows.length, 2);
  assert.ok(matrix.body.rows.every((row: any) => row.nodes.length > 0));
});

test("pairwise 预览与应用写入显式数据集", async () => {
  const flow = await jsonRequest("/api/flows", {
    method: "POST",
    body: JSON.stringify({
      dsl: flowFor(
        fixture.baseUrl,
        [
          {
            id: "open",
            type: "navigate",
            system: "fixture",
            url: "/customers",
            readySignal: "page-ready",
          },
        ],
        [],
      ),
    }),
  });
  assert.equal(flow.status, 201, JSON.stringify(flow.body));
  const flowId = flow.body.id as string;
  const factors = {
    region: ["华东区", "华南区", "华北区"],
    status: ["启用", "停用"],
    type: ["普通", "VIP"],
    channel: ["线上", "线下"],
  };
  const preview = await jsonRequest(`/api/flows/${flowId}/matrix/preview`, {
    method: "POST",
    body: JSON.stringify({ mode: "pairwise", factors, seed: 7 }),
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.pairCoverage.ratio, 1);
  assert.ok(preview.body.count < 3 * 2 * 2 * 2);
  assert.equal(preview.body.generatedBy, "pairwise@1");

  const applied = await jsonRequest(`/api/flows/${flowId}/matrix/generate`, {
    method: "POST",
    body: JSON.stringify({ mode: "pairwise", factors, seed: 7 }),
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.flow.dsl.datasets.length, preview.body.count);
  assert.equal(applied.body.flow.dsl.datasets[0].meta.generatedBy, "pairwise@1");
  const reread = await jsonRequest(`/api/flows/${flowId}`);
  assert.equal(reread.body.dsl.datasets.length, preview.body.count);
  assert.equal(reread.body.dsl.datasets[0].meta.seed, 7);
});

test("AI 默认关闭、上下文包与模板检索可用", async () => {
  const flows = await jsonRequest("/api/flows");
  const mainFlow = (
    flows.body.flows as Array<{ id: string; name: string; publishedVersion: number | null }>
  ).find((flow) => flow.name === "集成测试流程" && flow.publishedVersion);
  assert.ok(mainFlow);

  const context = await jsonRequest(`/api/ai/context?flowId=${mainFlow.id}`);
  assert.equal(context.status, 200);
  assert.ok(context.body.context.systems.length >= 1);
  assert.ok(context.body.context.schema);
  const contextText = JSON.stringify(context.body.context);
  assert.equal(contextText.includes("FF_AI_API_KEY"), false);
  assert.equal(contextText.includes("storageState.json"), false);

  const draft = await jsonRequest("/api/ai/draft", {
    method: "POST",
    body: JSON.stringify({ description: "创建一个 CRM 建档流程" }),
  });
  assert.equal(draft.status, 400);
  assert.equal(draft.body.error.code, "AI_DISABLED");

  const suggest = await jsonRequest("/api/ai/suggest", {
    method: "POST",
    body: JSON.stringify({ kind: "field", text: "客户名称" }),
  });
  assert.equal(suggest.status, 400);
  assert.equal(suggest.body.error.code, "AI_DISABLED");

  const templates = await jsonRequest("/api/templates/search?q=集成");
  assert.equal(templates.status, 200);
  assert.ok(templates.body.templates.length >= 1);
  assert.equal(templates.body.templates[0].flow.name, "集成测试流程");
  assert.ok(templates.body.templates[0].flow.dsl);
});

test("运行数据导出 CSV / JSON", async () => {
  assert.ok(mainRunId);
  const csv = await fetch(`${api.url}/api/runs/${mainRunId}/export?format=csv`);
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /node_id,field/);
  const json = await fetch(`${api.url}/api/runs/${mainRunId}/export?format=json`);
  assert.equal(json.status, 200);
  const payload = (await json.json()) as { rows: unknown[] };
  assert.ok(payload.rows.length > 0);
});

test("设置读写与导入差异", async () => {
  const settings = await jsonRequest("/api/settings", {
    method: "PATCH",
    body: JSON.stringify({ nodeTimeoutMs: 20000, resourcePolicy: "fast" }),
  });
  assert.equal(settings.body.settings.nodeTimeoutMs, 20000);
  assert.equal(settings.body.settings.resourcePolicy, "fast");

  const flows = await jsonRequest("/api/flows");
  const flowId = (flows.body.flows[0] as { id: string }).id;
  const dsl = customerCreateFlow(fixture.baseUrl);
  dsl.meta.name = "导入改名";
  const imported = await jsonRequest("/api/flows/import", {
    method: "POST",
    body: JSON.stringify({ dsl, flowId }),
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.diff.some((entry: any) => entry.path === "/meta/name"), true);
  assert.equal(imported.body.flow, undefined);
});

test("inspector：打开、试探 target、保存会话并关闭", async () => {
  await ensureFixtureSystem();
  const opened = await jsonRequest("/api/inspector/open", {
    method: "POST",
    body: JSON.stringify({ systemId: "fixture", headless: true }),
  });
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  const session = opened.body.session;
  assert.equal(session.status, "open");
  assert.equal(session.headless, true);

  const tested = await jsonRequest(`/api/inspector/${session.id}/test-target`, {
    method: "POST",
    body: JSON.stringify({
      target: {
        label: "新建客户",
        strategies: [{ type: "role", role: "button", name: "新建客户" }],
      },
    }),
  });
  assert.equal(tested.status, 200);
  assert.equal(tested.body.attempts[0].count, 1);
  assert.equal(tested.body.ok, true);

  const saved = await jsonRequest("/api/systems/fixture/session", { method: "PUT" });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.system.auth.kind, "storageState");
  const stored = await stat(saved.body.path);
  assert.equal(stored.mode & 0o777, 0o600);

  await jsonRequest(`/api/inspector/${session.id}/close`, { method: "POST" });
  const current = await jsonRequest("/api/inspector/current");
  assert.equal(current.body.session, null);
});

test("recording：开始/停止保留原始事件文件", async () => {
  await ensureFixtureSystem();
  const started = await jsonRequest("/api/recordings", {
    method: "POST",
    body: JSON.stringify({ systemId: "fixture", headless: true }),
  });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const recordingId = started.body.id as string;

  const stopped = await jsonRequest(`/api/recordings/${recordingId}/stop`, { method: "POST" });
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
  assert.equal(stopped.body.status, "stopped");
  assert.ok(Array.isArray(stopped.body.events));
  assert.equal(stopped.body.ruleVersion, "segment@1");

  const row = runtime.store.getRecording(recordingId);
  assert.ok(row);
  assert.equal(String(row.status), "stopped");
  const raw = await readFile(String(row.raw_path), "utf8");
  assert.equal(typeof raw, "string");

  // 注入一份可重放的合成事件，验证采集 → 合成 → 回放闭环
  const synthetic = [
    {
      kind: "navigate",
      ts: new Date().toISOString(),
      url: `${fixture.baseUrl}/customers`,
      source: "playwright",
    },
    {
      kind: "click",
      t: 100,
      fp: {
        tag: "button",
        role: "button",
        text: "新建客户",
        testid: "customer-new",
        css: "button#new-customer",
        xpath: "//button[1]",
      },
    },
    {
      kind: "click",
      t: 900,
      fp: {
        tag: "button",
        role: "button",
        text: "取消",
        css: "button#new-cancel",
        xpath: "//button[2]",
      },
    },
  ];
  await writeFile(String(row.raw_path), synthetic.map((event) => JSON.stringify(event)).join("\n"));

  const synthesized = await jsonRequest(`/api/recordings/${recordingId}/synthesize`, {
    method: "POST",
  });
  assert.equal(synthesized.status, 200, JSON.stringify(synthesized.body));
  assert.equal(synthesized.body.report.nodes, 3);
  assert.equal(synthesized.body.dsl.nodes.length, 3);
  assert.equal(synthesized.body.dsl.nodes[0].type, "navigate");
  assert.equal(synthesized.body.dsl.nodes[1].type, "interact");

  const replay = await jsonRequest(`/api/recordings/${recordingId}/replay`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.report.ok, true, JSON.stringify(replay.body.report.failed));
  assert.ok(replay.body.runId);
  const replayRun = await jsonRequest(`/api/runs/${replay.body.runId}`);
  assert.equal(replayRun.body.status, "finished");
  assert.ok(replayRun.body.nodes.length >= 3);

  const listed = await jsonRequest("/api/recordings");
  assert.equal(listed.body.recordings.some((item: any) => item.id === recordingId), true);

  await jsonRequest("/api/inspector/current").then(async (current) => {
    if (current.body.session) {
      await jsonRequest(`/api/inspector/${current.body.session.id}/close`, { method: "POST" });
    }
  });
});

test("probe 运行遇到歧义暂停，确认后继续", async () => {
  const nodes: FlowNode[] = [
    {
      id: "open",
      type: "navigate",
      system: "fixture",
      url: "/customers",
      readySignal: "page-ready",
    },
    {
      id: "click-row",
      type: "interact",
      system: "fixture",
      adapter: "click",
      target: {
        label: "客户行",
        strategies: [{ type: "testid", value: "customer-row" }],
      },
    },
  ];
  const flow = await jsonRequest("/api/flows", {
    method: "POST",
    body: JSON.stringify({
      dsl: flowFor(fixture.baseUrl, nodes, [{ from: "open", to: "click-row" }]),
    }),
  });
  assert.equal(flow.status, 201, JSON.stringify(flow.body));
  const started = await jsonRequest(`/api/flows/${flow.body.id}/runs`, {
    method: "POST",
    body: JSON.stringify({ mode: "probe", headless: true }),
  });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  const runId = started.body.id as string;

  let detail: any;
  const deadline = Date.now() + 30000;
  do {
    await sleep(300);
    detail = (await jsonRequest(`/api/runs/${runId}`)).body;
    if (detail.pendingConfirms?.length > 0) break;
    if (["finished", "failed", "canceled"].includes(detail.status)) break;
  } while (Date.now() < deadline);
  assert.ok(detail.pendingConfirms?.length > 0, JSON.stringify(detail));
  const pending = detail.pendingConfirms[0];

  const confirmed = await jsonRequest(`/api/runs/${runId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ requestId: pending.requestId, action: "continue", nth: 0 }),
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));

  do {
    await sleep(300);
    detail = (await jsonRequest(`/api/runs/${runId}`)).body;
    if (["finished", "failed", "canceled"].includes(detail.status)) break;
  } while (Date.now() < deadline);
  assert.equal(detail.status, "finished", JSON.stringify(detail.error));
  const clicked = detail.nodes.find((node: any) => node.nodeId === "click-row");
  assert.equal(clicked.status, "pass");
  assert.ok(clicked.resolvedTarget.matchCount > 1);
});

test("运行到此节点只执行前缀，后续节点标记 skipped", async () => {
  const flows = await jsonRequest("/api/flows");
  const flowId = (
    flows.body.flows as Array<{ id: string; name: string; publishedVersion: number | null }>
  ).find((flow) => flow.name === "集成测试流程" && flow.publishedVersion)?.id;
  assert.ok(flowId);
  const started = await jsonRequest(`/api/flows/${flowId}/runs`, {
    method: "POST",
    body: JSON.stringify({ datasetId: "normal", headless: true, stopAtNodeId: "fill-name" }),
  });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  const runId = started.body.id as string;

  let detail: any;
  const deadline = Date.now() + 30000;
  do {
    await sleep(300);
    detail = (await jsonRequest(`/api/runs/${runId}`)).body;
    if (["finished", "failed", "canceled"].includes(detail.status)) break;
  } while (Date.now() < deadline);
  assert.equal(detail.status, "finished", JSON.stringify(detail.error));
  assert.equal(detail.nodes.find((node: any) => node.nodeId === "fill-name").status, "pass");
  assert.equal(detail.nodes.find((node: any) => node.nodeId === "fill-amount").status, "skipped");
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureFixtureSystem(): Promise<void> {
  const list = await jsonRequest("/api/systems");
  if ((list.body.systems as Array<{ id: string }>).some((system) => system.id === "fixture")) {
    return;
  }
  const created = await jsonRequest("/api/systems", {
    method: "POST",
    body: JSON.stringify({
      id: "fixture",
      name: "Fixture",
      baseUrl: fixture.baseUrl,
      auth: { kind: "none" },
    }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
}
