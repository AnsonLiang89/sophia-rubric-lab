# `.evaluations/` 目录导航

这个目录是 **Sophia Rubric Lab 的事实源**——评测标准、工作协议、产品清单、待评任务、评测产物全部放在这里。
网站和 LLM 评测官都直接从本目录读写。

---

## 📂 目录一览

```
.evaluations/
├── README.md                  # ← 本文件（索引）
├── RUBRIC_STANDARD.md         # 面向用户的评测标准（「标准」tab 渲染）
├── EVALUATION_CONTRACT.md     # 面向 LLM 的工作协议（inbox/outbox 结构、schema、工作流）
├── PRODUCTS.json              # 评测主体清单（AI 产品列表，「产品」tab 只读）
├── inbox/                     # 网站写入的待评测任务
│   └── {taskId}.json
└── outbox/                    # LLM 写回的评测产物（按 taskId 分文件夹）
    └── {taskId}/
        ├── v1.json
        ├── v2.json            # 多轮迭代历史版本
        └── vN.json
```

---

## 🧭 谁该读哪份？

| 角色 | 必读 | 选读 |
|---|---|---|
| **LLM 评测官（Sophia）** | `EVALUATION_CONTRACT.md`（工作协议） + `RUBRIC_STANDARD.md`（打分标准） | `PRODUCTS.json`（了解主评测对象谱系） |
| **人类用户** | `RUBRIC_STANDARD.md`（知道评什么、怎么评） | `EVALUATION_CONTRACT.md`（想了解契约机制） |
| **开发者 / 维护者** | 全部三份文档 + `MEMORY.md`（根目录 memory） | inbox/outbox 示例产物 |

---

## 🔀 三份文档的分工

- **RUBRIC_STANDARD.md** — *Why & What*：为什么这样评、评什么维度、权重多少、评级档位、issueTags 词表。内容面向人，写得通俗。
- **EVALUATION_CONTRACT.md** — *How*：LLM 怎么写 outbox、JSON schema 长什么样、多版本怎么管理、reportId 的隐式契约。内容面向机器，严格且有示例。
- **PRODUCTS.json** — *Who*：列出所有"评测主体"（AI 产品）的 id、名称、版本、色值。网站前端只读；新增/删除产品直接编辑 JSON。

三份文档**各司其职，不互相重复**：RUBRIC_STANDARD 是"评测什么"的事实源；EVALUATION_CONTRACT 是"产物长什么样"的事实源；PRODUCTS.json 是"谁在被评"的事实源。

---

## 🔄 典型工作流

1. 用户在网站点「发起评测」→ 网站写入 `inbox/{taskId}.json`
2. 用户在 WorkBuddy 对话框说 "**评测 {taskId}**" 召唤 LLM
3. LLM 依次读 `EVALUATION_CONTRACT.md` → `RUBRIC_STANDARD.md` → `inbox/{taskId}.json`
4. LLM 扫 `outbox/{taskId}/` 确定下一个版本号，写入 `outbox/{taskId}/v{n}.json`
5. 用户回网站点「刷新」→ 新版本出现在版本下拉

---

## 🧹 维护小贴士

- **孤儿 inbox** 清理：项目根运行 `npm run cleanup-inbox`（dry-run）/ `npm run cleanup-inbox:apply`
- **删除 Query**：网站上删除会级联清理 `inbox/` 和 `outbox/` 里该 queryCode 前缀的全部任务（不可恢复）
- **契约升级**：任何字段语义变更必须升 `contractVersion`，并在 `EVALUATION_CONTRACT.md §7` 记录；旧产物保留原版本以便兼容渲染

---

## 📚 交叉引用

- `EVALUATION_CONTRACT.md §4` → 指向 `RUBRIC_STANDARD.md §二`（打分维度定义）
- `EVALUATION_CONTRACT.md §6.1` → `reportId = 前端 Submission.id` 的隐式契约
- 项目工程侧沉淀见仓库根 `.workbuddy/memory/MEMORY.md`
