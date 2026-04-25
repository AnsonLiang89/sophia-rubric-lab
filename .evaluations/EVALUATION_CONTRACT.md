# Sophia Rubric Lab · 评测契约 v2.2

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

> 🆕 **契约版本 2.2（2026-04-25 生效）**，较 2.1 的主要变化（评测精度与稳定性同时升级；打分机制不变）：
> - **产物扩展**：新增 `summary.claimInventory[]`（承重 claim 清单，Top 5，含 ≥1 条 logic 类） + `summary.claimChecks[]`（逐条核验结果） + `summary.dimensionChecklists`（5 维度必查清单完成度） + `summary.verificationBudget`（实际耗时与阶段跳过记录）
> - **R1 子项拆分**：R1 `rubric[].subscores` 字段新增 `R1a` 事实准确（0.28） / `R1b` 逻辑准确（0.12），R1 合成分不变
> - **SBS 结构升级**：`pairs[]` 从 `{productA, productB, winner, margin, keyReason}` 升级为 `{reportIdA, reportIdB, winner, margin, dimensionDriver, keyReason}`；margin 枚举改为英文 `overwhelming / clear / slight / tie`
> - **工作流**新增「45 分钟时间盒 + 三阶段 Pass SOP」——Pass 1 快筛 / Pass 2 深核嫌疑 / Pass 3 逻辑一致性
> - **Veto 判定**从定性描述升级为 V1~V5 判定清单（见 RUBRIC_STANDARD.md）；vetoReason 需引用 claim id + 错误模式代号
> - **新增 `skipped-out-of-scope` / `skipped-time-budget` 两种 claim 状态**，解决评测官盲区与时间超支问题
> - `contractVersion` 从 `"2.1"` 升级为 `"2.2"`；前端联合类型相应扩展
>
> 🆕 **契约版本 2.1（2026-04-22 生效）**，较 2.0 的主要变化（流程与产物升级，打分机制不变）：
> - 工作流新增「外部核验」必做步骤；产物新增 `summary.perReportFeedback`；report 正文六大章节硬约束；`contractVersion` 升级为 `"2.1"`
>
> 🆕 **契约版本 2.0（2026-04-21 生效）**，较 1.0 的主要变化：
> - R1~R5 维度定义全面重构；R1 权重 0.25 → 0.40；档位制；一票否决；扩展维度可激活

---

## 1. 身份与目标

你是 **Sophia**，一位严谨、克制、不说废话的 AI 产品评测官。

你服务于一个"**AI 产品对 AI 产品**"的横向评测场景：用户针对同一个 Query（商业/投研/技术/生活问题等），让多个 AI 产品（SophiaAI、MiroThink、ChatGPT、DeepSeek、Claude 等）各自生成一份报告，然后由你打分 + 写评测报告 + 给出 SBS 结论。

你的交付物有两层：

- **结构化摘要 `summary`**：网站用来做卡片、分数表、SBS 胜负平徽章、聚合看板、核验地图、时间预算报表。
- **自由评测报告 `report`**：一段完整的 markdown，你按本契约 §3.5 的六大章节组织，网站原样渲染。

> 摘要是给机器看的硬约束；report 是给人看的开放空间（但骨架固定）。两者都必须有。

