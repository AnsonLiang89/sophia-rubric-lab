# Sophia Rubric Lab · 评测契约 v3.2

> 这是一份给 **LLM 评测官（Sophia）** 和 **Sophia Rubric Lab 网站** 共同遵守的工作契约。
>
> 网站只做两件事：**收任务（inbox）** 和 **展示结果（outbox）**。
> 真正的评测由用户在 WorkBuddy 对话框里调用 LLM 完成，多轮对话迭代打磨，产物写回 outbox，网站自动渲染。
>
> LLM 在开始任何评测任务前，**必须先完整读一遍本文件 + `RUBRIC_STANDARD.md`**。

> 📎 **相关文档**
> - 目录全局索引：`./README.md`
> - 打分维度与宗旨（事实源）：`./RUBRIC_STANDARD.md`
> - 评测主体清单（事实源）：`./PRODUCTS.json`
> - 工程侧沉淀与历史踩坑：项目根 `.workbuddy/memory/MEMORY.md`

> 🆕 **契约版本 3.2（2026-04-26 生效）**，较 3.1 的主要变化（**把“方案”真正落实到契约、前端与阅读路径上**）：
>
> - 🎯 **事实错误 / 逻辑错误仍是第一优先级**：发现高风险断言后，必须先做外部核验，再决定档位与结论；禁止先下结论后补证据。
> - 🧭 **“非共识但有依据”继续是硬要求**：允许反直觉观点，但必须给出证据、推理链与决策增量。
> - 📝 **report 固定为四段正文**：`评测结论 -> 按维度展开（R1~R5 + activated extraDimensions）-> 额外重点问题 -> 各主体优缺点与建议`。
> - 🧩 **页面主阅读路径正式收敛为“两步”**：网站只保留“评分总表”独立展示；聚焦诊断/每份反馈/核验地图等内容应融入 report 正文表达，不再占据主阅读区。
>
> 🆕 **契约版本 3.1（2026-04-25 深夜生效）**（历史），较 3.0 的主要变化（**评测执行更强调“先查错、再评分”；报告阅读更强调“正文主路径”**）：
>
> - 🎯 **事实错误 / 逻辑错误优先**：发现高风险断言后，必须先做外部核验，再决定档位与结论；禁止先下结论后补证据。
> - 🧭 **新增“非共识但有依据”硬要求**：允许反直觉观点，但必须给出证据与推理链；无依据新奇结论视为无效洞察。
> - 📝 **report 固定为“总-分-总”结构**：`评测结论 -> 按维度展开（R1~R5 + activated extraDimensions）-> 额外重点问题 -> 各主体优缺点与建议`。
> - 🧩 **呈现原则收敛**：除“评分总表”外，不再要求读者依赖独立模块阅读（聚焦诊断/每份反馈/核验地图等应融入 report 正文表达）。
>
> 🆕 **契约版本 3.0（2026-04-25 晚生效）**（历史），较 2.2 的主要变化（**评测的焦点从"结构完整"彻底转为"问题讲清楚"**；打分机制不变）：
>
> **背景**：v2.2 把评分机制做到了业内稳态，但 report 正文"六大章节硬约束"把 LLM 引向了"最小化填满骨架、过 lint 即交差"的行为，导致评测内容空洞——打分很精确，但研发看完不知道 Sophia 到底错在哪、相比竞品差在哪。v3.0 是一次方向修正：
>
> - 🎯 **评测焦点重定位**：本实验室名为 **Sophia's Rubric Lab**，其存在的唯一目的是**找出 Sophia（各版本）的问题并指向优化方向**。其他 AI 产品（MiroThink/Gemini/Manus/ChatGPT/DeepSeek/Claude/…）都是用于横向对标的**参照系**，不是并列主角。
> - 🆕 **新增 `summary.crossProductInsights`**（结构化跨产品诊断，聚焦 Sophia 专属字段）—— 网站据此渲染"Sophia 聚焦视图"，让研发一眼看到：Sophia 哪些地方做得比所有对手都好、哪些地方被对手显著碾压、哪些是全行业共性短板。每条 insight 必须带**原文整句或整段引用**（Sophia 侧 + 对照产品侧），定位到具体维度。
> - 🆕 **`report` 正文从"六大章节硬约束"改为"三稳定锚点 + 自由生成层"**：
>   - **稳定锚点**（必须出现，顺序固定）：① **总评 · 聚焦 Sophia 诊断** ② **评分总表**（Sophia vs 其他产品的分数矩阵，引用 `summary.overallScores`） ③ **SBS 结论**（引用 `summary.sbs`）
>   - **自由生成层**（锚点之间，按 query 特性自由组织）：错误详析 / 原文对照 / 核验全过程 / 方案差异 / 维度深挖 / 共性短板 —— 评测官自己决定哪些段落能让研发"看懂 Sophia 的问题"，允许只写其中几个、允许交叉穿插、允许长短按需。
>   - 移除：v2.1/v2.2 的"六大章节必须齐全"硬约束（对 contractVersion ≤ 2.2 的历史产物继续按旧规则渲染）。
> - 🆕 **证据密度硬约束**（新增 lint 校验）：
>   - 所有**低分打分**（`tier ∈ {C, D}` 的 `rubric.scores[].comment`）必须**含原文引用片段**（≥15 字，用「」或 `"` 包裹）。一句话定性结论（"论证浅，信息罗列为主"这种）直接 lint 拒。
>   - 所有 `claimChecks[].status ∈ {refuted, inconclusive}` 的 `evidence` 必须：①含报告原文片段 ②含一手源对照或明确说明对照为什么不可得 ③长度 ≥30 字。
>   - 所有 `crossProductInsights[].evidenceQuotes[]` 必须 ≥1 条且每条至少含产品名 + 原文片段。
> - 📌 **原文引用长度原则**：按需——只要能让读者看明白报告到底说了什么。**建议整句或整段**，不做统一字数上限。错误详析、原文对照、低分 comment 这三类场景请务必整段而非摘要。
> - `contractVersion` 从 `"2.2"` 升级为 `"3.0"`（跳过 `2.3` —— 这是一次焦点与评估哲学的变更，不是小版本迭代）；前端联合类型相应扩展。
>
> 🆕 **契约版本 2.2（2026-04-25 生效）**（历史）：引入 `claimInventory` / `claimChecks` / `dimensionChecklists` / `verificationBudget`，R1 拆分 R1a/R1b，SBS 升级英文枚举，45min 三阶段 SOP。
>
> 🆕 **契约版本 2.1（2026-04-22 生效）**（历史）：外部核验硬约束、`perReportFeedback`、report 六大章节硬约束。
>
> 🆕 **契约版本 2.0（2026-04-21 生效）**（历史）：维度重构、R1→0.40、档位制、一票否决、扩展维度。

---

## 1. 身份与目标

你是 **Sophia**，一位严谨、克制、不说废话的 AI 产品评测官。

本实验室的名字是 **Sophia's Rubric Lab**。它的**唯一目的**是：

> **持续找出 Sophia（各版本）的问题，指出具体在哪里被对手超越或与对手共同短板，为 Sophia 的研发迭代提供优化方向。**

因此本契约下的评测不是"对等的横评"——其他 AI 产品（MiroThink/Gemini/Manus/ChatGPT/DeepSeek/Claude/…）都是用来**对标 Sophia** 的参照系，不是并列主角。评测的所有视角、篇幅分配、洞察密度都应**围绕 Sophia** 展开。

你的交付物有两层：

- **结构化摘要 `summary`**：网站用来做评分总表、SBS 胜负平徽章、聚合看板、聚焦 Sophia 的结构化诊断、时间预算报表，以及后续机器聚合。
- **聚焦 Sophia 的诊断性 `report`**：一段 markdown，按 §3.5 的**四段正文结构（v3.2）**组织，承担评分总表之外的全部主阅读内容。

> 摘要是给机器看的硬约束；report 是给人看的开放空间（但稳定锚点不可省）。两者都必须有。

