# 命名契约（NAMING CONTRACT）

> 本目录所有"长得像编号、id 或标识"的东西到底是什么、谁分配、谁可以看、能不能变——一份就看懂。
> 任何新增字段、修改命名规则之前请先读完本文件，然后更新此文件保持同步。

---

## 🎯 命名的三类对象

Sophia Rubric Lab 里的"标识"可以划成三层，**层与层之间不能混用**：

| 层 | 用途 | 稳定性 | 给谁看 |
|---|---|---|---|
| **永久 id** | 数据库主键、跨会话引用 | 一旦分配永不改变 | 程序（前端 store、后端 bus、outbox payload） |
| **展示 code** | 人类能记住的编号、UI 徽章 | 理论稳定，偶尔可手动重排 | 用户（管理员、访客） |
| **复合 taskId** | 一次评测召唤的唯一定位符 | 分配后不改 | 程序（inbox/outbox 文件名） |

**核心原则**：
- **永久 id 是事实源**，所有跨对象引用都应使用 id
- **code 只是"给人看的外衣"**，允许在合理边界内重排
- **taskId 封装了 code**，但 code 变更时 taskId **不自动改名**（由 reconcile 迁移）

---

## 📇 各字段契约

### 1. `query.id`（永久）
- **形式**：`nanoid(10)`，例 `vW5Ow0yQXI`
- **由谁分配**：前端 `store.createQuery()` 在本地 nanoid 生成
- **在哪里出现**：
  - `localStorage` 的 `queries[].id`
  - `.evaluations/_runtime-snapshot.json` 的 `queries[].id`
  - `.evaluations/_seed-snapshot.json` 的 `queries[].id`
  - `.evaluations/_code-registry.json` 的 `entries[].queryId`
  - outbox payload 的 `queryId` 字段（冗余写入，方案 D）
- **能否变更**：**永不**。这是跨所有数据层的稳定锚点。

### 2. `query.code`（展示编号）
- **形式**：`EV-XXXX`（XXXX 是递增四位数，例 `EV-0005`）
- **由谁分配**：**后端 `_code-registry.json` 独占分配权**
  - 前端调 `POST /_bus/register-code`，传 `{queryId, preferredCode?, registeredAt}`
  - 后端按 `registeredAt` 时间序递增 `nextNumber` 分配，永不回收已用号
- **在哪里出现**：
  - `_code-registry.json` `entries[].code`（权威事实源）
  - `_runtime-snapshot.json` / `_seed-snapshot.json` 的 `queries[].code`
  - `localStorage` 的 `queries[].code`
  - 所有 `inbox/{taskId}.json` / `outbox/{taskId}/` 的 **taskId 前缀**
- **能否变更**：**理论上可以**（通过注册簿 reconcile），但会级联改所有 taskId 前缀。前端从不主动改 code。
- **唯一性**：全局唯一。bake 脚本、reconcile、register-code 端点三处都做唯一性校验，冲突 fail fast。

### 3. `submission.id`（永久）
- **形式**：`nanoid(10)`，例 `dNtlBBFX3m`
- **由谁分配**：前端 `store.createSubmission()` 本地 nanoid 生成
- **在哪里出现**：
  - `localStorage.submissions[].id`
  - `_runtime-snapshot.json` / `_seed-snapshot.json` 的 `submissions[].id`
  - **outbox payload 的 `reportId`** ← 关键隐式契约
  - `public/data/reports/{submissionId}.md` 文件名（对外版懒加载）
- **能否变更**：**永不**。一旦被 outbox 引用就冻结。
- **隐式契约**：outbox payload 的 `summary.overallScores[].reportId`、`rubric[].scores[].reportId` 必须能在 submissions 表里找到——bake 脚本的 `validateReportIds()` 会对孤儿 reportId fail fast。

### 3.1 `submission.displayCode`（展示编号，纯计算不入库）
- **形式**：`{queryCode}-R{N}`，例 `EV-0005-R1`、`EV-0005-R2`
- **由谁分配**：**展示层按需计算**（`src/lib/submissionDisplayCode.ts` 的 `computeSubmissionDisplayCodes()`）
  - 不持久化到数据库、snapshot、localStorage、outbox 任何一处
  - 每次渲染现算，跟随当前权威 `queryCode` 变化，零数据迁移风险
- **排序规则**：同一 queryId 下，按 `(submittedAt, createdAt, id)` 稳定升序分配 N=1,2,3...
  - 用户反馈维度：submittedAt 更符合直觉（报告本身生成时间先后）；createdAt / id 只是兜底排序键
- **当前使用范围（2026-04-21）**：仅用于 `RawReportModal`（原始报告沉浸式弹窗）标题处的 badge 展示
- **能否变更**：跟随 queryCode 变化会自动重算；新增/删除同 query 下的 submission 也会让 R 序号连带变化——**这是设计目标，不是 bug**
- **扩展约束**：未来若扩展到其他 UI 位置，消费方也必须通过 `computeSubmissionDisplayCodes()` 统一计算，**禁止**另起炉灶
- **不是什么**：
  - 不是跨对象引用键（跨对象仍用 `submission.id`）
  - 不是 URL 参数（不会变成路由锚点）
  - 不是 outbox payload 的字段（LLM 写产物时仍用 `reportId = submission.id`）

