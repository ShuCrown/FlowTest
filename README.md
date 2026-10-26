# FlowForge

把测试意图沉淀为可校验、可版本化、可数据驱动的流程定义（Flow DSL），再由可替换的解释器执行的本地流程测试平台。

- 落地计划：[plan.md](./plan.md)
- 技术栈：Node 24 / pnpm workspace / TypeScript / Hono / SQLite / Playwright
- 包结构：`packages/dsl`（schema / 归一化 / 就绪度 / lint）、`packages/engine`（编译与解释执行）、`apps/api`（REST / 队列 / DB）、`fixtures`（本地夹具站）

## 命令

```bash
pnpm install
pnpm db:migrate
pnpm dev            # API 8787 + Web 5173
pnpm typecheck
pnpm test
pnpm test:perf
pnpm fixtures       # 启动夹具站（默认 127.0.0.1:4100）
pnpm ff validate <file>
pnpm ff run <flowId> [--dataset normal] [--mode probe|single]
```
