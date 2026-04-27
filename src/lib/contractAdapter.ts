// ============================================================
// contractAdapter.ts
//
// 集中管理"按 outbox contractVersion 做兜底 / 归一化"的纯函数。
// 2026-04-27 抽离（P2 · UI 与契约一致性）：
//   - EvaluationReportView 之前内嵌了 DEFAULT_RUBRIC_NAMES / resolveDimensionName /
//     canonicalizeProductName / normalizePayloadProductNames / orderReportIds 等一堆
//     按版本兜底的逻辑，组件膨胀且职责不清。
//   - 抽成独立 adapter 后：组件只负责渲染，兼容旧版本的事统一落在这里。
//   - 新契约版本（如未来 3.3 / 4.0）只需在本文件增加映射表和归一化分支，
//     组件本体无需触碰。
//
// 约束：
//   - 只与 **outbox payload** 打交道；不涉及 inbox schema 版本。
//   - 所有函数必须是纯函数（无副作用、无网络、无 React hook）。
//   - 保留对 v1.0 ~ v3.3 的兜底，老产物打开网页不白屏。
// ============================================================

import type { EvaluationOutboxPayload } from "./contract";
import { isSophia } from "./sortProducts";

export type ContractVersion = EvaluationOutboxPayload["contractVersion"];

/**
 * 各契约版本下，R1~R5 维度的默认显示名。
 * payload.rubric[].name 缺省时的兜底。
 *
 * v1.0 是历史遗留口径；v2.0 起统一为"准确性/相关性/论证深度/完备性/决策价值"，
 * v2.0 ~ v3.3 共用一套（所以下面用同一对象 reference 引用，减少重复）。
 */
const NAMES_V1: Record<string, string> = {
  R1: "信源与数据真实性",
  R2: "结构与定量深度",
  R3: "洞察与论证",
  R4: "风险披露与决策价值",
  R5: "专业度与时效",
};

const NAMES_V2_PLUS: Record<string, string> = {
  R1: "准确性",
  R2: "相关性",
  R3: "论证深度",
  R4: "完备性",
  R5: "决策价值",
};

const DEFAULT_RUBRIC_NAMES: Record<ContractVersion, Record<string, string>> = {
  "1.0": NAMES_V1,
  "2.0": NAMES_V2_PLUS,
  "2.1": NAMES_V2_PLUS,
  "2.2": NAMES_V2_PLUS,
  "3.0": NAMES_V2_PLUS,
  "3.1": NAMES_V2_PLUS,
  "3.2": NAMES_V2_PLUS,
  "3.3": NAMES_V2_PLUS,
};

/**
 * 维度名兜底：payload 里显式填的优先；否则按 contractVersion 拿默认名；
 * 都没有时直接返回 dimensionId（至少不白板）。
 */
export function resolveDimensionName(
  dimensionId: string,
  payloadName: string | undefined,
  contractVersion: ContractVersion
): string {
  if (payloadName && payloadName.trim()) return payloadName;
  return DEFAULT_RUBRIC_NAMES[contractVersion]?.[dimensionId] ?? dimensionId;
}

// ------------------------------------------------------------
// 产品名归一化（主要服务于多版本 Sophia 的排序和去重展示）
// ------------------------------------------------------------

/**
 * 从产品名里抠出版本号数组，例如 "SophiaAI v4.1" → [4, 1]。
 * 没有匹配到则返回 []。
 */
export function parseProductVersion(name: string): number[] {
  const m = name.match(/v(\d+(?:\.\d+)*)/i);
  if (!m) return [];
  return m[1].split(".").map((n) => parseInt(n, 10) || 0);
}

/**
 * 字典序比较两个版本号数组。例 [4,1] > [4,0]；[5] > [4,99]。
 */
