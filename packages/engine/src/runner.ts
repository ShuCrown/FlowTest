import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { FlowNode, ValueLike } from "@flowforge/dsl";
import { compileFlow } from "./compile.js";
import { storageStateFor } from "./auth.js";
import { sharedBrowserPool } from "./browser-pool.js";
import { checkAbort, type NodeContext } from "./context.js";
import { prepareRunData } from "./data.js";
import { toErrorPayload, isAbortError, FlowForgeError, ERROR_CODES } from "./errors.js";
import { executeNode } from "./executor.js";
import { LocatorResolver } from "./locator.js";
import { applyResourcePolicy } from "./resource-policy.js";
import {
  ERROR_CODES as CODES,
} from "./errors.js";
import type {
  ActionRecord,
  NetworkRecord,
  NodeRecord,
  ResolvedTargetInfo,
  RunEvent,
  RunOptions,
  RunResult,
  StageTiming,
} from "./types.js";
import { prepareWaits, type WaitContext } from "./waits.js";

export async function runFlow(options: RunOptions): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const emit = (event: Omit<RunEvent, "ts">): void => {
    options.onEvent?.({ ...event, ts: new Date().toISOString() });
  };

  const { plan, readiness } = compileFlow(options.dsl, {
    mode: options.mode,
    datasetId: options.datasetId,
  });
  const dsl = plan.dsl;
  const env = options.settings.env ?? process.env;
  const shortId = options.runId.replace(/[^a-zA-Z0-9]/g, "").slice(-6) || "run";
  const artifactDir = options.settings.artifactDir;
  await mkdir(artifactDir, { recursive: true });

  const { resolver: dataResolver, resolved } = await prepareRunData(dsl, options.datasetId, {
    runId: options.runId,
    shortId,
    startedAt,
    ledger: options.ledger,
    env,
    systemId: dsl.systems[0]?.id,
  });

  await writeFile(join(artifactDir, "compiled-plan.json"), JSON.stringify(plan, null, 2));
  await writeFile(
    join(artifactDir, "resolved-data.json"),
    JSON.stringify(redactResolved(resolved), null, 2),
  );

  emit({
    type: "run.started",
    payload: {
      mode: options.mode,
      datasetId: resolved.datasetId,
      readinessLevel: readiness.level,
      seed: resolved.seed,
    },
  });

  const nodesById = new Map<string, FlowNode>(dsl.nodes.map((node) => [node.id, node]));
  const nodeIndex = new Map<string, number>(dsl.nodes.map((node, index) => [node.id, index]));
  const records: NodeRecord[] = [];
  const actions: ActionRecord[] = [];
  const network: NetworkRecord[] = [];
  const warnings: string[] = [];
  let context: BrowserContext | undefined;
  let traceStarted = false;
  let status: RunResult["status"] = "finished";
  let failure: ReturnType<typeof toErrorPayload> | undefined;
  let currentNodeId: string | undefined;
  let sawStopNode = false;
  let pages = new Map<string, Page>();
  let resourceStats = { blocked: 0 };
  let browserMetrics = { browserColdStart: false, browserLaunchMs: 0 };

  const pool = sharedBrowserPool;
  const headless = options.settings.headless ?? true;
  if (pool.headless !== headless) {
    await pool.close();
  }

  try {
    const firstSystem = dsl.systems[0]!;
    const storageState = await storageStateFor(firstSystem, env);
    const created = await pool.newContext(storageState ? { storageState } : {});
    context = created.context;
    browserMetrics = {
      browserColdStart: created.coldStart,
      browserLaunchMs: created.launchMs,
    };
    context.setDefaultTimeout(options.settings.nodeTimeoutMs ?? 15000);
    context.setDefaultNavigationTimeout(options.settings.nodeTimeoutMs ?? 30000);
    const policyHandle = await applyResourcePolicy(
      context,
      options.settings.resourcePolicy ?? dsl.defaults?.resourcePolicy ?? "balanced",
    );
    resourceStats = policyHandle.stats();

    if (options.settings.trace ?? dsl.defaults?.trace ?? false) {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      traceStarted = true;
    }

    for (const system of dsl.systems) {
      const page = await context.newPage();
      pages.set(system.id, page);
      page.on("pageerror", (error) => {
        warnings.push(`页面错误 ${system.id}: ${error.message}`);
        emit({
          type: "warning",
          level: "warning",
          payload: { message: `页面错误 ${system.id}: ${error.message}` },
        });
      });
      page.on("requestfinished", (request) => {
        void captureNetwork(request, resultsNetwork());
      });
    }

    const resolver = new LocatorResolver({
      probe: options.mode === "probe",
      onAmbiguous: async (target, attempts) => {
        if (!options.onNeedsConfirm) return null;
        const request = {
          runId: options.runId,
          nodeId: currentNodeId ?? "unknown",
          kind: "target-ambiguous" as const,
          target,
          message: `目标存在歧义或缺失: ${target.label ?? "未命名目标"}`,
          candidates: attempts.map((attempt) => ({
            strategy: JSON.stringify(attempt.strategy),
            count: attempt.count,
          })),
        };
        emit({
          type: "needs_confirm",
          nodeId: request.nodeId,
          level: "warning",
          payload: request as unknown as Record<string, unknown>,
        });
        return options.onNeedsConfirm(request);
      },
    });

    const stageTimings: StageTiming[] = [];
    let resolvedTarget: ResolvedTargetInfo | undefined;
    let healed = false;

    const ctx: NodeContext = {
      runId: options.runId,
      mode: options.mode,
      dsl,
      plan,
      page: pages.get(firstSystem.id)!,
      pages,
      context,
      resolved,
      data: dataResolver,
      resolver,
      settings: options.settings,
      nodeOutputs: {},
      signal: options.signal,
      emit,
      stage: (timing) => stageTimings.push(timing),
      recordTarget: (info) => {
        resolvedTarget = info;
      },
      recordAction: (action) => {
        actions.push(action);
        options.onAction?.(action);
      },
      recordNetwork: (record) => {
        network.push(record);
        options.onNetwork?.(record);
      },
      recordHealed: (nodeId, info) => {
        healed = true;
        emit({
          type: "healed",
          nodeId,
          level: "warning",
          payload: {
            strategy: info.strategy,
            index: info.index,
            confidence: info.confidence,
          },
        });
      },
      onNeedsConfirm: options.onNeedsConfirm,
      pageForSystem: (systemId) => {
        const page = pages.get(systemId);
        if (!page) throw new FlowForgeError(CODES.compileFailed, `未知 system: ${systemId}`);
        return page;
      },
      resolveValue: async (value, pointer, extra) => {
        return dataResolver.resolveValue(value as ValueLike, pointer, {
          vars: resolved.vars,
          nodeOutputs: ctx.nodeOutputs,
          ...extra,
        });
      },
    };

    let current: string | undefined = plan.entry;
    const executed = new Set<string>();
    while (current) {
      checkAbort(options.signal, current);
      if (executed.has(current)) {
        throw new FlowForgeError(CODES.compileFailed, `检测到重复执行节点: ${current}`);
      }
      executed.add(current);
      currentNodeId = current;

      const node = nodesById.get(current);
      if (!node) throw new FlowForgeError(CODES.compileFailed, `节点不存在: ${current}`);
      const index = nodeIndex.get(current) ?? records.length;
      const record: NodeRecord = {
        nodeId: node.id,
        nodeType: node.type,
        index,
        name: node.name,
        status: "running",
        durationMs: 0,
        stageTimings: [],
      };
      records.push(record);
      resolvedTarget = undefined;
      healed = false;

      const page = node.system ? ctx.pageForSystem(node.system) : ctx.page;
      ctx.page = page;
      stageTimings.length = 0;
      const nodeStarted = Date.now();
      emit({ type: "node.started", nodeId: node.id, payload: { name: node.name, type: node.type } });

      if (node.enabled === false) {
        record.status = "skipped";
        emit({
          type: "warning",
          nodeId: node.id,
          level: "warning",
          payload: { message: "节点已禁用，跳过执行" },
        });
        record.durationMs = Date.now() - nodeStarted;
        options.onNode?.(record);
        const edge = chooseEdge(plan.outgoing[node.id] ?? [], undefined);
        current = edge?.to;
        continue;
      }

      const compiled = plan.nodes[node.id];
      const timeoutMs = node.timeoutMs ?? options.settings.nodeTimeoutMs ?? 15000;
      const waitCtx: WaitContext = {
        page,
        resolveTarget: async (target, budget, resolveOptions) =>
          (
            await resolver.resolve(page, target, {
              timeoutMs: budget,
              allowMultiple: resolveOptions?.multiple,
            })
          ).locator,
        resolveValue: (value) => ctx.resolveValue(value, `/nodes/${node.id}/wait`, {}),
        defaultTimeoutMs: timeoutMs,
        onWarning: (message) => {
          warnings.push(`${node.id}: ${message}`);
          emit({ type: "warning", nodeId: node.id, level: "warning", payload: { message } });
        },
      };
      const prepareStarted = Date.now();
      const pre = prepareWaits(compiled?.pre ?? [], waitCtx);
      const expect = prepareWaits(compiled?.expect ?? [], waitCtx);
      stageTimings.push({
        stage: "prepare",
        durationMs: Date.now() - prepareStarted,
        status: "completed",
      });

      try {
        const preStarted = Date.now();
        const preResult = await pre.wait();
        warnings.push(...preResult.warnings.map((w) => `${node.id}: ${w}`));
        if (compiled?.pre?.length) {
          stageTimings.push({
            stage: "pre",
            durationMs: Date.now() - preStarted,
            status: "completed",
            signal: preResult.signalKinds.join(","),
          });
        }

        const outcome = await executeNode(ctx, node);

        const expectStarted = Date.now();
        try {
          const expectResult = await expect.wait();
          warnings.push(...expectResult.warnings.map((w) => `${node.id}: ${w}`));
          if (compiled?.expect?.length) {
            stageTimings.push({
              stage: "expect",
              durationMs: Date.now() - expectStarted,
              status: "completed",
              signal: expectResult.signalKinds.join(","),
            });
          }
        } catch (error) {
          if (node.type === "picker") {
            throw new FlowForgeError(
              ERROR_CODES.backfillMismatch,
              `picker 回填断言失败: ${error instanceof Error ? error.message : String(error)}`,
              { nodeId: node.id, stage: "backfill", details: { cause: String(error) } },
            );
          }
          throw error;
        }

        record.status = healed ? "healed" : "pass";
        record.durationMs = Date.now() - nodeStarted;
        record.stageTimings = [...stageTimings];
        record.resolvedTarget = resolvedTarget;
        ctx.nodeOutputs[node.id] = outcome.output ?? {};
        emit({
          type: "node.finished",
          nodeId: node.id,
          payload: {
            status: record.status,
            durationMs: record.durationMs,
            stages: record.stageTimings,
          },
        });
        options.onNode?.(record);

        if (options.settings.screenshot === "always") {
          const path = join(artifactDir, "screenshots", `${safeName(node.id)}.png`);
          await mkdir(join(artifactDir, "screenshots"), { recursive: true });
          await page.screenshot({ path, fullPage: false }).catch(() => undefined);
          record.screenshotPath = path;
        }

        if (node.id === options.settings.stopAtNodeId) {
          sawStopNode = true;
          break;
        }

        const edge = chooseEdge(plan.outgoing[node.id] ?? [], outcome.branch);
        if (!edge && node.type !== "branch") {
          // 终点节点
          current = undefined;
          break;
        }
        if (!edge) {
          throw new FlowForgeError(
            CODES.compileFailed,
            `branch 未选择到有效出边: ${node.id}`,
            { nodeId: node.id },
          );
        }
        current = edge.to;
      } catch (error) {
        if (isAbortError(error)) {
          status = "canceled";
          record.status = "fail";
          record.durationMs = Date.now() - nodeStarted;
          record.stageTimings = [...stageTimings];
          record.error = toErrorPayload(error, node.id);
          options.onNode?.(record);
          emit({
            type: "run.error",
            nodeId: node.id,
            level: "error",
            payload: { ...record.error },
          });
          break;
        }
        status = "failed";
        failure = toErrorPayload(error, node.id);
        record.status = "fail";
        record.durationMs = Date.now() - nodeStarted;
        record.stageTimings = [...stageTimings];
        record.resolvedTarget = resolvedTarget;
        record.error = failure;
        try {
          await captureFailureArtifacts(artifactDir, page, node.id, failure, record);
        } catch {
          // 取证失败不覆盖业务失败
        }
        options.onNode?.(record);
        emit({ type: "run.error", nodeId: node.id, level: "error", payload: failure });
        for (const node2 of dsl.nodes.slice(index + 1)) {
          if (executed.has(node2.id)) continue;
          records.push({
            nodeId: node2.id,
            nodeType: node2.type,
            index: nodeIndex.get(node2.id) ?? records.length,
            name: node2.name,
            status: "skipped",
            durationMs: 0,
            stageTimings: [],
          });
        }
        break;
      } finally {
        pre.dispose();
        expect.dispose();
      }
    }

    if (options.settings.stopAtNodeId && !sawStopNode && status === "finished") {
      failure = {
        code: ERROR_CODES.notReached,
        message: `目标节点不在实际执行路径上: ${options.settings.stopAtNodeId}`,
      };
      status = "failed";
      emit({ type: "run.error", level: "error", payload: failure });
    }

    for (const node of dsl.nodes) {
      if (executed.has(node.id)) continue;
      if (records.some((record) => record.nodeId === node.id)) continue;
      records.push({
        nodeId: node.id,
        nodeType: node.type,
        index: nodeIndex.get(node.id) ?? records.length,
        name: node.name,
        status: "skipped",
        durationMs: 0,
        stageTimings: [],
      });
    }

    if (traceStarted && context) {
      await context.tracing
        .stop({ path: join(artifactDir, "trace.zip") })
        .catch(() => undefined);
    }
  } catch (error) {
    if (isAbortError(error)) {
      status = "canceled";
    } else {
      status = "failed";
      failure = toErrorPayload(error, currentNodeId);
      emit({
        type: "run.error",
        nodeId: currentNodeId,
        level: "error",
        payload: failure,
      });
    }
  } finally {
    if (context) {
      await context.close().catch(() => undefined);
    }
    pool.scheduleIdleClose();
  }

  if (failure) {
    await writeFile(
      join(artifactDir, "failure.json"),
      JSON.stringify({ runId: options.runId, failure, nodes: records }, null, 2),
    ).catch(() => undefined);
  }

  const finishedAt = new Date().toISOString();
  const result: RunResult = {
    runId: options.runId,
    status,
    startedAt,
    finishedAt,
    durationMs: Date.now() - started,
    datasetId: resolved.datasetId,
    mode: options.mode,
    resolvedData: resolved,
    nodes: records,
    actions,
    network,
    error: failure,
    artifactDir,
    seed: resolved.seed,
    readinessLevel: readiness.level,
    metrics: {
      ...browserMetrics,
      blockedRequests: resourceStats.blocked,
    },
  };

  emit({
    type: "run.finished",
    payload: {
      status,
      durationMs: result.durationMs,
      error: failure,
      warnings,
    },
  });
  return result;

  function resultsNetwork(): NetworkRecord[] {
    return network;
  }
}

