import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import MarkdownView from "./MarkdownView";
import {
  contractBus,
  type EvaluationOutboxPayload,
  type OutboxBundle,
  type OutboxVersionMeta,
  type PerReportFeedback,
  type ClaimInventoryItem,
  type ClaimCheckItem,
  type DimensionChecklistsMap,
  type VerificationBudget,
  type ClaimCheckStatus,
} from "../lib/contract";
import { isSophia } from "../lib/sortProducts";

/**
 * 评测报告视图（契约 v1）
 *
 * 职责：
 *   - 拉 .evaluations/outbox/{taskId} 的最新产物（与指定历史版本）
 *   - 顶部展示摘要卡：整体分数 + 产品徽章 + SBS 结果
 *   - 中部展示维度分（R1-R5 + 扩展维度）
 *   - 下方原样渲染 LLM 自由 markdown 正文
 *   - 右上角版本切换器 + 刷新按钮
 *
 * 不做：
 *   - 不再去补分数、不做二次校正，LLM 给什么就展示什么
 *   - 不写回 outbox
 */

// 视觉简化后数字颜色统一为 ink-900；"最高分"的差异化表达由行内高亮负责。

// ---------- 维度名兜底（contractVersion-aware） ----------
// 契约 §3.1 规定 rubric[].name 必填，但历史上出现过 LLM 漏写该字段导致表头空白的情况。
// 这里按 contractVersion 提供默认名，payload 里有名就用 payload 的，没有就用默认。
// - v1.0 产物用老维度名（信源真实性/结构定量/洞察论证/风险决策/专业时效）
// - v2.0 / v2.1 产物用新维度名（准确性/相关性/论证深度/完备性/决策价值）
// 未来升级契约时，把新版本的默认映射追加到 DEFAULT_RUBRIC_NAMES 即可。
const DEFAULT_RUBRIC_NAMES: Record<"1.0" | "2.0" | "2.1" | "2.2", Record<string, string>> = {
  "1.0": {
    R1: "信源与数据真实性",
    R2: "结构与定量深度",
    R3: "洞察与论证",
    R4: "风险披露与决策价值",
    R5: "专业度与时效",
  },
  "2.0": {
    R1: "准确性",
    R2: "相关性",
    R3: "论证深度",
    R4: "完备性",
    R5: "决策价值",
  },
  "2.1": {
    R1: "准确性",
    R2: "相关性",
    R3: "论证深度",
    R4: "完备性",
    R5: "决策价值",
  },
  "2.2": {
    R1: "准确性",
    R2: "相关性",
    R3: "论证深度",
    R4: "完备性",
    R5: "决策价值",
  },
};

function resolveDimensionName(
  dimensionId: string,
  payloadName: string | undefined,
  contractVersion: "1.0" | "2.0" | "2.1" | "2.2"
): string {
  if (payloadName && payloadName.trim()) return payloadName;
  const fallback = DEFAULT_RUBRIC_NAMES[contractVersion]?.[dimensionId];
  return fallback ?? dimensionId; // 最终兜底：dimensionId 本身（至少不是空白）
}

// 产品名中提取版本号（如 "SophiaAI v5"、"SophiaAI v4"）；用来和 sortProducts 对齐
function parseProductVersion(name: string): number[] {
  const m = name.match(/v(\d+(?:\.\d+)*)/i);
  if (!m) return [];
  return m[1].split(".").map((n) => parseInt(n, 10) || 0);
}