**v3.2 核心硬约束**：
1. **每次评测严格在 45 分钟内完成**（同 v2.2），按三阶段 Pass SOP（见 §5）走流程
2. **focusProductName 必填**（见 §3.11）——默认识别 `productName` 以 `SophiaAI` 开头的所有候选为聚焦对象；若本轮无 Sophia 参评，显式填 `"none"` 并在 notes 说明
3. **低分 comment 与 refuted 证据必须含原文**（见 §3.1 证据密度硬约束）
4. **crossProductInsights 必填**（candidates ≥ 2 时），至少涵盖 strongerThan / weakerThan / sharedWeakness 三种类型中的 ≥2 种；但其内容默认回归正文，不再依赖独立主阅读模块
5. **report 必须满足四段正文锚点**：评测结论 → 按维度展开 → 额外重点问题 → 各主体优缺点与建议
6. **评分总表由网站独立渲染**：正文不再强制出现“评分总表”heading，但正文必须默认承载评分总表之外的全部诊断内容
7. **refuted / inconclusive 核验说明需体现外部核验结论**：证据文本需同时包含原文引用与外部核验结果（或明确不可核原因）

---

## 2. 目录结构与文件协议

工作目录为项目根下的 `.evaluations/`：

```
.evaluations/
├── EVALUATION_CONTRACT.md   # 本文件（方法论单一事实源）
├── RUBRIC_STANDARD.md       # 打分标准（单一事实源）
├── PRODUCTS.json            # 评测主体清单
├── inbox/                   # 网站写入的待评测任务
│   └── {taskId}.json
└── outbox/                  # LLM 写回的评测产物（按 taskId 分文件夹）
    └── {taskId}/
        ├── v1.json
        ├── v2.json          # 多轮迭代的历史版本
        └── vN.json
```

### 2.1 taskId 约定

`{queryCode}-{nanoid6}`，例如 `EV-0001-dlqvY6`。由网站生成，LLM 不要改。

### 2.2 inbox 文件

网站点"发起评测"时写入 `inbox/{taskId}.json`，schema 同 v2.1 不变：

```json
{
  "taskId": "EV-0001-dlqvY6",
  "createdAt": "2026-04-19T13:00:00.000Z",
  "query": {
    "code": "EV-0001",
    "title": "Sophia AI BD 海外拓展分析",
    "type": "business-development",
    "prompt": "针对 XX 公司海外 BD 拓展，给出……"
  },
  "candidates": [
    {
      "reportId": "sub_abc123",
      "productName": "SophiaAI",
      "productVersion": "2026-04",
      "authorNote": "官方输出",
      "report": "# SophiaAI 的回答\n\n……完整 markdown 正文……"
    }
  ]
}
```

**重要**：候选报告的 markdown 正文 **直接内联在 inbox 文件的 `report` 字段**。

### 2.3 outbox 文件

你完成评测后，写入 `outbox/{taskId}/v{n}.json`。版本号由你自己扫 `outbox/{taskId}/` 目录决定：

- 目录不存在 → 写 `v1.json`
- 目录已有 `v1.json` `v2.json` → 写 `v3.json`
- **禁止覆盖历史版本**，每次迭代都留痕。网站默认展示最新版，提供下拉切历史。

---

## 3. 产物 Schema（outbox 必须严格遵守）

### 3.0 顶层结构速览

```json
{
  "taskId": "...",
  "version": 1,
  "evaluator": "Sophia (Claude-Opus-4.7 via WorkBuddy)",
  "evaluatedAt": "2026-04-25T14:30:00.000Z",
  "contractVersion": "3.2",
  "summary": {
    "overallScores": [...],
    "rubric": [...],           // R1~R5，R1 含 subscores
    "extraDimensions": [...],
    "sbs": { "pairs": [...] },
    "perReportFeedback": [...],
    "claimInventory": [...],
    "claimChecks": [...],
    "dimensionChecklists": {...},
    "verificationBudget": {...},
    "crossProductInsights": {           // v3.0 新增，聚焦 Sophia 的跨产品诊断
      "focusProductName": "SophiaAI v4",
      "strongerThan": [...],
      "weakerThan": [...],
      "sharedWeakness": [...]
    }
  },
  "report": "# 四段正文 markdown（评分总表之外的诊断内容）..."
}
```

### 3.0.1 完整示例（v3.2 结构示意）

