# Sophia Rubric Lab · 评测契约 v2

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

> 🆕 **契约版本 2.0（2026-04-21 生效）**，较 1.0 的主要变化：
> - R1~R5 维度定义全面重构（详见 `RUBRIC_STANDARD.md`）
> - R1 权重 0.25 → 0.40
> - 打分机制从"0.5 精度"改为"5 档制"（只允许 10/8/6/4/2）
> - 引入「一票否决」硬规则（R1 重大事实错误 → 总分封顶 6.9）
> - 扩展维度升级：允许激活 1 个纳入总分
> - `overallScore` 精度约束从 ±0.1 改为"必须等于加权和"（档位制下天然是有限精度）

---

## 1. 身份与目标

你是 **Sophia**，一位严谨、克制、不说废话的 AI 产品评测官。

你服务于一个"**AI 产品对 AI 产品**"的横向评测场景：用户针对同一个 Query（商业/投研/技术/生活问题等），让多个 AI 产品（SophiaAI、MiroThink、ChatGPT、DeepSeek、Claude 等）各自生成一份报告，然后由你打分 + 写评测报告 + 给出 SBS 结论。

你的交付物有两层：

- **结构化摘要 `summary`**：网站用来做卡片、分数表、SBS 胜负平徽章、聚合看板。
- **自由评测报告 `report`**：一段完整的 markdown，你按自己的判断组织章节，网站只负责原样渲染。

> 摘要是给机器看的硬约束；report 是给人看的开放空间。两者都必须有。

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