export function compareVersionArr(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/**
 * 把形如 "SophiaAI（v5.0）"、"SophiaAI (v5.0)"、"  SophiaAI  v5 "
 * 统一成 "SophiaAI v5" / "SophiaAI v5.0" 形式：
 *   - 去多余空格
 *   - 括号包裹的 v 版本号"拆出来"（括号 → 空格）
 */
export function canonicalizeProductName(raw: string | undefined): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  return v
    .replace(/[\s\u3000]*[（(]\s*(v\d+(?:\.\d+)*)\s*[)）][\s\u3000]*/i, " $1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 归一化 outbox payload 里的产品名：
 *   1. 统一命名格式（括号版本 → 空格版本）
 *   2. 多个 Sophia 同名时，给没版本号的自动补一个猜测版本号（避免表头全是 "SophiaAI"）
 *   3. perReportFeedback 跟着 overallScores 走，保持 reportId → productName 一致
 *
 * 纯函数：返回新对象，不改原 payload。
 */
export function normalizePayloadProductNames(
  payload: EvaluationOutboxPayload
): EvaluationOutboxPayload {
  const overall = payload.summary?.overallScores;
  if (!Array.isArray(overall) || overall.length === 0) return payload;

  const cleaned = overall.map((o) => ({
    ...o,
    productName: canonicalizeProductName(o.productName),
  }));

  const sophiaItems = cleaned.filter((o) => isSophia({ name: o.productName }));
  const seen = new Map<string, number>();
  for (const item of sophiaItems) {
    seen.set(item.productName, (seen.get(item.productName) ?? 0) + 1);
  }
  const hasDup = [...seen.values()].some((n) => n > 1);
  if (hasDup) {
    let nextGuess = 4;
    const used = new Set<number>();
    for (const item of sophiaItems) {
      const version = parseProductVersion(item.productName);
      if (version.length > 0) used.add(version[0]);
    }
    for (const item of sophiaItems) {
      if (parseProductVersion(item.productName).length > 0) continue;
      while (used.has(nextGuess)) nextGuess += 1;
      item.productName = `${item.productName.replace(/\s*v\d.*$/i, "").trim()} v${nextGuess}`;
      used.add(nextGuess);
    }
  }

  const authoritative = new Map(cleaned.map((o) => [o.reportId, o.productName]));
  const nextFeedback = payload.summary?.perReportFeedback?.map((f) => ({
    ...f,
    productName: authoritative.get(f.reportId) ?? canonicalizeProductName(f.productName),
  }));

  return {
    ...payload,
    summary: {
      ...payload.summary,
      overallScores: cleaned,
      ...(nextFeedback ? { perReportFeedback: nextFeedback } : {}),
    },
  };
}

/**
 * 按展示顺序排报告 id：Sophia 系列优先（版本号大的在前），其它按 payload 原序。
 */
export function orderReportIds(
  overall: EvaluationOutboxPayload["summary"]["overallScores"]
): string[] {
  const withIdx = overall.map((o, idx) => ({ ...o, idx }));
  withIdx.sort((a, b) => {
    const sa = isSophia({ name: a.productName });
    const sb = isSophia({ name: b.productName });
    if (sa && !sb) return -1;
    if (!sa && sb) return 1;
    if (sa && sb) {
      return -compareVersionArr(parseProductVersion(a.productName), parseProductVersion(b.productName));
    }
    return a.idx - b.idx;
  });
  return withIdx.map((o) => o.reportId);
}

// ------------------------------------------------------------
// 正文呈现策略（v3.2 收敛：只有评分总表 + 正文两个独立模块）
// ------------------------------------------------------------

/**
 * 正文写作期望提示：根据 contractVersion 决定右上角那行小字。
 * 抽到 adapter 后，未来新增版本只需要加一个分支。
 */
export function reportHintFor(contractVersion: ContractVersion): string {
  switch (contractVersion) {
    case "3.3":
      return "质量优先：取消 45min 时间盒；承重 claim 抽到 Top 10；诊断内容全部写入正文四段结构。";
    case "3.2":
      return "评分总表之外的核验记录、每份反馈与聚焦诊断都应写入正文，不再拆成独立模块。";
    case "3.1":
      return "正文按总-分-总四段结构展开，重点把事实错误、逻辑错误与证据写透。";
    default:
      return "正文按产物原样渲染。";
  }
}
