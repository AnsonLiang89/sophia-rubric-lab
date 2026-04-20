/**
 * 分数相关展示层工具
 *
 * 注：本文件原本还承载 `computeOverall` / `latestEvaluation` 等函数（服务于
 * 旧的 localStorage Evaluation 模型）。自契约 v1 起评分全部由 LLM 写入
 * `.evaluations/outbox/` JSON，前端不再自行计算加权/筛最新，这些函数已移除。
 */

/** 按分数取文字色阶 class（4 档） */
export function scoreColor(score: number): string {
  if (score >= 8) return "text-moss";
  if (score >= 6.5) return "text-amber-dark";
  if (score >= 5) return "text-ochre";
  return "text-clay";
}

/**
 * 按分数取"背景色 + 前景色"组合 class，用于 chip/徽章等浅底块
 *
 * 4 档阈值与 `scoreColor` 对齐；Dashboard 的综合得分 chip、单元格高亮都走它。
 */
export function scoreBg(score: number): string {
  if (score >= 8) return "bg-moss/15 text-moss";
  if (score >= 6.5) return "bg-amber/20 text-amber-dark";
  if (score >= 5) return "bg-paper-200 text-ink-700";
  return "bg-clay/15 text-clay";
}

export function formatDate(iso: string, withTime = false) {
  const d = new Date(iso);
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, "0");
  const D = String(d.getDate()).padStart(2, "0");
  if (!withTime) return `${Y}-${M}-${D}`;
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${Y}-${M}-${D} ${h}:${m}`;
}

/** 简易 deep clone */
export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}