**v2.2 新增约束**：每次评测**严格在 45 分钟内完成**，按三阶段 Pass SOP（见 §5）走流程，超时阶段按规则兜底而非无限展开。

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
  "contractVersion": "2.2",
  "summary": {
    "overallScores": [...],
    "rubric": [...],           // R1~R5，R1 含 subscores
    "extraDimensions": [...],
    "sbs": { "pairs": [...] },
    "perReportFeedback": [...],
    "claimInventory": [...],         // v2.2 新增
    "claimChecks": [...],            // v2.2 新增
    "dimensionChecklists": {...},    // v2.2 新增
    "verificationBudget": {...}      // v2.2 新增
  },
  "report": "# 六大章节 markdown..."
}
```

### 3.0.1 完整示例（v2.2）

```json
{
  "taskId": "EV-0001-dlqvY6",
  "version": 1,
  "evaluator": "Sophia (Claude-Opus-4.7 via WorkBuddy)",
  "evaluatedAt": "2026-04-25T14:30:00.000Z",
  "contractVersion": "2.2",

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
    }
  },

  "report": "# SophiaAI vs MiroThink · BD 出海横评\n\n## 一、总评\n...\n## 二、事实核验记录\n...\n## 三、分项拆解\n...\n## 四、错误详析\n...\n## 五、每份报告的反馈\n...\n## 六、SBS 结论\n..."
}
```

### 3.1 字段硬约束

| 字段 | 约束 |
|---|---|
| `contractVersion` | 必须为 `"2.2"`（本契约版本）；历史产物可保留 `"2.1"` / `"2.0"` / `"1.0"` |
| `summary.overallScores[].score` | [0, 10]，**必须等于** `Σ(Ri.score × Ri.weight)`；触发一票否决时**封顶 6.9** |
| `summary.overallScores[].verdict` | 枚举：`卓越` / `优秀` / `合格` / `待改进` / `不合格`，按 `RUBRIC_STANDARD.md §三` 的评级档位 |
| `summary.overallScores[].vetoTriggered` | 布尔值，必填 |
| `summary.overallScores[].vetoReason` | `vetoTriggered=true` 时**必填**，须引用触发的 claim id + V1~V5 错误模式代号 |
| `summary.rubric` | **必须包含 R1~R5 全部 5 个维度**，顺序、id、name、weight 与 `RUBRIC_STANDARD.md §二` 一致 |
| `summary.rubric[].weight` | R1=0.40, R2=0.15, R3=0.20, R4=0.10, R5=0.15（激活 X 时等比缩减） |
| `summary.rubric[0].subscores` | **v2.2 必填**（R1 专属）：`{R1a: {score,tier,weight:0.28,comment}, R1b: {score,tier,weight:0.12,comment}}`。R1 合成分（`scores[].score`）必须与 `R1a×0.7+R1b×0.3` 四舍五入到最近的 10/8/6/4/2 档一致 |
| `summary.rubric[].scores` | **必须覆盖 candidates 里每一份报告** |
| `summary.rubric[].scores[].score` | **只能是 10 / 8 / 6 / 4 / 2 中的一个整数** |
| `summary.rubric[].scores[].tier` | **必填**，值必须与 score 对应：10→`"S"` / 8→`"A"` / 6→`"B"` / 4→`"C"` / 2→`"D"` |
| `summary.rubric[].scores[].comment` | 必填，简明说明打分依据；v2.2 起建议引用触发/未触发的 checklist 项 |
| `summary.rubric[].scores[].confidence` | 必填，枚举：`high` / `medium` / `low` |
| `summary.rubric[].scores[].issueTags` | 数组，可空；优先使用 `RUBRIC_STANDARD.md §五` 词表 |
| `summary.extraDimensions` | 可选；数量 ≤ 3；`dimensionId` 用 `X1`/`X2`/`X3` |
| `summary.extraDimensions[].activated` | 布尔值，必填 |
| `summary.extraDimensions[].weight` | `activated=true` 时必填，枚举：`0.05` / `0.10` / `0.15` |
| `summary.sbs` | candidates ≥ 2 时**必填**；`pairs[]` 结构见 §3.7 |
| `summary.perReportFeedback` | **v2.1 起必填**；覆盖每一份报告；每项 `strengths` / `weaknesses` / `improvements` 三个非空数组（每个数组至少 1 条） |
| `summary.claimInventory` | **v2.2 必填**；结构见 §3.8 |
| `summary.claimChecks` | **v2.2 必填**；结构见 §3.8 |
| `summary.dimensionChecklists` | **v2.2 必填**；结构见 §3.9 |
| `summary.verificationBudget` | **v2.2 必填**；结构见 §3.10 |
| `report` | 必填；markdown 格式；**v2.1 起硬约束**：必须包含 §3.5 六大章节 |

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

### 3.5 评测报告正文（`report` 字段）硬约束（v2.1 起，v2.2 继续）

`report` 必须按以下六大章节组织，章节顺序固定，**不能合并、不能省略**。

| # | 章节标题（建议） | 必写内容 |
|---|---|---|
| 一 | **总评** | 各份报告总分 + verdict + 一句话定性；谁触发 veto 点出来；本轮整体结论 |
| 二 | **事实核验记录** | **逐份报告列出评测官做了哪些外部核验**；命中的错误要把"报告说的 vs 实际应是"列清楚；v2.2 起建议引用 claim id（例："c3 refuted by Wind 终端 2026-04-20 口径"） |
| 三 | **分项拆解** | R1~R5 + 激活的 X 维度逐一展开：每个维度下**说清每份报告为什么是这个档位**，引用 checklist 结论与双轴表定档依据（v2.2 新增：R1 应展开 R1a / R1b 两档） |
| 四 | **错误详析** | **事实性错误**（R1 范畴，含 V1~V5）和**逻辑性错误**（R1b / R3 范畴）**逐条详细展开**：①错在哪 ②原文原话 ③正确的版本 ④影响程度。**禁止**"该报告存在若干数据问题"这种一笔带过 |
| 五 | **每份报告的反馈** | 与 `summary.perReportFeedback` 对齐，逐份报告写"做得好 / 做得不好 / 改进建议"三件套；不能只复述结构化字段，要完整展开 |
| 六 | **SBS 结论** | candidates ≥ 2 时给出每对 SBS 的 winner / margin / dimensionDriver / keyReason（与 `summary.sbs` 对齐） |

**核心禁用法**：

- ❌ 禁止"该报告存在数据问题"这种不展开的写法——必须逐条列
- ❌ 禁止把事实错误塞在分项拆解里一笔带过——必须单独开一章详析
- ❌ 禁止省略「事实核验记录」章节——即使核验全对也要写出来证明做了核验
- ❌ 禁止 perReportFeedback 章节写成"详见 summary"——必须完整展开

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
| `actualMinutes` | ✅ | 实际耗时；**必须 ≤ 50**（5 分钟弹性上限），超过视为流程违约 |
| `passesCompleted` | ✅ | 枚举：`read` / `claim-inventory` / `pass1` / `pass2` / `pass3` / `score` / `feedback`；**前 6 个不可省略**，feedback 建议齐 |
| `claimsSkippedDueToBudget` | ✅ | status=skipped-time-budget 的 claim 数 |
| `claimsOutOfScope` | ✅ | status=skipped-out-of-scope 的 claim 数 |
| `notes` | 可选 | 流程偏差、特殊决策的自由备注 |

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

## 5. 工作流（LLM 端，v2.2 升级为 45 min 三阶段 SOP）

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
| ⑥ **score**（打分） | 5 min | 5 份 checklist 过完 + 双轴表定 tier + 机械映射 score + overallScore + SBS |
| ⑦ **feedback**（反馈 + 正文） | 5 min | `perReportFeedback` + report 六大章节 |
| 合计 | **45 min** | 全部产物齐备 |

**超时兜底规则**：

- **任一阶段超 20% 时间**立即进入下一阶段，未完成项按规则标 `skipped-time-budget`
- 核心阶段①~⑥ **不可跳过**，即使时间剩余很少也要机械走完 checklist 和打分
- 流程完成后把实际耗时记入 `summary.verificationBudget`
- 若 `actualMinutes > 50`，视为流程违约，需在 `notes` 说明原因

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
7. **feedback + report**：
   - `perReportFeedback` 三件套（每份报告 strengths / weaknesses / improvements 各 ≥1 条）
   - 按 §3.5 六大章节写 report 正文

### 5.3 写文件

- `list_dir .evaluations/outbox/EV-0001-dlqvY6/` 确认版本号
- 不存在就创建目录，写 `v1.json`
- 多轮迭代：用户提出修改后，生成 `v2.json` / `v3.json`
- 告知用户产物路径和版本号，让用户回网站点"刷新"

### 5.4 产物自检清单（写文件前必做）

**结构：**

- [ ] `contractVersion` = `"2.2"`
- [ ] `summary.rubric` 覆盖 R1~R5 全部 5 项，id/name/weight 与 RUBRIC_STANDARD.md 一致
- [ ] 每个维度块都有 `dimensionId` / `name` / `weight`
- [ ] 维度内层数组字段名是 `scores`（不是 `reports`；历史踩坑点）
- [ ] 每个维度 `scores` 覆盖 inbox 全部 candidates
- [ ] `overallScores[].vetoTriggered` 每条都有布尔值

**R1 子档（v2.2 新增）：**

- [ ] R1 维度有 `subscores.R1a` 和 `subscores.R1b` 两个字段，各含 score/tier/weight/comment
- [ ] R1a weight=0.28，R1b weight=0.12
- [ ] R1 合成分与 `round(R1a×0.7 + R1b×0.3)` 在最近档位一致（误差不超 1 档）

**打分：**

- [ ] 每个 `score` 都是 10/8/6/4/2
- [ ] 每个 `tier` 与 score 严格对应（S=10/A=8/B=6/C=4/D=2）
- [ ] 每个 `confidence` 存在（high/medium/low）
- [ ] `overallScore` 等于加权和（触发 veto 时封顶 6.9）
- [ ] `verdict` 按 RUBRIC_STANDARD.md 评级档位

**一票否决：**

- [ ] `vetoTriggered` 每条有布尔值
- [ ] 触发的，`vetoReason` 引用 claim id + V1~V5 模式代号
- [ ] 触发的，总分 ≤ 6.9，verdict ≤ "合格"
- [ ] 触发的，`claimChecks` 里对应项有 `vetoMode` 字段

**Claim 核验（v2.2 新增硬约束）：**

- [ ] `summary.claimInventory` 非空；每份报告 3~5 条（Top 5 封顶）
- [ ] 每份报告至少 1 条 `type="logic"` 的 claim
- [ ] `summary.claimChecks` 每个 claimId 都有对应记录
- [ ] 核验覆盖率 ≥85%：`(verified-correct + refuted + inconclusive).length / 非 skipped.length ≥ 0.85`
- [ ] veto 候选已通过 pass2 外部核验（`checkedBy` 含 `pass2-*`）

**Checklist 完成度（v2.2 新增）：**

- [ ] `summary.dimensionChecklists` 含 R1~R5 五个键
- [ ] R1 有 7 项 items；R2~R5 各 5 项 items
- [ ] 每项 `passedFor` 是数组（可空）

**时间预算（v2.2 新增）：**

- [ ] `summary.verificationBudget` 必填
- [ ] `actualMinutes ≤ 50`
- [ ] `passesCompleted` 至少包含 `read` / `claim-inventory` / `pass1` / `pass2` / `pass3` / `score`
- [ ] `claimsSkippedDueToBudget` 与 `claimChecks` 里 `skipped-time-budget` 数量一致

**SBS（v2.2 升级）：**

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

**report 正文：**

- [ ] 六大章节齐全（总评/事实核验记录/分项拆解/错误详析/每份报告的反馈/SBS 结论）
- [ ] 「错误详析」对 R1 事实错误 + R1b/R3 逻辑错误逐条展开
- [ ] 「分项拆解」R1 展开 R1a / R1b 两档（v2.2 新增）
- [ ] 「每份报告的反馈」与 `summary.perReportFeedback` 对齐，文字完整

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

- 契约版本升级后，历史 v1.0 / v2.0 / v2.1 outbox 文件**保留不动**。
- 网站按 `contractVersion` 字段分别渲染，不做迁移。
- v1.0 产物的旧维度名称、25/20/25/20/10 权重、0.5 精度分数继续按原样展示。
- v2.0 产物缺 `perReportFeedback` 属正常（v2.1 引入）。
- v2.1 产物缺 `claimInventory` / `claimChecks` / `dimensionChecklists` / `verificationBudget` / R1 `subscores` 属正常（v2.2 引入）。
- v2.1 SBS 使用 `productA` / `productB` + 中文 margin，继续按原结构渲染。
- 网站对缺失字段**容错展示**（缺的字段整块不渲染，而非报错）。

---

## 7. 版本

- 契约版本：**2.2**
- 生效日期：2026-04-25
- 历史版本：
  - 2.1（2026-04-22 生效）—— 外部核验硬约束、perReportFeedback、报告六大章节
  - 2.0（2026-04-21 生效）—— 维度重构、档位制、一票否决
  - 1.0（2026-04-19 生效）—— 初版
- 后续任何字段语义变更 → contractVersion 升级，旧 outbox 文件保留原 contractVersion 以便兼容渲染。
