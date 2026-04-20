// ============================================================
// outboxAgg.ts
// 从 .evaluations/outbox/ 汇总评测结果，供 QueriesPage / DashboardPage
// 等"外层概览页"消费。
//
// 背景（2026-04-20）：ReportPage 已切到 outbox 作为唯一事实源；
// 但 QueriesPage 列表卡与 DashboardPage 总览仍在读 store.evaluations
// （localStorage 里的 seed 数据），导致外层与详情页脱节。
// 本 hook 提供统一的聚合入口，让三处展示的数据对齐。
//
// 聚合策略：
//  - 每个 queryCode 下可能有多次"召唤"（taskId）
//  - 每个 taskId 下可能有多个版本（v1/v2/v3...）
//  - 我们取每个 queryCode 下**最新 taskId 的最新 version**（mtime 最大）
//    作为该 Query 的"当前评测结果"
//  - 进一步把该 payload 拆成 { reportId -> PerReportAgg }，
//    以便外层按 submission 维度展示总分/维度分/问题标签
// ============================================================

import { useEffect, useMemo, useState } from "react";
import {
  contractBus,
  type EvaluationOutboxPayload,
  type OutboxListItem,
} from "./contract";
import { pickLatestTaskByQueryCode } from "./outboxUtils";

export interface PerReportAgg {
  reportId: string;
  productName: string;
  /** 综合得分（0~10） */
  overallScore: number;
  verdict?: string;
  /** R1~R5 分数映射 */
  rubric: Record<string, number>;
  /** 所有维度的 issueTags 去重汇总 */
  issueTags: string[];
}

export interface QueryAgg {
  queryCode: string;
  /** 该 Query 下参与聚合的 taskId（最新一次） */
  taskId: string;
  /** 该 taskId 的最新版本号 */
  version: number;
  mtime: number;
  /** reportId (= submission.id) -> 聚合 */
  byReport: Map<string, PerReportAgg>;
  /** 原始 payload，需要时透传 */
  payload: EvaluationOutboxPayload;
}

export interface OutboxAggregate {
  loading: boolean;
  /** queryCode -> 最新聚合；没评测过的 query 不在这个 map 里 */
  byQueryCode: Map<string, QueryAgg>;
  /** queryCode -> 该 Query 下所有 tasks（原始，方便 ReportPage 之外的页面也能知道"有几次召唤、几个版本"） */
  tasksByQueryCode: Map<string, OutboxListItem[]>;
  /** 手动刷新（例如新建评测完成后调用） */
  refresh: () => void;
}

/**
 * 订阅 outbox 聚合。
 * - 页面挂载时拉一次
 * - refresh() 触发重新聚合
 *
 * 注意：这是**前端侧的聚合**，不改动 store.evaluations；这样旧代码仍能工作，
 * 但外层展示可以优先使用新数据，保证与 ReportPage 详情一致。
 */
export function useOutboxAggregate(): OutboxAggregate {
  const [tasks, setTasks] = useState<OutboxListItem[]>([]);
  const [payloads, setPayloads] = useState<Map<string, EvaluationOutboxPayload>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const resp = await contractBus.listOutbox();
        const list = resp?.results ?? [];
        if (cancelled) return;
        setTasks(list);

        // 每个 queryCode 只拉"最新的那个 task 的最新版本"
        // （最新 task = 该 queryCode 下 latestMtime 最大的 task）
        // 此处"最新 task"的判定被抽到 outboxUtils.pickLatestTaskByQueryCode，
        // 与 ReportPage 的版本扁平化共享基础语义，避免两处手写 mtime 比较漂移。
        const latestByCode = pickLatestTaskByQueryCode(list);

        const entries = await Promise.all(
          Array.from(latestByCode.values()).map(async (t) => {
            try {
              const bundle = await contractBus.getOutbox(t.taskId);
              return bundle ? ([t.taskId, bundle.latest] as const) : null;
            } catch {
              return null;
            }
          })
        );
        if (cancelled) return;
        const next = new Map<string, EvaluationOutboxPayload>();
        for (const e of entries) if (e) next.set(e[0], e[1]);
        setPayloads(next);
      } catch {
        if (!cancelled) {
          setTasks([]);
          setPayloads(new Map());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const agg = useMemo<OutboxAggregate>(() => {
    const byQueryCode = new Map<string, QueryAgg>();
    const tasksByQueryCode = new Map<string, OutboxListItem[]>();

    for (const t of tasks) {
      if (!t.queryCode) continue;
      const arr = tasksByQueryCode.get(t.queryCode) ?? [];
      arr.push(t);
      tasksByQueryCode.set(t.queryCode, arr);
    }

    // 从 payloads 构造 QueryAgg
    for (const [taskId, payload] of payloads.entries()) {
      const task = tasks.find((t) => t.taskId === taskId);
      if (!task || !task.queryCode) continue;

      const byReport = new Map<string, PerReportAgg>();
      // overallScores 是骨架
      for (const o of payload.summary.overallScores) {
        byReport.set(o.reportId, {
          reportId: o.reportId,
          productName: o.productName,
          overallScore: o.score,
          verdict: o.verdict,
          rubric: {},
          issueTags: [],
        });
      }
      // 填 rubric 分 + 汇总 issueTags
      for (const dim of payload.summary.rubric) {
        for (const s of dim.scores) {
          const cur = byReport.get(s.reportId);
          if (!cur) continue;
          cur.rubric[dim.dimensionId] = s.score;
          if (s.issueTags?.length) {
            for (const tag of s.issueTags) {
              if (!cur.issueTags.includes(tag)) cur.issueTags.push(tag);
            }
          }
        }
      }

      byQueryCode.set(task.queryCode, {
        queryCode: task.queryCode,
        taskId,
        version: payload.version,
        mtime: task.latestMtime,
        byReport,
        payload,
      });
    }

    return {
      loading,
      byQueryCode,
      tasksByQueryCode,
      refresh: () => setTick((v) => v + 1),
    };
  }, [tasks, payloads, loading]);

  return agg;
}
