# MEMORY.md

- 更新日期：2026-04-28（下午）
- 变更原因：v3.4 **taskId 扁平化**后续收尾——清文档债（A 组：EvaluationRunModal 注释 / replace-report CLI / migrate-inbox CLI / dataSource.test 扁平化样本）+ 加 lint 硬约束（B 组：v3.4 产物 taskId 必须扁平化且等于目录名）。134 vitest pass，四绿收口。

## 用户偏好

- 用户希望评测把重点放在**事实性错误**和**逻辑错误**上；一旦发现此类问题，必须主动进行外部查验或补充搜索，而不是停留在主观判断。
- 用户希望评测显式关注**有依据的新意/非共识观点**：允许反直觉判断，但必须有证据和推理链，不能凭空捏造。
- 用户希望页面呈现**保留评分总表**，其他诊断信息（如每份报告反馈、核验地图等）都应并入**评测报告正文**，不要用过多独立模块切碎阅读路径。
- 用户会重点阅读**评测报告正文**，因此正文必须详实、符合五大基本维度与额外维度要求；每个评测观点都应有具体理由、论据，必要时引用原文。
- 用户偏好的报告结构是**总-分-总**落地为四段：1）评测结论；2）按维度展开结论、详情与论据；3）额外重点问题；4）Sophia 及其他评测对象做得好的和不好的地方，以及建议。
- **质量优先于速度**：v3.3 起取消 45min 硬时间盒，发现承重问题时允许也鼓励评测官深入核验，不让时间限制压缩评测深度。
- **文档偏好精简**：在严格保证内涵和细节要求不变的前提下，尽量去除冗余叙述、合并多版本并存的变更历史、把大型 JSON 示例下沉到独立文件，以提升作业效率。
- **UI 偏好**：代码逻辑清晰准确、不出篓子；UI 合理、清晰、优雅、直观。破坏性动作必须有 confirm，长文本编辑走抽屉而非整屏 Modal。新增/编辑表单的时间字段优先默认填“当前本地时间（分钟级）”，减少重复录入。
- **观测偏好**：任何"写入类"入口都要有结构化 console log（tag + stage + payload），让用户在 DevTools 里能立刻自查"我点的这下到底落哪儿了"。拒绝黑箱。

## 项目约定

- **评测官工作方法论（2026-04-28 EV-0002 复盘沉淀）**：
  - **读顺序强约束**：`.evaluations/EVALUATION_CONTRACT.md` → `.evaluations/RUBRIC_STANDARD.md` → `.evaluations/inbox/{taskId}.json` 全量 → `.evaluations/outbox/{taskId}/` 仅查版本号。**不要先翻历史 outbox 找样式参考**——历史产物可能是旧 contractVersion，按历史样式抄会违反当前契约（本次 EV-0002 v5 就栽在这儿，误扫了 v4 contractVersion=1.0 的简版）。
  - **长 JSON 产物落盘策略**：预估超 500 行或评测产物（含 5 份 perReportFeedback + claimChecks evidence + 四段正文）的 JSON，**禁止单次 write_to_file 试探**（单次输出 token 上限约 24000，中文内容几乎必然截断）。标准流程：① `write_to_file` 写一个最小骨架（含 `"__PLACEHOLDER__": true` 占位符）；② 多次 `replace_in_file` 把 rubric / SBS+feedback / claims / checklists+budget+crossInsights / report 字段依次替换上去；③ 最后 `python3 -c "import json; json.load(open(...))"` 验 JSON 合法 + `npm run lint:outbox` 过硬约束。EV-0002 v5 已验证该流程一次通过。
  - **inconclusive 不留尾**：pass2/pass3 核验中标记为 inconclusive 的 claim，必须再推一层——要么查清实际口径下结论是 verified-correct 还是 refuted，要么说清"为什么不可核"（例如：付费源不可得、上下文不足），不要停在"疑似口径交叉"这种第一反应结论。评测官的价值就在于把"疑似"变成"确认 / 排除"。
  - **召唤口令升级**（见 `src/lib/contract.ts::buildSummonPrompt`）：从 5 行软性引导升级为"强制读顺序 + 落盘方式提示 + 核验深度约束 + 10 条交付前自检清单"，减少评测官"凭手感判"的不稳定性。自检清单每一条都对应 `scripts/lint-outbox.mjs` 的一条硬约束，打完钩基本一次过 lint。
