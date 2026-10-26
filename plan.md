# FlowForge 落地方案

- 文档版本：v2.0
- 状态：待评审
- 日期：2026-10-26
- 工作目录：`/Volumes/project/agent/FlowTest`（目录沿用，产品名改为 FlowForge）
- 上游设计：《FlowForge 设计与落地实施方案》v1.0
- 技术基线：Node 24.16 / pnpm 10.34 / Vite 8.3 / React 19.3 / React Flow 12 / Playwright 1.64 / Hono 4 / SQLite
- 取代关系：本版取代 v1 `plan.md`（FlowTest / FlowSpec 线性步骤模型）。v1 中已验证的工程结论——浏览器进程复用、显式等待信号、唯一值账本、定位候选降级、失败诊断——并入本版。

---

## 0. 执行摘要

FlowForge 的核心不是“录制回放”，而是把测试意图沉淀成一份**可校验、可版本化、可数据驱动的流程定义**，再由可替换的解释器执行。

1. **Flow DSL 是唯一执行契约**：节点图（`navigate / interact / picker / wait / assert / branch / api`）+ `datasets` + `constraints` + `edges`，用 zod 校验；画布坐标单独存 `layout_json`，不进 DSL。
2. **执行器只做解释**：定位用有序候选链，等待用四类显式信号（DOM 稳定、元素可交互、业务网络、加载指示器消失），复合控件统一收进 `picker` 阶段化执行；不生成 Playwright 代码，不解析 codegen 产物。
3. **数据是一等公民**：唯一值生成器 + 唯一值账本 + 约束求值 + 显式数据集；pairwise 只在**编辑期**生成数据集，运行期不做随机组合，保证可复现。
4. **编辑器是节点画布**：React Flow 画布与 DSL 双向同步；检查器按“目标 / 数据 / 等待 / 断言”分区；就绪度 L0–L5 与缺口清单常驻。
5. **采集只生产草稿**：注入式事件采集 → 阶段切分 → 模式识别 → 探测回放；采集产出 `needsConfirm` 草稿，不直接落库为可执行流程。
6. **AI 可选、受控**：只接 `fieldSemanticMapper` 与 `nlToCondition` 两个 hook；默认关闭，输出必须经确认与回放两道闸。

**与上游文档的落地差异（均为实现层决定，不改变产品语义）**

| 项 | 上游设计 | 本方案落地 | 原因 |
|---|---|---|---|
| 分支表达 | `then: []` / `else: []` 嵌套子序列 | 节点 + 带 `when: "then" \| "else"` 标签的出边 | 与 React Flow 节点图同构，避免画布与 DSL 两套嵌套结构；执行语义等价 |
| pairwise | 运行期按字段维度生成组合 | 编辑期生成器，产出显式 `datasets` 写回 DSL | 运行可复现、可 diff、可审计；运行期不引入随机性 |
| 断言语言 | `assert` 用 `matcher`，picker 用 `expect` 对象 | 统一为 `WaitSignal`，`assert` / `expect` 都是信号 | 等待与断言共用一套编译器，减少两套语义漂移 |
| 数据集存储 | DSL 内数据集 | DSL 内联，单流程上限 500 行；大集后续再拆外部表 | v1 保证流程自包含与版本可回溯 |
| 目标复用 | 每个节点持有 `targetRef` | v1 不做跨流程目标库，M5 做节点级策略修复 | 先闭环“单点修复”，避免过早引入目录同步问题 |
| 直播画面 | 未要求 | v1 不做 screencast，保留失败截图 + trace + ARIA 快照 | 直播是主要 CPU 抖动源，溯源已足够定位问题 |

---

## 1. 目标与成功标准

| 编号 | 用户痛点 | 落地回答 | 可验收标准 |
|---|---|---|---|
| P1 | 表单唯一字段无法重复录入 | 类型化取值绑定 + 唯一值生成器 + 唯一值账本 + 提交后重复检测回退 | 同一流程连续跑 10 次唯一字段零冲突；预置冲突时自动换值重跑并留下 attempt 记录 |
| P2 | select / 弹窗 / 筛选需要等渲染，配置困难 | `picker` 复合节点 + 阶段化等待链 + 四类就绪信号 + 等待预设 | 夹具中“1.2s 异步下拉 + 关键字筛选 + 多选 + 弹窗保存”“三条件筛选面板”全部仅靠配置跑通，配置中无 sleep、无 `networkidle` |
| P3 | 系统增删字段后流程全部要重调 | 有序定位策略 + `HEALED` 降级事件 + 失败快照 + 策略替换工作台 | 改掉一个 label 后，运行记录降级或失败；在 M5 工作台替换一条策略后同节点恢复，不重录整条流程 |
| P4 | 用户描述到可执行之间断裂 | Flow DSL + 就绪度分级 + L2 探测运行 + 画布 / 采集 / AI 草稿三种入口 | L2 即可试运行；缺口清单可点击定位；草稿导入有结构化预览与差异 |
| P5 | 执行后说不清提交了什么 | 节点级 / 阶段级溯源 + 数据表 + 业务请求体 + 断言实际值 | 每次运行可导出「字段 → 期望值 → 实际值 → 请求体 → 状态」 |
| P6 | Playwright 执行时页面加载慢、卡顿 | 浏览器进程复用 + 每系统常驻标签页 + `domcontentloaded`/`domStable` 就绪 + 按需资源拦截 + 取证成本控制 | 夹具 8 节点 / 3 次导航 ≤ 25s；第二次运行无浏览器冷启动；长轮询页面不会因等待 idle 卡死 |

次要目标：跨系统长流程、登录态复用、失败可诊断、失败现场可继续、运行产物可回放、流程版本可回溯。

---

## 2. 非目标（v1 明确不做）

- 不做团队共享服务：不做账号、权限、多租户、远程协同；API 只监听 `127.0.0.1`。
- 不做任意图灵完备的流程：节点图是**无环有向图（DAG）**，v1 不支持循环、重试子图、动态节点生成。
- 不做“一键录制生成完整流程”：录制只产出候选交互簇与草稿，分支 / 数据集 / 负向期望仍需用户表达。
- 不生成、不解析 Playwright 代码，不依赖 `playwright codegen`，不调用 `agent-browser` CLI。
- 不做默认 `waitForTimeout` / `networkidle`：lint 直接拒绝；仅允许显式信号。
- 不做静默自愈：后备策略命中只记录 `HEALED`，绝不自动改写配置。
- 不让 AI 输出直接落库或自动运行：必须经 `needsConfirm` 与探测回放。
- 不做 screencast 直播、视频录制；保留失败截图、ARIA 快照、trace。
- 不做跨流程目标库、运行结果 diff、API 压测、安全渗透测试。
- 不做生产环境无人值守的默认授权：默认只面向测试环境。

---

## 3. 设计原则与硬约束

1. **DSL 是唯一源头**：画布、录制器、AI、导入接口都只生产同一种 `dslVersion: "1.0"` 的 JSON；画布布局单独存储。
2. **执行细节不进流程逻辑**：节点只声明“做什么、需要什么数据”；selector 字符串、Playwright 语法、等待时长不写进业务字段。
3. **等待是一等配置**：显式声明就绪信号；`picker` 的阶段时序知识收进适配器，不允许用户在每一步手填 sleep。
4. **定位是一组有序候选**：`testid → role+可访问名 → label → placeholder → text → name/id → 稳定 CSS → XPath`；默认严格匹配，命中多个即失败。
5. **复合交互是一等节点**：`picker` 统一承载 inline / dialog、筛选、多选、提交、回填断言。
6. **数据声明式**：唯一字段绑定生成器；约束在展开后、执行前统一求值；实际值写入溯源。
7. **就绪度分级**：L2 可探测试运行，L3 可单路径执行，L5 可跑矩阵；缺口可见、可点击修复。
8. **AI 可选、受控**：核心链路纯规则；AI 关闭时功能完整，开启时输出必须确认 + 回放。
9. **可复现**：流程版本不可变、数据集显式、随机种子记录、实际取值快照落库。
10. **本地优先**：单用户、单机、SQLite、数据目录可整体备份。

---

## 4. 总体架构

### 4.1 进程与职责

```
┌────────────────────────────────────────────────────────────────────┐
│ apps/web  React 19 + Vite 8 + React Flow 12                        │
│ 系统 / 流程画布 / 检查器 / 数据集 / 运行溯源 / 矩阵 / 修复工作台     │
└───────────────┬──────────────────────────────────┬─────────────────┘
                │ REST (JSON)                      │ WebSocket
┌───────────────▼──────────────────────────────────▼─────────────────┐
│ apps/api  Hono 4（127.0.0.1:8787，生产托管 dist/web）               │
│ 路由 + zod 校验 / Flow 编译 / 队列 / 事件转发 / DB 写入 / 产物索引   │
│ SQLite (Drizzle) + data/artifacts + data/recordings + data/sessions │
└───────┬─────────────────────────────────────────┬──────────────────┘
        │ fork + IPC（事件、记录、唯一值预留）      │ fork + IPC
┌───────▼──────────────────┐            ┌──────────▼─────────────────┐
│ Run Worker               │            │ Inspector Worker           │
│ Playwright chromium      │            │ Playwright headed chromium │
│ 默认 headless            │            │ 拾取 / 录制 / 登录 / 探测   │
│ BrowserPool + 串行队列    │            │ 独立 profile               │
└───────┬──────────────────┘            └──────────┬─────────────────┘
        └──────────────► 目标系统 A / B / C ◄───────┘
```

| 进程 | 数量 | 职责 | 不做什么 |
|---|---|---|---|
| API | 1 | 校验、编译、就绪度、队列、DB 写入、WS、静态资源 | 不驱动浏览器 |
| Run Worker | 0/1（懒启动，串行） | 解释执行编译后的 plan，写截图 / trace，发事件 | 不直接写 DB |
| Inspector Worker | 0/1（同一时刻一个会话） | headed 浏览器、元素拾取、录制、手动登录、target 试探 | 不写 DB |

- SQLite 只有 API 进程写；worker 通过 IPC 发送结构化记录，API 批量落库，避免跨进程锁。
- Run Worker 内维护 BrowserPool：Chromium 进程跨运行复用，空闲 10 分钟回收；每次运行新建 `BrowserContext`，每个 system 一个常驻 `Page`。
- 运行并发默认 1：表单测试共享同一套业务数据，并发会制造唯一冲突、顺序依赖与 CPU 争抢。
- 取消运行：API 发 `{ type: "cancel" }`，worker 在节点 / 阶段边界检查 `AbortSignal` 并优雅关闭 context。

### 4.2 数据流

```
画布编辑 ──► DSL 草稿 ──► 校验 / 就绪度 ──► 发布版本（不可变）
                                                    │
数据集行 ──► 数据解析（生成器/约束） ──► 编译 Plan ──► Run Worker ──► 节点/阶段溯源
                                                    │
录制事件 ──► 阶段切分 ──► 簇 ──► DSL 草稿 ──► 探测回放 ──► 确认落库
                                                    │
AI 描述 ──► DSL 草稿 / 条件建议 ──► 校验 ──► 预览/差异 ──► 确认落库
```

### 4.3 关键边界

- **编译产物不持久化为可编辑数据**：每次运行重新编译，运行记录里保存 `compiled-plan.json` 快照用于审计。
- **画布不是执行模型**：React Flow 的坐标、缩放、选中态属于 `layout_json`；DSL 只描述节点与边。
- **采集器不是执行器**：采集只产出原始事件与草稿；执行永远走 DSL → 编译 → 解释器。
- **AI 不是编译器**：AI 只产出候选 DSL / 条件，校验与回放由平台完成。

