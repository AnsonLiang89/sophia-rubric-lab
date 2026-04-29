# MEMORY.md

- 更新日期：2026-04-28（23:14）
- 变更原因：契约升级到 v3.6，事实准确性方法论与跨版本稳定性机制沉淀。

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
- 版本语义：`contractVersion`（当前主线 **3.6**）与 `inboxSchemaVersion`（当前 2.1）独立演进。
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
- Submission（localStorage）与 Inbox（磁盘契约）是两条平行存储链。
- "待评测"判据：对比源正文最后变动时间晚于最新评测时间时，必须提示重跑评测。
- 边界隔离：`vite-plugins/` 严禁 import `src/` 代码。
- 契约/lint/schema 相关改动后的回归三连：`npm run lint:outbox` + `npm test` + `tsc -p tsconfig.app.json --noEmit`（UI 变更再加 `npm run lint`）。

