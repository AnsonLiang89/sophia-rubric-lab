// ============================================================
// outboxUtils.ts
// outbox 列表的"按 mtime 挑选"的两种通用方式。抽出到此处，让
// 外层概览（outboxAgg.ts）与详情页（ReportPage.tsx）共享基础语义、
// 避免两处各自手写 mtime 比较导致漂移。
//
// 两个函数服务不同粒度，刻意不合并：
//   - pickLatestTaskByQueryCode: 以 **task 为粒度**
//     每个 queryCode 取"最新 task"（latestMtime 最大者），供外层卡片
//     展示"这个 Query 的当前评测结果"（只要 1 条）
//   - flattenTaskVersions: 以 **version 为粒度**
//     扁平化一个 queryCode 下所有 (taskId, v) 对，按 mtime 统一重编号，
//     供详情页展示"完整历史版本时间轴"
// ============================================================

import type { OutboxListItem } from "./contract";

/**
 * 在一批 outbox 任务里，按 queryCode 分组取出每组"最新"的 task。
 * "最新" = latestMtime 最大者（平手时保留先出现的一个，稳定性无关紧要）。
 *
 * @param tasks 通常来自 contractBus.listOutbox() 的 results
 * @returns queryCode -> 最新 task。没有 queryCode 的任务被跳过。
 */
export function pickLatestTaskByQueryCode(
  tasks: OutboxListItem[]
): Map<string, OutboxListItem> {
  const latestByCode = new Map<string, OutboxListItem>();
  for (const t of tasks) {
    const code = t.queryCode;
    if (!code) continue;
    const cur = latestByCode.get(code);
    if (!cur || t.latestMtime > cur.latestMtime) {
      latestByCode.set(code, t);
    }
  }
  return latestByCode;
}

/** 扁平化后的"报告版本"条目：一份具体产物 = 一个显示版本号 */
export interface FlatTaskVersion {
  /** 磁盘实际存放的任务 id（调用 deleteOutbox / getOutboxVersion 时用） */
  taskId: string;
  /** 磁盘上的版本号（LLM 在该 taskId 内自递增） */
  diskVersion: number;
  /** 对外展示的版本号：按 mtime 升序统一编号，1 = 最早，N = 最新 */
  displayVersion: number;
  mtime: number;
}

/**
 * 把一批 outbox 任务（通常属于**同一个 queryCode**）扁平化为 FlatTaskVersion[]：
 *   1. 把所有 (taskId, v) 对摊平
 *   2. 按 mtime **升序** 分配 displayVersion（时间越早版本号越小）
 *   3. 返回时按 mtime **倒序**（最新在前，方便 UI 直接取 [0] 作为默认选中项）
 *
 * 注意：调用方通常已经 filter 过 queryCode，这里不再做过滤——因为 task.queryCode
 * 语义是"任务挂在哪个 Query 下"，跨 Query 扁平化没有意义。
 */
export function flattenTaskVersions(tasks: OutboxListItem[]): FlatTaskVersion[] {
  const raw: Array<Omit<FlatTaskVersion, "displayVersion">> = [];
  for (const t of tasks) {
    for (const v of t.versions) {
      raw.push({ taskId: t.taskId, diskVersion: v.v, mtime: v.mtime });
    }
  }
  // 先按时间升序分配 displayVersion
  raw.sort((a, b) => a.mtime - b.mtime);
  const flat: FlatTaskVersion[] = raw.map((r, i) => ({
    ...r,
    displayVersion: i + 1,
  }));
  // 对外倒序：最新排第一
  flat.sort((a, b) => b.mtime - a.mtime);
  return flat;
}
