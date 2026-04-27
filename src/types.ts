// ============================================================
// 领域模型 - Sophia's Rubric Lab
// ============================================================

/**
 * Rubric 5 维（与当前 v2.0+ 契约对齐）
 *
 * 维度历史：
 *   - v1.0（2026-04 之前）：R1 信源 / R2 结构 / R3 洞察 / R4 风险 / R5 专业度时效
 *   - v2.0（2026-04-21 起）：按下方定义重构；R1 吸收 v1 的信源职能（"数字对不对"和"信源硬不硬"本就指向同一件事），权重从 0.25 → 0.40
 *   - v2.1（2026-04-22）：维度不变，新增外部核验硬约束 + perReportFeedback
 *   - v2.2（2026-04-25）：维度不变，R1 拆 R1a/R1b 子项 + claim-inventory/checklist/budget 流水线
 *   - v3.0（2026-04-25 晚）：维度/权重仍不变，但评测焦点转向 Sophia 聚焦诊断；report 结构从六大章节改为三稳定锚点 + 自由生成层
 *   - v3.1（2026-04-25 深夜）：先查错再评分；report 收敛为总-分-总四段锚点
 *   - v3.2（2026-04-26）：评分总表之外的核验/反馈/聚焦诊断全部回归正文；页面主阅读路径收敛为“评分总表 + 正文”
 *
 * ⚠️ 注意：下方 `description` 是**精简占位文案**，仅供前端列表/图例等快速展示使用。
 * 维度的**完整定义、打分锚点、负面特征**等正式说明以
 * `.evaluations/RUBRIC_STANDARD.md` §二 为准（由 Standard 页面直接渲染 markdown）。
 * 若要修订维度语义，请同步更新 RUBRIC_STANDARD.md，避免两处漂移。
 *
 * Dashboard 的总览/SBS 聚合默认只计入 `contractVersion >= "2.0"` 的产物（含 v3.0），
 * v1.0 历史产物因维度语义不同会被过滤（顶部提示已过滤几份）。
 */
export const RUBRIC_DIMENSIONS = [
  {
    id: "R1",
    name: "准确性",
    weight: 0.4,
    description: "事实/数字/因果/信源准确；无编造、无量级级误差、无张冠李戴；可外部核验",
  },
  {
    id: "R2",
    name: "相关性",
    weight: 0.15,
    description: "紧扣 query 核心诉求；识别字面之下的真问题；不跑题不绕路",
  },
  {
    id: "R3",
    name: "论证深度",
    weight: 0.2,
    description: "有独立观点、推导链条清晰、证据支撑扎实；非结论先行、非流于表面",
  },
  {
    id: "R4",
    name: "完备性",
    weight: 0.1,
    description: "关键维度覆盖齐全、视角均衡、不漏重大风险/反方论点",
  },
  {
    id: "R5",
    name: "决策价值",
    weight: 0.15,
    description: "结论可落地、能支撑实际决策；给出可操作建议与权衡",
  },
] as const;

export type DimensionId = (typeof RUBRIC_DIMENSIONS)[number]["id"];

/** 问题标签库（复用） */
export const ISSUE_TAGS = [
  { id: "no-citation", label: "缺引用", severity: "high" },
  { id: "fabricated", label: "造数嫌疑", severity: "critical" },
  { id: "contradiction", label: "内部矛盾", severity: "critical" },
  { id: "category-error", label: "事实性错误", severity: "critical" },
  { id: "caliber-mixed", label: "口径混用", severity: "high" },
  { id: "conclusion-first", label: "结论先行", severity: "medium" },
  { id: "casual-tone", label: "口语化", severity: "low" },
  { id: "weak-argument", label: "论据薄弱", severity: "medium" },
  { id: "outdated", label: "时效落后", severity: "medium" },
  { id: "missing-risk", label: "风险遗漏", severity: "high" },
  { id: "excellent-insight", label: "亮眼洞察", severity: "positive" },
  { id: "strong-evidence", label: "证据扎实", severity: "positive" },
] as const;

export type IssueTagId = (typeof ISSUE_TAGS)[number]["id"];
export type Severity = "critical" | "high" | "medium" | "low" | "positive";

/** 评测题类型（用于 SBS 分桶对比，后续可由用户自定义扩展） */
export const QUERY_TYPES = [
  {
    id: "info-mining",
    name: "信息挖掘型",
    description: "需要广泛检索、信息聚合、去重归并的题目",
    color: "#C8941F",
  },
  {
    id: "complex-reasoning",
    name: "复杂推理型",
    description: "需要多步推理、因果链条、假设推导的题目",
    color: "#8B6F3D",
  },
  {
    id: "quantitative-analysis",
    name: "定量分析型",
    description: "需要数据建模、估值测算、敏感性分析的题目",
    color: "#5A7A47",
  },
  {
    id: "decision-advisory",
    name: "决策建议型",
    description: "需要给出明确行动建议、风险权衡、落地路径的题目",
    color: "#A8522B",
  },
  {
    id: "industry-research",
    name: "行业研究型",
    description: "行业格局、竞争分析、产业链梳理类题目",
    color: "#7B6A4E",
  },
  {
    id: "other",
    name: "其他",
    description: "未分类或混合型题目",
    color: "#8B8272",
  },
] as const;

export type QueryTypeId = (typeof QUERY_TYPES)[number]["id"];

/** AI 产品 */
export interface AIProduct {
  id: string;
  name: string;            // 例: "SophiaAI"
  version?: string;        // 例: "v4"
  vendor?: string;
  /**
   * @deprecated 自 2026-04-20 起废弃。
   * 产品列表由 `.evaluations/PRODUCTS.json` 管理，"主评测对象"默认取排序后的第一个。
   * 保留此字段仅用于向后兼容 seed/localStorage 里的旧快照。
   */
  isPrimary?: boolean;
  color?: string;          // 图表配色
  /**
   * 内部说明文字（Markdown 或纯文本均可），仅「评测对象管理器」页面可见。
   * Dashboard / Report / Products 等展示面均**不渲染**此字段。
   * 用来记录这个评测对象的背景、用途、版本差异等，方便管理员自己维护。
   */
  description?: string;
  createdAt: string;
}

/** Query：一条评测（以 Query 为唯一管理维度） */
export interface Query {
  id: string;              // 内部 nanoid
  code: string;            // 人类可读编号，例：EV-0001（独一无二）
  title: string;           // 评测 Query 原文（列表原样展示，不做总结）
  description?: string;    // 追加说明（可选 Markdown）
  domain?: string;         // 如 "医药BD出海" / "个股估值"
  typeId: QueryTypeId;     // 评测题类型（必填）
  reportDate?: string;     // 报告生成时间（ISO，填到报告这批报告的整体产出时间）
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

/** Submission：某个 AI 在某道 Query 下的报告 */
export interface Submission {
  id: string;
  queryId: string;
  productId: string;
  productVersion?: string; // 冗余快照，便于未来版本演进
  submittedAt: string;     // 报告生成时间
  contentFormat: "markdown" | "plain" | "html";
  content: string;         // 报告正文
  sourceUrl?: string;
  createdAt: string;
}

/** 整库快照（用于导入导出）
 *
 * 注：自契约 v1 起，评测结果由 LLM 写入 `.evaluations/outbox/` JSON 文件，
 * **不再**进入 localStorage，因此 LabSnapshot 也不再承载 evaluations/comments。
 * 如需导出完整历史评测，直接备份 `.evaluations/` 目录即可。
 */
export interface LabSnapshot {
  version: number;
  exportedAt: string;
  products: AIProduct[];
  queries: Query[];
  submissions: Submission[];
}
