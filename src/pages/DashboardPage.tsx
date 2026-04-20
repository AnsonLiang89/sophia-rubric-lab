import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLab } from "../store";
import {
  RUBRIC_DIMENSIONS,
  QUERY_TYPES,
  type QueryTypeId,
  type AIProduct,
  type Query,
} from "../types";
import clsx from "clsx";
import { useOutboxAggregate, type PerReportAgg } from "../lib/outboxAgg";
import { scoreBg } from "../lib/score";
import { pickPrimaryProduct } from "../lib/sortProducts";

// ============================================================
// 工具：聚合一组"(query -> perReport)"记录，得到评测数 / 总分均值 / 各维度均值
// ============================================================
interface ProductAggResult {
  count: number;
  overallAvg: number | null;
  dimAvg: Record<string, number | null>;
}

function aggregateByProduct(records: PerReportAgg[]): ProductAggResult {
  const count = records.length;
  if (count === 0) {
    return {
      count: 0,
      overallAvg: null,
      dimAvg: Object.fromEntries(
        RUBRIC_DIMENSIONS.map((d) => [d.id, null as number | null])
      ) as Record<string, number | null>,
    };
  }
  const overallAvg =
    records.reduce((a, e) => a + (e.overallScore || 0), 0) / count;

  const dimAvg: Record<string, number | null> = {};
  for (const d of RUBRIC_DIMENSIONS) {
    const vals: number[] = [];
    for (const e of records) {
      const s = e.rubric[d.id];
      if (typeof s === "number") vals.push(s);
    }
    dimAvg[d.id] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  return { count, overallAvg, dimAvg };
}

// ============================================================
// SBS 对决：主产品 vs 对手在共同评测题上的胜平负
// ============================================================
function compareSBS(
  primary: AIProduct,
  opponent: AIProduct,
  queries: Query[],
  /** queryId -> productId -> PerReportAgg */
  matrix: Map<string, Map<string, PerReportAgg>>
) {
  const total = { wins: 0, ties: 0, losses: 0 };
  const dims: Record<
    string,
    { wins: number; ties: number; losses: number; primarySum: number; opponentSum: number; pairs: number }
  > = {};
  for (const d of RUBRIC_DIMENSIONS)
    dims[d.id] = { wins: 0, ties: 0, losses: 0, primarySum: 0, opponentSum: 0, pairs: 0 };

  let primaryOverallSum = 0;
  let opponentOverallSum = 0;
  let overallPairs = 0;

  for (const q of queries) {
    const row = matrix.get(q.id);
    if (!row) continue;
    const a = row.get(primary.id);
    const b = row.get(opponent.id);
    if (!a || !b) continue;

    overallPairs++;
    primaryOverallSum += a.overallScore;
    opponentOverallSum += b.overallScore;

    const dTotal = a.overallScore - b.overallScore;
    if (Math.abs(dTotal) < 0.05) total.ties++;
    else if (dTotal > 0) total.wins++;
    else total.losses++;

    for (const d of RUBRIC_DIMENSIONS) {
      const sa = a.rubric[d.id];
      const sb = b.rubric[d.id];
      if (sa == null || sb == null) continue;
      dims[d.id].pairs++;
      dims[d.id].primarySum += sa;
      dims[d.id].opponentSum += sb;
      const diff = sa - sb;
      if (Math.abs(diff) < 0.05) dims[d.id].ties++;
      else if (diff > 0) dims[d.id].wins++;
      else dims[d.id].losses++;
    }
  }

  const primaryOverallAvg = overallPairs ? primaryOverallSum / overallPairs : null;
  const opponentOverallAvg = overallPairs ? opponentOverallSum / overallPairs : null;

  return {
    total,
    dims,
    overallPairs,
    primaryOverallAvg,
    opponentOverallAvg,
  };
}

// ============================================================
// 主页面
// ============================================================
export default function DashboardPage() {
  const { products, queries, submissions } = useLab();
  const outbox = useOutboxAggregate();

  // 新架构：products 已在 store 里用 sortProducts 排好序（Sophia 在前，新版本在前）。
  // 主评测对象显式挑 Sophia（最新版），避免 PRODUCTS.json 里没有 Sophia 时错拿第一个。
  const primary = pickPrimaryProduct(products);
  const others = products.filter((p) => p.id !== primary?.id);

  const [overviewType, setOverviewType] = useState<QueryTypeId | "all">("all");
  const [sbsType, setSbsType] = useState<QueryTypeId | "all">("all");
  const [opponentId, setOpponentId] = useState<string | null>(others[0]?.id ?? null);

  /** 构建 { queryId -> { productId -> PerReportAgg } } —— 数据源是 outbox */
  const matrix = useMemo(() => {
    const m = new Map<string, Map<string, PerReportAgg>>();
    for (const q of queries) {
      const row = new Map<string, PerReportAgg>();
      const qAgg = q.code ? outbox.byQueryCode.get(q.code) : undefined;
      if (qAgg) {
        const qSubs = submissions.filter((s) => s.queryId === q.id);
        for (const s of qSubs) {
          const r = qAgg.byReport.get(s.id);
          if (r) row.set(s.productId, r);
        }
      }
      m.set(q.id, row);
    }
    return m;
  }, [queries, submissions, outbox.byQueryCode]);

  const overviewQueries = useMemo(
    () =>
      overviewType === "all"
        ? queries
        : queries.filter((q) => (q.typeId ?? "other") === overviewType),
    [queries, overviewType]
  );
  const sbsQueries = useMemo(
    () =>
      sbsType === "all"
        ? queries
        : queries.filter((q) => (q.typeId ?? "other") === sbsType),
    [queries, sbsType]
  );

  /** 每个产品在"当前总览题型"范围内的整体聚合 */
  const productAgg = useMemo(() => {
    const m: Record<string, ProductAggResult> = {};
    for (const p of products) {
      const records: PerReportAgg[] = [];
      for (const q of overviewQueries) {
        const r = matrix.get(q.id)?.get(p.id);
        if (r) records.push(r);
      }
      m[p.id] = aggregateByProduct(records);
    }
    return m;
  }, [products, overviewQueries, matrix]);

  const currentOpponent = others.find((o) => o.id === opponentId) ?? others[0];
  const sbsResult = useMemo(() => {
    if (!primary || !currentOpponent) return null;
    return compareSBS(primary, currentOpponent, sbsQueries, matrix);
  }, [primary, currentOpponent, sbsQueries, matrix]);

  // 数据新鲜度提示：outbox 里有结果的 Query 数
  // 注：必须放在所有 early return 之前，遵守 Hook Rules
  const evaluatedQueryCount = useMemo(() => {
    let n = 0;
    for (const q of queries) {
      if (q.code && outbox.byQueryCode.has(q.code)) n++;
    }
    return n;
  }, [queries, outbox.byQueryCode]);

  if (!primary || queries.length === 0) {
    return (
      <div className="py-20 text-center text-ink-500">
        <p className="text-lg mb-4">还没有任何评测数据</p>
        <Link
          to="/queries"
          className="inline-block bg-amber text-white px-5 py-2 rounded-lg hover:bg-amber-dark transition"
        >
          去创建第一道评测题 →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* ============ Part 1：评测总览 ============ */}
      <section>
        <div className="mb-4 flex items-end justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold">评测总览</h1>
            <p className="text-sm text-ink-500 mt-1">
              最新版本{" "}
              <strong className="text-amber-dark">
                {primary.name} {primary.version}
              </strong>{" "}
              · 共 {products.length} 个 AI 产品 · {queries.length} 道评测题 ·{" "}
              <span className="text-moss">{evaluatedQueryCount} 道已完成评测</span>
            </p>
          </div>
          {outbox.loading && (
            <span className="text-xs text-ink-400 italic">同步评测结果…</span>
          )}
        </div>

        <TypeTabs
          value={overviewType}
          onChange={setOverviewType}
          counts={countByType(queries)}
        />

        <div className="mt-3">
          {overviewQueries.length === 0 ? (
            <EmptyBox text="当前题型下暂无题目" />
          ) : (
            <ProductScoresTable
              primary={primary}
              others={others}
              agg={productAgg}
              queryCount={overviewQueries.length}
            />
          )}
        </div>
      </section>

      {/* ============ Part 2：SBS 对比 ============ */}
      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold">SBS 对比</h2>
          <p className="text-sm text-ink-500 mt-1">
            选择题型与对手，查看 {primary.name} 与其在总分及每个维度上的对比结论
          </p>
        </div>

        <TypeTabs
          value={sbsType}
          onChange={setSbsType}
          counts={countByType(queries)}
        />

        <div className="mt-3">
          <OpponentTabs
            opponents={others}
            value={currentOpponent?.id ?? null}
            onChange={setOpponentId}
          />
        </div>

        <div className="mt-3">
          {others.length === 0 || !currentOpponent ? (
            <EmptyBox text="还没有其他 AI 可以对比" />
          ) : sbsQueries.length === 0 ? (
            <EmptyBox text="当前题型下暂无题目" />
          ) : !sbsResult || sbsResult.overallPairs === 0 ? (
            <EmptyBox
              text={`${primary.name} 与 ${currentOpponent.name} 在该范围内没有共同评测过的题目`}
            />
          ) : (
            <SBSTable
              primary={primary}
              opponent={currentOpponent}
              sbs={sbsResult}
            />
          )}
        </div>
      </section>
    </div>
  );
}

// ============================================================
// 子组件：题型 tab
// ============================================================
function TypeTabs({
  value,
  onChange,
  counts,
}: {
  value: QueryTypeId | "all";
  onChange: (v: QueryTypeId | "all") => void;
  counts: Record<string, number>;
}) {
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div className="flex flex-wrap gap-1.5">
      <TabChip
        active={value === "all"}
        onClick={() => onChange("all")}
        label="全部"
        count={allCount}
      />
      {QUERY_TYPES.map((t) => (
        <TabChip
          key={t.id}
          active={value === t.id}
          onClick={() => onChange(t.id)}
          label={t.name}
          count={counts[t.id] ?? 0}
          color={t.color}
        />
      ))}
    </div>
  );
}