---

## 5. Flow DSL

### 5.1 文档骨架

```ts
type FlowDsl = {
  dslVersion: "1.0";
  meta: { name: string; description?: string; tags?: string[] };
  systems: System[];
  defaults: {
    nodeTimeoutMs?: number;       // 默认 15000
    pickerTimeoutMs?: number;     // 默认 30000
    screenshot?: "onFailure" | "always" | "never";
    resourcePolicy?: "balanced" | "fast" | "accurate";
    trace?: boolean;
    onDuplicate?: DuplicatePolicy;   // 见 9.5
  };
  vars?: Record<string, ValueExpr>;
  datasets?: Dataset[];
  constraints?: Constraint[];
  nodes: Node[];
  edges: Edge[];
  entry: string;                  // 起始节点 id
};
```

约束：`nodes` 至少 1 个；`entry` 必须存在；节点 id 为稳定 kebab-case；边无环；所有节点从 `entry` 可达。

### 5.2 节点类型

| 类型 | 语义 | 关键字段 |
|---|---|---|
| `navigate` | 跳转并等待页面就绪 | `url`（可含模板）、`waitUntil`、`readySignal` |
| `interact` | 原子交互 | `adapter`、`target`、`value` / `checked` / `key`、`verify` |
| `picker` | 复合选择器 | `mode`、`trigger`、`panel`、`filter`、`pick`、`commit`、`expect` |
| `wait` | 显式等待点 | `condition` |
| `assert` | 断言 | `condition`、`message` |
| `branch` | 条件分支 | `condition`（引用数据集列 / 变量） |
| `api` | 接口调用（混合策略） | `method`、`url`、`body`、`expectStatus`、`extract` |

所有节点通用字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 稳定 id，运行记录、补丁、差异都依赖它 |
| `type` | 是 | 上表枚举 |
| `name` | 否 | 画布展示名 |
| `system` | 浏览器节点必填 | 决定 baseUrl、鉴权与页面归属；`branch` 可省略 |
| `enabled` | 否 | 默认 true；禁用节点在编译时被跳过并告警 |
| `timeoutMs` | 否 | 节点总预算；`picker` 默认取 `defaults.pickerTimeoutMs` |
| `pre` | 否 | 动作前等待信号数组 |
| `expect` | 否 | 动作后等待 / 断言信号数组 |
| `meta.sourceText` | 否 | 用户描述句，用于“描述 ↔ 节点”追溯 |
| `meta.needsConfirm` | 否 | 待确认项标记，编辑器高亮 |

### 5.3 边与执行语义

```json
{ "edges": [
  { "from": "open", "to": "new" },
  { "from": "check-amount", "to": "approve", "when": "then" },
  { "from": "check-amount", "to": "save", "when": "else" }
] }
```

- `edge.when` 只允许出现在 `branch` 节点的出边，值为 `"then"` / `"else"`。
- `branch` 必须有且只有两条出边；其它节点最多一条出边；允许多条入边汇聚（merge）。
- 执行器从 `entry` 开始，节点完成后沿唯一出边前进；`branch` 求值后选择一条。
- 无环；重复执行同一段逻辑通过复制节点表达（v1 不做循环）。
- `branch` 的 `then` / `else` 分支最终应汇聚到同一后继，避免出现“悬空终点”；校验器对未汇聚分支给出 warning。

### 5.4 目标定位 `TargetRef`

```ts
type TargetRef = {
  label?: string;                         // 人类可读名，用于溯源
  strategies: Strategy[];                 // 有序，至少 1 条
  fingerprint?: {                         // 采集器产出的语义指纹
    tag?: string; role?: string; visibleText?: string;
    anchorText?: string; testid?: string; name?: string; placeholder?: string;
  };
  strict?: boolean;                       // 默认 true：命中多个可见元素即失败
  nth?: number;                           // 显式序号（0 基）
  scope?: TargetRef;                      // 容器范围（弹窗、表格行、局部表单）
  frame?: { urlContains?: string } | { name?: string };
};

type Strategy =
  | { type: "testid"; value: string }
  | { type: "role"; role: string; name?: string; exact?: boolean }
  | { type: "label"; value: string; exact?: boolean }
  | { type: "placeholder"; value: string }
  | { type: "text"; value: string; exact?: boolean }
  | { type: "name"; value: string }
  | { type: "css"; value: string }
  | { type: "xpath"; value: string };
```

- 顺序固定为：`testid → role → label → placeholder → text → name → css → xpath`；编辑器允许拖动，但默认按稳定性排序。
- 只有 CSS / XPath 的 target 产生 lint warning；导入的 DSL 也允许，但运行失败时优先提示“补语义策略”。
- `scope` 先解析容器，再在容器内解析目标；`frame` 用于 iframe。
- `strict: false` 只允许探测模式或显式用户选择，正常运行时记录 warning。

### 5.5 Picker 复合选择器

```ts
type PickerNode = NodeBase & {
  type: "picker";
  mode: "inline" | "dialog";
  trigger: TargetRef;
  panel: {
    scope: { type: "dropdown" | "dialog"; name?: string; target?: TargetRef };
    readySignal?: SignalRef;              // 默认 "content-stable"
    optionResponse?: {                    // 选项由接口填充时，先等接口
      urlContains: string; method?: "GET" | "POST"; status?: number;
    };
  };
  filter?: {
    steps: Array<{
      adapter: "input" | "click" | "check" | "nativeSelect";
      target: TargetRef;
      value?: ValueExpr;
      checked?: boolean;
    }>;
  };
  pick: {
    strategy: "byText" | "byRow" | "byCondition" | "all";
    byText?: { column?: string; value?: ValueExpr; match?: "exact" | "contains" };
    byRow?: { keyColumn: string; keyValue?: ValueExpr; rowTarget?: TargetRef; clickTarget?: TargetRef };
    byCondition?: { columns: Record<string, TargetRef>; condition: ConditionExpr }; // M3
    multi?: boolean;
  };
  commit?: { adapter: "click"; target: TargetRef; waitHidden?: boolean };  // dialog 推荐
  stageTimeouts?: {
    openMs?: number; panelMs?: number; filterMs?: number;
    refreshMs?: number; pickMs?: number; commitMs?: number;
  };
};
```

`mode` 与阶段：

| 阶段 | `inline` | `dialog` | 默认超时 | 核心信号 |
|---|---|---|---|---|
| 1 打开 | trigger 可交互 → click | 同左 | `openMs` 3000 | trigger visible + enabled |
| 2 面板就绪 | listbox visible + 选项区 DOM 稳定 | dialog visible + 内容非骨架屏 + DOM 稳定 | `panelMs` 5000 | `panel.readySignal` / `optionResponse` |
| 3 筛选 | 逐项填 / 选，回读一致 | 同左 | `filterMs` 3000 / 项 | 元素可交互 + 值回读 |
| 4 列表刷新 | loading 消失 / 列表 DOM 稳定 / 匹配接口 | 同左 | `refreshMs` 12000 | 三选一，`any` 组合 |
| 5 选择 | 目标选项可交互 → click | 同左 | `pickMs` 3000 / 项 | 选项匹配唯一 |
| 6 提交 | 通常无 | 点保存 → dialog hidden | `commitMs` 5000 | 面板隐藏 |
| 7 回填断言 | trigger 值等于选择值 | 同左 | 3000 | `expect` 信号 |

- `byText` 默认精确匹配（trim + 折叠空白）；命中多个即失败并列出候选；`contains` 需显式声明。
- `byRow` 先按 `keyColumn` 找到唯一行，再点击行本身或 `clickTarget`（如行内勾选框）。
- `all` 仅用于多选全选；与 `multi: true` 搭配。
- `byCondition` 在 M3 实现：先按 `columns` 抽取行内单元格文本，再对条件求值；无法从单次录制推断，必须人工配置。
- `commit` 可省略：选项点击即关闭的弹窗走“panel hidden”等待；有保存按钮的 dialog 必须配置 `commit`，否则 lint warning。
- 多选循环中，每选一项后重新等待列表稳定；面板关闭则重开；有筛选则重新填筛选值并回读。

### 5.6 等待信号 `WaitSignal`

```ts
type WaitSignal =
  | { kind: "visible" | "hidden" | "attached" | "enabled"; target: TargetRef; timeoutMs?: number; optional?: boolean }
  | { kind: "count"; target: TargetRef; min?: number; max?: number; equals?: number; stableMs?: number; timeoutMs?: number }
  | { kind: "text"; target: TargetRef; equals?: string | ValueExpr; contains?: string; timeoutMs?: number }
  | { kind: "value"; target: TargetRef; equals: string | ValueExpr; timeoutMs?: number }
  | { kind: "url"; matches: string; timeoutMs?: number }
  | { kind: "response"; urlContains: string; method?: string; status?: number | number[]; timeoutMs?: number }
  | { kind: "domStable"; target?: TargetRef; quietMs?: number; maxMs?: number; optional?: boolean }
  | { kind: "loaderGone"; target: TargetRef; timeoutMs?: number }
  | { kind: "all" | "any"; of: WaitSignal[] };

type SignalRef = WaitSignal | WaitPresetName;
```

内置预设（编译时展开，可在 M3 编辑）：

| 预设 | 展开 |
|---|---|
| `page-ready` | `domStable(quiet 600ms, max 8000ms)` + 可选关键元素 visible |
| `content-stable` | `domStable(quiet 200ms, max 8000ms)` |
| `list-ready` | 可选 `response` + `count(min 1)` + 数量稳定 400ms |
| `dialog-ready` | `visible(role=dialog)` + scope attached + `domStable` |
| `option-ready` | listbox visible + 选项数量稳定 300ms |
| `save-ready` | 写请求 `response` + toast visible |

约束：

- 禁止 `waitForTimeout`、`networkidle`、固定 sleep；DSL 没有这些字段，lint 也不接受未知 kind。
- `response` 条件在动作**之前**注册监听；`expect` 中的 `response` 由执行器预注册，避免竞态。
- `optional: true` 的条件失败只记 warning；`domStable` 超时按“尽力而为”放行并记 warning（长轮询页面）。
- 条件超时与节点总预算同时生效；失败报告“哪一段吃掉了预算”。

### 5.7 取值、数据集与约束

```ts
type ValueExpr =
  | { kind: "literal"; value: unknown }
  | { kind: "var"; name: string }
  | { kind: "template"; template: string }
  | { kind: "dataset"; column: string }
  | { kind: "env"; name: string }
  | { kind: "ref"; nodeId: string; output: "value" | "text" | "attribute"; attribute?: string }
  | { kind: "generator"; type: GeneratorType; scope?: string; template?: string; unique?: boolean; options?: Record<string, unknown> };

type GeneratorType =
  | "unique.text" | "unique.email" | "unique.phone" | "unique.orderNo"
  | "faker.name" | "faker.email" | "faker.phone" | "faker.company" | "faker.idCard"
  | "sequence";
```

简写归一：`{ "gen": "unique.email" }` → `{ kind: "generator", type: "unique.email", unique: true }`；`{ "gen": "sequence.orderNo" }` → `{ kind: "generator", type: "sequence", scope: "orderNo" }`；`{ "gen": "faker.name" }` → 对应 faker 类型。普通标量视为 `literal`。

模板命名空间只允许：`{{vars.x}}`、`{{run.id}}`、`{{run.shortId}}`、`{{run.startedAt}}`、`{{seq.x}}`、`{{sys.baseUrl}}`、`{{env.NAME}}`。不支持任意 JS 表达式。

