export type MatrixMode = "full" | "pairwise";

export interface MatrixOptions {
  mode: MatrixMode;
  factors: Record<string, unknown[]>;
  mandatoryRows?: Array<Record<string, unknown>>;
  seed?: number;
  maxRows?: number;
}

export interface MatrixResult {
  mode: MatrixMode;
  rows: Array<Record<string, unknown>>;
  count: number;
  factors: string[];
  seed: number;
  generatedBy: string;
  pairCoverage?: { covered: number; total: number; ratio: number };
}

const FULL_LIMIT = 500;
const PAIRWISE_LIMIT = 200;

export function generateMatrix(options: MatrixOptions): MatrixResult {
  const factors: Record<string, unknown[]> = {};
  for (const [column, values] of Object.entries(options.factors)) {
    const unique: unknown[] = [];
    for (const value of values) {
      if (!unique.some((item) => sameValue(item, value))) unique.push(value);
    }
    if (unique.length === 0) throw new Error(`因子 ${column} 没有取值`);
    factors[column] = unique;
  }
  const keys = Object.keys(factors);
  if (keys.length === 0) throw new Error("至少需要一个因子");
  const seed = options.seed ?? 20261026;
  const random = mulberry32(seed);
  const maxRows = Math.min(
    options.maxRows ?? (options.mode === "full" ? FULL_LIMIT : PAIRWISE_LIMIT),
    options.mode === "full" ? FULL_LIMIT : PAIRWISE_LIMIT,
  );
  const mandatory = normalizeMandatory(options.mandatoryRows ?? [], factors).map((row) => {
    const complete = { ...row };
    for (const key of keys) {
      if (!(key in complete)) complete[key] = factors[key]![0];
    }
    return complete;
  });

  if (keys.length === 1) {
    const key = keys[0]!;
    const rows = [...mandatory];
    for (const value of factors[key]!) {
      const row = { [key]: value };
      if (!rows.some((item) => sameRow(item, row))) rows.push(row);
    }
    return {
      mode: options.mode,
      rows,
      count: rows.length,
      factors: keys,
      seed,
      generatedBy: options.mode === "full" ? "matrix-full@1" : "pairwise@1",
      pairCoverage: { covered: 0, total: 0, ratio: 1 },
    };
  }

  if (options.mode === "full") {
    const total = keys.reduce((count, key) => count * factors[key]!.length, 1);
    if (total > FULL_LIMIT) throw new Error(`full 组合超过 ${FULL_LIMIT} 行（${total} 行）`);
    const rows = [...mandatory];
    let combos: Array<Record<string, unknown>> = [{}];
    for (const key of keys) {
      const next: Array<Record<string, unknown>> = [];
      for (const row of combos) {
        for (const value of factors[key]!) next.push({ ...row, [key]: value });
      }
      combos = next;
    }
    for (const combo of combos) {
      if (!rows.some((row) => sameRow(row, combo))) rows.push(combo);
      if (rows.length >= maxRows) break;
    }
    if (rows.length > FULL_LIMIT) throw new Error(`full 组合超过 ${FULL_LIMIT} 行`);
    return {
      mode: "full",
      rows,
      count: rows.length,
      factors: keys,
      seed,
      generatedBy: "matrix-full@1",
    };
  }

  const pairs = buildPairs(factors);
  const rows: Array<Record<string, unknown>> = mandatory.map((row) => ({ ...row }));
  const covered = new Set<string>();
  for (const row of rows) markCovered(row, pairs, covered);

  while (covered.size < pairs.length && rows.length < maxRows) {
    const remaining = pairs.filter((pair) => !covered.has(pair.key));
    if (remaining.length === 0) break;
    const pair = remaining[Math.floor(random() * remaining.length)]!;
    const row: Record<string, unknown> = {
      [pair.a]: pair.va,
      [pair.b]: pair.vb,
    };
    for (const column of keys) {
      if (column in row) continue;
      let bestValue = factors[column]![0];
      let bestScore = -1;
      for (const value of factors[column]!) {
        row[column] = value;
        let score = 0;
        for (const other of Object.keys(row)) {
          if (other === column) continue;
          const key = pairKey(column, other, value, row[other]);
          if (!covered.has(key)) score += 1;
        }
        if (score > bestScore) {
          bestScore = score;
          bestValue = value;
        }
      }
      row[column] = bestValue;
    }
    if (rows.some((item) => sameRow(item, row))) {
      // 避免空转：强制加入一个能覆盖新 pair 的新行
      const extra = remaining[0]!;
      row[extra.a] = extra.va;
      row[extra.b] = extra.vb;
    }
    rows.push(row);
    markCovered(row, pairs, covered);
  }

  return {
    mode: "pairwise",
    rows,
    count: rows.length,
    factors: keys,
    seed,
    generatedBy: "pairwise@1",
    pairCoverage: {
      covered: covered.size,
      total: pairs.length,
      ratio: pairs.length === 0 ? 1 : Math.round((covered.size / pairs.length) * 1000) / 1000,
    },
  };
}

interface FactorPair {
  key: string;
  a: string;
  va: unknown;
  b: string;
  vb: unknown;
}

function buildPairs(factors: Record<string, unknown[]>): FactorPair[] {
  const keys = Object.keys(factors);
  const pairs: FactorPair[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const a = keys[i]!;
      const b = keys[j]!;
      for (const va of factors[a]!) {
        for (const vb of factors[b]!) {
          pairs.push({ key: pairKey(a, b, va, vb), a, va, b, vb });
        }
      }
    }
  }
  return pairs;
}

function markCovered(
  row: Record<string, unknown>,
  pairs: FactorPair[],
  covered: Set<string>,
): void {
  const keys = Object.keys(row);
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const a = keys[i]!;
      const b = keys[j]!;
      covered.add(pairKey(a, b, row[a], row[b]));
    }
  }
  if (pairs.length === 0) return;
}

function pairKey(a: string, b: string, va: unknown, vb: unknown): string {
  const first = a < b ? a : b;
  const second = a < b ? b : a;
  const firstValue = a < b ? va : vb;
  const secondValue = a < b ? vb : va;
  return `${first}=${JSON.stringify(firstValue)}|${second}=${JSON.stringify(secondValue)}`;
}

function normalizeMandatory(
  rows: Array<Record<string, unknown>>,
  factors: Record<string, unknown[]>,
): Array<Record<string, unknown>> {
  const normalized: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!(key in factors)) throw new Error(`必测组合包含未知列: ${key}`);
      if (!factors[key]!.some((item) => sameValue(item, value))) {
        throw new Error(`必测组合的 ${key} 取值不在因子集合中`);
      }
      clean[key] = value;
    }
    if (!normalized.some((item) => sameRow(item, clean))) normalized.push(clean);
  }
  return normalized;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function sameRow(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!sameValue(a[key], b[key])) return false;
  }
  return true;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
