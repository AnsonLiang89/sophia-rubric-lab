# MEMORY.md

- 更新日期：2026-06-03（18:42）
- 变更原因：契约升级 v3.7（子问题覆盖矩阵 + 决策信噪比 + 非共识跨产品归集）；lint 版本门彻底数值语义化。

## 用户偏好（稳定）

- 评测重点是**事实错误**与**逻辑错误**；发现承重点必须外部核验后再定档。
- 允许非共识观点，但必须给出**证据 + 推理链 + 决策增量**，禁止凭感觉下结论。
- 主阅读路径坚持"**评分总表 + 正文**"；避免把诊断拆成太多并列模块。
- 正文必须详实，偏好"**总-分-总四段**"：评测结论 → 按维度展开 → 额外重点问题 → 各主体优缺点与建议。
- 用户特别关注"**why 讲透**"：无论好坏都要给原文引文、判断依据、外部佐证与推理过程。
- 评测官要**客观中性、无立场**，聚焦经济/投资分析质量。
- 质量优先于速度，但希望**同时提高效率**：分层核验、信源复用优先级高于"完美但重复"。
- **不依赖历史产物做评测**：每轮评测必须能独立发现承重错误；历史只做最后一步一致性兜底。
- 工程与 UI 偏好：逻辑清晰可靠；破坏性动作必须 confirm；长文本编辑优先抽屉；写入链路需结构化日志可观测。

## 项目约定（当前有效）

- 评测执行顺序强约束：`EVALUATION_CONTRACT.md` → `RUBRIC_STANDARD.md` → `inbox/{taskId}.json` 全量 → **禁止在评测开头或中途参考 outbox 历史，仅在最后一步做 history-gate 兜底**。
- 长 JSON 产物采用"**骨架 + 分段 replace**"策略，避免单次写入截断；交付前必须过 `json.load` 与 `npm run lint:outbox`。
- 版本语义：`contractVersion`（当前主线 **3.7**）与 `inboxSchemaVersion`（当前 2.1）独立演进。
- taskId 扁平化（v3.4 起）：`taskId === queryCode`，同一 query 版本累计在 `outbox/{taskId}/vN.json`。
- v3.4 lint 硬约束：`taskId` 必须匹配 `^[A-Z]+-\d+$` 且等于 outbox 目录名。
- **v3.5 硬约束（报告详实化 + 效率优化）**：
  1) 正文第二段必须含"维度×产品交叉验证矩阵"；
  2) 高影响判断必须含 **why 三联**：原文引文 + 外部核验结论 + 推理链；
  3) `perReportFeedback` 每产品 ≥2 条 strengths + 2 条 weaknesses；
  4) `inconclusive` 必须写明"不可核原因 + 下一步核验动作"；
  5) Pass 2 采用 **P0/P1/P2 承重分层 + 同源证据 sourceId 复用**。
- **v3.6 新增硬约束（事实准确性方法论 + 跨版本稳定性）**：
  1) `summary.factCoverageMatrix`：T1~T8 八类事实类型必须全扫描（T1 数字/T2 时间/T3 货币量纲/T4 主体或适应症/T5 因果/T6 信源/T7 范围 scope/T8 口径一致性），每类给"有/无/原因"显式记录；存在的类别至少 1 条 claim 进 inventory；
  2) `claimChecks[].pass1Question`：每条 claim 必须写明怀疑点，没有问题不得进入 Pass 2；
  3) Pass 2 三条强制核验动作（A 专名+分类反查 / B 大额数字量纲对照 / C scope 对齐 query），结果写入 `verificationBudget.notes`；
  4) `overallScores[].deltaReason`：跨版本同 reportId 总分 Δ≥1.0 或跨档/veto 翻转必须写明变动来源；
  5) 历史 outbox 只在最后一步参考（history-gate 阶段），严禁在开头或中途引用。