```json
{
  "datasets": [
    { "id": "normal", "name": "普通", "columns": { "region": "华东区", "amount": 100, "email": { "gen": "unique.email" } } },
    { "id": "large", "name": "大额", "columns": { "region": "华南区", "amount": 5000, "email": { "gen": "unique.email" } } }
  ],
  "constraints": [
    { "type": "equals", "left": "password", "right": "confirmPassword" },
    { "type": "derive", "target": "username", "from": "email", "op": "localPart" },
    { "type": "unique", "field": "orderNo", "gen": "sequence.orderNo" },
    { "type": "range", "field": "amount", "min": 0, "max": 100000 },
    { "type": "regex", "field": "phone", "pattern": "^1\\d{10}$" },
    { "type": "oneOf", "field": "region", "values": ["华东区", "华南区"] }
  ]
}
```

- 约束类型：`equals / derive / unique / range / regex / oneOf`；不支持自定义代码。
- 约束在数据集展开、变量生成之后、浏览器启动之前求值；不通过则本次运行快速失败，不产生脏数据。
- `derive.op` 支持：`localPart / domain / prefix / suffix / concat / hash`；`hash` 只用于非安全场景。

### 5.8 分支与接口节点

```json
{ "id": "branch-amount", "type": "branch", "condition": { "op": "gt", "left": { "column": "amount" }, "right": 1000 } }
```

条件操作数：`{ "column": "..." }`、`{ "var": "..." }`、`{ "value": ... }`。操作符：`eq / neq / gt / gte / lt / lte / in / contains / exists / and / or / not`。

```json
{
  "id": "fetch-id",
  "type": "api",
  "system": "crm",
  "method": "GET",
  "url": "/api/customers?name={{vars.customerName}}",
  "expectStatus": 200,
  "extract": { "customerId": "$.data.id" }
}
```

- `api` 使用 `context.request`，复用当前系统 cookies / storageState。
- 默认只允许同 system origin；跨域需在系统配置的 `allowedOrigins` 显式声明。
- `extract` 仅支持安全 JSONPath 子集（`$.a.b[0]`），不支持脚本执行；结果写入运行变量，供后续 `{ "kind": "ref" }` 引用。
- 响应体超过 2MB 截断；敏感字段按 `secret` 标记脱敏。

### 5.9 完整示例

```json
{
  "dslVersion": "1.0",
  "meta": { "name": "CRM 建档并按金额分支", "tags": ["crm"] },
  "systems": [
    { "id": "crm", "name": "CRM", "baseUrl": "http://127.0.0.1:4100", "auth": { "kind": "storageState" } }
  ],
  "defaults": { "nodeTimeoutMs": 15000, "pickerTimeoutMs": 30000, "screenshot": "onFailure", "resourcePolicy": "balanced" },
  "vars": {
    "customerName": {
      "kind": "generator", "type": "unique.text", "scope": "crm.customer.name",
      "template": "自动客户-{{seq.customer}}-{{run.shortId}}", "unique": true
    }
  },
  "datasets": [
    { "id": "normal", "name": "普通", "columns": { "amount": 100, "region": "华东区" } },
    { "id": "large", "name": "大额", "columns": { "amount": 5000, "region": "华南区" } }
  ],
  "constraints": [
    { "type": "range", "field": "amount", "min": 0, "max": 100000 }
  ],
  "nodes": [
    { "id": "open", "type": "navigate", "name": "打开客户列表", "system": "crm", "url": "/customers", "readySignal": "page-ready" },
    {
      "id": "new", "type": "interact", "name": "打开新建弹窗", "system": "crm", "adapter": "click",
      "target": { "label": "新建客户", "strategies": [
        { "type": "role", "role": "button", "name": "新建客户" },
        { "type": "testid", "value": "customer-new" }
      ] },
      "expect": [{ "kind": "visible", "target": { "label": "客户名称", "strategies": [{ "type": "label", "value": "客户名称" }] } }]
    },
    {
      "id": "fill-name", "type": "interact", "name": "填写唯一客户名", "system": "crm", "adapter": "input",
      "target": { "label": "客户名称", "strategies": [{ "type": "label", "value": "客户名称" }] },
      "value": { "kind": "var", "name": "customerName" }, "verify": "readBack"
    },
    {
      "id": "pick-region", "type": "picker", "name": "选择所属区域", "system": "crm", "mode": "dialog",
      "trigger": { "label": "所属区域", "strategies": [{ "type": "label", "value": "所属区域" }] },
      "panel": {
        "scope": { "type": "dialog" }, "readySignal": "content-stable",
        "optionResponse": { "urlContains": "/api/regions", "method": "GET", "status": 200 }
      },
      "filter": { "steps": [
        { "adapter": "input", "target": { "placeholder": "搜索区域", "strategies": [{ "type": "placeholder", "value": "搜索区域" }] }, "value": { "kind": "dataset", "column": "region" } }
      ] },
      "pick": { "strategy": "byText", "byText": { "column": "region", "match": "exact" } },
      "commit": { "adapter": "click", "target": { "label": "保存", "strategies": [{ "type": "role", "role": "button", "name": "保存" }] } },
      "expect": [{ "kind": "text", "target": { "label": "所属区域", "strategies": [{ "type": "label", "value": "所属区域" }] }, "equals": { "kind": "dataset", "column": "region" } }]
    },
    { "id": "branch-amount", "type": "branch", "name": "金额是否大额", "condition": { "op": "gt", "left": { "column": "amount" }, "right": 1000 } },
    {
      "id": "approve", "type": "interact", "name": "标记需要审批", "system": "crm", "adapter": "check",
      "target": { "label": "需要审批", "strategies": [{ "type": "label", "value": "需要审批" }] }, "checked": true
    },
    {
      "id": "save", "type": "interact", "name": "保存客户", "system": "crm", "adapter": "click",
      "target": { "label": "保存", "strategies": [{ "type": "role", "role": "button", "name": "保存" }] },
      "expect": [
        { "kind": "response", "urlContains": "/api/customers", "method": "POST", "status": 200 },
        { "kind": "text", "target": { "label": "提示", "strategies": [{ "type": "text", "value": "保存成功" }] }, "contains": "保存成功" }
      ]
    }
  ],
  "edges": [
    { "from": "open", "to": "new" },
    { "from": "new", "to": "fill-name" },
    { "from": "fill-name", "to": "pick-region" },
    { "from": "pick-region", "to": "branch-amount" },
    { "from": "branch-amount", "to": "approve", "when": "then" },
    { "from": "branch-amount", "to": "save", "when": "else" },
    { "from": "approve", "to": "save" }
  ],
  "entry": "open"
}
```

### 5.10 就绪度分级

| 等级 | 定义 | 可执行模式 |
|---|---|---|
| L0 意图 | 只有自然语言 / 原始事件，没有完整节点图 | 不可运行 |
| L1 骨架 | 有节点与边，但存在 target 无策略或值未绑定 | 不可运行 |
| L2 定位 | 每个 target 至少 1 条策略；值可为临时占位 | **探测运行（probe）** |
| L3 数据 | 所有必填值可解析、约束通过、无未解析引用 | 单路径运行（single） |
| L4 等待 | 所有 `navigate` / `picker` / 关键 `interact` 有显式或预设信号；无等待 lint error | 稳定单路径运行 |
| L5 组合 | ≥1 个数据集，约束 / 分支覆盖已计算，矩阵可生成 | 矩阵运行（matrix） |

`computeReadiness(dsl)` 返回 `{ level, gaps[] }`，每个 gap 带 `nodeId / path / severity / message / fix`。编辑器实时显示；服务端在保存、发布、运行时以服务端结果为准。

- L2 是“意图 → 可执行”的关键闸门：允许在定位未完全验证时试运行，失败以“待确认清单”返回。
- L3 不要求有数据集；流程变量 + 字面值可支撑单路径。
- L5 的分支覆盖只做静态可判定的部分；引用了生成器 / 运行时变量的条件标注“无法静态判定”，不阻塞矩阵。
- 发布要求 L4；L5 缺失只提示“尚未形成组合覆盖”。

### 5.11 校验与 lint

| 级别 | 规则 |
|---|---|
| error | 无 `entry`、存在环、不可达节点、重复节点 id、未知 system、target 无策略、未知变量 / 数据集列、模板命名空间非法、picker 缺 trigger / panel / pick、branch 出边不是恰好两条 then/else、api 跨域未授权、未知节点类型 |
| error | 使用 `waitForTimeout` / `networkidle` / 未知等待 kind |
| warning | target 只有 CSS 或 XPath；`strict: false`；dialog picker 无 `commit`；`submit` 类 click 无 `expect`；branch 一侧无数据集覆盖；节点预算大于流程预算；数据集行数超 500；异步列表无业务 `response` 信号（建议补） |
| info | 使用内置等待预设；生成器值未加 `unique`；步骤超过 10s |

校验错误统一用 JSON Pointer 定位（如 `/nodes/3/target/strategies`）。

---

## 6. 执行引擎

### 6.1 生命周期

`queued → preparing → running → finished | failed | canceled`

- **preparing**：加载不可变版本 → 解析数据集行 → 生成器 / 约束求值 → 编译 `ExecutablePlan` → 取系统会话态 → 从 BrowserPool 取 Chromium（仅首次冷启动）→ 新建 `BrowserContext` → 应用鉴权 → 为每个 system 建立常驻 `Page`。
- **running**：沿边执行节点；每个节点 / 阶段 / 定位 / 取值 / 等待耗时通过 IPC 上报（100ms 合批）；截图与 trace 写入 `data/artifacts/<runId>/`。
- **结束**：停止 trace、关闭 `BrowserContext`、浏览器归还池、汇总数据表与性能数据；失败时写 `failure.json`。
- **模式**：`probe`（L2 探测）、`single`（单数据集）、`matrix`（批量数据集）、`replay`（录制回放验证）。

### 6.2 编译

```ts
compile(dsl, datasetCase, settings) → {
  plan, errors, warnings, readiness
}
```

- 归一化简写（`gen`、标量值、target 字符串引用）。
- 展开等待预设；校验模板命名空间。
- 把 `picker` 展开为阶段计划（仍是结构化对象，不是 Playwright 代码）。
- 解析 `system` → `Page` 映射；冻结 `entry` 与可达节点。
- 数据值保留为 `ValueExpr`，由运行期数据解析器展开（生成器 / 账本 / 序列）。
- 编译结果可查看；运行记录保存 `compiled-plan.json` 快照。

### 6.3 定位解析 `LocatorResolver`

```text
resolve(target, page, scope):
  attempts = []
  for (index, strategy) of target.strategies:
    locator = build(strategy, scope, frame)
    count = await locator.count() with min(2000ms, remaining budget)
    if count == 1: return { locator, index, healed: index > 0 }
    if count > 1:
      if target.nth != null: return nth
      attempts.push({ index, strategy, count, ambiguous: true })
    else:
      attempts.push({ index, strategy, count: 0 })
  if target.strict != false:
    fail with attempts + similarElements()
  return first visible with warning
```

