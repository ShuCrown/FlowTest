import { chromium, type Browser, type BrowserContext, type BrowserContextOptions } from "playwright";

export interface BrowserPoolOptions {
  headless?: boolean;
  idleMs?: number;
}

/**
 * Chromium 进程复用池：同一 Run Worker 会话内连续运行不重复冷启动。
 * 每次运行仍创建独立 BrowserContext，避免状态污染。
 */
export class BrowserPool {
  readonly headless: boolean;
  readonly idleMs: number;
  private browser?: Browser;
  private launching?: Promise<Browser>;
  private idleTimer?: NodeJS.Timeout;
  private lastLaunchMs = 0;

  constructor(options: BrowserPoolOptions = {}) {
    this.headless = options.headless ?? true;
    this.idleMs = options.idleMs ?? 10 * 60 * 1000;
  }

  async acquire(): Promise<{ browser: Browser; coldStart: boolean; launchMs: number }> {
    this.clearIdleTimer();
    if (this.browser?.isConnected()) {
      return { browser: this.browser, coldStart: false, launchMs: 0 };
    }
    const coldStart = !this.launching;
    if (!this.launching) {
      const started = Date.now();
      this.launching = chromium
        .launch({
          headless: this.headless,
          args: ["--disable-dev-shm-usage", "--no-sandbox"],
        })
        .then((browser) => {
          this.browser = browser;
          this.lastLaunchMs = Date.now() - started;
          browser.on("disconnected", () => {
            this.browser = undefined;
          });
          return browser;
        })
        .finally(() => {
          this.launching = undefined;
        });
    }
    const browser = await this.launching;
    return { browser, coldStart, launchMs: this.lastLaunchMs };
  }

  async newContext(
    options: BrowserContextOptions = {},
  ): Promise<{ context: BrowserContext; coldStart: boolean; launchMs: number }> {
    const { browser, coldStart, launchMs } = await this.acquire();
    const context = await browser.newContext({
      reducedMotion: "reduce",
      viewport: { width: 1440, height: 900 },
      ...options,
    });
    return { context, coldStart, launchMs };
  }

  scheduleIdleClose(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      void this.close();
    }, this.idleMs);
    this.idleTimer.unref?.();
  }

  async close(): Promise<void> {
    this.clearIdleTimer();
    const browser = this.browser;
    this.browser = undefined;
    this.launching = undefined;
    if (browser?.isConnected()) {
      await browser.close().catch(() => undefined);
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }
}

export const sharedBrowserPool = new BrowserPool();
