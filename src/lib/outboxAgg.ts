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
import { useLab } from "../store";

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

  // 2026-04-21 方案 D：从 store 订阅 queries，构造 queryId → code 映射。
  // 作用：outbox 返回的 task 里带 queryId（冗余字段），即便 task.queryCode
  // 与当前 store 里某个 query.code 暂时对不上（例如 code 刚被 reconcile 改过
  // 而 localStorage 还没来得及 migrate），只要 queryId 命中，就把 task 归到
  // 正确的 queryCode 下。这是"以永久 id 为准、code 为次"的防御性修正。
  const queries = useLab((s) => s.queries);
  const queryIdToCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const q of queries) {
      if (q?.id && q?.code) m.set(q.id, q.code);
    }
    return m;
  }, [queries]);

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

  // ============================================================
  // 窗口焦点自动重拉（2026-04-20 新增）
  //
  // 背景：管理员版典型工作流是"在编辑器/LLM 里直接写 .evaluations/
  // 的产物 JSON，然后切回浏览器查看"。这种场景下前端没有任何机会
  // 感知到磁盘数据变化——ReportPage 因为 mount 时重拉所以看得到新
  // 数据，但 QueriesPage / DashboardPage 的 useOutboxAggregate 只在
  // 首次 mount 时拉一次，会停留在旧快照。
  //
  // 这里订阅两个事件让"切回来自动刷新"成为默认行为：
  //   - window focus: 从其他应用/窗口切回浏览器
  //   - document visibilitychange (visible): 同一窗口里从别的 tab
  //     切回本 tab（focus 事件在这种情况下不一定触发）
  //
  // 刷新通过复用 tick 自增机制实现（不直接调 refresh()，避免闭包陷阱）。
  // ============================================================
  useEffect(() => {
    const bump = () => setTick((v) => v + 1);
    const onVisibility = () => {
      if (document.visibilityState === "visible") bump();
    };
    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const agg = useMemo<OutboxAggregate>(() => {
    const byQueryCode = new Map<string, QueryAgg>();
    const tasksByQueryCode = new Map<string, OutboxListItem[]>();

    // 校正 task 的 queryCode：优先用 queryId 反查 store.queries 的 code，
    // 找不到时回退到 task.queryCode（从 taskId 前缀解析）。
    // 这样做的好处：即便 localStorage 里某条 query.code 还没 migrate 到注册簿的新值，
    // 只要 queryId 能回查到，这条 task 就能被归到正确的 query 下。
    const resolveEffectiveCode = (t: OutboxListItem): string | undefined => {
      if (t.queryId) {
        const fromId = queryIdToCode.get(t.queryId);
        if (fromId) return fromId;
      }
      return t.queryCode;
    };

    for (const t of tasks) {
      const code = resolveEffectiveCode(t);
      if (!code) continue;
      const arr = tasksByQueryCode.get(code) ?? [];
      arr.push(t);
      tasksByQueryCode.set(code, arr);
    }

    // 从 payloads 构造 QueryAgg
    for (const [taskId, payload] of payloads.entries()) {
      const task = tasks.find((t) => t.taskId === taskId);
      if (!task) continue;
      const code = resolveEffectiveCode(task);
      if (!code) continue;
      // 防御：payload 可能为 null / summary 缺失（例如 outbox 里 JSON 解析失败
      // 被 bus 返回 null）——不能让一份坏数据把整个 Dashboard 炸成白屏
      if (!payload || !payload.summary) {
        console.warn(
          `[outboxAgg] skip task ${taskId}: payload or summary missing`
        );
        continue;
      }

      const byReport = new Map<string, PerReportAgg>();
      // overallScores 是骨架
      const overallScores = payload.summary.overallScores ?? [];
      for (const o of overallScores) {
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
      const rubricDims = payload.summary.rubric ?? [];
      for (const dim of rubricDims) {
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

      byQueryCode.set(code, {
        queryCode: code,
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
  }, [tasks, payloads, loading, queryIdToCode]);

  return agg;
}