- 默认严格：同一策略命中多个可见元素即视为歧义，继续尝试下一档；全部歧义则失败。
- 命中后等 actionability（可见、稳定、可接收事件）；点击类动作额外等 `enabled`。
- 记录 `{ strategy, index, matchCount, durationMs }` 到 `run_nodes.resolved_target_json`。
- 后备策略命中 → 记录 `HEALED` 事件；置信度按 `max(0.5, 0.95 - 0.1 * index)` 计算，仅作提示，不自动改配置。
- 全部失败 → 保存 ARIA 快照、截图、DOM 片段，并用可访问名相似度给出 top 5 相似元素；`probe` 模式暂停等待人工确认，`single` / `matrix` 模式标记失败并保留现场。
- 基于 fingerprint 的打分修复作为可选候选生成器：只在失败时给出建议，不自动应用；M5 可插拔。
- `target.nth` 在 strict 下用于显式消除歧义；没有 `nth` 不允许“盲点第一个”。

### 6.4 等待编译 `WaitCompiler`

| 信号 | 实现 | 说明 |
|---|---|---|
| `visible / hidden / attached` | `locator.waitFor({ state })` | 元素状态 |
| `enabled` | `waitForFunction` 检查 `disabled` | 按钮 / 选项可操作 |
| `count` | 轮询 `locator.count()`，连续 `stableMs` 一致 | 列表 / 选项数量稳定 |
| `text` | `waitForFunction` 读 `innerText` / `textContent` | `equals` 接受 ValueExpr |
| `value` | 读 input value | 回读校验 |
| `url` | `page.waitForURL` | 子串或正则 |
| `response` | 动作前 `page.waitForResponse` | 预注册，避免竞态 |
| `domStable` | 注入探针 + `waitForFunction` | 长轮询超时放行 |
| `loaderGone` | 加载指示器 `hidden` | 通用兜底 |
| `all / any` | Promise.all / Promise.race | 分支清理，避免悬挂监听 |

DOM 稳定探针（注入到所有 frame）：

```js
window.__ffWaitStable = (selector, quietMs = 200, maxMs = 8000) =>
  new Promise((resolve) => {
    const root = selector ? document.querySelector(selector) : document.body;
    if (!root) return resolve(false);
    let quietTimer, hardTimer;
    const done = (ok) => { obs.disconnect(); clearTimeout(quietTimer); clearTimeout(hardTimer); resolve(ok); };
    const obs = new MutationObserver(() => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => done(true), quietMs);
    });
    obs.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
    quietTimer = setTimeout(() => done(true), quietMs);
    hardTimer = setTimeout(() => done(false), maxMs);
  });
```

- 每个条件独立超时；节点总预算到达即失败，报告阶段拆分。
- `response` 的等待在动作**之前**注册；`expect` 中的 `response` 由执行器在动作前预挂载。
- `domStable` 超时放行记 warning，不把长轮询页面判死。
- 导航失败、页面崩溃、`pageerror` 导致页面不可用 → fast-fail，不空等剩余预算。
- `navigate.waitUntil` 默认 `domcontentloaded`；默认 `readySignal: "page-ready"`；当前 URL 已匹配时默认跳过重复导航。

### 6.5 Picker 执行

执行器按 5.5 的阶段表逐段执行，每段独立超时并写入 `stage_timings`：

- 打开阶段若面板未出现，按 `openRetry`（默认 1）重试一次，并记录 attempt。
- 面板阶段同时等待 `panel.readySignal` 与 `optionResponse`（若配置）；`any` 语义下谁先就绪用谁。
- 筛选阶段每步 `readBack` 校验；筛选后等待列表刷新信号。
- 选择阶段枚举选项 / 行；`byText` 精确匹配；命中 0 个 → `PICK_NO_MATCH`（列出前 10 个候选文本）；命中多个 → `PICK_AMBIGUOUS`（列出候选）。
- 多选：逐项选择；面板关闭则重开；有筛选则重填并回读；每项记录耗时与命中文本。
- 提交阶段点击保存并等 `dialog hidden`；没有 `commit` 的 dialog 等待面板关闭。
- 回填断言读取 trigger 的输入值 / 文本，与选择值比较；不一致记 `PICK_BACKFILL_MISMATCH`。
- 负向用例在对应阶段失败，错误码明确：`FILTER_NO_RESULT`、`PICK_NO_MATCH`、`PICK_AMBIGUOUS`、`COMMIT_TIMEOUT`、`BACKFILL_MISMATCH`，不是笼统超时。

### 6.6 数据解析

见第 9 节。执行器只消费 `ResolvedData`：

```json
{
  "datasetId": "large",
  "values": { "customerName": "自动客户-1042-a1b2", "region": "华南区", "amount": 5000 },
  "provenance": { "customerName": { "source": "unique.text", "scope": "crm.customer.name", "ledgerKey": "..." } },
  "seed": 1729930000
}
```

### 6.7 分支与接口

- `branch` 在节点边界同步求值；条件引用缺失列 / 变量 → `BRANCH_EVAL_FAILED`，不猜测。
- `api` 使用 `context.request`，复用 cookies；`extract` 结果写入运行变量；跨域白名单不通过直接失败。
- 接口响应只存状态码、截断响应体、脱敏后的请求体；不存完整敏感响应。

### 6.8 探测运行与增量运行

**探测运行（L2）**：

- 目标解析歧义 / 零命中时暂停，发送 `needs_confirm` 事件：截图、候选元素、候选策略、当前 target。
- 缺失数据绑定或 `needsConfirm` 的取值 → 暂停并给出候选（数据集列 / 生成器 / 字面值）。
- 缺失等待信号 → 不暂停，使用预设并记录建议。
- 用户确认 / 跳过；确认结果只作为本次运行的临时覆盖，**不自动写回** DSL。
- 运行结束返回“待确认清单”，用户可逐项应用到草稿。

**运行到此节点**：

- `POST /runs` 带 `stopAtNodeId`；从 `entry` 执行到该节点，复用本次运行的 context 与已填充状态；秒级反馈。
- 运行到此节点会重放前缀；若前缀包含提交 / 危险点击，UI 明确提示副作用，建议在测试环境或只跑到提交前。
- 目标节点不在当前分支路径 → 返回 `NOT_REACHED`，并给出实际路径。

**失败现场继续**（M5）：

- 失败后保留 `BrowserContext` 5 分钟（可配）；用户修改节点后 `POST /runs/:id/resume`，服务端重编译并从失败节点继续。
- context 已失效 → 明确提示“只能从起点重跑”，不做虚假续跑。

### 6.9 取消、失败与上下文

- 取消在节点 / 阶段边界生效；关闭 context，浏览器归还池。
- worker 崩溃：API 标记运行失败，保留已落库事件；同一运行最多自动重试 1 次（仅基础设施错误）。
- 失败产物：`failure.json`（候选探测、相似元素、阶段耗时）、截图、ARIA 快照、`trace.zip`。
- 失败节点之后的节点标记 `skipped`，矩阵中显示为 `—`。

### 6.10 性能治理

| 卡顿来源 | 现象 | 措施 |
|---|---|---|
| 浏览器冷启动 / 每命令子进程 | 运行前白屏数秒；动作间卡顿 | BrowserPool 复用 Chromium；Playwright 库进程内调用；禁止 spawn CLI |
| 导航等待策略 | `load` / `networkidle` 等重资源 | 默认 `domcontentloaded` + `page-ready`；禁用 networkidle；导航错误 fast-fail |
| 跨系统来回切换 | 每步整页加载 | 每个 system 常驻标签页；系统内走真实页面路径；同 URL 跳过重复导航 |
| 重资源 | 图片 / 字体 / 埋点拖慢首屏 | `balanced`（默认，拦埋点 / 媒体）、`fast`（再拦图片字体）、`accurate`（不拦）；按 URL 正则 + 域名白名单拦截并计数，不做全局 `route('**/*')` |
| 动画 / 过渡 | 元素坐标不稳 | 默认 `reducedMotion: "reduce"`；不注入全局 CSS 破坏真实行为 |
| 截图 / trace | CPU 抖动 | 默认仅失败截图；trace 只 snapshots；不启用 screencast / video |
| 长轮询 / SSE | `networkidle` 永不触发 | 业务信号（response / 关键元素 / 数量稳定）；`domStable` 超时放行 |
| 等待条件串行 | 多个超时叠加 | 每段独立预算；可并行条件并行；节点总预算 |
| 定位候选过多 | 每档探测叠加 | 每档上限 2s，命中即停；仅失败时全页相似元素扫描 |
| IPC / 前端渲染 | 高频事件卡 UI | 事件 100ms 合批；矩阵 / 列表虚拟滚动 |

性能预算（写进夹具回归）：

- 同一 Run Worker 会话内第二次运行无浏览器冷启动，取 browser < 100ms。
- 单步非等待开销（定位 + 动作）< 300ms。
- 夹具 8 节点 / 3 次导航，headless、失败截图、无 trace 时总耗时 ≤ 25s。
- 长轮询夹具不因等 idle 卡死；`domStable` 最迟 8s 放行。
- 超过 10s 的节点、超过 5min 的流程标 warning（可配）。
- 冷启动复用按同一 Run Worker 会话内的连续运行统计；CLI 单次进程不承诺跨进程复用，只测单次预算。

测量：导航、应用就绪、每段等待、定位、动作、取证分别打点，写 `run_nodes.stage_timings_json`；运行详情“性能”页展示拆分、最慢 5 个节点与预算告警。

诚实边界：目标系统服务端慢或第三方脚本慢，只能靠资源策略、页面复用、业务就绪信号缓解；平台不伪造数据、不跳过真实业务等待。性能页明确区分“目标系统 / 网络耗时”与“平台的等待与取证开销”。

---

## 7. 编辑器

### 7.1 页面

| 页面 | 内容 |
|---|---|
| 系统 | 列表、baseUrl、鉴权策略、打开检查器、保存会话、允许的跨域 |
| 流程列表 | 名称、标签、就绪度、最近运行状态、复制 / 导入 / 导出 |
| 流程编辑 | 画布 + 检查器 + 问题面板 + 运行控制 |
| 数据集 | 数据集表格、约束、组合生成器、覆盖预览 |
| 录制 | headed 浏览器、事件流、交互簇、草稿预览、回放 |
| 运行列表 | 状态、模式、数据集、时长、触发方式 |
| 运行详情 | 溯源时间线、数据表、网络、失败诊断、性能、产物 |
| 矩阵 | 数据集 × 节点状态网格、批次进度 |
| 修复 | HEALED 清单、快照查看、策略替换、修复记录 |
| 设置 | 超时、截图、trace、资源策略、浏览器池、保留天数、AI 开关 |

### 7.2 画布 ↔ DSL 双向同步

- **DSL 是唯一源头**；`layout_json` 只存 `{ nodes: { id: {x,y} }, viewport: {x,y,zoom} }`。
- React Flow 的节点 / 边由 DSL + layout 派生；任何画布操作先转换为命令，再产生 DSL / layout 变更：
  - `addNode`、`removeNode`、`updateNode`、`connect`、`disconnect`、`setEntry` → 改 DSL；
  - `moveNode`、`resize`、`viewport` → 只改 layout。
- 节点 id 生成后不可变；重命名只改 `name`，不改 `id`。
- 新节点没有 layout 坐标时用 dagre 自动分层布局；已有手动坐标保留。
- 分支节点的两个 source handle 标注 `then` / `else`；连接时强制选择标签，非分支节点只允许一个出边。
- 删除节点自动删除关联边；删除 `entry` 节点时必须先指定新 `entry`。
- 本地用共享 zod schema 实时校验；服务端在保存 / 发布 / 运行时再次校验并以服务端为准。
- 自动保存防抖 500ms；布局保存防抖 1s；单用户，版本号乐观锁，冲突提示“重新加载”。
- 撤销 / 重做保存 DSL + layout 快照（最近 50 步）；不做服务端历史（发布版本才是历史）。
- **绝不把 x/y、选中态、React Flow 内部对象写进 DSL**。