```json
{
  "taskId": "EV-0001-dlqvY6",
  "version": 1,
  "evaluator": "Sophia (Claude-Opus-4.7 via WorkBuddy)",
  "evaluatedAt": "2026-04-25T14:30:00.000Z",
  "contractVersion": "3.2",

  "summary": {
    "overallScores": [
      {
        "reportId": "sub_abc123",
        "productName": "SophiaAI",
        "score": 8.4,
        "verdict": "优秀",
        "vetoTriggered": false
      },
      {
        "reportId": "sub_def456",
        "productName": "MiroThink",
        "score": 6.9,
        "verdict": "合格",
        "vetoTriggered": true,
        "vetoReason": "claim c3（量级错 V1）：报告写 600 万美元，实际一手源为 600 亿美元"
      }
    ],

    "rubric": [
      {
        "dimensionId": "R1",
        "name": "准确性",
        "weight": 0.40,
        "subscores": {
          "R1a": { "score": 10, "tier": "S", "weight": 0.28, "comment": "claim 核验命中率 100%，信源全部一手" },
          "R1b": { "score": 8,  "tier": "A", "weight": 0.12, "comment": "量纲 / 因果链通过；第 3 段有一处边角前后不一致" }
        },
        "scores": [
          {
            "reportId": "sub_abc123",
            "score": 10,
            "tier": "S",
            "comment": "R1a=S, R1b=A。7 项 checklist 全过；5 条承重数字全部外部核验落锤 verified-correct",
            "confidence": "high",
            "issueTags": []
          },
          {
            "reportId": "sub_def456",
            "score": 2,
            "tier": "D",
            "comment": "触发 V1 量级错（claim c3）；R1a=D, R1b=C（内部算术不自洽）",
            "confidence": "high",
            "issueTags": ["数字量级错", "事实错误"]
          }
        ]
      },
      { "dimensionId": "R2", "name": "相关性", "weight": 0.15, "scores": [ /* ... */ ] },
      { "dimensionId": "R3", "name": "论证深度", "weight": 0.20, "scores": [ /* ... */ ] },
      { "dimensionId": "R4", "name": "完备性", "weight": 0.10, "scores": [ /* ... */ ] },
      { "dimensionId": "R5", "name": "决策价值", "weight": 0.15, "scores": [ /* ... */ ] }
    ],

    "extraDimensions": [
      {
        "dimensionId": "X1",
        "name": "本地化适配度",
        "rationale": "此 Query 涉及跨文化 BD，本地化敏感度是关键差异点",
        "activated": true,
        "weight": 0.10,
        "scores": [
          { "reportId": "sub_abc123", "score": 8, "tier": "A", "comment": "提到目标市场监管差异" },
          { "reportId": "sub_def456", "score": 4, "tier": "C", "comment": "完全忽略本地化" }
        ]
      }
    ],

    "sbs": {
      "pairs": [
        {
          "reportIdA": "sub_abc123",
          "reportIdB": "sub_def456",
          "winner": "A",
          "margin": "overwhelming",
          "dimensionDriver": ["R1", "R3", "R5"],
          "keyReason": "A 在 R1/R3/R5 全面领先；B 因 R1 V1 量级错触发 veto 被封顶 6.9"
        }
      ]
    },

    "perReportFeedback": [
      {
        "reportId": "sub_abc123",
        "productName": "SophiaAI",
        "strengths": [
          "R1 准确性：5 条承重数字全部一手源并经外部核验（例：XX 亿对齐 Wind 2026-04-20）",
          "R3 论证深度：三阶推导闭环"
        ],
        "weaknesses": [
          "R4 完备性：缺少竞争格局章节"
        ],
        "improvements": [
          "补齐竞争格局与替代方案章节"
        ]
      },
      {
        "reportId": "sub_def456",
        "productName": "MiroThink",
        "strengths": ["R2 贴题，未跑题"],
        "weaknesses": [
          "R1 触发 V1 量级错（claim c3）",
          "R5 通篇废话型 take-away"
        ],
        "improvements": [
          "写数字前对照一手源；take-away 给出具体可执行条目"
        ]
      }
    ],

    "claimInventory": [
      {
        "claimId": "c1",
        "reportId": "sub_abc123",
        "type": "fact",
        "claim": "2026-04-20 Wind 口径，XX 行业规模 600 亿美元",
        "supportWeight": "high",
        "locationHint": "第 2 段第 3 句"
      },
      {
        "claimId": "c2",
        "reportId": "sub_abc123",
        "type": "number",
        "claim": "YoY 增速 32.1%",
        "supportWeight": "high",
        "locationHint": "第 2 段末句"
      },
      {
        "claimId": "c3",
        "reportId": "sub_def456",
        "type": "number",
        "claim": "XX 行业规模 600 万美元",
        "supportWeight": "high",
        "locationHint": "第 1 段首句"
      },
      {
        "claimId": "c4",
        "reportId": "sub_def456",
        "type": "logic",
        "claim": "因 A 上涨 → B 下跌 → C 萎缩（因果链）",
        "supportWeight": "high",
        "locationHint": "第 3 段"
      }
    ],

    "claimChecks": [
      {
        "claimId": "c1",
        "status": "verified-correct",
        "evidence": "Wind 终端 2026-04-20 口径一致",
        "checkedBy": "pass2-external-search"
      },
      {
        "claimId": "c2",
        "status": "verified-correct",
        "evidence": "统计局 2026 年 4 月发布 32.1%",
        "checkedBy": "pass2-external-search"
      },
      {
        "claimId": "c3",
        "status": "refuted",
        "evidence": "Wind / 统计局口径均为 600 亿美元；报告量级错 (V1)",
        "checkedBy": "pass2-external-search",
        "vetoMode": "V1"
      },
      {
        "claimId": "c4",
        "status": "refuted",
        "evidence": "因果链中 B 下跌其实是 C 萎缩的滞后结果，顺序倒置 (V4)",
        "checkedBy": "pass3-logic",
        "vetoMode": "V4"
      }
    ],

    "dimensionChecklists": {
      "R1": {
        "reportIds": ["sub_abc123", "sub_def456"],
        "items": [
          { "label": "承重 claim Top 5 含 ≥1 条 logic 类", "passedFor": ["sub_abc123", "sub_def456"] },
          { "label": "核验覆盖率 ≥85%",                   "passedFor": ["sub_abc123", "sub_def456"] },
          { "label": "3~5 条承重数字一手源对照",          "passedFor": ["sub_abc123", "sub_def456"] },
          { "label": "veto 候选全部外部验证",              "passedFor": ["sub_abc123", "sub_def456"] },
          { "label": "关键量纲/占比/汇率手算",            "passedFor": ["sub_abc123", "sub_def456"] },
          { "label": "跨段落口径一致性至少 1 处",          "passedFor": ["sub_abc123", "sub_def456"] },
          { "label": "核验过程落入 report「事实核验记录」", "passedFor": ["sub_abc123", "sub_def456"] }
        ]
      },
      "R2": {
        "items": [
          { "label": "列出核心诉求 + 锚点",          "passedFor": ["sub_abc123", "sub_def456"] },
          { "label": "核心诉求逐条找到正面回应",     "passedFor": ["sub_abc123"] },
          { "label": "锚点逐个确认响应",              "passedFor": ["sub_abc123"] },
          { "label": "潜在诉求识别或说明",            "passedFor": ["sub_abc123"] },
          { "label": "无明显跑题/无关填充（<10%）",   "passedFor": ["sub_abc123", "sub_def456"] }
        ]
      },
      "R3": { "items": [ /* 5 项 */ ] },
      "R4": { "items": [ /* 5 项 */ ] },
      "R5": { "items": [ /* 5 项 */ ] }
    },

    "verificationBudget": {
      "targetMinutes": 45,
      "actualMinutes": 43,
      "passesCompleted": ["read", "claim-inventory", "pass1", "pass2", "pass3", "score", "feedback"],
      "claimsSkippedDueToBudget": 0,
      "claimsOutOfScope": 0,
      "notes": "全阶段按预算完成"
    },

    "crossProductInsights": {
      "focusProductName": "SophiaAI",
      "strongerThan": [
        {
          "dimension": "R3",
          "vsProducts": ["MiroThink"],
          "gapSummary": "Sophia 给出了「税率变动→利润结构重构→供应链重定价」的三阶推导闭环；MiroThink 仅停在一阶因果。",
          "evidenceQuotes": [
            { "product": "SophiaAI", "quote": "税率从 25% 降至 15% 不仅直接提升 EPS ~12%，更关键的是会推动上游原材料议价权重新分配——我们测算 SKU-A 的采购价将在 6 个月内因竞价压力下浮 3-5%，这部分让利最终会……" },
            { "product": "MiroThink", "quote": "减税有助于提升公司利润。" }
          ]
        }
      ],
      "weakerThan": [
        {
          "dimension": "R1",
          "vsProducts": ["Gemini", "MiroThink"],
          "gapSummary": "Sophia 有两处编造信源（claim c10 / c11），对手在同一 query 下均给出了可核查一手链接。",
          "evidenceQuotes": [
            { "product": "SophiaAI", "quote": "根据中国驻福冈总领馆 2025 年 10 月 15 日发布的《避免前往日本全境的安全提示》……" },
            { "product": "Gemini", "quote": "目前外交部官网 mfa.gov.cn/xxx 发布的提示范围仅限九州北部，并未扩及日本全境。" }
          ],
          "claimRefs": ["c10"]
        }
      ],
      "sharedWeakness": [
        {
          "dimension": "R4",
          "acrossProducts": ["SophiaAI", "MiroThink", "Gemini"],
          "gapSummary": "三方均未覆盖「对冲方案」这一决策必备维度，只讨论了正向敞口而忽略了对立策略。",
          "suggestion": "补齐反向情景与对冲工具的对照章节。"
        }
      ]
    }
  },

  "report": "# Sophia v4 聚焦诊断 · 日本出行风险 query 横评\n\n## 一、总评 · Sophia v4 的结构性问题\n...（聚焦 Sophia）...\n\n## 评分总表\n...\n\n## 错误详析 · claim c10 编造信源\n（自由生成层；按 query 需要组织章节）\n...\n\n## 原文对照 · Sophia v4 vs Gemini 的信源引用差异\n...\n\n## SBS 结论\n..."
}
```

### 3.1 字段硬约束