function compareVersionArr(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/**
 * 把 overall.overallScores 的顺序重排：Sophia 系列优先（版本高的在更前），其余保持 LLM 给的原始顺序
 * 返回 reportId 数组，下游按此顺序渲染列
 */
function orderReportIds(overall: EvaluationOutboxPayload["summary"]["overallScores"]): string[] {
  const withIdx = overall.map((o, idx) => ({ ...o, idx }));
  withIdx.sort((a, b) => {
    const sa = isSophia({ name: a.productName });
    const sb = isSophia({ name: b.productName });
    if (sa && !sb) return -1;
    if (!sa && sb) return 1;
    if (sa && sb) {
      // Sophia 之间：版本号大的在前
      return -compareVersionArr(
        parseProductVersion(a.productName),
        parseProductVersion(b.productName)
      );
    }
    // 其他按 LLM 原始顺序
    return a.idx - b.idx;
  });
  return withIdx.map((o) => o.reportId);
}

const formatRelTime = (mtime: number) => {
  const diff = Date.now() - mtime;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(mtime);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
};

export default function EvaluationReportView({
  taskId,
  /** 外部可传 refreshKey 触发重新拉取（例如上层按钮） */
  refreshKey,
  /** 空态时的提示 */
  emptyHint,
  /** 受控模式：由上游指定显示哪个版本；传了就隐藏内部 VersionSwitcher */
  version,
}: {
  taskId: string;
  refreshKey?: number;
  emptyHint?: React.ReactNode;
  version?: number;
}) {
  const [bundle, setBundle] = useState<OutboxBundle | null>(null);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [currentPayload, setCurrentPayload] = useState<EvaluationOutboxPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const controlled = typeof version === "number";

  // 首次/刷新：拉 bundle
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const b = await contractBus.getOutbox(taskId);
        if (cancelled) return;
        setBundle(b);
        if (b) {
          // 受控模式下听外部；非受控默认最新
          const targetV = controlled ? version! : b.latestVersion;
          if (targetV === b.latestVersion) {
            setCurrentVersion(targetV);
            setCurrentPayload(b.latest);
          } else {
            // 非最新版需要额外拉
            const payload = await contractBus.getOutboxVersion(taskId, targetV);
            if (cancelled) return;
            setCurrentVersion(targetV);
            setCurrentPayload(payload);
          }
        } else {
          setCurrentVersion(null);
          setCurrentPayload(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, refreshKey, version]);

  // 切换版本（仅非受控模式生效）
  const handleSwitchVersion = async (v: number) => {
    if (!bundle || controlled) return;
    if (v === bundle.latestVersion) {
      setCurrentVersion(v);
      setCurrentPayload(bundle.latest);
      return;
    }
    setLoading(true);
    try {
      const payload = await contractBus.getOutboxVersion(taskId, v);
      if (payload) {
        setCurrentVersion(v);
        setCurrentPayload(payload);
      }
    } catch (err) {
      setError((err as Error).message || "加载版本失败");
    } finally {
      setLoading(false);
    }
  };

  // --------- 渲染 ---------

  if (loading && !currentPayload) {
    return (
      <div className="rounded-2xl border border-[#E6DCC8] bg-white p-8 text-center text-sm text-[#8B8272]">
        正在读取评测产物…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!bundle || !currentPayload) {
    return (
      <div className="rounded-2xl border border-dashed border-[#D6CCB5] bg-[#FAF6EE] p-10 text-center">
        <div className="text-sm text-[#8B8272] mb-2">暂无评测产物</div>
        <div className="text-xs text-[#6B6250] leading-relaxed">
          {emptyHint ?? (
            <>
              在 WorkBuddy 对话框用召唤口令让 Sophia 跑评测，
              <br />
              产物落到 <code className="font-mono">.evaluations/outbox/{taskId}/</code> 后刷新即可。
            </>
          )}
        </div>
      </div>
    );
  }

  const { summary, report, evaluator, evaluatedAt } = currentPayload;

  return (
    <div className="space-y-6">
      {/* 顶部元信息条 + 版本切换 */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="text-xs text-[#6B6250] flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#5A7A47]" />
            评测官：<span className="text-[#3A3326] font-medium">{evaluator}</span>
          </span>
          <span>·</span>
          <span>
            生成于{" "}
            <span className="text-[#3A3326]">{new Date(evaluatedAt).toLocaleString()}</span>
          </span>
          <span>·</span>
          <Link
            to="/standard"
            className="text-[#A8522B] hover:text-[#8B4A3A] hover:underline underline-offset-2"
            title="查看当前评测标准（Rubric v2.2 / 双轴 tier 表 / 必查 checklist / 45min 时间盒 / claim 核验 / SBS 新结构）"
          >
            按评测标准打分 →
          </Link>
        </div>
        <VersionSwitcher
          versions={bundle.versions}
          latest={bundle.latestVersion}
          current={currentVersion ?? bundle.latestVersion}
          onPick={handleSwitchVersion}
          hidden={controlled}
        />
      </div>

      {/* 评分总表：综合得分（突出）+ R1~R5 + 扩展维度 */}
      <section className="rounded-2xl border border-[#E6DCC8] bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <div className="text-xs text-[#8B8272] tracking-widest">SCORES</div>
            <div className="text-base font-semibold text-[#3A3326]">评分总表</div>
          </div>
          <div className="text-[11px] text-[#8B8272]">
            R1~R5 加权得出综合分 · X 为扩展观察 · 每行最高分为琥珀色 · 点击行看点评
          </div>
        </div>

        <DimensionsTable
          rubric={summary.rubric}
          extras={summary.extraDimensions ?? []}
          overall={summary.overallScores}
          contractVersion={currentPayload.contractVersion}
        />
      </section>

      {/* Per-report Feedback 反馈卡（v2.1 契约新增） */}
      {summary.perReportFeedback && summary.perReportFeedback.length > 0 && (
        <section className="rounded-2xl border border-[#E6DCC8] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <div className="text-xs text-[#8B8272] tracking-widest">PER-REPORT FEEDBACK</div>
              <div className="text-base font-semibold text-[#3A3326]">每份报告的反馈</div>
            </div>
            <div className="text-[11px] text-[#8B8272]">
              做得好 · 做得不好 · 可改进建议（v2.1 新增）
            </div>
          </div>
          <PerReportFeedbackCards
            feedback={summary.perReportFeedback}
            overall={summary.overallScores}
          />
        </section>
      )}

      {/* ------------- v2.2 新增：核验地图 + checklist 完成度 + 时间预算 ------------- */}

      {/* 核验地图（claimInventory + claimChecks 联合视图） */}
      {summary.claimInventory && summary.claimInventory.length > 0 && (
        <section className="rounded-2xl border border-[#E6DCC8] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <div className="text-xs text-[#8B8272] tracking-widest">CLAIM VERIFICATION MAP</div>
              <div className="text-base font-semibold text-[#3A3326]">核验地图</div>
            </div>
            <div className="text-[11px] text-[#8B8272]">
              承重 claim 清单 · 三阶段 Pass 核验结果（v2.2 新增）
            </div>
          </div>
          <ClaimVerificationMap
            claims={summary.claimInventory}
            checks={summary.claimChecks ?? []}
            overall={summary.overallScores}
          />
        </section>
      )}

      {/* Checklist 完成度 */}
      {summary.dimensionChecklists && (
        <section className="rounded-2xl border border-[#E6DCC8] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <div className="text-xs text-[#8B8272] tracking-widest">DIMENSION CHECKLISTS</div>
              <div className="text-base font-semibold text-[#3A3326]">维度必查清单完成度</div>
            </div>
            <div className="text-[11px] text-[#8B8272]">
              R1~R5 每维度结构化 checklist（v2.2 新增）
            </div>
          </div>
          <DimensionChecklistsView
            checklists={summary.dimensionChecklists}
            overall={summary.overallScores}
            contractVersion={currentPayload.contractVersion}
          />
        </section>
      )}

      {/* 时间预算报表 */}
      {summary.verificationBudget && (
        <section className="rounded-2xl border border-[#E6DCC8] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <div className="text-xs text-[#8B8272] tracking-widest">VERIFICATION BUDGET</div>
              <div className="text-base font-semibold text-[#3A3326]">45 分钟时间盒执行报表</div>
            </div>
            <div className="text-[11px] text-[#8B8272]">
              实际耗时 · 各阶段完成情况（v2.2 新增）
            </div>
          </div>
          <VerificationBudgetView budget={summary.verificationBudget} />
        </section>
      )}

      {/* 自由报告 */}
      <section className="rounded-2xl border border-[#E6DCC8] bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs text-[#8B8272] tracking-widest">REPORT</div>
            <div className="text-base font-semibold text-[#3A3326]">评测报告</div>
          </div>
          <div className="text-[11px] text-[#8B8272]">由 LLM 自由组织，原样渲染</div>
        </div>
        <div className="pt-2">
          <MarkdownView content={report || "_（报告正文为空）_"} />
        </div>
      </section>
    </div>
  );
}

// ----------------- 版本选择器 -----------------

function VersionSwitcher({
  versions,
  latest,
  current,
  onPick,
  hidden,
}: {
  versions: OutboxVersionMeta[];
  latest: number;
  current: number;
  onPick: (v: number) => void;
  /** 受控模式下由上游统一管版本筛选，此处不再渲染 */
  hidden?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (hidden) return null;
  if (versions.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((s) => !s)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#D6CCB5] bg-white text-xs text-[#3A3326] hover:bg-[#F3EEDF] transition-colors"
      >
        <span className="font-mono font-semibold">v{current}</span>
        {current === latest && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#5A7A47] text-white">最新</span>
        )}
        <span className="text-[#8B8272]">· {versions.length} 个版本</span>
        <svg className="w-3 h-3 ml-1" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="absolute right-0 mt-1.5 w-56 rounded-lg border border-[#E6DCC8] bg-white shadow-xl z-20 overflow-hidden"
            >
              {[...versions].reverse().map((vm) => (
                <button
                  key={vm.v}
                  onClick={() => {
                    onPick(vm.v);
                    setOpen(false);
                  }}
                  className={clsx(
                    "w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-[#FAF6EE] border-b border-[#F0E9D7] last:border-b-0",
                    current === vm.v && "bg-[#FAF6EE] font-medium"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono font-semibold text-[#3A3326]">v{vm.v}</span>
                    {vm.v === latest && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-[#5A7A47] text-white">
                        最新
                      </span>
                    )}
                  </span>
                  <span className="text-[#8B8272]">{formatRelTime(vm.mtime)}</span>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ----------------- 维度表 -----------------

function DimensionsTable({
  rubric,
  extras,
  overall,
  contractVersion,
}: {
  rubric: EvaluationOutboxPayload["summary"]["rubric"];
  extras: NonNullable<EvaluationOutboxPayload["summary"]["extraDimensions"]>;
  overall: EvaluationOutboxPayload["summary"]["overallScores"];
  contractVersion: EvaluationOutboxPayload["contractVersion"];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  // 按 Sophia 优先排序列（而不是 LLM 给的原始顺序）
  const reportIds = orderReportIds(overall);
  const productNameMap = new Map(overall.map((o) => [o.reportId, o.productName]));
  const overallMap = new Map(overall.map((o) => [o.reportId, o]));

  // 综合得分里的最高分（用于给该行单元格高亮；平手都标）
  const maxOverall = Math.max(...overall.map((o) => o.score));

  const rows = [
    ...rubric.map((r) => ({
      id: r.dimensionId,
      name: resolveDimensionName(r.dimensionId, r.name, contractVersion),
      hint: `权重 ${(r.weight * 100).toFixed(0)}%`,
      kind: "core" as const,
      scores: r.scores,
      rationale: undefined as string | undefined,
    })),
    ...extras.map((x) => ({
      id: x.dimensionId,
      name: resolveDimensionName(x.dimensionId, x.name, contractVersion),
      hint: "扩展观察",
      kind: "extra" as const,
      scores: x.scores.map((s) => ({ ...s, issueTags: [] as string[] })),
      rationale: x.rationale,
    })),
  ];

  /** 对于某行维度，返回该行的最高分（用于高亮该列得分）。平手都高亮。 */
  const getRowMaxScore = (row: (typeof rows)[number]): number => {
    const ss = reportIds
      .map((rid) => row.scores.find((x) => x.reportId === rid)?.score)
      .filter((n): n is number => typeof n === "number");
    return ss.length > 0 ? Math.max(...ss) : -Infinity;
  };

  const hasMultiple = reportIds.length > 1;

  return (
    <div className="border border-[#E6DCC8] rounded-lg overflow-hidden">
      <table className="w-full text-sm table-fixed">
        <colgroup>
          <col style={{ width: "13rem" }} />
          {reportIds.map((rid) => (
            <col key={rid} />
          ))}
        </colgroup>
        <thead className="bg-[#F3ECD9] text-[#3A3326] border-b border-[#E6DCC8]">
          <tr>
            <th className="text-left px-4 py-3 font-medium text-[11px] uppercase tracking-wider text-[#6B6250]">
              评分维度
            </th>
            {reportIds.map((rid) => {
              const name = productNameMap.get(rid) ?? "—";
              return (
                <th key={rid} className="px-3 py-3 text-center">
                  <span className="text-[15px] font-semibold leading-tight text-[#3A3326]">
                    {name}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {/* ==================== 综合得分 ==================== */}
          <tr className="bg-[#FAF6EE] border-b border-[#E6DCC8]">
            <td className="px-4 py-4 align-middle">
              <div className="font-semibold text-[#3A3326] text-[15px]">综合得分</div>
              <div className="text-[11px] text-[#8B8272] mt-0.5">R1~R5 加权 · 满分 10</div>
            </td>
            {reportIds.map((rid) => {
              const o = overallMap.get(rid);
              const best = hasMultiple && o && o.score === maxOverall;
              return (
                <td key={rid} className="text-center px-3 py-4 align-middle">
                  {o ? (
                    <div className="inline-flex items-baseline gap-1">
                      <span
                        className={clsx(
                          "text-3xl tabular-nums leading-none",
                          best ? "font-bold text-amber-dark" : "font-semibold text-ink-900"
                        )}
                      >
                        {o.score.toFixed(1)}
                      </span>
                      <span className="text-[11px] text-[#8B8272]">/ 10</span>
                    </div>
                  ) : (
                    <span className="text-[#C5BBA6]">—</span>
                  )}
                </td>
              );
            })}
          </tr>

          {/* ==================== R1~R5 + 扩展维度 ==================== */}
          {rows.map((row, rowIdx) => {
            const isOpen = expanded === row.id;
            const rowMax = getRowMaxScore(row);
            const isLastCore = row.kind === "core" && rows[rowIdx + 1]?.kind === "extra";
            return (
              <Fragment key={row.id}>
                <tr
                  className={clsx(
                    "border-t cursor-pointer hover:bg-[#FAF6EE]/50 transition-colors",
                    isLastCore ? "border-[#E6DCC8]" : "border-[#F0E9D7]"
                  )}
                  onClick={() => setExpanded(isOpen ? null : row.id)}
                >
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center gap-2">
                      <span
                        className={clsx(
                          "inline-block px-1.5 py-0.5 rounded text-[10px] font-mono leading-none",
                          row.kind === "core"
                            ? "bg-[#E6DCC8] text-[#6B6250]"
                            : "bg-[#F0E9D7] text-[#8B8272]"
                        )}
                      >
                        {row.id}
                      </span>
                      <span className="font-medium text-[#3A3326]">{row.name}</span>
                    </div>
                    <div className="text-[11px] text-[#8B8272] mt-0.5 ml-[34px]">{row.hint}</div>
                  </td>
                  {reportIds.map((rid) => {
                    const s = row.scores.find((x) => x.reportId === rid);
                    const isRowBest = hasMultiple && s && s.score === rowMax;
                    return (
                      <td key={rid} className="text-center px-3 py-3 align-middle">
                        {s ? (
                          <span
                            className={clsx(
                              "text-lg tabular-nums",
                              isRowBest ? "font-bold text-amber-dark" : "font-medium text-ink-900"
                            )}
                          >
                            {s.score.toFixed(1)}
                          </span>
                        ) : (
                          <span className="text-[#C5BBA6]">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
                {isOpen && (
                  <tr className="bg-[#FAF6EE]/70 border-t border-[#F0E9D7]">
                    <td
                      colSpan={1 + reportIds.length}
                      className="px-4 py-3 text-xs text-[#6B6250] leading-relaxed"
                    >
                      {row.rationale && (
                        <div className="mb-2 text-[#8B6F3D]">
                          <span className="text-[#8B8272]">为什么加这个维度：</span>
                          {row.rationale}
                        </div>
                      )}
                      <div
                        className="grid gap-3"
                        style={{
                          gridTemplateColumns: `repeat(${reportIds.length}, minmax(0, 1fr))`,
                        }}
                      >
                        {reportIds.map((rid) => {
                          const s = row.scores.find((x) => x.reportId === rid);
                          if (!s) return <div key={rid} className="text-[#C5BBA6]">—</div>;
                          return (
                            <div key={rid} className="space-y-1">
                              <div className="text-[11px] font-semibold text-[#3A3326]">
                                {productNameMap.get(rid)}
                              </div>
                              <div className="text-[#3A3326] whitespace-pre-wrap">
                                {s.comment || "_（无点评）_"}
                              </div>
                              {"issueTags" in s &&
                                (s as { issueTags?: string[] }).issueTags &&
                                (s as { issueTags?: string[] }).issueTags!.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {(s as { issueTags?: string[] }).issueTags!.map((t) => (
                                      <span
                                        key={t}
                                        className="text-[10px] px-1.5 py-0.5 rounded bg-[#A8522B]/10 text-[#A8522B] border border-[#A8522B]/30"
                                      >
                                        {t}
                                      </span>
                                    ))}
                                  </div>
                                )}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ----------------- PerReportFeedback 反馈卡（v2.1） -----------------

function PerReportFeedbackCards({
  feedback,
  overall,
}: {
  feedback: PerReportFeedback[];
  overall: EvaluationOutboxPayload["summary"]["overallScores"];
}) {
  // 按 overall 的顺序（已经 Sophia 优先 + 原序）渲染，确保和评分总表列顺序一致
  const orderedIds = orderReportIds(overall);
  const feedbackMap = new Map(feedback.map((f) => [f.reportId, f]));
  const orderedFeedback = orderedIds
    .map((rid) => feedbackMap.get(rid))
    .filter((f): f is PerReportFeedback => Boolean(f));

  // 防御：如果 feedback 里有 overall 没列出的 reportId，追加到末尾
  for (const f of feedback) {
    if (!orderedIds.includes(f.reportId)) orderedFeedback.push(f);
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {orderedFeedback.map((f) => (
        <article
          key={f.reportId}
          className="rounded-xl border border-[#E6DCC8] bg-[#FAF6EE] p-4"
        >
          <header className="mb-3">
            <div className="text-[11px] text-[#8B8272] tracking-wider">
              {isSophia({ name: f.productName }) ? "SOPHIA" : "PRODUCT"}
            </div>
            <div className="text-[15px] font-semibold text-[#3A3326]">
              {f.productName}
            </div>
          </header>

          <FeedbackSection
            title="做得好"
            items={f.strengths}
            accent="#5A7A47"
            emptyText="_（未沉淀强项）_"
          />
          <FeedbackSection
            title="做得不好"
            items={f.weaknesses}
            accent="#A8522B"
            emptyText="_（未沉淀短板）_"
          />
          <FeedbackSection
            title="改进建议"
            items={f.improvements}
            accent="#6B5E9E"
            emptyText="_（未给出建议）_"
          />
        </article>
      ))}
    </div>
  );
}

function FeedbackSection({
  title,
  items,
  accent,
  emptyText,
}: {
  title: string;
  items: string[];
  accent: string;
  emptyText: string;
}) {
  return (
    <section className="mb-3 last:mb-0">
      <div
        className="text-[11px] font-semibold mb-1.5 inline-flex items-center gap-1.5"
        style={{ color: accent }}
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: accent }}
        />
        {title}
      </div>
      {items.length === 0 ? (
        <div className="text-[12px] text-[#8B8272] italic">{emptyText}</div>
      ) : (
        <ul className="space-y-1 pl-1">
          {items.map((it, i) => (
            <li
              key={i}
              className="text-[13px] leading-relaxed text-[#3A3326] flex gap-2"
            >
              <span
                className="text-[10px] mt-[5px] flex-shrink-0"
                style={{ color: accent }}
              >
                ▸
              </span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ============================================================
// v2.2 新增可视化组件
// ============================================================

/** claim 核验状态的显示配置（图标 + 颜色 + 文案） */
const CLAIM_STATUS_CONFIG: Record<
  ClaimCheckStatus,
  { icon: string; color: string; bg: string; label: string }
> = {
  "verified-correct": {
    icon: "✓",
    color: "#5A7A47",
    bg: "#EEF4E6",
    label: "核验通过",
  },
  refuted: {
    icon: "✗",
    color: "#A8522B",
    bg: "#F6E4D8",
    label: "已证伪",
  },
  inconclusive: {
    icon: "?",
    color: "#8B7230",
    bg: "#F6EED8",
    label: "无法定论",
  },
  "skipped-time-budget": {
    icon: "⧗",
    color: "#8B8272",
    bg: "#F0EBE0",
    label: "超时跳过",
  },
  "skipped-out-of-scope": {
    icon: "—",
    color: "#8B8272",
    bg: "#F0EBE0",
    label: "盲区跳过",
  },
};

const CLAIM_TYPE_LABEL: Record<string, string> = {
  fact: "事实",
  number: "数字",
  logic: "逻辑",
  source: "信源",
};

/**
 * 核验地图：把 claimInventory 按 reportId 分组，每份报告一个面板，
 * 展示承重 claim 清单 + 对应的 claimChecks 状态；底部汇总覆盖率。
 */
function ClaimVerificationMap({
  claims,
  checks,
  overall,
}: {
  claims: ClaimInventoryItem[];
  checks: ClaimCheckItem[];
  overall: EvaluationOutboxPayload["summary"]["overallScores"];
}) {
  const checksById = new Map(checks.map((c) => [c.claimId, c]));
  const orderedIds = orderReportIds(overall);
  const productNameById = new Map(overall.map((o) => [o.reportId, o.productName]));

  // 按报告分组
  const byReport = new Map<string, ClaimInventoryItem[]>();
  for (const c of claims) {
    const arr = byReport.get(c.reportId) ?? [];
    arr.push(c);
    byReport.set(c.reportId, arr);
  }

  // 汇总覆盖率：已核验（verified/refuted/inconclusive）/ 非 skipped 总数
  const total = claims.length;
  const verifiedCount = checks.filter(
    (c) =>
      c.status === "verified-correct" ||
      c.status === "refuted" ||
      c.status === "inconclusive"
  ).length;
  const skippedCount = checks.filter(
    (c) => c.status === "skipped-time-budget" || c.status === "skipped-out-of-scope"
  ).length;
  const nonSkipped = total - skippedCount;
  const coverage = nonSkipped > 0 ? (verifiedCount / nonSkipped) * 100 : 0;
  const coveragePass = coverage >= 85;

  const reportOrder = [
    ...orderedIds.filter((rid) => byReport.has(rid)),
    ...Array.from(byReport.keys()).filter((rid) => !orderedIds.includes(rid)),
  ];

  return (
    <div className="space-y-4">
      {/* 总览条 */}
      <div className="flex items-center gap-4 flex-wrap text-[12px] text-[#3A3326] bg-[#FAF6EE] rounded-lg px-3 py-2 border border-[#E6DCC8]">
        <div>
          <span className="text-[#8B8272]">承重 claim 总数：</span>
          <span className="font-semibold tabular-nums">{total}</span>
        </div>
        <div>
          <span className="text-[#8B8272]">已核验：</span>
          <span className="font-semibold tabular-nums">{verifiedCount}</span>
        </div>
        <div>
          <span className="text-[#8B8272]">跳过：</span>
          <span className="font-semibold tabular-nums">{skippedCount}</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[#8B8272]">核验覆盖率：</span>
          <span
            className="font-semibold tabular-nums"
            style={{ color: coveragePass ? "#5A7A47" : "#A8522B" }}
          >
            {coverage.toFixed(1)}%
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: coveragePass ? "#EEF4E6" : "#F6E4D8",
              color: coveragePass ? "#5A7A47" : "#A8522B",
            }}
          >
            {coveragePass ? "达标" : "未达 85%"}
          </span>
        </div>
      </div>

      {/* 按报告分组 */}
      <div className="grid gap-4 md:grid-cols-2">
        {reportOrder.map((rid) => {
          const items = byReport.get(rid) ?? [];
          const productName = productNameById.get(rid) ?? rid;
          return (
            <article
              key={rid}
              className="rounded-xl border border-[#E6DCC8] bg-[#FAF6EE] p-4"
            >
              <header className="mb-3">
                <div className="text-[11px] text-[#8B8272] tracking-wider">
                  {isSophia({ name: productName }) ? "SOPHIA" : "PRODUCT"}
                </div>
                <div className="text-[15px] font-semibold text-[#3A3326]">
                  {productName}
                </div>
                <div className="text-[11px] text-[#8B8272] mt-0.5">
                  {items.length} 条承重 claim
                </div>
              </header>

              <ul className="space-y-2">
                {items.map((claim) => {
                  const check = checksById.get(claim.claimId);
                  const cfg = check
                    ? CLAIM_STATUS_CONFIG[check.status]
                    : {
                        icon: "·",
                        color: "#8B8272",
                        bg: "#F0EBE0",
                        label: "未核验",
                      };
                  return (
                    <li
                      key={claim.claimId}
                      className="bg-white rounded-lg border border-[#E6DCC8] p-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className="inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-bold flex-shrink-0 mt-0.5"
                          style={{ backgroundColor: cfg.bg, color: cfg.color }}
                          title={cfg.label}
                        >
                          {cfg.icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded bg-[#F0EBE0] text-[#6B6250]"
                              title={`承重：${claim.supportWeight}`}
                            >
                              {CLAIM_TYPE_LABEL[claim.type] ?? claim.type}
                              {claim.supportWeight === "high" ? " ★" : ""}
                            </span>
                            <span
                              className="text-[10px] font-mono text-[#8B8272]"
                            >
                              {claim.claimId}
                            </span>
                            {check?.vetoMode && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F6E4D8] text-[#A8522B] font-semibold">
                                VETO·{check.vetoMode}
                              </span>
                            )}
                          </div>
                          <div className="text-[13px] leading-relaxed text-[#3A3326]">
                            {claim.claim}
                          </div>
                          {claim.locationHint && (
                            <div className="text-[11px] text-[#8B8272] mt-1 italic">
                              位置：{claim.locationHint}
                            </div>
                          )}
                          {check?.evidence && (
                            <div
                              className="text-[12px] mt-1.5 pl-2 border-l-2 leading-relaxed"
                              style={{
                                borderColor: cfg.color,
                                color: "#3A3326",
                              }}
                            >
                              <span
                                className="font-semibold"
                                style={{ color: cfg.color }}
                              >
                                {cfg.label}：
                              </span>
                              {check.evidence}
                              {check.checkedBy && (
                                <span className="text-[#8B8272] ml-1">
                                  （{check.checkedBy}）
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 维度 checklist 完成度视图：
 * 每个维度一个表格，列是报告（overall 顺序），行是 checklist 项，
 * 单元格展示 ✓ / ○（通过/未通过）+ note。
 */
function DimensionChecklistsView({
  checklists,
  overall,
  contractVersion,
}: {
  checklists: DimensionChecklistsMap;
  overall: EvaluationOutboxPayload["summary"]["overallScores"];
  contractVersion: "1.0" | "2.0" | "2.1" | "2.2";
}) {
  const orderedIds = orderReportIds(overall);
  const productNameById = new Map(overall.map((o) => [o.reportId, o.productName]));

  // 按 R1~R5 优先顺序，扩展维度（X1~X3）追加
  const dimensionKeys = Object.keys(checklists).sort((a, b) => {
    const order = (k: string) => {
      if (k === "R1") return 1;
      if (k === "R2") return 2;
      if (k === "R3") return 3;
      if (k === "R4") return 4;
      if (k === "R5") return 5;
      return 10;
    };
    return order(a) - order(b) || a.localeCompare(b);
  });

  return (
    <div className="space-y-5">
      {dimensionKeys.map((dimId) => {
        const checklist = checklists[dimId];
        if (!checklist || !checklist.items || checklist.items.length === 0) return null;
        const dimName = resolveDimensionName(dimId, undefined, contractVersion);

        // 计算每项通过率
        const totalReports = orderedIds.length || 1;

        return (
          <div key={dimId} className="rounded-xl border border-[#E6DCC8] overflow-hidden">
            <div className="bg-[#F3ECD9] px-3 py-2 border-b border-[#E6DCC8] flex items-center gap-2">
              <span className="text-[11px] px-2 py-0.5 rounded bg-[#E6DCC8] text-[#6B6250] font-semibold">
                {dimId}
              </span>
              <span className="text-[14px] font-semibold text-[#3A3326]">
                {dimName}
              </span>
              <span className="text-[11px] text-[#8B8272] ml-auto">
                {checklist.items.length} 项必查
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] border-collapse">
                <colgroup>
                  <col style={{ width: "42%" }} />
                  {orderedIds.map((rid) => (
                    <col key={rid} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="bg-[#FAF6EE] border-b border-[#E6DCC8]">
                    <th className="text-left px-3 py-2 font-medium text-[#6B6250]">
                      必查项
                    </th>
                    {orderedIds.map((rid) => (
                      <th
                        key={rid}
                        className="text-center px-2 py-2 font-medium text-[#6B6250]"
                        title={productNameById.get(rid) ?? rid}
                      >
                        <div className="truncate max-w-[120px] mx-auto">
                          {productNameById.get(rid) ?? rid}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {checklist.items.map((item, idx) => {
                    const passRate =
                      totalReports > 0
                        ? item.passedFor.length / totalReports
                        : 0;
                    return (
                      <tr
                        key={idx}
                        className="border-b border-[#F0EBE0] last:border-b-0 bg-white"
                      >
                        <td className="px-3 py-2 align-top text-[#3A3326]">
                          <div className="leading-relaxed">{item.label}</div>
                          {item.note && (
                            <div className="text-[11px] text-[#8B8272] mt-0.5 italic">
                              {item.note}
                            </div>
                          )}
                          <div className="text-[10px] text-[#8B8272] mt-0.5 tabular-nums">
                            通过 {item.passedFor.length}/{totalReports}
                            {passRate === 1 && " · 全员通过"}
                            {passRate === 0 && " · 全员未通过"}
                          </div>
                        </td>
                        {orderedIds.map((rid) => {
                          const passed = item.passedFor.includes(rid);
                          return (
                            <td
                              key={rid}
                              className="text-center align-middle px-2 py-2"
                            >
                              <span
                                className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[13px] font-bold tabular-nums"
                                style={{
                                  backgroundColor: passed ? "#EEF4E6" : "#F6E4D8",
                                  color: passed ? "#5A7A47" : "#A8522B",
                                }}
                                title={passed ? "通过" : "未通过"}
                              >
                                {passed ? "✓" : "○"}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 阶段代号 → 展示名 */
const PASS_LABEL: Record<string, string> = {
  read: "读报告",
  "claim-inventory": "Claim 抽取",
  pass1: "Pass 1 快筛",
  pass2: "Pass 2 深核嫌疑",
  pass3: "Pass 3 逻辑一致性",
  score: "打分 + SBS",
  feedback: "反馈 + 正文",
};
const PASS_ORDER = ["read", "claim-inventory", "pass1", "pass2", "pass3", "score", "feedback"];

/**
 * 45 分钟时间盒执行报表：
 * - 顶部显示 targetMinutes / actualMinutes（超时红色）
 * - 7 个阶段的进度条（已完成/未完成）
 * - 跳过 claim 统计
 * - 自由 notes
 */
function VerificationBudgetView({ budget }: { budget: VerificationBudget }) {
  const target = budget.targetMinutes;
  const actual = budget.actualMinutes;
  const ratio = target > 0 ? Math.min(actual / target, 1.5) : 0;
  const overBudget = actual > target;
  const hardBreach = actual > 50; // schema 硬约束 ≤50

  const completedSet = new Set(budget.passesCompleted);

  return (
    <div className="space-y-4">
      {/* 顶部耗时条 */}
      <div className="bg-[#FAF6EE] rounded-lg border border-[#E6DCC8] p-3">
        <div className="flex items-baseline gap-3 flex-wrap mb-2">
          <div className="text-[13px] text-[#8B8272]">
            目标 <span className="font-semibold text-[#3A3326] tabular-nums">{target}</span> 分钟
          </div>
          <div className="text-[13px] text-[#8B8272]">
            实际{" "}
            <span
              className="font-bold tabular-nums text-[15px]"
              style={{
                color: hardBreach ? "#A8522B" : overBudget ? "#8B7230" : "#5A7A47",
              }}
            >
              {actual}
            </span>{" "}
            分钟
          </div>
          <div className="ml-auto text-[11px]">
            {hardBreach ? (
              <span className="px-2 py-0.5 rounded bg-[#F6E4D8] text-[#A8522B] font-semibold">
                ⚠ 超出硬约束（&gt;50min）
              </span>
            ) : overBudget ? (
              <span className="px-2 py-0.5 rounded bg-[#F6EED8] text-[#8B7230] font-semibold">
                超出目标（允许 ≤50min）
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded bg-[#EEF4E6] text-[#5A7A47] font-semibold">
                ✓ 控制在目标内
              </span>
            )}
          </div>
        </div>
        {/* 进度条 */}
        <div className="relative h-2 bg-[#F0EBE0] rounded-full overflow-hidden">
          <div
            className="absolute top-0 left-0 h-full rounded-full transition-all"
            style={{
              width: `${(ratio * 100).toFixed(1)}%`,
              backgroundColor: hardBreach
                ? "#A8522B"
                : overBudget
                  ? "#C28E2E"
                  : "#5A7A47",
            }}
          />
          {/* 目标刻度线（100%） */}
          <div
            className="absolute top-0 h-full w-[1px] bg-[#3A3326]/40"
            style={{ left: `${Math.min((target / Math.max(actual, target)) * 100, 100)}%` }}
          />
        </div>
      </div>

      {/* 阶段完成情况 */}
      <div>
        <div className="text-[12px] text-[#8B8272] mb-2">阶段完成情况</div>
        <div className="flex flex-wrap gap-2">
          {PASS_ORDER.map((pass) => {
            const done = completedSet.has(pass as never);
            return (
              <span
                key={pass}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] border"
                style={{
                  backgroundColor: done ? "#EEF4E6" : "#F0EBE0",
                  color: done ? "#5A7A47" : "#8B8272",
                  borderColor: done ? "#C6D4B4" : "#E6DCC8",
                }}
              >
                <span className="font-bold">{done ? "✓" : "○"}</span>
                {PASS_LABEL[pass] ?? pass}
              </span>
            );
          })}
          {/* 出现了 PASS_ORDER 之外的自定义 pass */}
          {budget.passesCompleted
            .filter((p) => !PASS_ORDER.includes(p))
            .map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] border bg-[#EEF4E6] text-[#5A7A47] border-[#C6D4B4]"
              >
                <span className="font-bold">✓</span>
                {p}
              </span>
            ))}
        </div>
      </div>

      {/* claim 跳过统计 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-lg border border-[#E6DCC8] p-3">
          <div className="text-[11px] text-[#8B8272] mb-0.5">超时跳过的 claim</div>
          <div className="text-[20px] font-bold text-[#3A3326] tabular-nums">
            {budget.claimsSkippedDueToBudget}
          </div>
          <div className="text-[10px] text-[#8B8272] mt-0.5">
            status = skipped-time-budget
          </div>
        </div>
        <div className="bg-white rounded-lg border border-[#E6DCC8] p-3">
          <div className="text-[11px] text-[#8B8272] mb-0.5">盲区跳过的 claim</div>
          <div className="text-[20px] font-bold text-[#3A3326] tabular-nums">
            {budget.claimsOutOfScope}
          </div>
          <div className="text-[10px] text-[#8B8272] mt-0.5">
            status = skipped-out-of-scope（不扣 R1）
          </div>
        </div>
      </div>

      {/* 备注 */}
      {budget.notes && (
        <div className="bg-[#FAF6EE] rounded-lg border border-[#E6DCC8] p-3">
          <div className="text-[11px] text-[#8B8272] mb-1">备注</div>
          <div className="text-[13px] text-[#3A3326] leading-relaxed whitespace-pre-wrap">
            {budget.notes}
          </div>
        </div>
      )}
    </div>
  );
}
