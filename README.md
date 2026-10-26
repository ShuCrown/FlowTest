# FlowForge

把测试意图沉淀为可校验、可版本化、可数据驱动的流程定义（Flow DSL），再由可替换的解释器执行的本地流程测试平台。

- 落地方案：[plan.md](./plan.md)
- 技术栈：Node 24 / pnpm workspace / TypeScript / Hono / SQLite / Playwright / React Flow
- 当前进度：M1–M5 主体已落地（DSL/执行器、画布/检查器/采集、数据/组合/矩阵、AI 受控入口、降级修复工作台）。
  M5 的“失败现场继续（resume）”尚未实现，接口明确返回 501，不做虚假续跑。

## 包结构

```text
apps/
  api/        Hono REST/WS、SQLite、串行 Run Worker、CLI
  web/        React 19 + Vite + React Flow 编辑器
packages/
  dsl/        Flow DSL schema / 归一化 / 就绪度 / lint / diff / 条件
  engine/     编译、定位、等待、picker、数据生成、浏览器池、执行器
  recorder/   注入式采集器、元素指纹、阶段切分、Inspector Worker
fixtures/     本地夹具站（异步下拉、筛选面板、长轮询、变体、分支、重资源）
test/         unit / integration / perf / e2e
```

## 命令

```bash
pnpm install
pnpm db:migrate
pnpm dev                 # API 8787 + Web 5173
pnpm build               # API/Worker/Inspector 打包
pnpm start               # 生产启动，托管 apps/web/dist
pnpm fixtures            # 夹具站 127.0.0.1:4100
pnpm typecheck
pnpm test                # unit + integration
pnpm test:perf           # 10 次唯一值 / 8 节点预算 / 资源策略
pnpm test:e2e            # 构建前端并跑画布 E2E

pnpm ff validate <file>
pnpm ff run <flowId> [--dataset normal] [--mode probe|single] [--headed]
pnpm ff matrix <flowId>
```

## 关键约束

- Flow DSL 是唯一执行契约；画布坐标单独存 `layout_json`。
- 禁止 `waitForTimeout` / `networkidle`；等待只用显式信号或预设。
- 定位是有序候选链，后备命中只记录 `HEALED`，不自动改写配置。
- 唯一值由账本原子预留；数据集行与随机种子显式落库，运行可复现。
- 采集只产出原始事件与交互簇；原始事件永不删除，切分规则版本化可重切。
- 数据组合：pairwise / full 在编辑期生成显式数据集；运行期不做随机组合。
- 提交后重复检测命中 409 / “已存在”时，rewind 重新生成指定变量并重跑，attempt 写入运行事件。
- AI 默认关闭；上下文包不包含 cookies / env 值 / 密码；AI 草稿与建议必须确认并回放后才可发布。
- API/WS 只监听 `127.0.0.1`；SQLite 仅 API 进程写。
- Inspector 在没有 `DISPLAY` 的环境自动 headless；本地桌面可用 headed 手动登录。

## 数据目录

```text
data/
  flowforge.db
  artifacts/<runId>/       # compiled-plan / 截图 / trace / failure
  recordings/<sessionId>.jsonl
  sessions/<systemId>/    # profile 与 storageState（0600）
```
