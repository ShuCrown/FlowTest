import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintToTarget, segmentEvents, type RawEvent } from "@flowforge/recorder";

function fp(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    tag: "div",
    css: "div",
    xpath: "//div",
    ...overrides,
  };
}

test("phase segmentation: click → overlay → filter → option → commit", () => {
  const events: RawEvent[] = [
    {
      kind: "click",
      t: 100,
      fp: fp({
        tag: "button",
        role: "button",
        text: "选择区域",
        ariaLabel: "选择区域",
        testid: "region-trigger",
      }) as never,
    },
    { kind: "overlay-open", t: 150, role: "dialog", title: "选择区域" },
    {
      kind: "input",
      t: 300,
      fp: fp({ tag: "input", placeholder: "搜索区域", labelText: "搜索区域" }) as never,
      value: "华",
    },
    {
      kind: "click",
      t: 500,
      fp: fp({ tag: "div", role: "option", text: "华东区" }) as never,
    },
    {
      kind: "click",
      t: 700,
      fp: fp({ tag: "button", role: "button", text: "确定" }) as never,
    },
    { kind: "overlay-close", t: 750, role: "dialog" },
    {
      kind: "click",
      t: 900,
      fp: fp({ tag: "button", role: "button", text: "取消" }) as never,
    },
  ];
  const result = segmentEvents(events);
  assert.equal(result.ruleVersion, "segment@1");
  assert.equal(result.clusters.length, 2);
  const picker = result.clusters[0]!;
  assert.equal(picker.kind, "picker");
  assert.equal(picker.mode, "dialog");
  assert.equal(picker.trigger?.target.strategies[0]?.type, "testid");
  assert.equal(picker.filters.length, 1);
  assert.equal(picker.filters[0]?.value, "华");
  assert.equal(picker.picks.length, 1);
  assert.equal(picker.commit?.fp.text, "确定");
  assert.equal(picker.needsConfirm, true);
  assert.equal(picker.evidence.length, 6);
  assert.equal(result.clusters[1]?.kind, "interact");
});

test("fingerprint → 有序候选链，跳过不稳定字段", () => {
  const target = fingerprintToTarget({
    tag: "input",
    name: "customerName",
    testid: "customer-name",
    labelText: "客户名称",
    placeholder: "请输入客户名称",
    css: "div > input",
    xpath: "//input[1]",
  });
  assert.equal(target.strategies[0]?.type, "testid");
  assert.equal(target.strategies[1]?.type, "label");
  assert.equal(target.strategies.at(-1)?.type, "xpath");
  assert.equal(target.strict, true);
  assert.equal(target.label, "客户名称");
});

test("没有 overlay 的点击降级为 interact，不丢失原始事件", () => {
  const events: RawEvent[] = [
    {
      kind: "click",
      t: 10,
      fp: fp({ tag: "button", role: "button", text: "刷新" }) as never,
    },
    {
      kind: "navigate",
      ts: "2026-10-26T00:00:00.000Z",
      url: "http://127.0.0.1:4100/customers",
      source: "playwright",
    },
  ];
  const result = segmentEvents(events);
  assert.equal(result.clusters.length, 1);
  assert.equal(result.clusters[0]?.kind, "interact");
  assert.equal(result.totalEvents, 2);
});
