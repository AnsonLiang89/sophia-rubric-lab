# Sophia's Rubric Lab 🪻

> **"AI 产品对 AI 产品"的横向评测实验室**
>
> 针对同一个 Query（商业/投研/技术/生活等真实问题），让多个 AI 产品（SophiaAI、MiroThink、ChatGPT、DeepSeek、Claude 等）各自生成一份报告，然后由评测官 **Sophia** 按严格的 5 维 rubric 打分 + 写评测报告 + 给出 SBS 结论。

一份 rubric，一套产物契约，两种部署模式（管理员本地 + 对外只读版）。

**在线 Demo**：<https://ansonliang89.github.io/sophia-rubric-lab/>（对外只读版，GitHub Pages）

---

## 🎯 这是什么

很多人都在问"哪个 AI 模型更好？"——但"好"不能只看榜单。**同一个问题丢给不同模型，谁的答案能真正帮到要做决策的人？** 这是 Rubric Lab 要回答的事。

我们的核心价值观：

- **不看长度，看有用程度**：篇幅 / 排版 / 语气不计分
- **不做内部自洽评分**：评测官必须主动外部核验、交叉验证
- **不允许浮点伪精度**：5 档制（S/A/B/C/D）强制档位打分，禁止 7.5 这种"凑分"
- **一票否决生命线**：R1 准确性出现重大事实错误 → 总分封顶 6.9

### 评测什么（5 维 Rubric）

| ID | 维度 | 权重 | 一句话 |
|----|------|------|--------|
| **R1** | 准确性 | 40% | 事实、数据、口径、信源是否经得起核查——生命线 |
| **R2** | 相关性 | 15% | 是否正面回应用户 query、识别到潜在深层诉求 |
| **R3** | 论证深度 | 20% | 有证据、有推导闭环、有非共识洞察 |
| **R4** | 完备性 | 10% | 决策所需维度齐全、结构支撑论证 |
| **R5** | 决策价值 | 15% | 信息熵增量 + 启发性 + 可操作 take-away |

外加 1 个激活式"扩展维度"（X1/X2/X3）—— 针对特定 Query 的关键差异维度（如本地化、时政锚点捕捉、行业专业度等）。

**完整评测标准**：[`.evaluations/RUBRIC_STANDARD.md`](.evaluations/RUBRIC_STANDARD.md)（v2.1，2026-04-22 生效）
**LLM 工作协议**：[`.evaluations/EVALUATION_CONTRACT.md`](.evaluations/EVALUATION_CONTRACT.md)

---

## 🏗️ 架构一览

```
┌─────────────────────────────────────────────────────────────┐
│  管理员模式（npm run dev）                                   │
│  ┌─────────────┐   Vite dev + /_bus/*   ┌─────────────────┐ │
│  │  React SPA  │◀───── middleware ─────▶│ .evaluations/    │ │
│  │  (src/)     │                         │  ├─ inbox/       │ │
│  │             │                         │  ├─ outbox/      │ │
│  │  可读可写    │                         │  ├─ RUBRIC_*.md  │ │
│  └─────────────┘                         │  └─ CONTRACT_*.md│ │
│         ▲                                └─────────────────┘ │
│         │ 评测触发                                ▲           │
│         │                            WorkBuddy   │           │
│         └── LLM (Sophia) 写 outbox JSON ─────────┘           │
└─────────────────────────────────────────────────────────────┘
                         │
                         │  npm run build:public
                         │  (bake 成静态快照)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  对外只读模式（GitHub Pages）                                │
│  ┌─────────────┐  fetch /data/*.json   ┌─────────────────┐  │
│  │  React SPA  │◀──── 静态文件 ────────│ public/data/    │  │
│  │  (same!)    │                        │   (baked 快照)   │  │
│  │  只读       │                        └─────────────────┘  │
│  └─────────────┘                                              │
└─────────────────────────────────────────────────────────────┘
```

**一份代码、两种数据源**。区分逻辑集中在 `src/lib/dataSource.ts`，由 `IS_READONLY = import.meta.env.PROD` 驱动：
- dev → 走 `/_bus/*` (vite-plugin 中间件，读写 `.evaluations/`)
- prod → 走 `${BASE}/data/*.json` (静态文件，只读)

---

## 🚀 Quickstart

### 1. 安装

```bash
git clone https://github.com/AnsonLiang89/sophia-rubric-lab.git
cd sophia-rubric-lab
npm install
```

### 2. 本地开发

```bash
npm run dev
# → http://127.0.0.1:5173/
```

可读可写，所有编辑按钮都显示。可以：

- **录入 Query**（评测题目）
- **挂载 Submission**（每个 AI 产品对该 Query 的报告正文）
- **召唤 Sophia**（触发 WorkBuddy 对话框跑评测，产物落到 `.evaluations/outbox/`）

### 3. 在 WorkBuddy 里跑 Sophia 评测

1. 在 Lab 的 QueriesPage 点击「召唤评测」按钮，生成 `inbox/{taskId}.json`
2. 打开 WorkBuddy，说「**评测 EV-XXXX-XXXXX**」
3. Sophia（LLM）读契约 → 读 inbox → 外部核验 → 5 档打分 → 写 `outbox/{taskId}/v{n}.json`
4. 回 Lab 网站点刷新，评测渲染出来

### 4. 发布到对外版

```bash
npm run build:public    # 跑 lint + seed:dump + bake + vite build（全链路自检）
npm run preview         # 本地预览 dist
git push                # CI 自动部署到 GitHub Pages
```

详细部署见 [`DEPLOY.md`](./DEPLOY.md)。

---

## 📦 npm Scripts

