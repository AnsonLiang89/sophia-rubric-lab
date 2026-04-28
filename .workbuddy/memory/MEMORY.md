# MEMORY.md

- 更新日期：2026-04-28（14:08）
- 变更原因：按会话要求对 MEMORY 做去重压缩；保留仍有效的用户偏好与项目硬约束，删除过时/重复叙述。

## 用户偏好（稳定）

- 评测重点是**事实错误**与**逻辑错误**；发现承重点必须外部核验后再定档。
- 允许非共识观点，但必须给出**证据 + 推理链 + 决策增量**，禁止凭感觉下结论。
- 主阅读路径坚持“**评分总表 + 正文**”；避免把诊断拆成太多并列模块。
- 正文必须详实，偏好“**总-分-总四段**”：评测结论 → 按维度展开 → 额外重点问题 → 各主体优缺点与建议。
- 用户特别关注“**why 讲透**”：无论好坏都要给原文引文、判断依据、外部佐证与推理过程。
- 评测官要**客观中性、无立场**，聚焦经济/投资分析质量。
- 质量优先于速度：允许深挖核验，不以时间盒压缩分析深度。
- 工程与 UI 偏好：逻辑清晰可靠；破坏性动作必须 confirm；长文本编辑优先抽屉；写入链路需结构化日志可观测。

## 项目约定（当前有效）

- 评测执行顺序强约束：`EVALUATION_CONTRACT.md` → `RUBRIC_STANDARD.md` → `inbox/{taskId}.json` 全量 → `outbox/{taskId}/` 仅看版本号。
- 长 JSON 产物采用“**骨架 + 分段 replace**”策略，避免单次写入截断；交付前必须过 `json.load` 与 `npm run lint:outbox`。
- claim 核验中 `inconclusive` 不留尾：必须继续收敛到 verified/refuted，或明确不可核原因。
- 版本语义：`contractVersion`（当前主线 3.4）与 `inboxSchemaVersion`（当前 2.1）独立演进。
- taskId 扁平化（v3.4）：`taskId === queryCode`，同一 query 版本累计在 `outbox/{taskId}/vN.json`。
- v3.4 lint 硬约束：`taskId` 必须匹配 `^[A-Z]+-\d+$` 且等于 outbox 目录名；历史 v1.0~v3.3 读兼容不受影响。
- Submission（localStorage）与 Inbox（磁盘契约）是两条平行存储链；“看得见胶囊”不等于“已入 inbox”。
- “待评测”判据：对比源正文最后变动时间晚于最新评测时间时，必须提示重跑评测。
- 边界隔离：`vite-plugins/` 严禁 import `src/` 代码，避免 Node 求值期冷启动崩溃。
- 契约/lint/schema 相关改动后的回归三连：`npm run lint:outbox` + `npm test` + `tsc -p tsconfig.app.json --noEmit`（UI 变更再加 `npm run lint`）。