### 7.3 节点检查器

| 分区 | 内容 |
|---|---|
| 基本 | id、名称、system、启用、节点预算、`meta.sourceText` |
| 目标 | 候选策略列表（拖动排序）、拾取按钮、指纹、strict / nth / scope / frame、“测试解析” |
| 数据 | 取值绑定编辑器（字面值 / 变量 / 数据集列 / 生成器 / env / 引用）、预览本次解析值 |
| 等待 | `pre` / `expect` 信号列表、预设选择、picker 阶段超时覆盖 |
| 断言 | 文本 / 值 / 数量 / URL / 响应条件；期望值与实际值预览 |
| 元信息 | `needsConfirm` 项、来源描述、备注 |

“测试解析”只做元素探测，不执行填充 / 提交；用 Inspector 会话或短生命周期 headed 页面完成。

### 7.4 就绪度与问题面板

- 顶部徽标显示 `L2 / L3 / L4 / L5`，点击展开缺口清单。
- 每个缺口可点击定位到节点与字段；提供修复动作：
  - 补定位策略 → 打开拾取；
  - 绑定数据 → 打开数据分区 / 数据集；
  - 补等待信号 → 选择预设 / 自定义；
  - 补数据集 → 打开组合生成器。
- 问题面板同时展示 lint error / warning；运行前若有 error，运行按钮禁用。

### 7.5 数据集与约束编辑器

- 数据集表格：行 = 数据集，列 = 字段；单元格支持字面值、`{gen}`、模板；列类型与示例值可见。
- 约束列表：类型化表单；保存时即时求值预览；不通过显示具体字段。
- 组合生成器：
  - 输入因子列与取值集合；
  - 模式 `full` / `pairwise`；
  - 必测组合（mandatory rows）；
  - 随机种子；
  - 预览行数、pair 覆盖率；
  - 应用后写回 `datasets`（显式行），并记录 `meta.generatedBy` / seed。

### 7.6 执行矩阵

- 行 = 数据集，列 = 节点（按实际路径展示；未走到的节点灰显）。
- 单元格状态：`pass / fail / skipped / healed / not-reached`；失败显示错误码与阶段。
- 点击单元格 → 运行详情定位到对应节点。
- 批次顶部显示进度、成功 / 失败计数、取消按钮。
- 负向用例显示明确失败阶段（如“筛选无结果”），不聚合成“超时”。

### 7.7 溯源与修复工作台

- 时间线：节点 → 阶段 → 定位 → 动作 → 等待 → 断言；每段显示耗时、命中策略、信号类型。
- `HEALED` 独立清单：节点、原策略、后备策略、置信度、时间；支持“提升为首选”或“替换策略”。
- 快照查看：失败截图、ARIA 快照、DOM 片段、候选元素列表。
- 修复动作显式应用，生成草稿变更并记录 `repair_actions`；不自动发布、不自动运行。
- “从失败处继续”（M5）：同一 context 内续跑；context 失效明确提示。

### 7.8 录制工作台

- 打开 Inspector 的 headed 浏览器；事件流实时显示。
- 停止后展示：原始事件、交互簇、生成草稿、等待证据、置信度、`needsConfirm` 项。
- 支持重新切分 / 重新折叠 / 重新回放；原始事件永不删除。
- 草稿可“插入画布”为节点组，或“替换现有节点”。

### 7.9 探测确认弹窗

- 展示当前节点、目标、候选元素截图与策略列表。
- 操作：选择候选并继续 / 修改策略后继续 / 中止运行。
- 选择只影响本次运行；可勾选“运行结束后写入草稿”（显式动作）。
- 超过 5 分钟未确认 → 运行取消，保留待确认项。

### 7.10 四级入口与短决策

| 入口 | 到可执行路径 | 适用 |
|---|---|---|
| 已有模板 + 填数据集 | 直接 L5 | 最常见，复用优先 |
| 自然语言描述 | LLM → L1 草稿 → 探测补到 L3 | 新建流程 |
| 单次操作采集 | 采集 → 簇 → L1 骨架 → 合成 → 回放 | 复杂交互 |
| 空白画布手动配置 | 逐节点 + 单步验证 | 精细控制 |

- 用户描述意图时先检索相似模板（M4）；命中则建议“基于 XX 模板改字段”，这是缩短意图→执行间隔的最大杠杆。
- 用户只承担三类短决策：
  1. **确认**：从系统建议的候选中点选（定位、等待模板、数据绑定、分支）；
  2. **授权**：试运行探测范围；
  3. **回退**：撤销自动补全，退回上一就绪度。
- 平台不要求用户先学 DSL；DSL 是系统内部与高级用户的契约，普通用户通过画布、数据集表格与确认弹窗完成配置。

---

## 8. 操作采集与草稿合成

### 8.1 四段管线

```
[1] 操作采集  → 原始语义事件流（时间戳、DOM 快照、网络）
[2] 阶段切分  → 候选交互簇（每簇 = 一次复合交互）
[3] 模式识别  → DSL 草稿（置信度 + needsConfirm）
[4] 探测回放  → 确认后的 DSL（就绪度 L4）
```

边界：M2 交付 [1][2]（事件 + 簇）；M3 交付 [3][4]（草稿 + 回放）。

### 8.2 采集器

- Inspector headed 浏览器；`addInitScript` 注入到所有 frame；`exposeBinding` 回传。
- 采集三类信号：
  1. 用户动作 + 语义指纹：`click / input / change / keydown / focusin / focusout`；
  2. 面板开闭：`MutationObserver` 识别 `dialog / menu / listbox / drawer / popup`；
  3. 列表稳定：表格 / 列表容器 quiet-window。
- Playwright 侧同时记录 `framenavigated`、`request/response`（只记写请求与选项填充接口）、`pageerror`。

```js
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('button,[role=button],a,li,[role=option],[role=row]');
  if (el) push({ kind: 'click', fp: fingerprint(el), t: performance.now() });
}, true);

new MutationObserver((muts) => {
  for (const m of muts) for (const n of m.addedNodes)
    if (isOverlay(n)) push({ kind: 'overlay-open', role: overlayRole(n), title: overlayTitle(n) });
  for (const m of muts) for (const n of m.removedNodes)
    if (isOverlay(n)) push({ kind: 'overlay-close', role: overlayRole(n) });
}).observe(document.body, { childList: true, subtree: true });
```

`fingerprint(el)` 采集：`tag / type / role`、可访问名（aria-label / label[for] / 邻近文本 / placeholder / title）、`name / id / data-testid`、有限 class、稳定 CSS、XPath、可见文本、`value / checked`、边界框、frame 路径、最多 3 层容器。

安全：`input[type=password]` 与带 `data-ff-secret` 的字段只记录“已输入”事件，不记录值；原始事件文件权限 0600。

### 8.3 阶段切分规则

| 规则 | 触发 | 产出 |
|---|---|---|
| picker 入口 | click 后 800ms 内出现 `overlay-open` | 该 click 为 trigger |
| picker 出口 | inline 为 `overlay-close`；dialog 为 `overlay-close` + footer 按钮 click | 簇边界 |
| 簇内归类 | overlay 内 change / input → 筛选；overlay 内点击 option / row → pick；dialog 内最后 footer click → commit | 阶段结构 |
| 回填检测 | 出口后 trigger 关联字段值变化 | expect |
| 未吸收事件 | 孤立 click / change | 降级为 `interact` |
| 丢弃 | 点击只导致输入聚焦；重复无状态变化点击 | 丢弃 / 合并 |

- 切分规则是数据（规则版本 + 参数），不是散落的 if；改规则可对同一份原始事件重新切分。
- 非标准组件库无法识别 overlay 时，事件降级为 `interact`；提供 `overlayRules` 扩展点（role / class / 固定定位 / aria-modal 组合）。

### 8.4 模式识别与置信度

| 推断项 | 方法 | 置信度 |
|---|---|---|
| 模式 `inline` / `dialog` | overlay role 与挂载位置 | 高，规则直定 |
| 面板就绪信号 | 实测时间线 + 网络 | 高 |
| 触发 / 选项定位策略 | fingerprint 排序 | 高 |
| 字段语义与数据绑定 | label / placeholder / 值格式 | 中高 |
| pick `byText` / `byRow` | 文本相等 / 行内点击 | 中，需确认 |
| pick `byCondition` | 单次操作无法推断 | 低，必须人工 |
| 分支条件 | 单次操作只走一条路径 | 必须人工 |
| 数据集组合维度 | 测试设计 | 建议 + 确认 |

生成结果中 `needsConfirm: true` 的项在编辑器高亮；未确认项不阻塞保存，但阻塞 L3 / L4。

### 8.5 草稿合成

- 交互簇 → `picker` 节点：trigger、panel、filter、pick、commit、expect。
- 未吸收事件 → `interact`；连续导航合并为 `navigate`。
- 等待证据 → 信号：
  - `panelMs` = 点击 → 面板 visible；
  - `optionResponse` = 点击 → 选项接口；
  - `refreshMs` = 筛选 → 列表稳定；
  - `commitMs` = 保存 → 面板隐藏；
  - `saveMs` = 提交 → 写请求 → toast。
- 标定：取实测 p95 + 1.5s 余量，限制在 `[1000ms, 20000ms]`；无样本用预设。
- 取值建议：`xxx` / 重复名称 → `unique`；手机号 / 邮箱 → 对应 generator；下拉选中项 → 字面值；密码 → `secret`。
- 草稿保留 `evidence`（原始事件下标），支持人工合并 / 拆分 / 删除。

### 8.6 探测回放

- 用生成的草稿 + 录制时的字面值，在同一系统回放。
- 比对：节点顺序、面板开闭、选项文本、筛选值、提交、回填值、各阶段时序（容差 ±50% 或落在配置超时内）。
- 不一致 → `replay_report` 标红到具体节点 / 阶段，用户修正后落库，就绪度升至 L4。
- 回放复用“运行到此节点”能力，秒级反馈；不回放分支 / 数据集（单次录制只有一条路径）。

### 8.7 生成边界

| 内容 | 自动生成 | 说明 |
|---|---|---|
| 节点序列、阶段结构、面板类型 | 是 | 规则切分 |
| 定位策略、fingerprint | 是 | 采集直接产出 |
| 等待信号 | 是 | 实测时间线推荐 |
| filter 字段绑定 | 中高置信 | 格式 + label 推断 |
| pick `byText` / `byRow` | 需确认 | 多选 / 行定位需人工 |
| pick `byCondition` | 否 | 必须人工 |
| 数据集列与生成器 | 建议 + 确认 | 组合维度是测试设计 |
| 分支条件 | 否 | 单次操作只走一条路径 |

结论：生成把 L0→L2 压到接近零，L2→L4 压到“几次点选确认”；L4→L5 仍需用户表达测试意图。

---

## 9. 数据、约束与组合

### 9.1 解析顺序

```
选择数据集行
  → 展开生成器（唯一账本 / 序列）
  → 渲染模板
  → 约束定点求值（最多 10 轮）
  → 校验（range / regex / oneOf / 引用完整性）
  → 冻结 ResolvedData（含 provenance 与 seed）
  → 启动浏览器
```

约束不通过时快速失败，不打开浏览器；失败信息指出字段、约束类型、期望 / 实际。

### 9.2 生成器与唯一值账本

