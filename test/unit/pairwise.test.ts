import assert from "node:assert/strict";
import test from "node:test";
import { generateMatrix } from "@flowforge/dsl";

const factors = {
  region: ["华东区", "华南区", "华北区"],
  status: ["启用", "停用"],
  type: ["普通", "VIP", "试用"],
  channel: ["线上", "线下"],
};

test("pairwise：pair 覆盖率 100%，行数少于 full，seed 可复现", () => {
  const first = generateMatrix({ mode: "pairwise", factors, seed: 42 });
  const second = generateMatrix({ mode: "pairwise", factors, seed: 42 });
  assert.equal(first.pairCoverage?.ratio, 1);
  assert.equal(first.count < 3 * 2 * 3 * 2, true);
  assert.deepEqual(first.rows, second.rows);
  assert.equal(first.generatedBy, "pairwise@1");
  assert.equal(first.rows.length < 200, true);
});

test("full：基数封顶 500 行并保持必测组合优先", () => {
  const result = generateMatrix({
    mode: "full",
    factors,
    mandatoryRows: [{ region: "华北区", status: "停用" }],
  });
  assert.equal(result.generatedBy, "matrix-full@1");
  assert.equal(result.rows[0]?.region, "华北区");
  assert.equal(result.rows[0]?.status, "停用");
  assert.equal(result.rows.length, 36);
});

test("必测组合不在因子集合时报错", () => {
  assert.throws(
    () =>
      generateMatrix({
        mode: "pairwise",
        factors,
        mandatoryRows: [{ region: "不存在" }],
      }),
    /不在因子集合/,
  );
});

test("单因子与超限矩阵", () => {
  const single = generateMatrix({ mode: "pairwise", factors: { a: [1, 2, 3] } });
  assert.equal(single.count, 3);
  assert.deepEqual(single.rows, [{ a: 1 }, { a: 2 }, { a: 3 }]);
  assert.throws(
    () =>
      generateMatrix({
        mode: "full",
        factors: { a: Array.from({ length: 30 }, (_, i) => i), b: Array.from({ length: 20 }, (_, i) => i) },
      }),
    /超过 500/,
  );
});