- 项目已落地 **v3.3**（2026-04-27）：文档、契约、lint、前端全链路已对齐"评分总表 + 正文"阅读路径；去除 45min 硬时间盒；承重 claim 容量 Top 5 → Top 10。动作语义完全向后兼容 v1.0 ~ v3.2 所有历史产物。
- `crossProductInsights`、`perReportFeedback`、`claimInventory/claimChecks`、`dimensionChecklists`、`verificationBudget` 等结构化字段继续保留用于校验与聚合，但单份报告页面默认不再拆成独立主阅读模块。
- **版本号双轨制**：outbox `contractVersion`（当前 v3.4）与 inbox `inboxSchemaVersion`（当前 v2.1）语义完全独立；任何字段语义变更必须升对应版本号，并在契约 §7 记录；旧产物保留原版本兼容渲染。v2.1 新增顶层 `nextVersion`（服务端按 outbox 目录回填），用于召唤口令直接给出应提交的 `vN.json`，减少人工扫目录和版本漂移。
- **契约完整示例**下沉到 `.evaluations/EVALUATION_CONTRACT_EXAMPLE.json` 独立文件；契约正文只保留骨架示意 + 引用。
- **产品观**：Sophia v3/v4/v5 在评测维度上与 MiroThink、Kimi、Gemini 等完全平级，各自是**独立 AI 产品**。同一评测任务里同一 AI 产品只能有 1 份原始报告；v3/v4/v5 的注册是 Products 页职责，不在 ReportPage 的对比源面板里引入"多版本并存"语义。
- **ReportPage 对比源管理**（2026-04-27 晚升级）：由单一入口 `ManageSourcesModal`（"📝 编辑对比源"）承担新增 / 改元数据 / 替换正文 / 删除四类动作。删除 submission 不联动 inbox（选项 A，留 orphan 给 cleanup 脚本）。替换正文必填 replacedReason ≥ 6 字 + contentHash 前端预检。新增默认不召唤评测，提供 checkbox 可选。
- **taskId 扁平化（v3.4，2026-04-28 起）**：
  - **新语义**：`taskId === queryCode`（如 `EV-0002`）。同一 query 的多轮评测累积写入 `outbox/EV-0002/vN.json`；inbox 为 `inbox/EV-0002.json`。
  - **动机**：v3.3 及以前 `taskId = ${queryCode}-${nano6()}`，每次"召唤评测"前端 `makeTaskId()` 生成新 suffix → 新目录，导致 outbox 碎片化（EV-0002 下过去曾有 4 个 suffix 目录），前端 `pickLatestTaskByQueryCode` 只展示最新那份，其余历史"埋了"。
  - **实现点**：
    - `src/lib/contract.ts::makeTaskId` → 直接返回 `queryCode`（删 nano6 拼接）
    - `contractVersion` 联合类型追加 `"3.4"`
    - `vite-plugins/bus/handlers/inbox.ts::handlePostInbox`：文件已存在时**不再 409**，按 `candidateId` 合并 candidates（新 → 追加；已存在 → 保留磁盘权威副本，含 reportVersions / activeReportVersion / productVersion / authorNote）；顶层 query 元信息以新提交为准
    - `vite-plugins/bus/helpers.ts::parseQueryCode` 正则 `^([A-Z]+-\d+)(?:-|$)` 兼容两种形态
    - `vite-plugins/codeRegistry.ts::parsePrefixCode / renamePrefix` 同时认 `EV-XXXX` 和 `EV-XXXX-suffix[.json]`
    - `scripts/migrate-consolidate-outbox.mjs`：一次性按 mtime 合并历史 suffix 目录/文件；迁移完成，6 个扁平化 outbox 目录 + 6 个扁平化 inbox 文件
    - `scripts/lint-outbox.mjs` 允许 `contractVersion="3.4"`；目录扫描本就宽松，未改
    - `src/lib/contractAdapter.ts::DEFAULT_RUBRIC_NAMES` 加 3.4 映射
  - **兼容性**：所有 v1.0 ~ v3.3 outbox 产物继续按原 contractVersion 渲染；`flattenTaskVersions` 对混合目录（万一有漏网之鱼）也能按 (taskId, version) mtime 统一编号。
  - **lint 硬约束（v3.4+）**：`scripts/lint-outbox.mjs::validatePayload` 新增可选第 4 参 `expectedTaskId`，当 `contractVersion === "3.4"` 时激活两条硬约束：① `taskId` 必须匹配 `^[A-Z]+-\d+$`（防回退到旧 suffix 形态）；② 若传 `expectedTaskId`（= outbox 目录名），`payload.taskId` 必须与之完全一致（防目录漂移）。`lintOutbox()` 从 `path.basename(path.dirname(file))` 推目录名传入；单测不传就只校验格式（兼容路径）。历史 v1.0~v3.3 产物不受新约束影响。
  - **回归**：`lint:outbox`（16 outbox + 6 inbox） / `vitest`（**134 pass**，此前 126 + 新增 dataSource 扁平化样本 2 + lintOutbox v3.4 硬约束 6 = 134） / `tsc` / `eslint` / dev server 冷启 `[codeRegistry] reconcile: no-op (7 entries tracked)` 全绿。
  - **身份锚语义**：原"两段式 queryCode + suffix"的双段身份锚，由 payload 里冗余的 `queryId`（UUID）本体承担 reconcile 主键作用；suffix 的弱防护功能让位于扁平化带来的"一个 query 一个目录"直观语义。
  - **展示层**：ReportPage 的 `flattenTaskVersions` + `ReportVersionPicker` 天然展示 `EV-0002/v1/v2/.../vN`，无需前端改动；召唤评测按钮点了以后会往已有目录追加 `v{N+1}`，不再生成新 suffix。