function TabChip({
  active,
  onClick,
  label,
  count,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition",
        active
          ? "bg-amber text-white border-amber shadow-soft"
          : "bg-white text-ink-700 border-paper-300 hover:border-amber/50"
      )}
      style={!active && color ? { borderColor: `${color}40` } : undefined}
    >
      {color && !active && (
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: color }}
        />
      )}
      <span>{label}</span>
      <span
        className={clsx(
          "tabular-nums text-[10px] px-1.5 rounded-full",
          active ? "bg-white/25" : "bg-paper-100 text-ink-500"
        )}
      >
        {count}
      </span>
    </button>
  );
}

function countByType(queries: Query[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const q of queries) {
    const id = q.typeId ?? "other";
    m[id] = (m[id] ?? 0) + 1;
  }
  return m;
}

// ============================================================
// 子组件：对手 tab
// ============================================================
function OpponentTabs({
  opponents,
  value,
  onChange,
}: {
  opponents: AIProduct[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  if (opponents.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {opponents.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={clsx(
              "inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border transition",
              active
                ? "bg-ink-900 text-white border-ink-900 shadow-soft"
                : "bg-white text-ink-700 border-paper-300 hover:border-ink-700/40"
            )}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: o.color ?? "#8B8272" }}
            />
            <span className="font-medium">{o.name}</span>
            {o.version && (
              <span
                className={clsx(
                  "text-[10px]",
                  active ? "text-white/70" : "text-ink-400"
                )}
              >
                {o.version}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// 子组件：产品整体得分表（评测数 / 总分 / 各维度均值）
// ============================================================
function ProductScoresTable({
  primary,
  others,
  agg,
  queryCount,
}: {
  primary: AIProduct;
  others: AIProduct[];
  agg: Record<string, ProductAggResult>;
  queryCount: number;
}) {
  const allProducts = [primary, ...others];
  return (
    <div className="bg-white rounded-xl shadow-soft border border-paper-200 overflow-x-auto">
      <table className="w-full text-sm min-w-[760px]">
        <thead className="bg-paper-100 text-ink-700">
          <tr>
            <th className="text-left px-4 py-3 font-semibold">AI 产品</th>
            <th className="text-center px-4 py-3 font-semibold">
              评测数
              <div className="text-[10px] font-normal text-ink-400">
                共 {queryCount} 道
              </div>
            </th>
            <th className="text-center px-4 py-3 font-semibold">总分</th>
            {RUBRIC_DIMENSIONS.map((d) => (
              <th key={d.id} className="text-center px-4 py-3 font-semibold">
                <div>{d.name}</div>
                <div className="text-[10px] font-normal text-ink-400">
                  {d.id} · {Math.round(d.weight * 100)}%
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allProducts.map((p, idx) => {
            const a = agg[p.id];
            const isPrim = idx === 0;
            return (
              <tr
                key={p.id}
                className={clsx(
                  "border-t border-paper-200",
                  isPrim ? "bg-amber/5 hover:bg-amber/10" : "hover:bg-paper-50"
                )}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: p.color ?? "#8B8272" }}
                    />
                    <span className={clsx("font-medium", isPrim && "text-amber-dark")}>
                      {p.name}
                    </span>
                    {p.version && (
                      <span className="text-xs text-ink-400">{p.version}</span>
                    )}
                    {isPrim && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber text-white">
                        最新
                      </span>
                    )}
                  </div>
                </td>
                <td className="text-center px-4 py-3 tabular-nums text-ink-500">
                  {a.count}
                </td>
                <td className="text-center px-4 py-3">
                  {a.overallAvg != null ? (
                    <span
                      className={clsx(
                        "inline-block px-2 py-0.5 rounded font-semibold tabular-nums",
                        scoreBg(a.overallAvg)
                      )}
                    >
                      {a.overallAvg.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-ink-400 text-xs">—</span>
                  )}
                </td>
                {RUBRIC_DIMENSIONS.map((d) => {
                  const v = a.dimAvg[d.id];
                  return (
                    <td key={d.id} className="text-center px-4 py-3 tabular-nums">
                      {v != null ? (
                        <span className={clsx("inline-block px-1.5 py-0.5 rounded", scoreBg(v))}>
                          {v.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-ink-400 text-xs">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// 子组件：SBS 数值对比表
// ============================================================
function SBSTable({
  primary,
  opponent,
  sbs,
}: {
  primary: AIProduct;
  opponent: AIProduct;
  sbs: ReturnType<typeof compareSBS>;
}) {
  const { total, dims, overallPairs, primaryOverallAvg, opponentOverallAvg } = sbs;

  const winRate = overallPairs
    ? ((total.wins + total.ties * 0.5) / overallPairs) * 100
    : 0;

  return (
    <div className="bg-white rounded-xl shadow-soft border border-paper-200 overflow-hidden">
      {/* 顶部摘要 */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 bg-paper-50 border-b border-paper-200">
        <div className="flex items-center gap-3 text-sm">
          <span className="inline-flex items-center gap-1.5 font-semibold text-amber-dark">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: primary.color ?? "#C8941F" }}
            />
            {primary.name} {primary.version}
          </span>
          <span className="text-ink-400">vs</span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-ink-700">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: opponent.color ?? "#8B8272" }}
            />
            {opponent.name} {opponent.version ?? ""}
          </span>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <div className="text-xs text-ink-500">共 {overallPairs} 场对决</div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-500">总胜率</span>
            <span
              className={clsx(
                "px-2 py-0.5 rounded font-bold tabular-nums",
                winRate >= 60
                  ? "bg-moss/15 text-moss"
                  : winRate >= 40
                  ? "bg-amber/20 text-amber-dark"
                  : "bg-clay/15 text-clay"
              )}
            >
              {winRate.toFixed(0)}%
            </span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-white text-ink-700">
            <tr className="border-b border-paper-200">
              <th className="text-left px-4 py-3 font-semibold">维度</th>
              <th className="text-center px-4 py-3 font-semibold">
                {primary.name}
              </th>
              <th className="text-center px-4 py-3 font-semibold">
                {opponent.name}
              </th>
              <th className="text-center px-4 py-3 font-semibold">差值</th>
              <th className="text-center px-4 py-3 font-semibold">胜 / 平 / 负</th>
              <th className="text-center px-4 py-3 font-semibold">结论</th>
            </tr>
          </thead>
          <tbody>
            <SBSDataRow
              label="总分"
              sub="综合加权"
              primaryAvg={primaryOverallAvg}
              opponentAvg={opponentOverallAvg}
              wlt={total}
              highlight
            />
            {RUBRIC_DIMENSIONS.map((d) => (
              <SBSDataRow
                key={d.id}
                label={d.name}
                sub={`权重 ${Math.round(d.weight * 100)}%`}
                primaryAvg={dims[d.id].pairs ? dims[d.id].primarySum / dims[d.id].pairs : null}
                opponentAvg={dims[d.id].pairs ? dims[d.id].opponentSum / dims[d.id].pairs : null}
                wlt={dims[d.id]}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SBSDataRow({
  label,
  sub,
  primaryAvg,
  opponentAvg,
  wlt,
  highlight,
}: {
  label: string;
  sub?: string;
  primaryAvg: number | null;
  opponentAvg: number | null;
  wlt: { wins: number; ties: number; losses: number };
  highlight?: boolean;
}) {
  const diff =
    primaryAvg != null && opponentAvg != null ? primaryAvg - opponentAvg : null;

  let verdict: "lead" | "lag" | "tie" | "none";
  if (wlt.wins + wlt.ties + wlt.losses === 0) verdict = "none";
  else if (wlt.wins > wlt.losses) verdict = "lead";
  else if (wlt.wins < wlt.losses) verdict = "lag";
  else verdict = "tie";

  return (
    <tr
      className={clsx(
        "border-b border-paper-100 last:border-b-0",
        highlight ? "bg-amber/5 font-medium" : "hover:bg-paper-50"
      )}
    >
      <td className="px-4 py-3">
        <div className={clsx(highlight ? "text-ink-900 font-semibold" : "text-ink-800")}>
          {label}
        </div>
        {sub && <div className="text-[10px] text-ink-400 font-normal">{sub}</div>}
      </td>
      <td className="text-center px-4 py-3 tabular-nums">
        {primaryAvg != null ? (
          <span className={clsx("inline-block px-2 py-0.5 rounded", scoreBg(primaryAvg))}>
            {primaryAvg.toFixed(2)}
          </span>
        ) : (
          <span className="text-ink-400 text-xs">—</span>
        )}
      </td>
      <td className="text-center px-4 py-3 tabular-nums">
        {opponentAvg != null ? (
          <span className={clsx("inline-block px-2 py-0.5 rounded", scoreBg(opponentAvg))}>
            {opponentAvg.toFixed(2)}
          </span>
        ) : (
          <span className="text-ink-400 text-xs">—</span>
        )}
      </td>
      <td
        className={clsx(
          "text-center px-4 py-3 tabular-nums font-semibold",
          diff == null
            ? "text-ink-400"
            : diff > 0.05
            ? "text-moss"
            : diff < -0.05
            ? "text-clay"
            : "text-ink-500"
        )}
      >
        {diff == null
          ? "—"
          : `${diff > 0 ? "+" : ""}${diff.toFixed(2)}`}
      </td>
      <td className="text-center px-4 py-3 tabular-nums text-xs">
        <span className="text-moss font-semibold">{wlt.wins}</span>
        <span className="text-ink-300 mx-1">/</span>
        <span className="text-ink-500">{wlt.ties}</span>
        <span className="text-ink-300 mx-1">/</span>
        <span className="text-clay">{wlt.losses}</span>
      </td>
      <td className="text-center px-4 py-3">
        <VerdictBadge verdict={verdict} />
      </td>
    </tr>
  );
}

function VerdictBadge({ verdict }: { verdict: "lead" | "lag" | "tie" | "none" }) {
  if (verdict === "none")
    return <span className="text-ink-400 text-xs">—</span>;
  const map = {
    lead: { text: "领先", cls: "bg-moss/15 text-moss border border-moss/30" },
    tie: { text: "持平", cls: "bg-paper-200 text-ink-600 border border-paper-300" },
    lag: { text: "落后", cls: "bg-clay/15 text-clay border border-clay/30" },
  } as const;
  const cfg = map[verdict];
  return (
    <span
      className={clsx(
        "inline-block px-2 py-0.5 rounded text-xs font-semibold",
        cfg.cls
      )}
    >
      {cfg.text}
    </span>
  );
}

// ============================================================
// 子组件：空状态
// ============================================================
function EmptyBox({ text }: { text: string }) {
  return (
    <div className="py-10 text-center text-sm text-ink-400 italic bg-white rounded-xl border border-dashed border-paper-300">
      {text}
    </div>
  );
}