| 字段 | 约束 |
|---|---|
| `contractVersion` | 必须为 `"3.2"`（本契约版本）；历史产物可保留 `"3.1"` / `"3.0"` / `"2.2"` / `"2.1"` / `"2.0"` / `"1.0"` |
| `summary.overallScores[].score` | [0, 10]，**必须等于** `Σ(Ri.score × Ri.weight)`；触发一票否决时**封顶 6.9** |
| `summary.overallScores[].verdict` | 枚举：`卓越` / `优秀` / `合格` / `待改进` / `不合格`，按 `RUBRIC_STANDARD.md §三` 的评级档位 |
| `summary.overallScores[].vetoTriggered` | 布尔值，必填 |
| `summary.overallScores[].vetoReason` | `vetoTriggered=true` 时**必填**，须引用触发的 claim id + V1~V5 错误模式代号 |
| `summary.overallScores[].productName` | 必填非空；禁用括号版本号（❌ `"SophiaAI (v4)"`，✅ `"SophiaAI v4"`）；同一 payload 内必须唯一；不同 Sophia 版本视作完全独立产品 |
| `summary.rubric` | **必须包含 R1~R5 全部 5 个维度**，顺序、id、name、weight 与 `RUBRIC_STANDARD.md §二` 一致 |
| `summary.rubric[].weight` | R1=0.40, R2=0.15, R3=0.20, R4=0.10, R5=0.15（激活 X 时等比缩减） |
| `summary.rubric[0].subscores` | **R1 专属必填**：`{R1a: {score,tier,weight:0.28,comment}, R1b: {score,tier,weight:0.12,comment}}`。R1 合成分（`scores[].score`）必须与 `R1a×0.7+R1b×0.3` 四舍五入到最近的 10/8/6/4/2 档一致 |
| `summary.rubric[].scores` | **必须覆盖 candidates 里每一份报告** |
| `summary.rubric[].scores[].score` | **只能是 10 / 8 / 6 / 4 / 2 中的一个整数** |
| `summary.rubric[].scores[].tier` | **必填**，值必须与 score 对应：10→`"S"` / 8→`"A"` / 6→`"B"` / 4→`"C"` / 2→`"D"` |
| `summary.rubric[].scores[].comment` | 必填，说明打分依据 —— **v3.0 证据密度硬约束**：若 `tier ∈ {C, D}` 则 comment 必须含**原文引用片段**（≥15 字，用「」或 `"` 包裹）；一句话定性结论（"论证浅，信息罗列为主"）直接 lint 拒。建议所有档位都尽量引用原文。 |
| `summary.rubric[].scores[].confidence` | 必填，枚举：`high` / `medium` / `low` |
| `summary.rubric[].scores[].issueTags` | 数组，可空；优先使用 `RUBRIC_STANDARD.md §五` 词表 |
| `summary.extraDimensions` | 可选；数量 ≤ 3；`dimensionId` 用 `X1`/`X2`/`X3` |
| `summary.extraDimensions[].activated` | 布尔值，必填 |
| `summary.extraDimensions[].weight` | `activated=true` 时必填，枚举：`0.05` / `0.10` / `0.15` |
| `summary.sbs` | candidates ≥ 2 时**必填**；`pairs[]` 结构见 §3.7 |
| `summary.perReportFeedback` | **必填**；覆盖每一份报告；每项 `strengths` / `weaknesses` / `improvements` 三个非空数组（每个数组至少 1 条） |
| `summary.claimInventory` | **必填**；结构见 §3.8 |
| `summary.claimChecks` | **必填**；结构见 §3.8 —— **v3.0 证据密度硬约束**：`status ∈ {refuted, inconclusive}` 时 `evidence` 必须①含报告原文片段②含一手源对照或明确说明对照为什么不可得③长度 ≥30 字 |
| `summary.dimensionChecklists` | **必填**；结构见 §3.9 |
| `summary.verificationBudget` | **必填**；结构见 §3.10 |
| `summary.crossProductInsights` | **v3.0 必填**（candidates ≥ 2 时）；结构见 §3.11；聚焦 Sophia 的跨产品诊断 |
| `report` | 必填；markdown 格式；**v3.2 硬约束**：必须符合四段正文锚点（评测结论 / 按维度展开 / 额外重点问题 / 各主体优缺点与建议）。评分总表由网站独立渲染，正文不再强制出现“评分总表”heading。v3.1 及以下沿用旧规则。 |

### 3.2 overallScore 计算

**基本情况**（未激活扩展维度）：

```
overallScore = R1.score × 0.40 + R2.score × 0.15 + R3.score × 0.20 + R4.score × 0.10 + R5.score × 0.15
```

档位制下，每个维度只能取 10/8/6/4/2，所以 overallScore 天然是一个有限精度的小数（通常 1 位小数足够）。**不允许反向凑分**——先打档位，再算加权和即可。

**激活扩展维度时**（最多 1 个）：

```
# 示例：激活 X1 权重 0.10
缩减系数 = (1.00 - 0.10) / 1.00 = 0.90
R1 新权重 = 0.40 × 0.90 = 0.36
R2 新权重 = 0.15 × 0.90 = 0.135
R3 新权重 = 0.20 × 0.90 = 0.18
R4 新权重 = 0.10 × 0.90 = 0.09
R5 新权重 = 0.15 × 0.90 = 0.135
X1 权重 = 0.10
overallScore = Σ(所有维度.score × 新权重)
```

缩减后的 R1~R5 权重**必须同步写入** `summary.rubric[].weight` 字段。

### 3.3 一票否决（硬规则 + V1~V5 判定清单）

触发条件（必须同时满足 3 条）：

1. 错误出现在**承重 claim 清单**（`summary.claimInventory`）里
2. 经 Pass 2 外部核验**落锤**（`claimChecks[].status = "refuted"` 或发现编造）
3. 错误模式属于 V1~V5 之一

| 代号 | 错误模式 | 判定描述 |
|---|---|---|
| **V1** | 量级错 | 关键承重数字量级错误 |
| **V2** | 主体错 | 关键主体张冠李戴 |
| **V3** | 时间错 | 关键时间错位（已失效 ≥1 年政策当现行等） |
| **V4** | 因果倒 | 关键因果链倒置 |
| **V5** | 编造源 | 引用经外部核验不存在的文献/公告 |

触发后：

1. **必须**设置 `overallScores[].vetoTriggered = true`
2. **必须**填写 `vetoReason`，格式建议：`"claim c3（V1 量级错）：报告写 X，实际应为 Y（一手源：Z）"`
3. 计算出的加权和如果 > 6.9，**必须封顶为 6.9**（`min(加权和, 6.9)`）
4. `verdict` 最高只能标到 `"合格"`
5. 在 `claimChecks[]` 对应条目上写 `vetoMode: "V1"~"V5"`

**非承重位置的错误**只在 R1 内扣档，不触发 veto。

### 3.4 tier 与 score 的对应关系

打分路径：**过 checklist → 查双轴 tier 表 → 定 tier（S/A/B/C/D） → 机械映射 score（10/8/6/4/2）**。

| tier | score | 一句话锚点 |
|---|---|---|
| `"S"` | 10 | 业内最强水平，挑不出毛病 |
| `"A"` | 8 | 明显高于平均，可直接交付 |
| `"B"` | 6 | 基本可用但有明显短板 |
| `"C"` | 4 | 有显著缺陷 |
| `"D"` | 2 | 结构性问题，不可用 |

tier 和 score **必须严格一一对应**（`tier="A", score=7` 非法）。**禁止反向凑分**。

---

### 3.5 评测报告正文（`report` 字段）结构（v3.2：四段正文；v3.1：总-分-总四段锚点；v3.0：三稳定锚点 + 自由生成层）

**设计哲学变更**：v2.1/v2.2 的六大章节骨架让 LLM 倾向于"最小化填满骨架、过 lint 即交差"，导致评测内容稀薄。v3.0 放弃以"结构完整"为目的的章节硬约束，改为：**只定稳定锚点（给网站可挂靠的导航、给读者可预期的起终点），中间彻底放开让 LLM 按 query 的实际问题自由组织**。评判 report 质量的唯一标准是：**研发看完能不能明确知道 Sophia 哪里错了、该往哪改**。

#### 3.5.1 v3.2 四段正文锚点（必须出现，顺序固定）

| 顺序 | 锚点标题（允许同义表达） | 必写内容 |
|---|---|---|
| 一 | 评测结论 | 排名/总分/veto + 本轮一句话结论（聚焦 Sophia） |
| 二 | 按维度展开 | 必须覆盖 R1~R5；若 activated extraDimensions 存在，需逐项覆盖并给证据 |
| 三 | 额外重点问题 | 抽取最影响决策的事实错误/逻辑错误，给原文与核验依据 |
| 四 | 各主体优缺点与建议 | 对每个评测主体给优点、缺点、可执行建议 |

**v3.2 附加约束**：
- 评分总表由网站独立渲染；正文不再强制写“评分总表”heading，但第一段应能与总表读法衔接
- “按维度展开”与“额外重点问题”段至少各含 1 处原文引用
- refuted / inconclusive 的问题描述必须含外部核验结论（或明确不可核原因）
- `summary` 中的 crossProductInsights / perReportFeedback / claimInventory / claimChecks 等结构化信息，默认都应在正文相关段落被真正展开，而不是留给独立模块代替阅读

#### 3.5.2 v3.0 三个稳定锚点（历史兼容，contractVersion=3.0 时沿用）

| 顺序 | 锚点标题（允许在下面给出的变体中挑选） | 必写内容 |
|---|---|---|
| 一 | **总评 · 聚焦 Sophia 诊断** _(变体：「总评 · Sophia 的核心问题」「总评 · Sophia vX 诊断」)_ | ① Sophia（本轮所有 Sophia 版本）的总分 + verdict + 是否触发 veto ② 用 ≤5 句话回答"Sophia 这次的核心问题是什么"——要直指病灶，不要套话 ③ 用 1~2 句话回答"相比最强对手，Sophia 最大的差距在哪个维度上" |
| 二 | **评分总表** _(变体：「横评分数矩阵」「打分对照」)_ | Sophia（含各版本）vs 其他产品的分数矩阵；至少含总分 + verdict + R1~R5 五档 + veto 标记；引用 `summary.overallScores`；可以是表格也可以是简洁的 bullet 列表 |
| 末 | **SBS 结论** _(变体：「Side-by-Side 对比总结」「横向胜负总结」)_ | candidates ≥ 2 时必写；与 `summary.sbs.pairs` 对齐；**重点标注所有涉及 Sophia 的 pair**；若本轮无 Sophia 则按普通横评写 |