| 生成器 | 行为 |
|---|---|
| `unique.text` | `template` + 序列 + 运行短 id；查账本并原子预留 |
| `unique.email` | 本地部分唯一 + 固定测试域；查账本 |
| `unique.phone` | 合法号段 + 序列；查账本 |
| `unique.orderNo` | 日期 + 序列；查账本 |
| `sequence` | 按 `scope` 持久递增，跨运行不重置 |
| `faker.*` | `@faker-js/faker`；可选 seed；记录 seed |

- 唯一值账本：`(system_id, scope, value)` 联合主键；worker 通过 IPC 请求 API 原子插入，冲突则递增重试（≤20 次）。
- 账本跨运行保留；设置页可清理 N 天前记录（默认 90 天）。
- `sequence` 计数器持久化；运行失败也消耗序号，避免重试复用同一值。
- 若数据集提供了字面值且与账本冲突 → 约束失败，提示更换数据集值，不静默改写。

### 9.3 约束

| 类型 | 语义 |
|---|---|
| `equals` | 两侧解析后必须相等；一侧缺失时复制另一侧；两侧显式且不同 → 失败 |
| `derive` | 由 `from` 计算 `target`（localPart / domain / prefix / suffix / concat / hash） |
| `unique` | 字段由指定生成器产生并预留；若已有字面值则查账本预留，冲突失败 |
| `range` | 数值 / 日期上下界 |
| `regex` | 字符串格式 |
| `oneOf` | 枚举 |

定点求值：`derive → equals → unique → validate` 循环，直到没有变化；超过 10 轮 → `CONSTRAINT_CYCLE`。

### 9.4 Pairwise 与矩阵

- DSL 只存**显式数据集行**；pairwise 是编辑期生成器，不是运行期算法。
- 输入：因子列（仅字面值枚举）、模式、必测组合、seed。
- 输出：显式 `datasets` 行；记录 `meta.generatedBy: "pairwise@1"`、seed、覆盖率。
- Full 模式上限 500 行；pairwise 上限 200 行；超出报错并建议减少因子。
- 必测组合优先并入，按列值去重；pairwise 作为补充而非替代。
- 矩阵运行 = 批次（`run_batches`）+ 每个数据集一次 `run`，串行执行；聚合为网格。

### 9.5 提交后重复检测（M3 增强）

```json
{
  "defaults": {
    "onDuplicate": {
      "detect": [
        { "kind": "response", "urlContains": "/api/customers", "status": 409 },
        { "kind": "text", "target": { "label": "保存提示", "strategies": [{ "type": "text", "value": "已存在" }] }, "contains": "已存在" }
      ],
      "rewindTo": "fill-name",
      "regenerate": ["customerName"],
      "maxAttempts": 3
    }
  }
}
```

- `detect` 是 `WaitSignal[]`，在提交 / 危险点击前预挂载；命中后本次 attempt 标记 `duplicate`。
- 回到 `rewindTo` 节点，重新生成 `regenerate` 变量，从该节点续跑到结束。
- 每次 attempt 记录使用的值、命中条件、耗时；用尽后失败并输出已用值清单。
- 该能力解决“外部数据已存在”的残余冲突；唯一账本解决“本平台重复”。

### 9.6 敏感数据

- 取值 / 数据集列可标 `secret: true`；溯源、网络记录、导出默认脱敏。
- 系统密钥只存 env 引用；storageState 文件 0600，不写入 DB / 日志。
- `secret` 节点可配置“跳过截图”，避免截图泄露；默认仍截图，但 UI 明确提示。
- 录制密码字段不记录值；回放时用占位符，要求用户补充绑定。

---

## 10. 溯源、矩阵与修复

### 10.1 记录内容

| 表 | 内容 |
|---|---|
| `runs` | 流程版本、数据集、模式、状态、时间、artifact 目录、解析数据快照、seed |
| `run_nodes` | 节点 id / 类型 / 顺序 / 状态 / 耗时 / 命中策略 / 阶段耗时 / 错误 / 截图 |
| `run_events` | 节点开始结束、阶段、`HEALED`、`needs_confirm`、等待超时、断言失败、API 调用 |
| `run_actions` | 字段 → 期望值 → 实际值 → 值来源 → 状态 → 耗时 |
| `run_network` | 方法、URL、状态码、请求体（脱敏）、响应片段 |
| `run_batches` | 矩阵批次、数据集列表、汇总 |
| `repair_actions` | 修复对象、前后策略、操作人、时间 |

提交 / 危险点击后 3s 内捕获同源 `POST / PUT / PATCH`，方法与请求体写入 `run_network`；敏感字段按 `secret` 脱敏。

### 10.2 溯源示例

```
Run #42 · dataset 大额
├─ pick-region (picker)                 1.42s
│  ├─ open trigger                     120ms  visible
│  ├─ dialog visible                   180ms  dialog-ready
│  ├─ content stable                   340ms  domStable
│  ├─ filter 搜索“华南区”              190ms  value readBack
│  ├─ list ready                       210ms  response /api/regions
│  ├─ pick “华南区”                     90ms  byText exact
│  ├─ commit 保存 → dialog hidden      260ms
│  └─ expect 回填一致                  60ms
├─ save (interact)                     320ms
│  └─ HEALED: [data-testid=save] → role=button[name="保存"]  conf 0.82
└─ result: pass
```

### 10.3 执行矩阵

```
                 open      new       fill-name   pick-region        branch   approve   save
普通              pass      pass      pass        pass               else     —         pass
大额              pass      pass      pass        pass               then     pass      pass
客户不存在        pass      pass      pass        FILTER_NO_RESULT    —        —         —
区域无效          pass      pass      pass        PICK_NO_MATCH       —        —         —
```

- 负向用例在对应阶段明确失败，后续节点 `skipped`。
- 矩阵单元格可点击进入运行详情；支持按数据集 / 节点筛选。

### 10.4 失败诊断

失败时保留并展示：

- 每个候选策略的探测结果（是否存在、可见数量、耗时、是否歧义）；
- 可访问名相似度 top 5 的元素（修复建议）；
- 分阶段耗时（导航 / 就绪 / 等待 / 定位 / 动作 / 取证），指出预算消耗；
- 失败截图、ARIA 快照、DOM 片段、`trace.zip`；
- `failure.json` 可下载，供离线分析。

### 10.5 修复工作台（M5）

1. 查看 `HEALED` 清单与失败快照；
2. 选择“提升后备为首选”或“替换某条策略”；
3. 在页面上重新拾取候选；
4. 应用为草稿变更（记录 `repair_actions`）；
5. 重新运行验证；通过后可发布新版本。

约束：修复只影响显式修改的节点；v1 不做跨流程目标库；不自动应用、不自动发布。

### 10.6 失败现场继续

- 保留 context 5 分钟；`POST /runs/:id/resume` 带可选节点补丁。
- 服务端重编译，跳过已成功节点，从失败节点继续。
- 若 context 已关闭 / 页面崩溃，返回 `CONTEXT_LOST`，提示从起点重跑。

---

## 11. AI 层

### 11.1 定位

核心链路不需要 AI。事件采集、阶段切分、模式判定、定位策略、等待信号推荐、`byText` / `byRow`、回放验证、DSL 解释执行、适配器、picker 阶段化——全部规则实现，可复现、可单测、可定位。

AI 只接两个瓶颈：

1. `fieldSemanticMapper`：跨语言 / 缩写的字段名 → 数据集列 / 生成器建议；
2. `nlToCondition`：自然语言 → 分支条件 / `byCondition` 条件草稿。

M4 额外提供自然语言 → DSL 草稿（L1）与模板检索。

### 11.2 接入方式

- 默认关闭；设置页开启后读取环境变量：`FF_AI_BASE_URL`、`FF_AI_API_KEY`、`FF_AI_MODEL`（OpenAI 兼容接口）。
- 平台只做请求编排，不内置模型权重；密钥只读 env，不写 DB / 日志。
- 输出带 `source: "llm"`、`confidence`、`needsConfirm`；永不直接落库、永不自动运行。
- AI 关闭时，字段绑定用下拉点选，条件用三段式构建器，功能完整。

### 11.3 自然语言草稿

1. `GET /api/ai/context` 生成可复制上下文包：schema、两个完整示例、systems、数据集列、target 约定、模板命名空间、ID 规则；不包含 cookies / env 值 / 密码。
2. 用户把描述 + 上下文包交给 Chat，返回 JSON 草稿。
3. `POST /api/flows/import` 或 `POST /api/ai/draft`：校验、归一化、就绪度、结构化差异、`needsConfirm`。
4. UI 左侧 JSON / 右侧节点预览；应用前必须看到差异。
5. 应用后进入画布，L1 / L2；探测运行补全定位与等待；回放通过后升 L4。

### 11.4 安全闸

- 结构闸：zod 校验、未知节点类型拒绝、大小限制、JSON Pointer 报错。
- 语义闸：AI 不得编造 CSS / XPath；target 只能来自页面拾取或用户确认。
- 回放闸：生成草稿必须在真实页面回放通过，才能从 L2 升到 L4。
- 人工闸：`needsConfirm` 未清空不得发布。

### 11.5 AI 替代不了的部分

`byCondition` 的具体条件、数据集组合维度、分支路径、负向用例期望结果——这些是测试设计，必须用户表达。

---

## 12. 存储与产物

### 12.1 SQLite 表

| 表 | 关键列 | 说明 |
|---|---|---|
| `systems` | id, name, base_url, auth_json, allowed_origins | 目标系统；auth 只存策略与 env 引用 |
| `flows` | id, name, dsl_json, layout_json, readiness, updated_at | 草稿；可编辑 |
| `flow_versions` | id, flow_id, version, dsl_json, checksum, created_at | 发布版本，不可变 |
| `run_batches` | id, flow_id, flow_version_id, mode, dataset_ids_json, status, summary_json | 矩阵批次 |
| `runs` | id, batch_id, flow_id, flow_version_id, dataset_id, mode, status, started_at, finished_at, artifact_dir, resolved_data_json, seed, error_json | 一次执行 |
| `run_nodes` | run_id, node_id, node_type, index, status, duration_ms, resolved_target_json, stage_timings_json, error_json, screenshot_path | 节点级 |
| `run_events` | run_id, seq, ts, node_id, type, level, payload_json | `HEALED` / `needs_confirm` / 阶段 |
| `run_actions` | run_id, node_id, field, expected, actual, value_source, status, duration_ms | 数据表 |
| `run_network` | run_id, node_id, method, url, status, req_body_json, resp_snippet, redacted | 业务请求 |
| `value_ledger` | system_id, scope, value, run_id, created_at | 唯一值账本 |
| `sequences` | system_id, scope, next_value | 持久序列 |
| `record_sessions` | id, system_id, raw_path, events_count, draft_dsl_json, rule_version, status, created_at | 录制 |
| `pending_confirms` | run_id, request_id, node_id, kind, options_json, status, expires_at | 探测确认 |
| `repair_actions` | id, flow_id, node_id, kind, before_json, after_json, created_at | 修复审计 |
| `settings` | key, value_json | 超时 / 截图 / trace / 资源策略 / 保留 |

SQLite：`data/flowforge.db`，WAL 模式；只有 API 进程写。

### 12.2 产物目录

```
data/
  flowforge.db
  artifacts/<runId>/          # trace.zip, screenshots, failure.json, compiled-plan.json
  recordings/<sessionId>.jsonl
  sessions/<systemId>.json    # storageState，0600
  tmp/
```

### 12.3 保留与清理

