import assert from "node:assert/strict";
import test from "node:test";
import { synthesizeRecording, fingerprintToTarget, type InteractionCluster } from "@flowforge/recorder";

const system = {
  id: "fixture",
  name: "Fixture",
  baseUrl: "http://127.0.0.1:4100",
  auth: { kind: "none" as const },
};

function fp(overrides: Record<string, unknown>) {
  return {
    tag: "div",
    css: "div",
    xpath: "//div",
    ...overrides,
  };
}

test("picker 簇合成 trigger/panel/filter/pick/commit，保留 evidence", () => {
  const trigger = fingerprintToTarget(
    fp({
      tag: "button",
      role: "button",
      text: "选择区域",
      ariaLabel: "选择区域",
      testid: "region-trigger",
      css: "button#region-trigger",
    }),
  );
  const cluster: InteractionCluster = {
    id: "cluster_1",
    kind: "picker",
    startT: 100,
    endT: 1800,
    mode: "dialog",
    trigger: {
      fp: fp({ tag: "button", role: "button", text: "选择区域", ariaLabel: "选择区域" }),
      target: trigger,
    },
    panel: { role: "dialog", title: "选择区域", name: "选择区域" },
    filters: [
      {
        kind: "input",
        fp: fp({ tag: "input", placeholder: "搜索区域", labelText: "搜索区域" }),
        value: "华",
        evidence: 2,
      },
    ],
    picks: [
      { fp: fp({ tag: "div", role: "option", text: "华东区" }), evidence: 3 },
      { fp: fp({ tag: "div", role: "option", text: "华南区" }), evidence: 4 },
    ],
    commit: { fp: fp({ tag: "button", role: "button", text: "确定" }), evidence: 5 },
    evidence: [0, 1, 2, 3, 4, 5],
    confidence: 0.65,
    needsConfirm: true,
  };

  const result = synthesizeRecording({
    clusters: [cluster],
    rawEvents: [
      {
        kind: "navigate",
        ts: "2026-10-26T00:00:00.000Z",
        url: "http://127.0.0.1:4100/customers",
        source: "playwright",
      },
    ],
    system,
    flowName: "采集测试",
  });

  assert.equal(result.dsl.nodes.length, 2);
  const navigate = result.dsl.nodes[0]!;
  assert.equal(navigate.type, "navigate");
  if (navigate.type !== "navigate") return;
  assert.equal(navigate.url, "/customers");

  const picker = result.dsl.nodes[1]!;
  assert.equal(picker.type, "picker");
  if (picker.type !== "picker") return;
  assert.equal(picker.mode, "dialog");
  assert.equal(picker.trigger.label, "选择区域");
  assert.equal(picker.filter?.steps[0]?.value !== undefined, true);
  assert.equal(picker.pick.multi, true);
  assert.deepEqual(
    (picker.pick.byText?.value as { kind: string; value: unknown }).value,
    ["华东区", "华南区"],
  );
  assert.equal(picker.commit?.target.label, "确定");
  assert.equal(picker.meta?.needsConfirm, true);
  assert.equal(result.report.nodes, 2);
  assert.equal(result.report.needsConfirm >= 1, true);
  assert.deepEqual(result.report.evidence["picker-1"], cluster.evidence);
});

test("交互簇按 filter 拆成多个 interact，脱敏值给出待确认与占位", () => {
  const cluster: InteractionCluster = {
    id: "cluster_1",
    kind: "interact",
    startT: 10,
    endT: 100,
    filters: [
      {
        kind: "input",
        fp: fp({ tag: "input", labelText: "用户名" }),
        value: "alice",
        evidence: 1,
      },
      {
        kind: "change",
        fp: fp({ tag: "input", type: "password", labelText: "密码" }),
        value: undefined,
        redacted: true,
        evidence: 2,
      },
    ],
    picks: [],
    evidence: [1, 2],
    confidence: 0.8,
    needsConfirm: false,
  };
  const result = synthesizeRecording({
    clusters: [cluster],
    rawEvents: [],
    system,
  });
  assert.equal(result.dsl.nodes.length, 3);
  const input = result.dsl.nodes[1]!;
  assert.equal(input.type, "interact");
  if (input.type !== "interact") return;
  assert.equal(input.value !== undefined ? literal(input.value) : input.value, "alice");
  const password = result.dsl.nodes[2]!;
  assert.equal(password.type, "interact");
  if (password.type !== "interact") return;
  assert.equal(password.meta?.needsConfirm, true);
  assert.equal(password.value !== undefined ? literal(password.value) : password.value, "待确认");
  assert.equal(result.report.warnings.length >= 1, true);
});

function literal(value: unknown): unknown {
  if (value && typeof value === "object" && "kind" in value) {
    const expr = value as { kind: string; value?: unknown };
    if (expr.kind === "literal") return expr.value;
  }
  return value;
}
