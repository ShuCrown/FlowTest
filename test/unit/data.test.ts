import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDsl } from "@flowforge/dsl";
import { prepareRunData } from "@flowforge/engine";
import { MemoryLedger } from "../helpers/ledger.js";

function dataFlow() {
  return normalizeDsl({
    dslVersion: "1.0",
    meta: { name: "数据测试" },
    systems: [{ id: "fixture", name: "Fixture", baseUrl: "http://127.0.0.1:4100" }],
    vars: {
      customerName: {
        gen: "unique.text",
        template: "自动客户-{{seq.customer}}-{{run.shortId}}",
        unique: true,
      },
    },
    datasets: [
      {
        id: "normal",
        name: "普通",
        columns: {
          email: { gen: "unique.email" },
          amount: 100,
          password: "S3cret!",
          phone: "13800000000",
        },
      },
    ],
    constraints: [
      { type: "equals", left: "password", right: "confirmPassword" },
      { type: "derive", target: "username", from: "email", op: "localPart" },
      { type: "unique", field: "orderNo", gen: "sequence.orderNo" },
      { type: "range", field: "amount", min: 0, max: 1000 },
      { type: "regex", field: "phone", pattern: "^1\\d{10}$" },
    ],
    nodes: [
      {
        id: "open",
        type: "navigate",
        system: "fixture",
        url: "/customers",
      },
    ],
    edges: [],
    entry: "open",
  });
}

test("生成器、模板、序列与约束定点求值", async () => {
  const ledger = new MemoryLedger();
  const dsl = dataFlow();
  const first = await prepareRunData(dsl, "normal", {
    runId: "run_data_1",
    shortId: "abc123",
    startedAt: "2026-10-26T00:00:00.000Z",
    ledger,
    env: { FF_DOMAIN: "example.test" },
  });
  const second = await prepareRunData(dsl, "normal", {
    runId: "run_data_2",
    shortId: "def456",
    startedAt: "2026-10-26T00:01:00.000Z",
    ledger,
    env: {},
  });

  assert.notEqual(first.resolved.values.email, second.resolved.values.email);
  assert.notEqual(first.resolved.vars.customerName, second.resolved.vars.customerName);
  assert.match(String(first.resolved.values.email), /^ff-.*@test\.local$/);
  assert.equal(first.resolved.values.confirmPassword, "S3cret!");
  assert.equal(
    first.resolved.values.username,
    String(first.resolved.values.email).split("@")[0],
  );
  assert.equal(first.resolved.values.orderNo !== second.resolved.values.orderNo, true);
  assert.equal(first.resolved.values.amount, 100);
  assert.equal(first.resolved.provenance.email?.source, "unique.email");
  assert.equal(ledger.sequence("fixture", "customer"), 2);
  assert.equal(ledger.sequence("fixture", "orderNo"), 2);
});

test("约束不通过时快速失败且错误码明确", async () => {
  const ledger = new MemoryLedger();
  const raw = dataFlow();
  raw.constraints = [{ type: "range", field: "amount", min: 500, max: 1000 }];
  await assert.rejects(
    () =>
      prepareRunData(raw, "normal", {
        runId: "run_data_3",
        shortId: "xyz",
        startedAt: new Date().toISOString(),
        ledger,
        env: {},
      }),
    (error: { code?: string; message: string }) => {
      assert.equal(error.code, "CONSTRAINT_FAILED");
      assert.match(error.message, /range/);
      return true;
    },
  );
});

test("唯一值账本冲突时不静默改写字面值", async () => {
  const ledger = new MemoryLedger();
  const dsl = dataFlow();
  const deps = {
    runId: "run_data_4",
    shortId: "aaa111",
    startedAt: new Date().toISOString(),
    ledger,
    env: {},
  };
  await prepareRunData(dsl, "normal", deps);
  await ledger.reserve("fixture", "constraint.phone", "13800000000", "seed");
  const conflictDsl = dataFlow();
  conflictDsl.constraints = [
    { type: "unique", field: "phone", gen: undefined },
    { type: "range", field: "amount", min: 0, max: 1000 },
  ];
  await assert.rejects(
    () =>
      prepareRunData(conflictDsl, "normal", {
        ...deps,
        runId: "run_data_5",
      }),
    (error: { code?: string }) => error.code === "CONSTRAINT_FAILED",
  );
});