- lint 脚本对 3.6 产物做以下结构校验：factCoverageMatrix（T1~T8 齐全 + 每类 perReport 覆盖全 candidates + present=true 需 sampleQuote 与 claimIdsSampled）、claimChecks pass1Question 必填、deltaReason 条件必填（通过读 v{N-1}.json 对比）。
- **v3.7 新增硬约束（答题颗粒度 + 决策信噪比，2026-06-03 生效）**：
  1) `summary.queryCoverageMatrix`：query 含 ≥2 子问题时必填，逐子问题×逐产品判 `full/partial/missing`，覆盖全 candidates，partial/missing 必给 note（契约 §3.13）；单一诉求 query 整体省略。
  2) R5 必查 checklist 5→6 项，新增"信息冗余/篇幅膨胀稀释决策价值/甄别成本过高"负向项；**篇幅永不作为 R5 加分理由，堆字数≠帮决策**；长报告零 caveat 诚实度轴再降一档。
  3) R3 checklist 加"跨产品非共识归集"（逐产品列差异化观点+是否带why三联+决策增量）。
  4) history-gate 的 deltaReason 须说明"差异来源=新证据/视角变化"。
- **lint 版本门铁律（三次踩坑后定）**：凡按 contractVersion 分支的判断，**一律用 `cvNum = Number.parseFloat(cv); cvNum >= X` 数值语义**，禁用精确枚举(`cv==="3.6"`)和枚举白名单。已统一：isV2Plus/isV22Plus/isV3/isV36Plus/isV37Plus/isClaimTopTen/targetMinutes门/四段锚点门/扁平化门/contractVersion白名单。
- Submission（localStorage / `_runtime-snapshot.json`）与 Inbox/Outbox（磁盘契约）是两条平行存储链。**新增候选时三处都要补**：inbox candidates + outbox 评测 + snapshot.submissions（否则 `build:public` 的 bake 报 dangling reportId）。补 submission 关键字段：`id`=reportId、`queryId`=query.id、`productId`=PRODUCTS.json 已注册 id、`content`=正文。
- "待评测"判据：对比源正文最后变动时间晚于最新评测时间时，必须提示重跑评测。
- 边界隔离：`vite-plugins/` 严禁 import `src/` 代码。
- **生产构建铁律（2026-06-04 踩坑后定）**：dev 构建污染的真凶是环境变量 `NODE_ENV=development`，**`--mode production` 压不住它**。`build`/`build:public` 的 vite build 必须加 `NODE_ENV=production` 前缀。污染会让 `import.meta.env.PROD=false` → 只读版退化成读 localStorage 旧 seed（页面只剩 2 产品 1 题），且零报错。验证构建纯净探针：`grep -c "fileName:" dist/assets/index-*.js` 应为 0（>0=dev JSX 注入）。运行时已有 `detectBuildModeAnomaly()`（指纹 `env.DEV && !import.meta.hot`）在 App init 时 console.error 兜底。
- **前端「数据缺失」排障铁律**：必须用 agent-browser 实地看渲染，不能只 curl 数据层——数据层 200 完整 ≠ 页面正确（store adapter 选错会读错源）。
- 契约/lint/schema 相关改动后的回归三连：`npm run lint:outbox` + `npm test` + `tsc -p tsconfig.app.json --noEmit`（UI 变更再加 `npm run lint`）。

## 工程踩坑（评测官写产物时高频翻车点）

- **lint-outbox 期望字段名是 `dimensionId`**（rubric / extraDimensions 都是），契约 §3.0 示例写的是 `id` 但 lint 实现取的是 `dimensionId`，存在契约示例与 lint 不一致。直接用 `dimensionId` 即可。
- **extraDimensions 即便 `activated=false` 也必须显式 `scores: []`**，否则 lint 报「必须是数组」。
- **JSON 内 markdown 引用片段「...」严禁出现未转义的 ASCII `"`**——写产物时一律把中文场景里的 `"x"` 改成 `『x』` / `"x"` / `'x'`，可避免反复修 JSON 语法错。
- **lint 版本门已改为数值语义比较**（2026-06-03 修复）：`isV2Plus = cvNum >= 2.0` / `isV22Plus = cvNum >= 2.2` / `isV3 = cvNum >= 3.0`，杜绝新增 contractVersion 时再漏纳入枚举白名单。
- **lint legacy grandfather 机制**：`LEGACY_GRANDFATHER` 集合中的历史文件（EV-0002~EV-0011 共 14 个版本）的违规降级为 warning 不阻断 exit code；EV-0012 及未来产物走全严格校验。新增历史文件需注明原因和日期；新产物绝不入此清单。

