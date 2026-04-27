# MEMORY.md

- 更新日期：2026-04-27（晚）
- 变更原因：补充 ReportPage「编辑对比源」面板升级后的产品观与 UX 约定。

## 用户偏好

- 用户希望评测把重点放在**事实性错误**和**逻辑错误**上；一旦发现此类问题，必须主动进行外部查验或补充搜索，而不是停留在主观判断。
- 用户希望评测显式关注**有依据的新意/非共识观点**：允许反直觉判断，但必须有证据和推理链，不能凭空捏造。
- 用户希望页面呈现**保留评分总表**，其他诊断信息（如每份报告反馈、核验地图等）都应并入**评测报告正文**，不要用过多独立模块切碎阅读路径。
- 用户会重点阅读**评测报告正文**，因此正文必须详实、符合五大基本维度与额外维度要求；每个评测观点都应有具体理由、论据，必要时引用原文。
- 用户偏好的报告结构是**总-分-总**落地为四段：1）评测结论；2）按维度展开结论、详情与论据；3）额外重点问题；4）Sophia 及其他评测对象做得好的和不好的地方，以及建议。
- **质量优先于速度**：v3.3 起取消 45min 硬时间盒，发现承重问题时允许也鼓励评测官深入核验，不让时间限制压缩评测深度。
- **文档偏好精简**：在严格保证内涵和细节要求不变的前提下，尽量去除冗余叙述、合并多版本并存的变更历史、把大型 JSON 示例下沉到独立文件，以提升作业效率。
- **UI 偏好**：代码逻辑清晰准确、不出篓子；UI 合理、清晰、优雅、直观。破坏性动作必须有 confirm，长文本编辑走抽屉而非整屏 Modal。

## 项目约定

- 项目已落地 **v3.3**（2026-04-27）：文档、契约、lint、前端全链路已对齐"评分总表 + 正文"阅读路径；去除 45min 硬时间盒；承重 claim 容量 Top 5 → Top 10。动作语义完全向后兼容 v1.0 ~ v3.2 所有历史产物。
- `crossProductInsights`、`perReportFeedback`、`claimInventory/claimChecks`、`dimensionChecklists`、`verificationBudget` 等结构化字段继续保留用于校验与聚合，但单份报告页面默认不再拆成独立主阅读模块。
- **版本号双轨制**：outbox `contractVersion`（当前 v3.3）与 inbox `inboxSchemaVersion`（当前 v2.0）语义完全独立；任何字段语义变更必须升对应版本号，并在契约 §7 记录；旧产物保留原版本兼容渲染。
- **契约完整示例**下沉到 `.evaluations/EVALUATION_CONTRACT_EXAMPLE.json` 独立文件；契约正文只保留骨架示意 + 引用。
- **产品观**：Sophia v3/v4/v5 在评测维度上与 MiroThink、Kimi、Gemini 等完全平级，各自是**独立 AI 产品**。同一评测任务里同一 AI 产品只能有 1 份原始报告；v3/v4/v5 的注册是 Products 页职责，不在 ReportPage 的对比源面板里引入"多版本并存"语义。
- **ReportPage 对比源管理**（2026-04-27 晚升级）：由单一入口 `ManageSourcesModal`（"📝 编辑对比源"）承担新增 / 改元数据 / 替换正文 / 删除四类动作。删除 submission 不联动 inbox（选项 A，留 orphan 给 cleanup 脚本）。替换正文必填 replacedReason ≥ 6 字 + contentHash 前端预检。新增默认不召唤评测，提供 checkbox 可选。
- **时区无损约定**：任何涉及 YYYY-MM-DD ↔ ISO 的转换都走"本地日期 × 12:00"锚点，禁止直接 `new Date("YYYY-MM-DD")`（=UTC 零点，东八区会偏一天）。
- **Store 更新签名**：`updateSubmission(s: Submission)` 接收完整对象而非 patch；调用方需 `{ ...sub, ...changes }` 自行合并。
- **回归三连**（任何契约/lint/schema 改动后必须跑）：`npm run lint:outbox` + `npm test` + `tsc -p tsconfig.app.json --noEmit`，三绿才算收口。UI 变更额外跑 `npm run lint`（ESLint）。
- **边界隔离硬约束**：`vite-plugins/` 目录下任何文件**严禁 import `src/` 下的模块**。原因：vite.config.ts 加载时 esbuild 会把 plugin 依赖链整条 bundle 到 Node 环境求值，而 `src/lib/dataSource.ts` 等前端模块顶层同步访问 `import.meta.env.PROD` / `BASE_URL`，在 Node 下会抛 `Cannot read properties of undefined (reading 'PROD')`，导致 dev server 冷启失败。需要共享的纯工具函数（hash、版本识别、安全校验等）必须各维护一份，或抽到一个只依赖 `node:*` + 纯 TS 类型的中立模块。2026-04-27 已踩过坑：`inbox.ts` 跨边界 import `readInboxSchemaVersion` 导致冷启爆雷。

