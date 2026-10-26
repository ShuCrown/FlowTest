import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { startServer, type Runtime } from "../../apps/api/src/index.js";
import { customerCreateFlow, resetFixture } from "../helpers/flows.js";
import { startFixtureServer, type FixtureServerHandle } from "../../fixtures/server.mjs";

let fixture: FixtureServerHandle;
let api: Awaited<ReturnType<typeof startServer>>;
let runtime: Runtime;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
