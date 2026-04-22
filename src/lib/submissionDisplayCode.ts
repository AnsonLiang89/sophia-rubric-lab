/**
 * Submission 展示编号（displayCode）
 * ============================================================
 * 契约：
 *   - 格式：`{queryCode}-R{N}`（示例：`EV-0005-R1`、`EV-0005-R2`）
 *   - 排序：同一 queryId 下，按 submittedAt 升序分配 N=1,2,3...
 *           submittedAt 相同则按 createdAt 升序兜底；仍相同则按 id 字典序
 *   - **纯计算，不入库**：跟随当前权威 queryCode 变化，零数据迁移风险
 *   - 分配权：展示层调用本 helper 计算；Submission 数据里不持久化 displayCode 字段
 *   - 使用范围：目前仅用于 RawReportModal 标题。未来若扩展到其他 UI 位置，
 *              消费方也应通过本 helper 计算，保持口径唯一
 *
 * 详见 `.evaluations/NAMING_CONTRACT.md` 的 "Submission.displayCode" 小节。
 */

import type { Submission } from "../types";

/**
 * 给定 queryCode 和该 query 下的 submissions，返回 Map<submissionId, displayCode>。
 *
 * 实现细节：
 *   - 按 (submittedAt, createdAt, id) 稳定升序排列
 *   - 若 queryCode 为空（数据异常兜底），fallback 到 `R{N}`（不带 query 前缀），
 *     调用方应自行保证 queryCode 的存在
 */
export function computeSubmissionDisplayCodes(
  queryCode: string,
  submissions: readonly Submission[]
): Map<string, string> {
  const sorted = [...submissions].sort((a, b) => {
    const sa = a.submittedAt || "";
    const sb = b.submittedAt || "";
    if (sa !== sb) return sa < sb ? -1 : 1;
    const ca = a.createdAt || "";
    const cb = b.createdAt || "";
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const prefix = queryCode ? `${queryCode}-R` : "R";
  const map = new Map<string, string>();
  sorted.forEach((sub, idx) => {
    map.set(sub.id, `${prefix}${idx + 1}`);
  });
  return map;
}

/**
 * 快捷方法：单独取某条 submission 的 displayCode。
 * 注意：只算一条的场景，也必须传入全量 submissions 以保证排序正确。
 */
export function getSubmissionDisplayCode(
  queryCode: string,
  submissions: readonly Submission[],
  submissionId: string
): string | undefined {
  return computeSubmissionDisplayCodes(queryCode, submissions).get(submissionId);
}
