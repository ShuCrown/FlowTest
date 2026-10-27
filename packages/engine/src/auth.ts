import { readFile } from "node:fs/promises";
import type { BrowserContextOptions } from "playwright";
import type { SystemConfig } from "@flowforge/dsl";

export async function storageStateFor(
  system: SystemConfig,
  env: Record<string, string | undefined>,
): Promise<BrowserContextOptions["storageState"] | undefined> {
  if (!system.auth || system.auth.kind !== "storageState") return undefined;
  if (system.auth.env) {
    const raw = env[system.auth.env];
    if (!raw) return undefined;
    if (raw.trim().startsWith("{")) {
      try {
        return JSON.parse(raw) as BrowserContextOptions["storageState"];
      } catch {
        throw new Error(`系统 ${system.id} 的 storageState 环境变量不是合法 JSON`);
      }
    }
    return readFile(raw, "utf8").then((text) => JSON.parse(text));
  }
  if (system.auth.path) {
    try {
      const text = await readFile(system.auth.path, "utf8");
      return JSON.parse(text) as BrowserContextOptions["storageState"];
    } catch {
      return undefined;
    }
  }
  return undefined;
}