### 4. `product.id`（永久）
- **形式**：手工命名的 slug（不是 nanoid），例 `sophia-ai-v5` / `manus` / `gemini`
- **由谁分配**：人工编辑 `.evaluations/PRODUCTS.json`
- **在哪里出现**：
  - `PRODUCTS.json` 的 `products[].id`
  - `submissions[].productId`
  - outbox payload 的 `overallScores[].productName`（**注意：product 维度用 productName 字符串，不直接携带 productId**）
- **能否变更**：不建议。改了要同步刷所有 submission.productId；若已被 outbox 引用过则不要改。

### 5. `taskId`（复合，一次评测召唤的唯一定位符）
- **形式**：`${queryCode}-${nanoid(6)}`，例 `EV-0005-CAP0sN`
- **由谁分配**：前端发起评测时 `contract.buildInboxPayload()` 生成
- **组成语义**：
  - 前缀 `EV-XXXX`：所属 query 的 code（便于命令行直观看出归属）
  - 后缀 `nanoid(6)`：随机短串，解决同一 query 多次召唤的冲突
- **在哪里出现**：
  - `inbox/{taskId}.json` 文件名
  - `outbox/{taskId}/v{n}.json` 文件夹名
  - outbox payload 的 `taskId` 字段
- **能否变更**：**一旦写入 outbox 就不由前端改**；但 reconcile 在 code 被官方重排时会把 taskId 前缀一起 rename（inbox 和 outbox 目录）。
- **反查规则**：
  - `parseQueryCode(taskId)` = 取第一段 `-` 之前的前缀，正则 `^([A-Z]+-\d+)` → `EV-0005`
  - `suffix = taskId.slice(-6)` 是随机串，reconcile 里用 suffix 做 fallback 匹配

### 6. `version`（outbox 版本号）
- **形式**：从 1 起的递增整数
- **由谁分配**：LLM 评测官写 outbox 时**自扫目录**决定下一个版本号
  - `outbox/{taskId}/` 里看有 v1/v2/v3，下次写 v4.json
- **在哪里出现**：`outbox/{taskId}/v{n}.json`，payload 的 `version` 字段
- **能否变更**：历史版本永不覆盖，只追加

---

## 🔗 映射关系速查

```
                    ┌──────────────────────────────────┐
                    │  _code-registry.json (权威)       │
                    │  entries: [{queryId, code, ...}]  │
                    └───────────┬──────────────────────┘
                                │ exportMap() / lookupByCode
                  ┌─────────────┼─────────────┐
                  ▼             ▼             ▼
         localStorage      snapshot        outbox payload
         queries[].id   queries[].id     queryId (冗余)
         queries[].code queries[].code   taskId 前缀 = code

         submissions[].id ◀────── outbox payload.summary.overallScores[].reportId
                                  outbox payload.summary.rubric[].scores[].reportId
```

**读这张图的关键点**：
1. **code 的流向**：注册簿 → snapshot → localStorage；localStorage 只是缓存镜像，不是事实源
2. **id 的流向**：前端生成 → 注册簿登记 queryId；submission.id 生成后 + 写 outbox 即冻结
3. **冗余字段**：outbox payload 既有 taskId 前缀能解出 code，又有独立 queryId——code 变更时 queryId 仍能稳定回查

---

## ⚠️ 三类常见陷阱

### 陷阱 1：前端自己编 code
**症状**：前端写 `code: 'EV-' + String(maxExistingNumber + 1).padStart(4, '0')`，然后保存。
**后果**：两个前端标签页同时操作就会撞号；reconcile 检测到冲突直接报错。
**正确姿势**：**永远**先 `await contractBus.registerCode({queryId, registeredAt})` 拿权威 code，再 commit。

### 陷阱 2：用 code 做长期引用
**症状**：后端数据表里存 `queryCode: "EV-0005"` 而不是 queryId。
**后果**：code 被 reconcile 重排后引用全部断链。
**正确姿势**：跨对象引用永远用 id（queryId / submissionId / productId）。

### 陷阱 3：outbox 产物的 `reportId` 随手瞎填
**症状**：LLM 写 outbox 时以为 reportId 是 taskId 或 productId。
**后果**：bake 的 `validateReportIds()` 直接 fail，发布被卡住。
**正确姿势**：reportId = 前端 `submission.id`（inbox 的 `candidateReports[].reportId` 字段已经给出，直接抄）。

---

## 🧭 面向维护者的检查清单

做这些操作时请对照本文件：

- [ ] 新增一种需要编号的对象（例如 "evaluator 评测官编号"）→ 先决定它属于永久 id / 展示 code / 复合 id 哪一层，再设计格式，最后更新本文件
- [ ] 要修改 `_code-registry.json` 手工补数据 → 仅能追加 `entries`，不能删、不能改已有条目的 queryId；`nextNumber` 只能增不能减
- [ ] 删除一个 query → 级联删 inbox/outbox 对应 taskId 文件，但**不要**回收 code（本文件§2：永不回收）
- [ ] 要升级 outbox payload schema → 先在 `EVALUATION_CONTRACT.md` 记录版本变更，不变更 reportId/queryId 两个外键字段的语义

---

## 📎 与其他文档的关系

- **`.evaluations/EVALUATION_CONTRACT.md`** — outbox payload 字段定义、版本契约；本文件是"命名"视角，那份是"数据形状"视角
- **`.evaluations/RUBRIC_STANDARD.md`** — 评测维度 id（R1~R5）、issueTags 词表；这些是**常量枚举**，不归本文件管
- **`.workbuddy/memory/MEMORY.md`** — 三源数据分工表（`_seed` / `_runtime` / `_code-registry`）、reconcile/bake 二次防御流程——属于工程实现侧沉淀