- 默认保留 30 天运行产物；可配置。
- 每次运行 trace 上限（默认 200MB）；超出截断并记 warning。
- 启动时清理过期 artifacts / recordings；DB 记录同步删除。
- `data/` 可整体备份 / 替换；DB 与 artifacts 用 runId 关联。

---

## 13. API 与 CLI

### 13.1 REST

| 方法 / 路径 | 用途 |
|---|---|
| `GET/POST/PATCH/DELETE /api/systems` | 系统 CRUD |
| `POST /api/systems/:id/session` | 打开 headed 检查器供手动登录；`PUT` 保存 storageState |
| `GET/POST /api/flows`、`GET/PATCH/DELETE /api/flows/:id` | 流程草稿 CRUD |
| `POST /api/flows/:id/publish` | 草稿 → 新不可变版本 |
| `GET /api/flows/:id/versions` | 版本列表与 DSL |
| `POST /api/flows/:id/validate` | 校验 + lint + 就绪度（不落库） |
| `POST /api/flows/import` | 导入 DSL：校验 / 归一化 / 差异 / 可选落草稿 |
| `GET /api/flows/:id/export` | 导出 DSL |
| `POST /api/flows/:id/matrix/preview` | pairwise / full 组合预览 |
| `POST /api/flows/:id/runs` | 启动单次运行（`dataset`、`mode`、`stopAtNodeId`） |
| `POST /api/flows/:id/batches` | 启动矩阵批次 |
| `GET /api/runs`、`GET /api/runs/:id` | 运行列表 / 详情 |
| `POST /api/runs/:id/cancel` | 取消 |
| `POST /api/runs/:id/confirm` | 探测确认 / 继续 |
| `POST /api/runs/:id/resume` | 失败现场继续（M5） |
| `GET /api/runs/:id/artifacts/:file` | 截图 / trace / failure.json |
| `WS /api/runs/:id/events` | 运行事件流 |
| `POST /api/recordings`、`POST /api/recordings/:id/stop` | 录制开始 / 停止 |
| `POST /api/recordings/:id/refold` | 重新切分 / 折叠 |
| `POST /api/recordings/:id/synthesize` | 簇 → DSL 草稿 |
| `POST /api/recordings/:id/replay` | 探测回放 |
| `POST /api/inspector/open`、`POST /api/inspector/:id/close` | 检查器会话 |
| `POST /api/inspector/:id/pick` | 拾取元素 → 候选链 |
| `POST /api/inspector/:id/test-target` | 测试 target 解析（不执行动作） |
| `GET /api/spec/schema` | JSON Schema |
| `GET /api/ai/context`、`POST /api/ai/draft`、`POST /api/ai/suggest` | AI 上下文 / 草稿 / 建议（M4） |
| `GET/PATCH /api/settings` | 设置 |
| `GET /api/health` | Playwright 版本、浏览器、数据目录、DB |

### 13.2 WebSocket 事件

```json
{
  "runId": "run_01",
  "seq": 42,
  "ts": "2026-10-26T12:00:00.000Z",
  "type": "node.stage",
  "nodeId": "pick-region",
  "payload": { "stage": "refresh", "status": "completed", "durationMs": 210, "signal": "response" }
}
```

事件类型：`run.started`、`run.finished`、`node.started`、`node.finished`、`node.stage`、`healed`、`needs_confirm`、`assert.failed`、`wait.timeout`、`api.call`、`run.error`。

- 连接时先发快照，再发增量；100ms 合批；单连接最多订阅一个 run。
- Origin 校验；只允许 `127.0.0.1` / `localhost`。

### 13.3 错误、限制

```json
{ "error": { "code": "DSL_INVALID", "message": "target 缺少策略", "pointer": "/nodes/3/target", "details": [] } }
```

- 校验错误按 JSON Pointer 定位。
- DSL 上限：500 节点 / 1000 边 / 5MB；数据集 500 行；录制会话 30 分钟；单响应 2MB。
- 运行并发默认 1；矩阵批次串行；同一流程同一时间只允许一个批次。
- 导入 / AI 草稿永不自动发布、永不自动运行。

### 13.4 CLI

```bash
pnpm ff validate <file>
pnpm ff run <flowId> [--dataset normal] [--mode probe|single] [--headless]
pnpm ff matrix <flowId>
pnpm ff replay <recordingId>
pnpm ff record --system <systemId>
```

CLI 直接使用 `packages/engine` + DB，不依赖 HTTP 服务；退出码：0 成功，1 运行失败，2 配置 / 校验失败。

---

## 14. 工程结构

### 14.1 Workspace

```text
FlowForge/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  drizzle.config.ts
  data/                         # gitignore
  apps/
    web/                        # React 19 + Vite 8 + React Flow
      vite.config.ts
      src/
        main.tsx
        App.tsx
        pages/                  # Systems/Flows/Editor/Datasets/Recordings/Runs/RunDetail/Matrix/Repair/Settings
        flow/                   # canvas, nodeTypes, layout, commands, store
        components/             # Inspector, TargetEditor, ValueEditor, WaitEditor, MatrixGrid, TraceTimeline
        lib/api.ts
        lib/ws.ts
    api/                        # Hono 4 + Drizzle + queue + WS
      src/
        index.ts
        db/schema.ts
        db/client.ts
        db/migrate.ts
        routes/                 # systems/flows/runs/batches/recordings/inspector/ai/settings/spec
        queue.ts                # 串行队列 + worker fork + IPC
        events.ts               # WS 广播
        artifacts.ts
        cli.ts
  packages/
    dsl/                        # zod schema, normalize, readiness, lint, diff, matrix, templates
      src/schema/...
      src/readiness.ts
      src/lint.ts
      src/diff.ts
      src/matrix.ts
      src/templates.ts
    engine/                     # 编译 + 解释执行 + 浏览器
      src/compile.ts
      src/runner.ts
      src/nodes/...
      src/locator.ts
      src/waits.ts
      src/picker.ts
      src/data.ts
      src/browser-pool.ts
      src/navigation.ts
      src/resource-policy.ts
      src/auth.ts
      src/trace.ts
      src/probe.ts
      src/worker-entry.ts
    recorder/                   # 采集脚本 + 切分 + 合成 + 回放
      src/collector.ts
      src/fingerprint.ts
      src/segment.ts
      src/synthesize.ts
      src/replay.ts
  fixtures/                     # 目标夹具站
    server.mjs
    pages/...
  test/
    unit/
    integration/
    perf/
    e2e/
```

### 14.2 技术选型

| 层 | 选择 | 版本 |
|---|---|---|
| 运行时 | Node | 24.16 |
| 包管理 | pnpm workspace | 10.34 |
| 前端 | React + TypeScript + Vite + Tailwind | 19.3 / 5.9 / 8.3 / 4.3 |
| 画布 | `@xyflow/react` + `@dagrejs/dagre` | 12.x |
| 服务端状态 | `@tanstack/react-query` | 5.x |
| 编辑器状态 | Zustand | 5.x |
| 后端 | Hono + `@hono/node-ws` | 4.x |
| 校验 | zod（含 `z.toJSONSchema`） | 4.6 |
| 存储 | better-sqlite3 + Drizzle | 13 / 0.45 |
| 浏览器 | Playwright（库，不使用 Test Runner 作为执行器） | 1.64.1 |
| 可选兼容层 | Selenium（仅当目标环境无法使用 Playwright；v1 不实现） | — |
| 数据生成 | `@faker-js/faker` | 10.6 |
| 自身 E2E | `@playwright/test` | 1.64.1 |

低代码参考（不作为依赖）：Robot Framework 关键字、Katalon 自愈，仅用于设计对照；平台不引入其运行时。

### 14.3 命令

```bash
pnpm dev            # api 8787 + web 5173；worker 懒启动
pnpm db:migrate
pnpm typecheck
pnpm test           # node:test：unit + integration
pnpm test:perf
pnpm test:e2e
pnpm build
pnpm start
```

构建：Vite 构建 `apps/web`；tsup / tsc 构建 `apps/api`、`packages/*`；生产由 Hono 托管 `apps/web/dist`。

### 14.4 部署

- 单机、单用户；API 绑定 `127.0.0.1:8787`；生产单端口，开发 `5173 + 8787`（`/api` 与 `/ws` 代理）。
- 不提供账号 / 权限 / 远程协同；需要局域网访问时再加 token 层（非 v1）。
- 启动自检：`GET /api/health` 返回 Playwright 版本、Chromium 可执行文件、`data/` 可写、SQLite 可迁移。

---

## 15. 里程碑

每个里程碑结束系统都可用；M4 可跳过，M5 依赖 M1–M3 的溯源。

### M1 DSL 内核与执行器

**范围**

- pnpm workspace、DSL schema、归一化、readiness、lint。
- 节点执行器：`navigate / interact / picker / wait / assert / branch / api`。
- 定位解析、等待编译、DOM 稳定探针、picker 阶段化、资源策略、导航策略。
- BrowserPool + 每系统常驻标签页；Run Worker；SQLite schema + 最小 API；CLI。
- 数据基础：`literal / var / template / env / generator(unique.text/sequence)` + 唯一值账本。
- 夹具：异步下拉、弹窗、筛选面板、唯一约束、长轮询、慢页面、变体页。

**验收**

1. CLI 运行夹具：打开列表 → 新建弹窗 → 唯一名称 → 1.2s 异步下拉（搜索 + 多选）→ 三条件筛选面板 → 保存；无 sleep、无 `networkidle`；溯源有阶段耗时。
2. 同一流程连续 10 次唯一字段零冲突；账本预留与序列递增可见。
3. 删除主定位策略后运行，后备策略命中并记录 `HEALED`；运行通过。
4. 夹具删掉一个字段 → 失败定位到具体策略与阶段，附截图 / ARIA 快照 / 相似元素。
5. 在同一 Run Worker 会话内连续运行，第二次无浏览器冷启动；8 节点 / 3 导航 ≤ 25s；长轮询页 `domStable` 最迟 8s 放行。
6. `branch` 的 then / else 与 `api` 的 GET + extract 在夹具上跑通，条件可引用变量与字面值。
7. `pnpm typecheck && pnpm test` 通过。

**工作包**

脚手架 → DSL schema / normalize / readiness / lint → compile → locator → waits → picker → 节点执行器 → browser pool / resource / navigation → trace / artifacts → DB / minimal API → CLI → fixtures → perf 用例。

### M2 编辑器最小闭环 + 采集

**范围**

- React Flow 画布、自定义节点、布局存储、DSL↔canvas 命令同步、撤销 / 重做。
- 检查器、target 编辑器、取值 / 等待 / 断言编辑器、问题面板、就绪度徽标。
- 系统 / 流程 / 运行页面；运行详情基础时间线；WebSocket。
- L2 探测运行 + 待确认弹窗；运行到此节点。
- Inspector Worker：headed 浏览器、元素拾取、手动登录保存会话。
- 注入式事件采集器 + 阶段切分 + 交互簇查看（M2 不做草稿合成）。

**验收**

1. 空白画布创建流程、添加 / 连接 / 删除节点、配置 picker、保存后刷新，DSL 与布局稳定回读。
2. L2 流程探测运行：目标歧义时暂停并给出候选；选择后继续；待确认项落库；运行完成。
3. 录一次“弹窗筛选 + 多选 + 保存”，能看到原始事件与 picker 交互簇；原始事件保留。
4. “运行到此节点”在秒级完成并复用 context；目标不在分支路径时明确 `NOT_REACHED`。
5. 拾取元素生成候选链并插入节点；`test-target` 能显示命中数量。
6. 运行详情能看节点 / 阶段 / 定位策略 / 截图。

