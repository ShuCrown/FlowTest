import type { FlowDsl } from "./schema.js";

export interface DiffEntry {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
}

export function diffDsl(before: FlowDsl, after: FlowDsl): DiffEntry[] {
  const entries: DiffEntry[] = [];
  compare(before, after, "", entries);
  return entries;
}

function compare(before: unknown, after: unknown, path: string, entries: DiffEntry[]): void {
  if (before === after) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    const max = Math.max(before.length, after.length);
    for (let i = 0; i < max; i += 1) {
      const childPath = `${path}/${i}`;
      if (i >= before.length) entries.push({ path: childPath, kind: "added", after: after[i] });
      else if (i >= after.length) entries.push({ path: childPath, kind: "removed", before: before[i] });
      else compare(before[i], after[i], childPath, entries);
    }
    return;
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const childPath = `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
      if (!(key in before)) entries.push({ path: childPath, kind: "added", after: after[key] });
      else if (!(key in after)) entries.push({ path: childPath, kind: "removed", before: before[key] });
      else compare(before[key], after[key], childPath, entries);
    }
    return;
  }
  entries.push({ path: path || "/", kind: "changed", before, after });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function describeDiff(entries: DiffEntry[]): string[] {
  return entries.map((entry) => {
    switch (entry.kind) {
      case "added":
        return `+ ${entry.path}`;
      case "removed":
        return `- ${entry.path}`;
      case "changed":
        return `~ ${entry.path}`;
    }
  });
}
