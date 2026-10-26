import type { BrowserContext } from "playwright";
import type { ResourcePolicy } from "./types.js";

const ANALYTICS = /google-analytics|googletagmanager|doubleclick|hotjar|segment\.(io|com)|mixpanel|sentry\.io|clarity\.ms|matomo/i;
const MEDIA = /\.(mp4|webm|mp3|ogg|wav)(\?|$)/i;
const IMAGES = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)(\?|$)/i;
const FONTS = /\.(woff2?|ttf|otf|eot)(\?|$)/i;

export interface ResourceStats {
  blocked: number;
  allowed: number;
  byType: Record<string, number>;
}

export interface ResourcePolicyHandle {
  stats: () => ResourceStats;
}

/**
 * 按资源类型与已知域名拦截，不做全局通配代理。
 */
export async function applyResourcePolicy(
  context: BrowserContext,
  policy: ResourcePolicy,
): Promise<ResourcePolicyHandle> {
  const stats: ResourceStats = { blocked: 0, allowed: 0, byType: {} };
  if (policy === "accurate") {
    return { stats: () => stats };
  }

  const block = (type: string) => async (route: import("playwright").Route): Promise<void> => {
    stats.blocked += 1;
    stats.byType[type] = (stats.byType[type] ?? 0) + 1;
    await route.abort("blockedbyclient").catch(() => undefined);
  };

  await context.route(ANALYTICS, block("analytics"));
  await context.route(MEDIA, block("media"));
  if (policy === "fast") {
    await context.route(IMAGES, block("image"));
    await context.route(FONTS, block("font"));
  }
  return { stats: () => stats };
}
