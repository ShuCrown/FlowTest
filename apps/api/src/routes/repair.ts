import { z } from "zod";
import type { Hono } from "hono";
import {
  normalizeDsl,
  StrategySchema,
  type FlowNode,
  type TargetRef,
} from "@flowforge/dsl";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../lib/errors.js";

const repairSchema = z.object({
  nodeId: z.string().min(1),
  action: z.enum(["promote", "replace"]),
  targetPath: z.enum(["target", "trigger", "panel", "commit"]).optional(),
  strategyIndex: z.number().int().min(0).optional(),
  strategy: z.unknown().optional(),
});

export function registerRepairRoutes(app: Hono, deps: AppDeps): void {
  app.get("/api/flows/:id/healed", (c) => {
    const flow = deps.store.getFlow(c.req.param("id"));
    if (!flow) throw new ApiError(404, "FLOW_NOT_FOUND", "流程不存在");
    return c.json({ healed: deps.store.listHealed(flow.id) });
  });

  app.get("/api/flows/:id/repairs", (c) => {
    const flow = deps.store.getFlow(c.req.param("id"));
    if (!flow) throw new ApiError(404, "FLOW_NOT_FOUND", "流程不存在");
    return c.json({ repairs: deps.store.listRepairs(flow.id) });
  });

  app.get("/api/flows/:id/health", (c) => {
    const flow = deps.store.getFlow(c.req.param("id"));
    if (!flow) throw new ApiError(404, "FLOW_NOT_FOUND", "流程不存在");
    return c.json({ health: deps.store.flowHealth(flow.id) });
  });

  app.post("/api/flows/:id/repair", async (c) => {
    const flow = deps.store.getFlow(c.req.param("id"));
    if (!flow) throw new ApiError(404, "FLOW_NOT_FOUND", "流程不存在");
    const body = repairSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      throw new ApiError(400, "REPAIR_INVALID", "修复请求不合法", {
        details: body.error.issues,
      });
    }
    const nodeIndex = flow.dsl.nodes.findIndex((node) => node.id === body.data.nodeId);
    if (nodeIndex < 0) throw new ApiError(404, "NODE_NOT_FOUND", "节点不存在");
    const node = flow.dsl.nodes[nodeIndex]!;
    const targetPath = body.data.targetPath ?? (node.type === "picker" ? "trigger" : "target");
    const target = getTarget(node, targetPath);
    if (!target) {
      throw new ApiError(400, "REPAIR_TARGET_MISSING", `节点 ${node.id} 没有 ${targetPath} 目标`);
    }
    const before = structuredClone(target.strategies);
    let strategies = structuredClone(target.strategies);
    if (body.data.action === "promote") {
      const index = body.data.strategyIndex;
      if (index === undefined || index < 0 || index >= strategies.length) {
        throw new ApiError(400, "REPAIR_INDEX_INVALID", "strategyIndex 不合法");
      }
      const [promoted] = strategies.splice(index, 1);
      strategies = [promoted!, ...strategies];
    } else {
      const parsed = StrategySchema.safeParse(body.data.strategy);
      if (!parsed.success) {
        throw new ApiError(400, "REPAIR_STRATEGY_INVALID", "strategy 不合法", {
          details: parsed.error.issues,
        });
      }
      const index = body.data.strategyIndex;
      if (index === undefined) strategies = [parsed.data, ...strategies];
      else {
        if (index < 0 || index >= strategies.length) {
          throw new ApiError(400, "REPAIR_INDEX_INVALID", "strategyIndex 不合法");
        }
        strategies[index] = parsed.data;
      }
    }

    const nextDsl = structuredClone(flow.dsl);
    const nextNode = nextDsl.nodes[nodeIndex]!;
    setTarget(nextNode, targetPath, { ...target, strategies });
    const normalized = normalizeDsl(nextDsl);
    const updated = deps.store.updateFlow(flow.id, { dsl: normalized });
    const repairId = deps.store.recordRepair({
      flowId: flow.id,
      nodeId: node.id,
      kind: body.data.action,
      before,
      after: strategies,
    });
    return c.json({
      flow: updated,
      repair: {
        id: repairId,
        nodeId: node.id,
        kind: body.data.action,
        before,
        after: strategies,
      },
    });
  });
}

function getTarget(node: FlowNode, path: string): TargetRef | undefined {
  if (node.type === "interact") {
    if (path === "target") return node.target;
    return undefined;
  }
  if (node.type === "picker") {
    if (path === "trigger") return node.trigger;
    if (path === "panel") return node.panel.scope.target;
    if (path === "commit") return node.commit?.target;
  }
  return undefined;
}

function setTarget(node: FlowNode, path: string, target: TargetRef): void {
  if (node.type === "interact" && path === "target") {
    node.target = target;
    return;
  }
  if (node.type === "picker") {
    if (path === "trigger") {
      node.trigger = target;
      return;
    }
    if (path === "panel") {
      node.panel.scope.target = target;
      return;
    }
    if (path === "commit" && node.commit) {
      node.commit.target = target;
      return;
    }
  }
  throw new ApiError(400, "REPAIR_TARGET_MISSING", "无法写入修复目标");
}