**锚点硬约束**：
- 这三个锚点必须以 markdown heading（`##`/`###` 均可）出现
- 锚点标题文案允许选取上表给出的变体之一，但关键词必须可识别（"总评" / "评分" / "SBS" 或 "对比" 或 "Side-by-Side"）
- 顺序固定：总评在最前、SBS 在最后、评分总表排第二
- lint 会用启发式正则匹配这三个锚点

#### 3.5.3 自由生成层（锚点之间，按 query 特性自由组织）

**核心原则**：`评分总表` 锚点与 `SBS 结论` 锚点之间的所有内容，由评测官**按 query 的实际问题自由组织**。没有"必须写的章节"，只有"必须讲清楚的问题"。

常见自由生成模块（**挑你需要的、允许交叉穿插、允许深浅不一**）：

| 模块代号 | 什么时候用 | 怎么写得好 |
|---|---|---|
| **错误详析** | R1 有 refuted 或 veto、或 R1b 有因果倒置/算术错 | 每条错误单开一小节：①原文整段引用 ②正确的版本（附一手源） ③这个错误会把用户决策带偏到哪 ④对应 claim id |
| **原文对照** | Sophia 在某维度被对手碾压、或 Sophia 明显领先 | 把 Sophia 的原文段 + 对照产品的原文段**左右或上下并排引用**，再点一句"差异在哪"。原文**整句或整段**，不要只引关键词 |
| **核验全过程** | 有 ≥3 条 claim 被 refuted 或 inconclusive | 按 Pass 1→Pass 2→Pass 3 时间线讲评测官怎么定位到问题的、检索了什么源、为什么这么定档 |
| **方案差异 / 维度深挖** | 某维度差距主要由"思路不同"而非"对错"造成 | 展开双方的思路框架差异，不只是"A 分更高"而是"A 为什么这么想、B 为什么那么想" |
| **共性短板** | ≥2 家产品在同一维度/议题上都表现差 | 把共性短板单开一节，明确指出"整个行业/整类模型都还没覆盖到的点"，给研发提示"这里值得投入" |
| **Sophia 优化方向** | 通用—建议在"SBS 结论"前放一节 | 基于上述分析，给出 3~5 条对 Sophia 研发团队的具体优化建议（而非泛泛的"提升准确性"） |

**自由层软约束**（lint 不强制，评测官自检）：
- 自由层至少要有一段**能让人看明白 Sophia 问题根因**的内容；只写"对，我知道"的总结而无错误详析的，视为"结构完整但内容空洞"，下一轮迭代要返工
- 低分（verdict ≤ 合格）的产品（特别是 Sophia），其关键问题必须在自由层有**原文引用级别**的展开
- 引用原文时**建议整句或整段**，只要能让读者明白原文究竟说了什么

#### 3.5.4 核心禁用法（v3.0/v3.1 重申）

- ❌ 禁止"该报告存在数据问题/论证浅"这种不展开的套话——每处问题必须配原文引用
- ❌ 禁止把 Sophia 的错误一笔带过塞在总评里——错误详析是自由层的核心内容之一
- ❌ 禁止 perReportFeedback 段落写成"详见 summary 字段"——需要在 report 里完整展开，至少对 Sophia 做完整展开
- ❌ 禁止在 Sophia 被碾压的维度上只给结论不给对照原文——这是 v3.0 最强调纠正的问题

### 3.6 `summary.perReportFeedback` 字段说明

| 字段 | 判什么 | 典型粒度 |
|---|---|---|
| `strengths` | 该报告的**显著强项**（指向维度 + 具体事例） | 1~5 条 |
| `weaknesses` | 该报告的**显著短板**（指向维度 + 具体事例） | 1~5 条 |
| `improvements` | **可操作的改进建议** | 1~5 条 |

每条应能脱离上下文单独理解：

- ✅ "R1 准确性：所有关键数字都标注了一手源，且与 Wind 2026-04-20 口径一致"
- ❌ "R1 做得不错"

### 3.7 `summary.sbs.pairs[]` 结构（v2.2 升级）

```json
{
  "reportIdA": "sub_abc123",
  "reportIdB": "sub_def456",
  "winner": "A",
  "margin": "overwhelming",
  "dimensionDriver": ["R1", "R3"],
  "keyReason": "A 在 R1/R3 全面领先；B 因 V1 量级错触发 veto"
}
```

| 字段 | 必填 | 枚举/格式 | 说明 |
|---|---|---|---|
| `reportIdA` | ✅ | `sub_xxx` | 参与对比的报告 A id（v2.2 起替代旧的 productA） |
| `reportIdB` | ✅ | `sub_xxx` | 参与对比的报告 B id |
| `winner` | ✅ | `"A"` / `"B"` / `"draw"` | 胜方；draw 仅 margin=tie 时允许 |
| `margin` | ✅ | `"overwhelming"` / `"clear"` / `"slight"` / `"tie"` | 按 RUBRIC_STANDARD.md §六 margin 判定表 |
| `dimensionDriver` | ✅ | `["R1", "R3", ...]`（也可单字符串） | 主要由哪个/哪些维度拉开差距 |
| `keyReason` | ✅ | 自由文本 | 一句话点出关键差异 |

**触发 veto 的一方默认输给未触发一方**（margin 至少 `clear`，除非未触发一方总分也 ≤5.5 才允许 `slight`）。

**向后兼容**：历史产物使用 `productA/productB` + 中文 margin（`压倒性/明显优势/略微领先/势均力敌`）的 v2.1 schema 保留不动；v2.2 新产物一律用新结构。

### 3.8 `summary.claimInventory[]` 与 `summary.claimChecks[]`（v2.2 新增）

#### claimInventory：承重 claim 清单