### M3 数据集与合成

**范围（双轨）**

- 数据轨：`datasets / constraints / generator(faker, unique.*) / pairwise / 矩阵批次 / 执行矩阵视图 / onDuplicate`。
- 合成轨：交互簇 → DSL 草稿、置信度、`needsConfirm`、探测回放、等待证据与超时建议、预设编辑。
- `byCondition` picker；分支覆盖计算；L5 就绪度；数据表导出。

**验收**

1. 一条流程覆盖三组数据集，约束求值通过；矩阵网格显示每行状态；唯一值零冲突。
2. 4 个因子 pairwise 生成行数与 pair 覆盖率正确；应用后写入显式 datasets；seed 可复现。
3. 大额数据集走 `then`，普通走 `else`；矩阵路径正确；分支覆盖可见。
4. “客户不存在”“区域无效”在 picker 的筛选 / 选择阶段明确失败，错误码不是超时。
5. 采集簇合成 picker DSL，回放通过；一个错误等待信号被回放标红；重新折叠不丢失原始事件。
6. 就绪度到 L5；数据表可导出 CSV / JSON。

### M4 AI 插件 + 自然语言草稿

**范围**

- AI provider（OpenAI 兼容，默认关闭）、上下文包、`fieldSemanticMapper`、`nlToCondition`。
- 自然语言 → DSL 草稿（L1）、结构化差异、预览、导入。
- 模板检索：按名称 / 标签 / 描述的关键词与 trigram 相似度；AI 开启时可语义增强。

**验收**

1. AI 关闭时，字段绑定与条件构建完整可用。
2. 一段中文描述 + 上下文包 → Chat 返回 JSON → 导入无错误；错误按 JSON Pointer 定位。
3. AI 建议的 binding / condition 全部进入 `needsConfirm`，不自动应用。
4. AI 草稿在真实页面探测回放通过后才能升 L4；未确认项阻塞发布。
5. 相似模板推荐能命中已有流程，并支持“基于模板创建”。

### M5 降级审计与修复工作台

**范围**

- 溯源时间线完整版、`HEALED` 清单、快照查看、策略替换 / 提升为首选。
- `repair_actions` 审计；失败现场继续；修复后重跑。
- 运行健康趋势（最近 N 次降级 / 失败）。

**验收**

1. 改掉夹具 label：运行记录 `HEALED` 或 `BROKEN`，并显示命中的后备策略。
2. 在工作台用快照替换一条策略，应用为草稿；重跑通过；修复记录可查。
3. “提升为首选”后下一次运行不再产生 `HEALED`。
4. 失败现场继续成功；关闭 context 后继续返回 `CONTEXT_LOST` 而不是假装成功。
5. 形成“执行 → 记录 → 修复 → 再执行”闭环，不重录整条流程。

### 里程碑依赖

```text
M1 ──► M2 ──► M3 ──► M4（可跳过）
              └────► M5
```

M3 的两条轨道可并行，但矩阵与回放都依赖 M2 的画布 / 运行 UI。

---

## 16. 测试与夹具

### 16.1 夹具站

`fixtures/` 必须覆盖真实痛点，不依赖外网：

| 夹具 | 覆盖 |
|---|---|
| 登录页 | cookie / localStorage 两种会话写入 |
| 客户列表 | 800ms 异步渲染、分页、唯一名称接口 |
| 新建客户弹窗 | 可搜索下拉（1.2s 选项 + 多选）、日期面板、上传、保存 |
| 筛选面板 | 3 个条件 + 查询按钮，接口 600ms，列表刷新 |
| 长轮询页 | SSE / 轮询，`networkidle` 永不触发 |
| 重资源页 | 2MB 图片 + 慢速第三方脚本 |
| SPA 路由页 | 前端路由切换，验证不重复整页导航 |
| 变体页 | 字段改名 / 删除 / 顺序调整，用于 HEALED 与修复 |
| 分支页 | 金额 / 类型分支，验证 then / else |
| 虚拟滚动页 | 用于暴露适配器边界（v1 明确不支持则记录） |
| 唯一约束接口 | 重复名称 409 + toast“已存在” |
| 重置接口 | 每个测试前清理数据 |

### 16.2 测试分层

| 层 | 覆盖 |
|---|---|
| 单元 | schema / 归一化 / readiness / lint、目标候选排序、等待预设展开、数据生成器、约束定点、pairwise、分支条件、结构化 diff、切分规则、合成规则 |
| 集成 | 引擎对夹具执行：异步下拉 / 搜索 / 多选、筛选面板、弹窗、上传、断言、branch、api、唯一账本、onDuplicate、HEALED、失败诊断、长轮询、重复导航跳过、BrowserPool 复用 |
| 性能 | 冷启动复用、单步非等待开销、8 节点 / 3 导航预算、资源拦截计数、无 screencast 时零额外开销 |
| E2E | 画布创建 → 拾取 → 运行；录制 → 切分 → 合成 → 回放；导入 → 预览 → 应用；矩阵 → 修复 → 重跑 |
| 快照 | `compiled-plan.json`、readiness、矩阵覆盖、失败诊断结构 |

### 16.3 验证命令

```bash
pnpm typecheck && pnpm test && pnpm test:perf && pnpm test:e2e
```

- 集成 / 性能 / E2E 全部 headless、随机端口、临时数据目录；结束后清理。
- 性能用例只断言本机夹具预算；CI 可放宽 20%，但不得取消预算断言。
- 每个里程碑合并前必须新增对应夹具用例，不允许只靠手工验收。

### 16.4 人工验收

按第 15 节每个里程碑逐条执行；另加：

- 同一流程连续 3 次结果一致（唯一值、数据集、分支）。
- 杀掉浏览器进程后服务不崩，运行标记失败，可重试。
- 删除 `data/` 后能重新迁移并启动。
- 导入一份故意错误的 DSL，UI 能按 Pointer 指出错误且不落库。

---

## 17. 风险、安全与回滚

### 17.1 风险

| 风险 | 影响 | 应对 |
|---|---|---|
| **最脆弱假设**：表单控件能归入 native select / popup listbox / dialog / 日期 / 上传，其余可用原语组合 | 画布表格、虚拟滚动选择器需要新适配器 | 适配器注册表 + 原语逃生通道；v1 `pick` 不含虚拟滚动；首个真实系统若需要，M1 后先补适配器再进 M2 |
| **前置假设**：Playwright auto-wait 足以处理 SPA 异步 | “元素可操作”不等于“数据已加载” | 显式等待链 + 业务就绪信号；auto-wait 只作最低保障 |
| 阶段切分覆盖不全 | 采集簇缺失或错误 | 未吸收事件降级为 `interact`；`overlayRules` 扩展；规则版本化可重切 |
| picker 在特定组件上超时 | 流程卡住 | 阶段级溯源；切换就绪信号 / 预设；适配器可扩展 |
| pairwise 仍遗漏关键路径 | 组合覆盖不足 | 必测组合优先；pairwise 是补充不是替代；覆盖率可视化 |
| 定位降级频繁造成噪音 | 用户忽略真实漂移 | 降级聚合，低于置信阈值才提示确认；M5 清单 |
| React Flow 与 DSL 双向同步复杂 | 画布状态与配置不一致 | DSL 唯一源头、布局分离、命令式修改、golden 测试 |
| 探测暂停 / 恢复复杂 | 运行悬挂 | 单问题协议、5 分钟超时、只影响本次运行、不自动写回 |
| 浏览器 / 标签页复用状态污染 | 上一步残留弹窗影响下一步 | 每次运行新 context；页面池按运行隔离；`pre` 显式关闭残留层 |
| 目标系统反自动化 / 验证码 | 无人值守失败 | headed + 真实 Chrome + 手动登录会话；不绕过，明确不支持 |
| AI 输出不可靠 | 错误配置进入流程 | 默认关闭、schema 校验、needsConfirm、回放闸、人工应用 |
| 第三方脚本 / 服务端慢 | 性能预算不达标 | 资源策略、页面复用、业务信号；性能页区分平台与目标系统耗时 |
| 产物增长 | 磁盘压力 | 保留天数、单次 trace 上限、启动清理 |
| Playwright 升级破坏行为 | 运行异常 | 锁定 1.64.1；升级跑完整集成测试 |
| 无循环 / 无动态节点 | 某些流程需要重复 | v1 用复制节点表达；真实需求出现再评估 `loop` 节点 |

### 17.2 安全与攻击面

- **本地边界**：API / WS 只监听 `127.0.0.1`；关闭 CORS；WS 校验 Origin；不提供远程访问。
- **密钥**：系统密钥只存 env 引用；storageState 文件 0600；日志 / 溯源脱敏；`secret` 字段不进入导出。
- **API 节点**：默认同 origin；跨域白名单；响应大小限制；不支持脚本执行。
- **模板**：受控命名空间，无 `eval`；JSONPath 仅安全子集。
- **导入 / AI**：schema 校验、节点数 / 大小限制、未知类型拒绝、不自动运行；AI 上下文不含 cookies / env 值。
- **录制**：密码字段不记录值；原始事件文件权限 0600；可配置脱敏规则。
- **截图**：可能包含敏感信息；`secret` 节点可关闭截图；数据目录仅本机。
- **依赖**：锁定版本；Playwright / Chromium 升级需回归；SQLite 仅 API 写。

### 17.3 规模与回滚

- 规模：5 个 workspace 包 + 1 个夹具站；预计 80–100 个源文件；1 个 SQLite 文件；开发期 2 个进程 + 运行期 1 个 worker。
- 回滚：`flow_versions` 不可变，草稿可恢复到任意版本；DB 迁移只增不删；DSL 主版本不兼容直接拒绝并提示导出旧配置；`data/` 可整体备份 / 替换。
- 阶段回滚：每个里程碑独立交付；M4 跳过不影响 M1–M3 / M5；M5 失败可回到 M1–M3 的运行与矩阵能力。

---

## 18. 待确认（不影响开工，影响首次接入）

1. **首个真实目标系统**：baseUrl、登录方式（SSO / 账号密码 / 扫码）、1–2 个典型表单页面。M1 验收后立即真实跑通；若控件超出内置适配器，先补适配器再进 M2。
2. **数据集规模与来源**：v1 采用 DSL 内联数据集，上限 500 行；是否需要 CSV 导入 / 外部大表？若需要，在 M3 前确认存储形态。
3. **是否允许写测试环境数据**：默认只面向测试环境；生产环境需显式标记，并建议矩阵运行前人工确认。
4. **AI provider**：M4 是否需要接入，使用哪个 OpenAI 兼容端点；默认关闭，不接入不影响 M1–M3 / M5。
5. **登录与会话**：SSO / 扫码 / 验证码场景是否接受“headed 手动登录 + storageState 复用”；若不接受，需要单独评估。
6. **命名**：产品名 FlowForge、工程目录沿用 `FlowTest`、包 scope `@flowforge/*`；如需统一改名，在 M1 脚手架阶段一次完成。

---

## 19. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v2.0 | 2026-10-26 | 基于 FlowForge v1.0 重新落地：节点图 DSL、picker、数据集 / 约束 / 分支、就绪度 L0–L5、React Flow 画布、采集四段管线、AI 两个 hook、M1–M5 里程碑；取代 v1 FlowSpec 线性步骤模型 |
| v1.0 | 2026-10-26 | FlowTest / FlowSpec 线性步骤模型、有序候选链、等待链 / 预设、浏览器复用、唯一值账本、字段目录与 doctor；核心工程结论并入 v2.0 |