function chooseEdge(
  edges: Array<{ to: string; when?: "then" | "else" }>,
  branch: "then" | "else" | undefined,
): { to: string } | undefined {
  if (branch) return edges.find((edge) => edge.when === branch);
  return edges.find((edge) => !edge.when) ?? edges[0];
}

async function captureNetwork(
  request: import("playwright").Request,
  sink: NetworkRecord[],
): Promise<void> {
  const method = request.method();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return;
  try {
    const response = await request.response();
    const postData = request.postData();
    let reqBody: unknown = postData;
    try {
      reqBody = postData ? JSON.parse(postData) : undefined;
    } catch {
      reqBody = postData;
    }
    sink.push({
      method,
      url: request.url(),
      status: response?.status(),
      reqBody,
      respSnippet: undefined,
    });
  } catch {
    // 忽略网络取证失败
  }
}

async function captureFailureArtifacts(
  artifactDir: string,
  page: Page,
  nodeId: string,
  failure: NonNullable<NodeRecord["error"]>,
  record: NodeRecord,
): Promise<void> {
  const shotDir = join(artifactDir, "screenshots");
  await mkdir(shotDir, { recursive: true });
  const screenshotPath = join(shotDir, `${safeName(nodeId)}-failure.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
  record.screenshotPath = screenshotPath;

  const aria = await page
    .locator("body")
    .ariaSnapshot()
    .catch(() => "");
  const html = (await page.content().catch(() => "")).slice(0, 200_000);
  await writeFile(join(artifactDir, `failure-${safeName(nodeId)}.yml`), aria);
  await writeFile(join(artifactDir, `failure-${safeName(nodeId)}.html`), html);
  await writeFile(
    join(artifactDir, "failure.json"),
    JSON.stringify({ nodeId, failure, stages: record.stageTimings }, null, 2),
  );
}

function redactResolved(resolved: RunResult["resolvedData"]): unknown {
  const secret = new Set(resolved.secretFields);
  const redact = (obj: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [
        key,
        secret.has(key) ? "***" : value,
      ]),
    );
  return {
    ...resolved,
    values: redact(resolved.values),
    vars: redact(resolved.vars),
  };
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export { FlowForgeError };