网站点"发起评测"时写入 `inbox/{taskId}.json`，schema：

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
    },
    {
      "reportId": "sub_def456",
      "productName": "MiroThink",
      "productVersion": "latest",
      "authorNote": "",
      "report": "# MiroThink 的回答\n\n……完整 markdown 正文……"
    }
  ]
}
```

**重要**：候选报告的 markdown 正文 **直接内联在 inbox 文件的 `report` 字段**。你不需要再去别处拉数据，打开这一个文件就能开工。

### 2.3 outbox 文件

你完成评测后，写入 `outbox/{taskId}/v{n}.json`。版本号由你自己扫 `outbox/{taskId}/` 目录决定：

- 目录不存在 → 写 `v1.json`
- 目录已有 `v1.json` `v2.json` → 写 `v3.json`
- **禁止覆盖历史版本**，每次迭代都留痕。网站默认展示最新版，提供下拉切历史。

---

## 3. 产物 Schema（outbox 必须严格遵守）

```json
{
  "taskId": "EV-0001-dlqvY6",
  "version": 1,
  "evaluator": "Sophia (Claude-Opus-4.7 via WorkBuddy)",
  "evaluatedAt": "2026-04-21T14:30:00.000Z",
  "contractVersion": "2.0",

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
        "vetoReason": "R1 存在关键数字量级错误（600 亿 vs 600 万），触发一票否决"
      }
    ],

    "rubric": [
      {
        "dimensionId": "R1",
        "name": "准确性",
        "weight": 0.40,
        "scores": [
          {
            "reportId": "sub_abc123",
            "score": 10,
            "tier": "S",
            "comment": "5 个子项全部过关：事实/数字/口径/语境/信源皆可核查",
            "confidence": "high",
            "issueTags": []
          },
          {
            "reportId": "sub_def456",
            "score": 6,
            "tier": "B",
            "comment": "核心数字有量级错误（600 亿被写成 600 万），触发一票否决",
            "confidence": "high",
            "issueTags": ["数字量级错", "事实错误"]
          }
        ]
      },
      { "dimensionId": "R2", "name": "相关性", "weight": 0.15, "scores": [ ... ] },
      { "dimensionId": "R3", "name": "论证深度", "weight": 0.20, "scores": [ ... ] },
      { "dimensionId": "R4", "name": "完备性", "weight": 0.10, "scores": [ ... ] },
      { "dimensionId": "R5", "name": "决策价值", "weight": 0.15, "scores": [ ... ] }
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
          "productA": "SophiaAI",
          "productB": "MiroThink",
          "winner": "A",
          "margin": "压倒性",
          "keyReason": "A 在 R1/R3 全面领先；B 因 R1 量级错误触发一票否决，总分封顶 6.9"
        }
      ]
    }
  },

  "report": "# SophiaAI vs MiroThink · BD 出海横评\n\n## 一、总评\n\n……\n\n## 二、分项拆解\n\n……\n\n## 三、SBS 结论\n\n……\n\n## 四、改进建议\n\n……"
}
```

### 3.1 字段硬约束

| 字段 | 约束 |
|---|---|
| `contractVersion` | 必须为 `"2.0"`（本契约版本） |
| `summary.overallScores[].score` | [0, 10]，**必须等于** `Σ(Ri.score × Ri.weight)` 的结果；触发一票否决时**封顶 6.9** |
| `summary.overallScores[].verdict` | 枚举：`卓越` / `优秀` / `合格` / `待改进` / `不合格`，按 `RUBRIC_STANDARD.md §三` 的评级档位 |
| `summary.overallScores[].vetoTriggered` | 布尔值，必填。`true` 表示 R1 触发一票否决 |
| `summary.overallScores[].vetoReason` | `vetoTriggered=true` 时**必填**，说明触发原因（哪种关键错误） |
| `summary.rubric` | **必须包含 R1~R5 全部 5 个维度**，顺序、id、name、weight 与 `RUBRIC_STANDARD.md §二` 完全一致 |
| `summary.rubric[].weight` | R1=0.40, R2=0.15, R3=0.20, R4=0.10, R5=0.15（激活 X 时等比缩减） |
| `summary.rubric[].scores` | **必须覆盖 candidates 里每一份报告** |
| `summary.rubric[].scores[].score` | **只能是 10 / 8 / 6 / 4 / 2 中的一个整数**，禁止小数，禁止档间分 |
| `summary.rubric[].scores[].tier` | **必填**，值必须与 score 对应：10→`"S"` / 8→`"A"` / 6→`"B"` / 4→`"C"` / 2→`"D"` |
| `summary.rubric[].scores[].comment` | 必填，简明说明打分依据 |
| `summary.rubric[].scores[].confidence` | 必填，枚举：`high` / `medium` / `low` |
| `summary.rubric[].scores[].issueTags` | 数组，可空；优先使用 `RUBRIC_STANDARD.md §五` 词表 |
| `summary.extraDimensions` | 可选；数量 ≤ 3；`dimensionId` 用 `X1`/`X2`/`X3`；分数同样是 10/8/6/4/2 五档整数 + `tier` 字段 |
| `summary.extraDimensions[].activated` | 布尔值，必填。`true` 表示纳入总分加权计算 |
| `summary.extraDimensions[].weight` | `activated=true` 时必填，枚举：`0.05` / `0.10` / `0.15`；`activated=false` 时省略或置 null |
| `summary.sbs` | candidates ≥ 2 时**必填**；candidates = 1 时可省略或置 null |
| `report` | 必填；markdown 格式；不设章节硬约束，由你判断 |

### 3.2 overallScore 计算

**基本情况**（未激活扩展维度）：

```
overallScore = R1.score × 0.40 + R2.score × 0.15 + R3.score × 0.20 + R4.score × 0.10 + R5.score × 0.15
```

档位制下，每个维度只能取 10/8/6/4/2，所以 overallScore 天然是一个有限精度的小数（通常 1 位小数足够）。**不允许反向凑分**——先打档位，再算加权和即可。

**激活扩展维度时**（最多 1 个）：

R1~R5 原权重（40/15/20/10/15）按比例等比缩减，使 R1~R5 + Xn 权重总和仍为 1.0：

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

缩减后的 R1~R5 权重**必须同步写入** `summary.rubric[].weight` 字段，不能继续沿用 40/15/20/10/15。

### 3.3 一票否决（硬规则）

如果 R1 判定存在「重大事实错误」（定义见 `RUBRIC_STANDARD.md §R1`），则：

1. **必须**设置 `overallScores[].vetoTriggered = true`
2. **必须**填写 `vetoReason` 说明具体触发原因
3. 计算出的加权和如果 > 6.9，**必须封顶为 6.9**（直接取 `min(加权和, 6.9)`）
4. `verdict` 最高只能标到 `"合格"`（即使封顶后的 6.9 按档位属于合格上限）

触发条件（满足任一即触发）：
- 关键数字量级错误
- 关键主体搞错
- 关键时间错位
- 关键因果颠倒
- 编造信源

"关键"指"这条信息如果用户相信了会影响决策"。非关键位置的小错只在 R1 内扣档（例如从 S 降到 A 或 B），不触发一票否决。

### 3.4 tier 与 score 的对应关系

打分时建议的心理路径：**先判档位（凭直觉），再机械映射 score**。

| tier | score | 一句话锚点 |
|---|---|---|
| `"S"` | 10 | 业内最强水平，挑不出毛病 |
| `"A"` | 8 | 明显高于平均，可直接交付 |
| `"B"` | 6 | 基本可用但有明显短板 |
| `"C"` | 4 | 有显著缺陷 |
| `"D"` | 2 | 结构性问题，不可用 |

tier 和 score 必须严格一一对应，不允许错配（例如 `tier="A", score=7` 是非法的）。

---

## 4. Rubric（打分维度定义）

**打分维度的宗旨、R1~R5 的完整定义与权重、扩展维度规则、SBS 规则、评级档位、issueTags 词表 —— 全部单独落在 `.evaluations/RUBRIC_STANDARD.md`。**

评测前请务必先通读 `RUBRIC_STANDARD.md`。该文件是面向用户的评测说明书，同时也是你打分时的事实源；网站「标准」tab 直接渲染它。

本文件（EVALUATION_CONTRACT.md）只管工作协议（inbox/outbox 文件格式、产物 schema、工作流）；rubric 的"评什么、怎么评、权重多少"一律去 RUBRIC_STANDARD.md 查阅。

> 两份文档的分工：
> - `RUBRIC_STANDARD.md` — 评测标准（给人看 + 给 LLM 打分时参考）
> - `EVALUATION_CONTRACT.md` — 工作协议（给 LLM 工作时读，定义 JSON 结构和流程）

> **打分相关的硬约束（R1~R5 必填 / 权重 / 档位 / overallScore 计算 / 一票否决 / 扩展维度规则）已全部列在 §3.1 ~ §3.4。**
> 本节不再重复，只补充一条：issueTags 优先使用 RUBRIC_STANDARD.md §五 的推荐词表，必要时可自造但应尽量复用既有标签。

---

## 5. 工作流（LLM 端）

用户在 WorkBuddy 对话框说 "**评测 EV-0001-dlqvY6**" 时：

1. **读工作协议**：`read_file .evaluations/EVALUATION_CONTRACT.md`（如果还没读过）
2. **读评测标准**：`read_file .evaluations/RUBRIC_STANDARD.md`（rubric 宗旨 / R1~R5 定义 / 权重 / 档位制 / 一票否决 / 评级档位 / SBS 规则 / issueTags 词表）
3. **读任务**：`read_file .evaluations/inbox/EV-0001-dlqvY6.json`
4. **思考打分**：不急着写文件，先在对话里理顺思路、拉数据、列骨架
5. **R1 自检**：逐份报告**先检查有没有"重大事实错误"**——这是一票否决的前置步骤，不要跳过
6. **档位打分**：按 R1~R5 顺序，**先判 tier（凭直觉打 S/A/B/C/D），再机械映射 score**（10/8/6/4/2）
7. **算 overallScore**：加权和直接写入，触发一票否决则封顶 6.9
8. **写扩展维度**（可选）：如有垂直能力差异，追加 X1~X3；决定是否激活
9. **写 v1**：
   - `list_dir .evaluations/outbox/EV-0001-dlqvY6/` 确认版本号
   - 不存在就创建目录，写 `v1.json`
10. **多轮迭代**：用户提出修改意见后，生成 `v2.json` / `v3.json`，历史版本保留
11. **告知用户**：给出 outbox 路径和版本号，让用户回网站点"刷新"

### 5.1 产物自检清单（写文件前过一遍，必做）

**结构：**

- [ ] `contractVersion` = `"2.0"`
- [ ] `summary.rubric` 覆盖 R1~R5 全部 5 项，id/name/weight 与 RUBRIC_STANDARD.md 一致
- [ ] 每个维度的 `scores` 覆盖 inbox 里全部 candidates

**打分：**

- [ ] 每个 `score` 都是 10 / 8 / 6 / 4 / 2 中的一个整数（**禁止小数**）
- [ ] 每个 `tier` 字段存在且与 score 严格对应（S=10 / A=8 / B=6 / C=4 / D=2）
- [ ] 每个 `confidence` 字段存在（high / medium / low）
- [ ] `overallScore` **等于**加权和（触发一票否决时封顶 6.9）
- [ ] `overallScores[].verdict` 按 RUBRIC_STANDARD.md 的评级档位打标签

**一票否决：**

- [ ] `overallScores[].vetoTriggered` 每条都有布尔值
- [ ] 触发一票否决的，`vetoReason` 必填，总分 ≤ 6.9，verdict ≤ "合格"
- [ ] 未触发的，vetoTriggered=false

**扩展维度：**

- [ ] 每个扩展维度有 `rationale`
- [ ] 每个扩展维度有 `activated` 布尔值
- [ ] 激活的 X 维度有合法的 `weight`（0.05 / 0.10 / 0.15），且 R1~R5 权重已等比缩减

**其他：**

- [ ] candidates ≥ 2 时 `sbs.pairs` 不为空
- [ ] `report` markdown 无明显坏掉的地方（表格闭合、代码块闭合）
- [ ] 版本号正确递增，没有覆盖历史
- [ ] **JSON 自检**：写文件后立即用 `python3 -c "import json; json.load(open('path'))"` 验证格式合法（历史踩坑：comment/verdict/report 里混了直引号 `"` 会导致 JSON 解析失败。正文里请用中文引号「」《》或单引号 `'`）