| 命令 | 用途 |
|---|---|
| `npm run dev` | 管理员本地开发（可写） |
| `npm test` | 跑 vitest 单元测试 |
| `npm run lint` | ESLint |
| `npm run lint:outbox` | 校验所有 outbox 产物的 schema（必填字段 / tier-score 一致性 / 加权和 / 权重总和 等） |
| `npm run seed:dump` | 把 `src/seed.ts` 物化成 `.evaluations/_seed-snapshot.json` |
| `npm run bake:public` | 把所有数据烘焙成 `public/data/*.json` |
| `npm run bake:check` | 检查对外版是否跟得上 `.evaluations/` 源（bake freshness） |
| `npm run build:public` | 一条龙：`lint:outbox → seed:dump → bake:public → tsc → vite build` |
| `npm run cleanup-inbox` | 清理已有 outbox 的孤儿 inbox |

---

## 🗂️ 项目结构

```
sophia-rubric-lab/
├── .evaluations/                 # 契约 + 评测数据（单一事实源）
│   ├── RUBRIC_STANDARD.md        ← 评测标准（给人看）
│   ├── EVALUATION_CONTRACT.md    ← LLM 工作协议（给 Sophia 看）
│   ├── NAMING_CONTRACT.md        ← id/code/taskId 命名契约
│   ├── PRODUCTS.json             ← 评测主体清单
│   ├── inbox/                    ← 评测任务（不入 git）
│   └── outbox/                   ← 评测产物（入 git）
│       └── {taskId}/v{n}.json
├── src/
│   ├── lib/
│   │   ├── contract.ts           ← TS 类型定义 + bus HTTP 封装
│   │   ├── dataSource.ts         ← dev/prod 双模式数据源抽象
│   │   ├── outboxAgg.ts          ← outbox 聚合（Dashboard 用）
│   │   ├── score.ts              ← 分数着色 helpers
│   │   └── sortProducts.ts       ← AI 产品排序（Sophia 优先）
│   ├── pages/                    ← Dashboard / Queries / Report / Standard / Contract / Products
│   ├── components/               ← 可复用 UI 组件
│   ├── store.ts                  ← Zustand 本地状态
│   └── storage.ts                ← localStorage 适配器
├── vite-plugins/
│   ├── evaluationBus.ts          ← /_bus/* API 中间件（dev 专用）
│   └── codeRegistry.ts           ← queryCode 注册簿
├── scripts/
│   ├── lint-outbox.mjs           ← Schema linter（pre-bake 防护）
│   ├── check-bake-freshness.mjs  ← 对外版同步检查
│   ├── bake-public-data.mjs      ← 烘焙静态快照
│   ├── dump-seed.mjs             ← 物化 seed
│   └── cleanup-orphan-inbox.mjs  ← 清理孤儿 inbox
└── tests/                        ← vitest 单元测试
```

---

## 🛡️ 产品契约与防御纵深

这个项目对"契约 + 防御纵深"投入不少，因为**评测产物一旦污染就会误导决策**。主要机制：

1. **契约版本化**：`contractVersion` 从 v1.0 → v2.0 → v2.1 平滑演进；旧产物按原版本继续渲染，网站同时支持 3 个版本
2. **Schema Linter**（`scripts/lint-outbox.mjs`）：自动校验所有 outbox 产物的 schema（字段名、枚举值、tier-score 一致性、权重总和、加权和校验）。**挂在 `build:public` 前置，schema 不过 → bake 不跑**
3. **Bake Freshness 三层警卫**：dev 启动打印警告 + UI 页脚红点 + bake 脚本 fail-fast，防止"改完 `.evaluations/` 忘 bake 导致对外版悄悄陈旧"
4. **前端兜底**：维度 name / 字段缺失时按 contractVersion 回退默认值，永远不会出现"白板表头"

详细设计沉淀见 [`.evaluations/README.md`](./.evaluations/README.md) 与 `.workbuddy/memory/MEMORY.md`（工程侧踩坑沉淀）。

---

## 🧪 测试

```bash
npm test              # 单次
npm run test:watch    # watch 模式
npm run test:coverage # 覆盖率报告
```

当前覆盖 3 个 critical 纯逻辑模块：
- `tests/sortProducts.test.ts` — AI 产品排序（Sophia 优先 + 版本比较 + orderHint）
- `tests/score.test.ts` — 分数着色阈值
- `tests/lintOutbox.test.mjs` — Schema linter 对合法/非法 payload 的判定

---

## 🤝 Contributing

这是一个个人评测实验室，但欢迎：

- 评测标准改进建议（提 Issue 讨论 RUBRIC_STANDARD.md 的维度定义）
- 加新的评测主体（更新 `PRODUCTS.json`）
- 报告对外版 bug（截图 + 触发步骤）

改代码时请确保：
- `npm run lint` 过
- `npm test` 过
- `npm run lint:outbox` 过（如果动了 outbox）
- `npm run build:public` 过（端到端自测）

---

## 📚 相关文档

- [`DEPLOY.md`](./DEPLOY.md) — 完整部署指南（首次部署 + 日常更新 + 常见问题）
- [`.evaluations/RUBRIC_STANDARD.md`](./.evaluations/RUBRIC_STANDARD.md) — 评测标准（面向用户）
- [`.evaluations/EVALUATION_CONTRACT.md`](./.evaluations/EVALUATION_CONTRACT.md) — LLM 工作协议（面向 Sophia）
- [`.evaluations/NAMING_CONTRACT.md`](./.evaluations/NAMING_CONTRACT.md) — 命名契约
- [`.evaluations/README.md`](./.evaluations/README.md) — .evaluations 目录索引

---

## 📄 License

个人实验项目，无明确 License（后续可能按 MIT 开源）。
