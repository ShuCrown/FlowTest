import type { Page } from "playwright";
import { ERROR_CODES, FlowForgeError } from "./errors.js";

export interface NavigateResult {
  skipped: boolean;
  url: string;
  durationMs: number;
}

export async function navigateTo(
  page: Page,
  url: string,
  options: { waitUntil?: "commit" | "domcontentloaded" | "load"; timeoutMs?: number } = {},
): Promise<NavigateResult> {
  const started = Date.now();
  if (page.url() === url) {
    return { skipped: true, url, durationMs: Date.now() - started };
  }
  try {
    await page.goto(url, {
      waitUntil: options.waitUntil ?? "domcontentloaded",
      timeout: options.timeoutMs ?? 30000,
    });
  } catch (error) {
    throw new FlowForgeError(
      ERROR_CODES.navigationFailed,
      `导航失败 ${url}: ${error instanceof Error ? error.message : String(error)}`,
      { details: { url } },
    );
  }
  return { skipped: false, url, durationMs: Date.now() - started };
}