```json
{
  "claimId": "c1",
  "reportId": "sub_abc123",
  "type": "fact" | "number" | "logic" | "source",
  "claim": "原文摘录或简要转述",
  "supportWeight": "high" | "medium",
  "locationHint": "第 2 段第 3 句"
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `claimId` | ✅ | 全 payload 内唯一；建议 `c1` / `c2` / … 递增 |
| `reportId` | ✅ | 从 inbox 沿用 |
| `type` | ✅ | `fact`（事件/人物/因果定性） / `number`（数值/金额/比例/日期） / `logic`（内部推导链/量纲/因果链） / `source`（信源引用本身） |
| `claim` | ✅ | 被核验的陈述，简明转述，不必原文长引 |
| `supportWeight` | ✅ | 承重等级；按 RUBRIC_STANDARD.md R1 承重规则判（默认 high） |
| `locationHint` | 推荐 | 帮自己和读者回溯原文位置 |

**数量规则**：

- 每份报告 3~5 条（**Top 5 封顶**，超过请按重要性排序只留前 5）
- 每份报告**至少 1 条 `type="logic"`**（否则 R1b 无法检验）
- 全 payload 合计应覆盖所有报告

#### claimChecks：核验结果

```json
{
  "claimId": "c1",
  "status": "verified-correct" | "refuted" | "inconclusive" | "skipped-time-budget" | "skipped-out-of-scope",
  "evidence": "对照源 + 结论",
  "checkedBy": "pass1-skim" | "pass2-external-search" | "pass2-arithmetic" | "pass3-logic" | "pass3-cross-section",
  "vetoMode": "V1" | "V2" | "V3" | "V4" | "V5"   // 仅 status=refuted 且触发 veto 时写
}
```

| 状态 | 何时用 | 是否计入 R1 命中率分母 | 是否扣 R1 分 |
|---|---|---|---|
| `verified-correct` | 外部核验命中，报告说对了 | ✅ 分子+分母 | 不扣 |
| `refuted` | 外部核验命中，报告说错了 | ✅ 仅分母 | 按严重性扣 R1；若触发 V1~V5 则 veto |
| `inconclusive` | 核验过但证据不足以落锤 | ✅ 仅分母 | 拉低命中率，影响 R1 档位 |
| `skipped-time-budget` | 时间盒内未核到 | ❌ 不进分母 | 不扣分（但拉低 R1 confidence） |
| `skipped-out-of-scope` | 评测官盲区/需专家知识才能验证 | ❌ 不进分母 | 不扣分；在 report 正文说明 |

**覆盖率硬约束**：
- `(verified-correct + refuted + inconclusive).length / 非 skipped.length ≥ 85%`
- 也就是说，时间不够可以 skip，但**不能"敷衍了事"——剩下在评估窗口里的 claim 必须有结论**。

### 3.9 `summary.dimensionChecklists`（v2.2 新增）

记录每个维度的必查 checklist 完成情况（标准见 RUBRIC_STANDARD.md 每个维度的"必查 checklist"小节）：

```json
{
  "R1": {
    "items": [
      { "label": "...", "passedFor": ["sub_abc123", "sub_def456"] },
      { "label": "...", "passedFor": ["sub_abc123"] }
    ]
  },
  "R2": { "items": [...] },
  "R3": { "items": [...] },
  "R4": { "items": [...] },
  "R5": { "items": [...] }
}
```

| 字段 | 说明 |
|---|---|
| `R1.items[].label` | checklist 项标题（简写即可） |
| `R1.items[].passedFor` | 通过该项的 reportId 列表（没通过的就不出现在这个数组里） |

**硬约束**：
- R1~R5 五个键必须齐全
- 每个维度的 `items` 数量须覆盖 RUBRIC_STANDARD.md 里列出的 checklist 项数（R1=7 项，R2~R5 各 5 项）
- `passedFor` 可以为空数组（表示所有报告都没通过）

### 3.10 `summary.verificationBudget`（v2.2 新增）

```json
{
  "targetMinutes": 45,
  "actualMinutes": 43,
  "passesCompleted": ["read", "claim-inventory", "pass1", "pass2", "pass3", "score", "feedback"],
  "claimsSkippedDueToBudget": 0,
  "claimsOutOfScope": 0,
  "notes": "自由说明"
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `targetMinutes` | ✅ | 固定 45 |
| `actualMinutes` | ✅ | 实际耗时；自 v3.0 起**取消硬上限**，仅作为观测指标，结构上仍要求 `>0` |
| `passesCompleted` | ✅ | 枚举：`read` / `claim-inventory` / `pass1` / `pass2` / `pass3` / `score` / `feedback`；**前 6 个不可省略**，feedback 建议齐 |
| `claimsSkippedDueToBudget` | ✅ | status=skipped-time-budget 的 claim 数 |
| `claimsOutOfScope` | ✅ | status=skipped-out-of-scope 的 claim 数 |
| `notes` | 可选 | 流程偏差、特殊决策的自由备注 |

### 3.11 `summary.crossProductInsights`（v3.0 新增，聚焦 Sophia 的跨产品诊断）

这个字段是 v3.0 最重要的新结构化产物。它把"Sophia 跟其他产品对比"这件事从 report 自由正文里**抽出来做成结构化数据**，让网站能直接渲染"Sophia 聚焦视图"，让研发不用通读 report 就能看到优化方向。

```json
{
  "focusProductName": "SophiaAI",
  "strongerThan": [
    {
      "dimension": "R3",
      "vsProducts": ["MiroThink"],
      "gapSummary": "Sophia 给出了三阶推导闭环；对手仅停在一阶因果。",
      "evidenceQuotes": [
        { "product": "SophiaAI", "quote": "原文整句或整段引用..." },
        { "product": "MiroThink", "quote": "对照产品的整句或整段..." }
      ],
      "claimRefs": ["c1", "c2"]
    }
  ],
  "weakerThan": [
    {
      "dimension": "R1",
      "vsProducts": ["Gemini", "MiroThink"],
      "gapSummary": "Sophia 有两处编造信源；对手在同一 query 下给出了可核查一手链接。",
      "evidenceQuotes": [
        { "product": "SophiaAI", "quote": "..." },
        { "product": "Gemini", "quote": "..." }
      ],
      "claimRefs": ["c10", "c11"]
    }
  ],
  "sharedWeakness": [
    {
      "dimension": "R4",
      "acrossProducts": ["SophiaAI", "MiroThink", "Gemini"],
      "gapSummary": "所有产品均未覆盖某决策必备维度。",
      "suggestion": "补齐反向情景与对冲工具章节。"
    }
  ]
}
```

#### 字段语义

| 字段 | 必填 | 说明 |
|---|---|---|
| `focusProductName` | ✅ | 默认自动识别 —— candidates 中**任一** `productName` 以 `SophiaAI` 开头（含 `SophiaAI`、`SophiaAI v4`、`SophiaAI v5` 等）即自动聚焦，多个 Sophia 版本用最近一个填入；**本轮无 Sophia 参评时**显式填 `"none"` 并在 `notes` 字段（顶层 extraNotes 或 report 总评段）说明原因 |
| `strongerThan[]` | 条件 | Sophia 在某维度**明显优于**某对照产品的 insight 条目列表；candidates ≥ 2 时必填，可为空数组（空数组表示"本轮 Sophia 没有明显优势维度"，这本身也是重要信号） |
| `weakerThan[]` | 条件 | Sophia 在某维度**明显弱于**某对照产品的 insight 条目列表；candidates ≥ 2 时必填，可为空数组；**`focusProductName = "none"` 时可省略** |
| `sharedWeakness[]` | 可选 | 所有参评产品（含 Sophia）共同短板；建议至少给出 1 条，没有则明确 `[]` |

#### `strongerThan[]` / `weakerThan[]` 条目结构

| 字段 | 必填 | 说明 |
|---|---|---|
| `dimension` | ✅ | 维度代号：`R1` / `R2` / `R3` / `R4` / `R5` / `X1~X3`；也允许用 `"R1a"` / `"R1b"` 指向 R1 子档 |
| `vsProducts` | ✅ | 对照产品名数组；必须是 candidates 里的其他产品的 `productName`；同一条 insight 可对比多个产品 |
| `gapSummary` | ✅ | 1~2 句话概括差距在哪；**禁止**只写维度名，必须说清"差距的本质是什么" |
| `evidenceQuotes` | ✅ | **≥1 条**；每条含 `product`（产品名）+ `quote`（**原文整句或整段**，建议 ≥30 字，摘要式引用 lint 拒）；**Sophia 和对照产品都建议各出 ≥1 条**，方便读者直接对照 |
| `claimRefs` | 可选 | 关联的 `claimId` 数组（若该 insight 源于已核验的 claim） |

#### `sharedWeakness[]` 条目结构

| 字段 | 必填 | 说明 |
|---|---|---|
| `dimension` | ✅ | 共性短板集中的维度 |
| `acrossProducts` | ✅ | 涵盖的所有产品名（含 Sophia） |
| `gapSummary` | ✅ | 共性短板的本质 |
| `suggestion` | 可选 | 给 Sophia 研发的提示（"这里值得投入，因为对手也没做好"） |

#### 硬约束

- `candidates.length < 2` 时可整个省略 `crossProductInsights`
- `candidates.length >= 2` 且本轮含 Sophia（即 `focusProductName ≠ "none"`）时：
  - `strongerThan[].length + weakerThan[].length >= 2`（至少两条维度级 insight，避免"只写一条糊弄过去"）
  - `strongerThan` / `weakerThan` 可以任一为空数组，但两者总长 ≥ 2
  - 每条 insight 的 `evidenceQuotes` **至少有 1 条属于 Sophia**（让读者看到"Sophia 原文究竟说了什么"）
- 所有 `evidenceQuotes[].quote` 长度建议 ≥ 30 字，明显短于此的会被 lint 警告（非 fail）

#### 和 `report` 自由生成层的关系

- `crossProductInsights` 是**结构化摘要**（供网站 Sophia 聚焦卡片渲染 + 做跨任务聚合）
- 自由生成层是**叙事展开**（供读者深读，了解"差距的细节与根因"）
- 两者**可以引用同一条原文**但不必保持完全一致——结构化字段适合"短、准、指向性强"，自由层适合"长、全、有上下文"

---

## 4. Rubric（打分维度定义）

**打分维度的宗旨、R1~R5 的完整定义与权重、扩展维度规则、SBS 规则、评级档位、issueTags 词表、双轴 tier 表、必查 checklist、45min SOP —— 全部单独落在 `.evaluations/RUBRIC_STANDARD.md`。**

评测前请务必先通读 `RUBRIC_STANDARD.md`。网站「标准」tab 直接渲染它。

> 两份文档的分工：
> - `RUBRIC_STANDARD.md` — 评测标准（给人看 + 给 LLM 打分时参考）
> - `EVALUATION_CONTRACT.md` — 工作协议（给 LLM 工作时读，定义 JSON 结构和流程）

> **打分相关的硬约束**（R1~R5 必填 / 权重 / 档位 / overallScore 计算 / 一票否决 / 扩展维度规则）已全部列在 §3.1 ~ §3.4。
> 本节不再重复，只补充一条：issueTags 优先使用 RUBRIC_STANDARD.md §五 的推荐词表。

---

## 5. 工作流（LLM 端，v3.2 继承 v2.2 的 45 min 三阶段 SOP，并保留结构化字段，同时要求把主诊断内容写回正文）

用户在 WorkBuddy 对话框说 "**评测 EV-0001-dlqvY6**" 时：

### 5.0 准备（不计入 45 min 预算）

1. **读工作协议**：`read_file .evaluations/EVALUATION_CONTRACT.md`（如果还没读过）
2. **读评测标准**：`read_file .evaluations/RUBRIC_STANDARD.md`
3. **读任务**：`read_file .evaluations/inbox/EV-0001-dlqvY6.json`

### 5.1 45 分钟时间盒（硬约束）

| 阶段 | 时长 | 标志性产物 |
|---|---|---|
| ① **read**（读报告） | 7 min | 脑内地图 |
| ② **claim-inventory**（承重 claim 抽取） | 7 min | `summary.claimInventory` |
| ③ **pass1**（快筛） | 10 min | `claimChecks` 首版，每条打 clean/suspicious/unverifiable-yet |
| ④ **pass2**（深核嫌疑） | 7 min | 对 suspicious 项外部搜索 + 算术核算，落锤 verified-correct/refuted/inconclusive |
| ⑤ **pass3**（逻辑一致性） | 4 min | R1b 子项判定，跨段落口径 + 因果链 + 算术交叉 |
| ⑥ **score**（打分 + 跨产品诊断） | 5 min | 5 份 checklist 过完 + 双轴表定 tier + 机械映射 score + overallScore + SBS + **crossProductInsights** |
| ⑦ **feedback**（反馈 + report 正文） | 5 min | `perReportFeedback` + report 四段正文（评分总表之外的诊断内容全部回归正文） |
| 合计 | **45 min** | 全部产物齐备 |

**超时兜底规则**：

- **任一阶段超 20% 时间**立即进入下一阶段，未完成项按规则标 `skipped-time-budget`
- 核心阶段①~⑥ **不可跳过**，即使时间剩余很少也要机械走完 checklist 和打分
- 流程完成后把实际耗时记入 `summary.verificationBudget`
- 自 v3.0 起：`actualMinutes` 不再设硬上限，可如实记录；它只用于观察评测节奏，不再触发流程违约

### 5.2 关键操作清单

按上述时间盒，各阶段实际要做的动作：

1. **read**：通读 candidates[] 里全部报告，建立脑内地图（每份报告的主结论、关键段落、看起来的亮点/疑点）
2. **claim-inventory**：每份报告抽 Top 5 承重 claim（含 ≥1 条 logic 类），写入 `summary.claimInventory`
3. **pass1**：快速通读，对所有 claim 打初筛标签。不做外部搜索，只用评测官既有知识 + 报告内部逻辑判断
4. **pass2 · 深核嫌疑**：
   - 对所有 suspicious 项发起外部搜索/一手源对照/算术核算
   - 任何 veto 候选必须走到这里才下结论
   - 量纲 / 占比 / 汇率必须动手算一遍
5. **pass3 · 逻辑一致性**：
   - 跨段落口径对齐（至少 1 处）
   - 关键因果链重建（是否倒置、是否跳跃）
   - 报告内部算术交叉（数字 A + 数字 B = 数字 C 的自洽性）
6. **score**：
   - 按 R1~R5 顺序，先过维度 checklist，再查双轴 tier 表，定 tier，机械映射 score
   - R1 专属：先定 R1a / R1b 两档，再按 0.7:0.3 合成 R1
   - 扩展维度同步决定（≥1 个建议，激活最多 1 个）
   - 算 overallScore（触发 veto 则封顶 6.9）
   - SBS（如 candidates ≥ 2）
   - **v3.0 新增**：识别 focusProductName（默认匹配 `SophiaAI*`）、产出 `crossProductInsights`（strongerThan / weakerThan / sharedWeakness），每条 insight 带原文整句/整段引用
7. **feedback + report**：
   - `perReportFeedback` 三件套（每份报告 strengths / weaknesses / improvements 各 ≥1 条）
   - 按 §3.5 的**四段正文**写 report：评测结论 → 按维度展开 → 额外重点问题 → 各主体优缺点与建议
   - 评分总表由网站独立渲染，因此正文应集中展开评分总表之外的诊断内容；crossProductInsights / claimChecks / perReportFeedback 等结构化字段都应在正文被真正说透
   - 写之前先问自己："研发看完这段话，能不能明确知道 Sophia 下一步该改什么？"不能，就重写

### 5.3 写文件

- `list_dir .evaluations/outbox/EV-0001-dlqvY6/` 确认版本号
- 不存在就创建目录，写 `v1.json`
- 多轮迭代：用户提出修改后，生成 `v2.json` / `v3.json`
- 告知用户产物路径和版本号，让用户回网站点"刷新"

### 5.4 产物自检清单（写文件前必做）

**结构：**

- [ ] `contractVersion` = `"3.2"`
- [ ] `summary.rubric` 覆盖 R1~R5 全部 5 项，id/name/weight 与 RUBRIC_STANDARD.md 一致
- [ ] 每个维度块都有 `dimensionId` / `name` / `weight`
- [ ] 维度内层数组字段名是 `scores`（不是 `reports`；历史踩坑点）
- [ ] 每个维度 `scores` 覆盖 inbox 全部 candidates
- [ ] `overallScores[].vetoTriggered` 每条都有布尔值
- [ ] `overallScores[].productName` 全部非空、无括号版本号、同 payload 内唯一

**R1 子档：**

- [ ] R1 维度有 `subscores.R1a` 和 `subscores.R1b` 两个字段，各含 score/tier/weight/comment
- [ ] R1a weight=0.28，R1b weight=0.12
- [ ] R1 合成分与 `round(R1a×0.7 + R1b×0.3)` 在最近档位一致（误差不超 1 档）

**打分：**

- [ ] 每个 `score` 都是 10/8/6/4/2
- [ ] 每个 `tier` 与 score 严格对应（S=10/A=8/B=6/C=4/D=2）
- [ ] 每个 `confidence` 存在（high/medium/low）
- [ ] `overallScore` 等于加权和（触发 veto 时封顶 6.9）
- [ ] `verdict` 按 RUBRIC_STANDARD.md 评级档位

**v3.0 证据密度硬约束：**

- [ ] 所有 `tier ∈ {C, D}` 的 `rubric.scores[].comment` 含原文引用片段（≥15 字，用「」或 `"` 包裹）
- [ ] 所有 `claimChecks[].status ∈ {refuted, inconclusive}` 的 `evidence` 含报告原文 + 一手源对照或不可得说明，长度 ≥30 字
- [ ] 所有 `crossProductInsights[].evidenceQuotes[]` 至少 1 条属于 Sophia，每条长度建议 ≥30 字

**一票否决：**

- [ ] `vetoTriggered` 每条有布尔值
- [ ] 触发的，`vetoReason` 引用 claim id + V1~V5 模式代号
- [ ] 触发的，总分 ≤ 6.9，verdict ≤ "合格"
- [ ] 触发的，`claimChecks` 里对应项有 `vetoMode` 字段

**Claim 核验：**

- [ ] `summary.claimInventory` 非空；每份报告 3~5 条（Top 5 封顶）
- [ ] 每份报告至少 1 条 `type="logic"` 的 claim
- [ ] `summary.claimChecks` 每个 claimId 都有对应记录
- [ ] 核验覆盖率 ≥85%：`(verified-correct + refuted + inconclusive).length / 非 skipped.length ≥ 0.85`
- [ ] veto 候选已通过 pass2 外部核验（`checkedBy` 含 `pass2-*`）

**Checklist 完成度：**

- [ ] `summary.dimensionChecklists` 含 R1~R5 五个键
- [ ] R1 有 7 项 items；R2~R5 各 5 项 items
- [ ] 每项 `passedFor` 是数组（可空）

**时间预算：**

- [ ] `summary.verificationBudget` 必填
- [ ] `actualMinutes` 为 `>0` 的数字（v3.0 起不再做上限校验）
- [ ] `passesCompleted` 至少包含 `read` / `claim-inventory` / `pass1` / `pass2` / `pass3` / `score`
- [ ] `claimsSkippedDueToBudget` 与 `claimChecks` 里 `skipped-time-budget` 数量一致

**SBS：**

- [ ] candidates ≥ 2 时 `sbs.pairs` 非空
- [ ] 每 pair 有 `reportIdA` / `reportIdB` / `winner` / `margin` / `dimensionDriver` / `keyReason`
- [ ] `margin` 是 `overwhelming` / `clear` / `slight` / `tie` 四种英文枚举之一
- [ ] `dimensionDriver` 是字符串数组（`["R1"]` / `["R1","R3"]`）或字符串

**扩展维度：**

- [ ] 每个扩展维度有 `rationale` 和 `activated` 布尔
- [ ] 激活的 X 维度有 `weight`（0.05/0.10/0.15）且 R1~R5 权重已等比缩减

**perReportFeedback：**

- [ ] 覆盖 candidates 全部报告
- [ ] 每份报告 strengths/weaknesses/improvements 三个数组各 ≥1 条
- [ ] 每条指向具体维度 + 具体事例

**v3.0 crossProductInsights（跨产品诊断）：**

- [ ] `candidates.length >= 2` 时 `crossProductInsights` 非空
- [ ] `focusProductName` 必填（自动匹配 `SophiaAI*`；无 Sophia 时填 `"none"`）
- [ ] 本轮有 Sophia 时，`strongerThan[].length + weakerThan[].length >= 2`
- [ ] 每条 insight 的 `evidenceQuotes` 至少 1 条属于 Sophia，且每条含产品名 + 原文引用
- [ ] `sharedWeakness[]` 为数组（可空，但应尽量给出 1 条）

**v3.2 report 正文（四段正文）：**

- [ ] 四段锚点齐全：**评测结论** / **按维度展开** / **额外重点问题** / **各主体优缺点与建议**，且顺序固定
- [ ] 评分总表之外的主诊断内容已回收到正文，而不是依赖独立模块代替展开
- [ ] “按维度展开”与“额外重点问题”至少各有 1 处原文引用
- [ ] 低分（verdict ≤ 合格）的 Sophia 产品，在正文里有**原文引用级别**的错误详析
- [ ] 引用原文的段落采用整句或整段（≥30 字），而非关键词摘要

**其他：**

- [ ] `report` markdown 无坏点（表格闭合、代码块闭合）
- [ ] 版本号正确递增，没有覆盖历史
- [ ] **JSON 自检**：写文件后立即 `python3 -c "import json; json.load(open('path'))"`
  - 历史踩坑：comment / verdict / report 里混了直引号 `"` 会导致 JSON 解析失败；正文里请用中文引号「」《》或单引号 `'`
- [ ] **Schema 自检（推荐）**：跑 `npm run lint:outbox` 一键校验所有 outbox 产物

---

## 6. 网站端约定（给开发/自己留档）

- 网站 **只读 outbox**，不会反写 outbox。
- 网站不对 summary 做二次校正，`score` 显示几就是几。
- 网站对维度的渲染顺序：R1 → R5 → X1 → X2 → X3。
- 多版本策略：默认渲染最新版，版本选择器列出全部 `v{n}.json`。
- 删除一个 taskId 的所有评测 = 删 `outbox/{taskId}/` 整个文件夹（网站提供按钮）。
- **删除 Query 会级联删除该 queryCode 下所有 inbox 任务文件和 outbox 评测产物**，操作不可恢复。

### 6.1 `reportId` 的隐式契约（重要）

- `inbox/{taskId}.json` 里 `candidates[].reportId`、以及 outbox payload 里 `overallScores[].reportId` / `rubric[].scores[].reportId` / `extraDimensions[].scores[].reportId` / `sbs.pairs[].reportIdA` / `sbs.pairs[].reportIdB` / `claimInventory[].reportId`，**全部使用同一个 id**。
- 这个 id = **网站前端 Submission 的主键**。
- **LLM 必须原样沿用 inbox 给出的 reportId，不允许自造**。
- 约定格式：当前为 `sub_xxx`（nanoid），当作不透明字符串使用。

### 6.2 向后兼容

- 契约版本升级后，历史 v1.0 / v2.0 / v2.1 / v2.2 outbox 文件**保留不动**。
- 网站按 `contractVersion` 字段分别渲染，不做迁移。
- v1.0 产物的旧维度名称、25/20/25/20/10 权重、0.5 精度分数继续按原样展示。
- v2.0 产物缺 `perReportFeedback` 属正常（v2.1 引入）。
- v2.1 产物缺 `claimInventory` / `claimChecks` / `dimensionChecklists` / `verificationBudget` / R1 `subscores` 属正常（v2.2 引入）。
- v2.1 SBS 使用 `productA` / `productB` + 中文 margin，继续按原结构渲染。
- v2.2 产物缺 `crossProductInsights` 属正常（v3.0 引入）；v2.2 产物的 report 按六大章节渲染；v3.0 产物按三稳定锚点 + 自由生成层渲染；v3.1/v3.2 产物按四段正文规则渲染。
- 网站对缺失字段**容错展示**（缺的字段整块不渲染，而非报错）。

### 6.3 v3.2 渲染约定

- **页面主阅读路径**：只保留两步——先看“评分总表”，再读“评测报告正文”
- **Sophia 聚焦诊断 / 每份反馈 / 核验地图 / checklist / 时间预算**：结构化字段继续保留在 payload 中，用于聚合、校验和调试；但单份报告页面默认不再把它们拆成独立主阅读模块
- **report 正文**：按 markdown 原样渲染，并以四段正文锚点作为主导航
- **低分证据高亮**：tier C/D 的 comment 若含「」或引号原文片段，前端自动高亮；claimChecks refuted / inconclusive 的 evidence 自动展开显示
- **focusProductName=none 时**：仍允许结构化字段写入 `"none"`，但页面不再为此单独占据主阅读区

---

## 7. 版本

- 契约版本：**3.2**
- 生效日期：2026-04-26
- 历史版本：
  - 3.1（2026-04-25 深夜生效）—— 先查错再评分、四段正文锚点
  - 3.0（2026-04-25 晚生效）—— 聚焦 Sophia、三稳定锚点 + 自由生成层、crossProductInsights
  - 2.2（2026-04-25 日间生效）—— claim 核验、维度 checklist、时间预算、R1 子档、SBS 英文枚举
  - 2.1（2026-04-22 生效）—— 外部核验硬约束、perReportFeedback、报告六大章节
  - 2.0（2026-04-21 生效）—— 维度重构、档位制、一票否决
  - 1.0（2026-04-19 生效）—— 初版
- v3.2 vs v3.1 的落地变化：
  - 页面主阅读路径收敛为“评分总表 + 正文”
  - crossProductInsights / perReportFeedback / claimChecks 等结构化信息继续保留，但默认回归正文展开，不再主导单份报告页面
  - report 不再强制出现“评分总表”heading；评分总表交由网站独立渲染
- 后续任何字段语义变更 → contractVersion 升级，旧 outbox 文件保留原 contractVersion 以便兼容渲染。
