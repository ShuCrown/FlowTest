#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { FlowDsl } from "@flowforge/dsl";
import { runFlow, sharedBrowserPool } from "@flowforge/engine";
import { createDatabase } from "./db/client.js";
import { newId } from "./lib/ids.js";
import { createLedger } from "./services/ledger.js";
import { Store, validateDsl } from "./services/store.js";

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split("=");
      if (inline !== undefined) flags.set(key!, inline);
      else if (argv[i + 1] && !argv[i + 1]!.startsWith("--")) {
        flags.set(key!, argv[i + 1]!);
        i += 1;
      } else flags.set(key!, true);
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function printUsage(): void {
  process.stdout.write(`FlowForge CLI

  pnpm ff validate <file>
  pnpm ff run <flowId> [--dataset normal] [--mode probe|single] [--headed] [--version <id>] [--stop-at <nodeId>] [--json]
  pnpm ff matrix <flowId> [--version <id>] [--headed]

退出码：0 成功，1 运行失败，2 配置 / 校验失败
`);
}

async function main(): Promise<number> {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const command = positionals[0];
  if (!command || flags.has("help")) {
    printUsage();
    return 0;
  }

  if (command === "validate") {
    const file = positionals[1];
    if (!file) {
      process.stderr.write("缺少 DSL 文件\n");
      return 2;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      process.stderr.write(`读取失败: ${String(error)}\n`);
      return 2;
    }
    const validation = validateDsl(raw);
    const output = {
      ok: validation.errors.length === 0,
      readiness: validation.readiness,
      lint: validation.lint,
      errors: validation.errors,
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return validation.errors.length === 0 ? 0 : 2;
  }

  if (command === "run" || command === "matrix") {
    const flowId = positionals[1];
    if (!flowId) {
      process.stderr.write("缺少 flowId\n");
      return 2;
    }
    const database = createDatabase();
    const store = new Store(database);
    const ledger = createLedger(database.sqlite);
    const flow = store.getFlow(flowId);
    if (!flow) {
      process.stderr.write(`流程不存在: ${flowId}\n`);
      return 2;
    }
    const versionFlag = typeof flags.get("version") === "string" ? String(flags.get("version")) : undefined;
    let dsl: FlowDsl = flow.dsl;
    let flowVersionId: string | null = null;
    if (versionFlag) {
      const version = store.getVersion(flow.id, versionFlag);
      if (!version) {
        process.stderr.write(`版本不存在: ${versionFlag}\n`);
        return 2;
      }
      dsl = version.dsl;
      flowVersionId = version.id;
    } else {
      const published = store.getLatestPublishedVersion(flow.id);
      if (published) {
        dsl = published.dsl;
        flowVersionId = published.id;
      } else {
        process.stderr.write("提示：流程尚未发布，CLI 使用当前草稿运行\n");
      }
    }

    const settings = store.getSettings();
    const headless = !flags.has("headed");
    const baseSettings = {
      headless,
      env: process.env,
      nodeTimeoutMs: Number(settings.nodeTimeoutMs ?? 15000),
      pickerTimeoutMs: Number(settings.pickerTimeoutMs ?? 30000),
      screenshot: (settings.screenshot as "onFailure" | "always" | "never") ?? "onFailure",
      trace: Boolean(settings.trace),
      resourcePolicy:
        (settings.resourcePolicy as "balanced" | "fast" | "accurate") ?? "balanced",
      stopAtNodeId: typeof flags.get("stop-at") === "string" ? String(flags.get("stop-at")) : undefined,
    };

    if (command === "run") {
      const datasetId =
        (typeof flags.get("dataset") === "string" ? String(flags.get("dataset")) : undefined) ??
        dsl.datasets?.[0]?.id;
      const runId = newId("run");
      const artifactDir = join(database.dataDir, "artifacts", runId);
      store.createRun({
        id: runId,
        flowId: flow.id,
        flowVersionId,
        datasetId,
        mode: typeof flags.get("mode") === "string" ? String(flags.get("mode")) : "single",
        artifactDir,
      });
      const result = await runFlow({
        runId,
        dsl,
        mode: (flags.get("mode") as "probe" | "single") ?? "single",
        datasetId,
        settings: { ...baseSettings, artifactDir },
        ledger,
      });
      store.saveRunResult(result);
      if (flags.has("json")) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        printRun(result);
      }
      await sharedBrowserPool.close();
      return result.status === "finished" ? 0 : 1;
    }

    const datasetIds = (dsl.datasets ?? []).map((dataset) => dataset.id);
    if (datasetIds.length === 0) {
      process.stderr.write("矩阵运行需要至少一个数据集\n");
      return 2;
    }
    const batch = store.createBatch({
      flowId: flow.id,
      flowVersionId,
      mode: "matrix",
      datasetIds,
    });
    const statuses: string[] = [];
    for (const datasetId of datasetIds) {
      const runId = newId("run");
      const artifactDir = join(database.dataDir, "artifacts", runId);
      store.createRun({
        id: runId,
        flowId: flow.id,
        flowVersionId,
        datasetId,
        mode: "matrix",
        batchId: batch.id,
        artifactDir,
      });
      const result = await runFlow({
        runId,
        dsl,
        mode: "matrix",
        datasetId,
        settings: { ...baseSettings, artifactDir },
        ledger,
      });
      store.saveRunResult(result);
      statuses.push(result.status === "finished" ? "pass" : (result.error?.code ?? "fail"));
      printRun(result);
    }
    const failed = statuses.filter((status) => status !== "pass").length;
    store.updateBatch(batch.id, failed > 0 ? "failed" : "finished", {
      total: statuses.length,
      passed: statuses.length - failed,
      failed,
    });
    process.stdout.write(`\n矩阵：${statuses.length - failed}/${statuses.length} 通过\n`);
    await sharedBrowserPool.close();
    return failed > 0 ? 1 : 0;
  }

  process.stderr.write(`未知命令: ${command}\n`);
  printUsage();
  return 2;
}

function printRun(result: Awaited<ReturnType<typeof runFlow>>): void {
  process.stdout.write(
    `\nRun ${result.runId} · ${result.status} · dataset=${result.datasetId ?? "-"} · ${result.durationMs}ms · L${result.readinessLevel}\n`,
  );
  for (const node of result.nodes) {
    const target = node.resolvedTarget ? ` · ${node.resolvedTarget.strategy}` : "";
    const error = node.error ? ` · ${node.error.code}: ${node.error.message}` : "";
    process.stdout.write(
      `  ${node.status.padEnd(7)} ${node.nodeId.padEnd(20)} ${String(node.durationMs).padStart(6)}ms${target}${error}\n`,
    );
    for (const stage of node.stageTimings) {
      process.stdout.write(
        `    ${stage.stage.padEnd(16)} ${String(stage.durationMs).padStart(6)}ms ${stage.signal ?? ""}${stage.status !== "completed" ? ` [${stage.status}]` : ""}\n`,
      );
    }
  }
  if (result.error) process.stdout.write(`  错误: ${result.error.code} ${result.error.message}\n`);
  process.stdout.write(`  产物: ${resolve(result.artifactDir)}\n`);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
