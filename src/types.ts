// ============================================================
// 领域模型 - Sophia's Rubric Lab
// ============================================================

/**
 * Rubric 5 维（与本次评测对齐）
 *
 * ⚠️ 注意：下方 `description` 是**精简占位文案**，仅供前端列表/图例等快速展示使用。
 * 维度的**完整定义、打分锚点、负面特征**等正式说明以
 * `.evaluations/RUBRIC_STANDARD.md` §二 为准（由 Standard 页面直接渲染 markdown）。
 * 若要修订维度语义，请同步更新 RUBRIC_STANDARD.md，避免两处漂移。
 */
export const RUBRIC_DIMENSIONS = [
  {
    id: "R1",
    name: "信源与数据真实性",
    weight: 0.25,
    description: "引用完整、数据可溯源、无造数嫌疑、口径一致",
  },
  {
    id: "R2",
    name: "结构与定量深度",
    weight: 0.2,
    description: "章节完整、逻辑层次清晰、量化指标充分",
  },
  {
    id: "R3",
    name: "洞察与论证",
    weight: 0.25,
    description: "有独立观点、推导严谨、非结论先行",
  },
  {
    id: "R4",
    name: "风险披露与决策价值",
    weight: 0.2,
    description: "风险全面、有可操作性、能支撑决策",
  },
  {
    id: "R5",
    name: "专业度与时效",
    weight: 0.1,
    description: "行文专业克制、引用时效新、无口语化毛刺",
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
