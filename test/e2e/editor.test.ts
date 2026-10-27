import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { chromium, type Page } from "@flowforge/engine";
import { startServer } from "../../apps/api/src/index.js";
import { startFixtureServer, type FixtureServerHandle } from "../../fixtures/server.mjs";

let fixture: FixtureServerHandle;
let api: Awaited<ReturnType<typeof startServer>>;

before(async () => {
  fixture = await startFixtureServer();
  const dataDir = await mkdtemp(join(tmpdir(), "flowforge-e2e-"));
  api = await startServer({ port: 0, dataDir });
  await fetch(`${api.url}/api/systems`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "fixture",
      name: "Fixture",
      baseUrl: fixture.baseUrl,
      auth: { kind: "none" },
    }),
  });
});

after(async () => {
  await api.close();
  await fixture.close();
});

test("E2E：新建流程 → 添加节点 → 自动保存 → 刷新回读 → 选中检查器", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("ResizeObserver")) {
      errors.push(message.text());
    }
  });

  try {
    await page.goto(api.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /新建流程/ }).click();
    await page.getByPlaceholder("CRM 建档并按金额分支").fill("E2E 验证流程");
    await page.getByRole("button", { name: "创建并打开" }).click();
    await page.waitForURL(/\/flows\/flow_/, { timeout: 10000 });
    await waitForNodes(page, 1);

    await page.getByRole("button", { name: /添加节点/ }).click();
    await page
      .locator("button")
      .filter({ hasText: "断言" })
      .first()
      .click();
    await waitForNodes(page, 2);
    await page.getByText("NODE INSPECTOR").waitFor({ timeout: 5000 });
    await page.getByText("assert-2").first().waitFor({ timeout: 5000 });

    await page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/flows/") &&
        response.status() === 200,
      { timeout: 8000 },
    );
    await page.getByText(/saved · rev/).first().waitFor({ timeout: 5000 });

    await page.reload({ waitUntil: "networkidle" });
    await waitForNodes(page, 2);

    await page.locator(".react-flow__node").filter({ hasText: "打开首页" }).click();
    await page.getByText("NODE INSPECTOR").waitFor({ timeout: 5000 });
    await page.getByText("打开首页").first().waitFor({ timeout: 5000 });

    await page.locator(".react-flow__node").filter({ hasText: "assert-2" }).click();
    await page.getByText("assert-2").first().waitFor({ timeout: 5000 });

    const flowId = new URL(page.url()).pathname.split("/").pop();
    const saved = (await (await fetch(`${api.url}/api/flows/${flowId}`)).json()) as {
      dsl: { nodes: Array<{ id: string }>; entry: string };
      layout: { nodes: Record<string, { x: number; y: number }> };
    };
    assert.equal(saved.dsl.nodes.length, 2);
    assert.equal(saved.dsl.entry, "open");
    assert.ok(saved.layout.nodes["assert-2"]);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

async function waitForNodes(page: Page, count: number): Promise<void> {
  await page.waitForFunction(
    (expected: number) => document.querySelectorAll(".react-flow__node").length === expected,
    count,
    { timeout: 10000 },
  );
}