- **作废条目：taskId 双段结构（`${queryCode}-${suffix6}`）**
  - 这条是 v3.3 及以前的设计，2026-04-28 起已扁平化，见上一条。旧 outbox 里历史目录/文件已经迁移合并；兼容代码保留认旧形态但新写入不再生成 suffix。
- **两条平行存储认知陷阱**（2026-04-27 深夜沉淀）：
  - **Submission（localStorage 镜像）**：`store.createSubmission / updateSubmission / deleteSubmission` 写入，负责 ReportPage 胶囊展示、产品清单。
  - **Inbox candidate（磁盘契约）**：`.evaluations/inbox/*.json`，**只在"召唤评测"走 `contractBus.upsertInbox`** 时才会被写；replace-content 走 PATCH 追加 reportVersions。
  - 直接后果：在"编辑对比源"里新增/改/删 submission 都**只动 localStorage，不落磁盘**。胶囊"看得见" ≠ inbox"有"。这不是 bug 而是架构语义，必须靠 UI 文案 + "待评测"徽标 + 日志链显式暴露，避免用户误判。
- **"待评测"徽标判据**（2026-04-28 升级，取代 2026-04-27 的"未参评"布尔判据）：
  - 核心判据：`lastContentChangeAt(sub) > latestEvalMtime`
    - `lastContentChangeAt` = inbox `reportVersions[last].submittedAt`（有 inbox 记录）/ `sub.createdAt`（全新产品）
    - `latestEvalMtime` = 整条 query 下 `outboxTasks.latestMtime` 的最大值
  - 两种命中场景：① 全新对比源从未召唤；② 走"替换正文"追加了 reportVersions 但还没重跑评测。改元数据不触发（contract 保证 `updateSubmission` 不 push 新 reportVersions）。
  - UI 表现：胶囊 "待评测" 小徽标 + 虚线边 + 灰色点；"召唤评测" 按钮右上角脉冲小圆点（`bg-clay` + `ring-2 ring-white` + `animate-ping` 光晕，7px，不带数字）。
  - 只读/公开模式 `pendingSubIds` 强制清空 → 徽标 + badge 整体隐藏。
  - 实现位置：`src/pages/ReportPage.tsx`（纯前端派生，不动 store / 契约 / 写入链路）。
  - 注意：`pendingSubIds` 的 `useMemo` 必须放在所有 early return **之前**，否则触发 `react-hooks/rules-of-hooks`。
- **时区无损约定（含纯日期陷阱）**：
  - 任何涉及 YYYY-MM-DD ↔ ISO 的转换都走"本地日期 × 12:00"锚点，**禁止直接 `new Date("YYYY-MM-DD")`**（按 UTC 零点解析，东八区偏一天 / 显示 08:00）。
  - `Query.reportDate` 是**纯日期字段**（YYYY-MM-DD），不能作为 `datetime-local` 控件的时间默认值。前端用 `isDateOnlyString()` 检测，遇到纯日期就回退到 "现在"。
- **前端操作日志规范**：
  - ManageSourcesModal 四入口（create / update-meta / delete / replace-content）统一走 `srcLog(action, stage, payload)`，tag `[sources]`，begin / done / fail 三阶段。done 必须带 hint 说明落到了 localStorage 还是 inbox。
  - `store.ts` 的 submission 三方法统一打 `[store.submission] {create|update|delete}` log。
  - DevTools 里过滤 `[sources]` 或 `[store.submission]` 即可完整还原一次对比源操作链路。
- **Store 更新签名**：`updateSubmission(s: Submission)` 接收完整对象而非 patch；调用方需 `{ ...sub, ...changes }` 自行合并。
- **回归三连**（任何契约/lint/schema 改动后必须跑）：`npm run lint:outbox` + `npm test` + `tsc -p tsconfig.app.json --noEmit`，三绿才算收口。UI 变更额外跑 `npm run lint`（ESLint）。
- **边界隔离硬约束**：`vite-plugins/` 目录下任何文件**严禁 import `src/` 下的模块**。原因：vite.config.ts 加载时 esbuild 会把 plugin 依赖链整条 bundle 到 Node 环境求值，而 `src/lib/dataSource.ts` 等前端模块顶层同步访问 `import.meta.env.PROD` / `BASE_URL`，在 Node 下会抛 `Cannot read properties of undefined (reading 'PROD')`，导致 dev server 冷启失败。需要共享的纯工具函数（hash、版本识别、安全校验等）必须各维护一份，或抽到一个只依赖 `node:*` + 纯 TS 类型的中立模块。2026-04-27 已踩过坑：`inbox.ts` 跨边界 import `readInboxSchemaVersion` 导致冷启爆雷。