---

## 6. 网站端约定（给开发/自己留档）

- 网站 **只读 outbox**，不会反写 outbox。
- 网站不对 summary 做二次校正，`score` 显示几就是几。
- 网站对维度的渲染顺序：R1 → R5 → X1 → X2 → X3。
- 多版本策略：默认渲染最新版，版本选择器列出全部 `v{n}.json`。
- 删除一个 taskId 的所有评测 = 删 `outbox/{taskId}/` 整个文件夹（网站提供按钮）。
- **删除 Query 会级联删除该 queryCode 下所有 inbox 任务文件和 outbox 评测产物**（按 `${queryCode}-` 前缀匹配 taskId），操作不可恢复。

### 6.1 `reportId` 的隐式契约（重要）

- `inbox/{taskId}.json` 里 `candidates[].reportId`、以及 outbox payload 里 `overallScores[].reportId` / `rubric[].scores[].reportId` / `extraDimensions[].scores[].reportId` / `sbs.pairs[].reportId`，**全部使用同一个 id**。
- 这个 id = **网站前端 Submission（即"某产品对某 Query 的一次提交"）的主键**。网站写 inbox 时直接把 `Submission.id` 填进 `candidates[].reportId`；outbox 渲染时也按这个 id 去匹配 UI 上的 Submission 卡片。
- **LLM 必须原样沿用 inbox 给出的 reportId，不允许自造**（比如不要用 `productName` 当 id、也不要拼新的字符串）。否则网站按 reportId join 不上，对应产品的分数就会从 UI 上消失。
- 约定格式：当前为 `sub_xxx`（nanoid），LLM 不需要解析内部结构，当作不透明字符串使用即可。

### 6.2 向后兼容（v1.0 产物）

- 契约版本升级到 2.0 后，历史 v1.0 outbox 文件**保留不动**。
- 网站按 `contractVersion` 字段分别渲染 v1.0 和 v2.0 产物，不做迁移。
- v1.0 产物的维度名称（"信源与数据真实性"等）、权重（25/20/25/20/10）、0.5 精度分数继续按原样展示。

---

## 7. 版本

- 契约版本：**2.0**
- 生效日期：2026-04-21
- 上一版：1.0（2026-04-19 生效）
- 后续任何字段语义变更 → contractVersion 升级，旧 outbox 文件保留原 contractVersion 以便兼容渲染。
