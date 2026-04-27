import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import MarkdownView from "./MarkdownView";
import {
  contractBus,
  type EvaluationOutboxPayload,
  type OutboxBundle,
  type OutboxVersionMeta,
} from "../lib/contract";
import {
  type ContractVersion,
  resolveDimensionName,
  normalizePayloadProductNames,
  orderReportIds,
  reportHintFor,
} from "../lib/contractAdapter";

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
  refreshKey,
  emptyHint,
  version,
}: {
  taskId: string;
  refreshKey?: number;
  emptyHint?: ReactNode;
  version?: number;
}) {
  const [bundle, setBundle] = useState<OutboxBundle | null>(null);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [currentPayload, setCurrentPayload] = useState<EvaluationOutboxPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const controlled = typeof version === "number";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const nextBundle = await contractBus.getOutbox(taskId);
        if (cancelled) return;
        setBundle(nextBundle);
        if (!nextBundle) {
          setCurrentVersion(null);
          setCurrentPayload(null);
          return;
        }

        const targetVersion = controlled ? version! : nextBundle.latestVersion;
        if (targetVersion === nextBundle.latestVersion) {
          setCurrentVersion(targetVersion);
          setCurrentPayload(nextBundle.latest ? normalizePayloadProductNames(nextBundle.latest) : null);
          return;
        }

        const payload = await contractBus.getOutboxVersion(taskId, targetVersion);
        if (cancelled) return;
        setCurrentVersion(targetVersion);
        setCurrentPayload(payload ? normalizePayloadProductNames(payload) : null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, refreshKey, version, controlled]);

  const handleSwitchVersion = async (v: number) => {
    if (!bundle || controlled) return;
    if (v === bundle.latestVersion) {
      setCurrentVersion(v);
      setCurrentPayload(bundle.latest ? normalizePayloadProductNames(bundle.latest) : null);
      return;
    }
    setLoading(true);
    try {
      const payload = await contractBus.getOutboxVersion(taskId, v);
      if (payload) {
        setCurrentVersion(v);
        setCurrentPayload(normalizePayloadProductNames(payload));
      }
    } catch (err) {
      setError((err as Error).message || "加载版本失败");
    } finally {
      setLoading(false);
    }
  };

  if (loading && !currentPayload) {
    return (
      <div className="rounded-2xl border border-[#E6DCC8] bg-white p-8 text-center text-sm text-[#8B8272]">
        正在读取评测产物…
      </div>
    );
  }

  if (error) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>;
  }

  if (!bundle || !currentPayload) {
    return (
      <div className="rounded-2xl border border-dashed border-[#D6CCB5] bg-[#FAF6EE] p-10 text-center">
        <div className="mb-2 text-sm text-[#8B8272]">暂无评测产物</div>
        <div className="text-xs leading-relaxed text-[#6B6250]">
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

  const { summary, report, evaluator, evaluatedAt, contractVersion } = currentPayload;
  const reportHint = reportHintFor(contractVersion);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex flex-wrap items-center gap-3 text-xs text-[#6B6250]">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#5A7A47]" />
            评测官：<span className="font-medium text-[#3A3326]">{evaluator}</span>
          </span>
          <span>·</span>
          <span>
            生成于 <span className="text-[#3A3326]">{new Date(evaluatedAt).toLocaleString()}</span>
          </span>
          <span>·</span>
          <Link
            to="/standard"
            className="text-[#A8522B] underline-offset-2 hover:text-[#8B4A3A] hover:underline"
            title={`查看当前评测标准（当前产物契约 ${contractVersion}）`}
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

      <section className="rounded-2xl border border-[#E6DCC8] bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs tracking-widest text-[#8B8272]">SCORES</div>
            <div className="text-base font-semibold text-[#3A3326]">评分总表</div>
          </div>
          <div className="text-[11px] text-[#8B8272]">
            评分总表负责导航，正文负责诊断；点击行可查看该维度评分说明。
          </div>
        </div>

        <DimensionsTable
          rubric={summary.rubric}
          extras={summary.extraDimensions ?? []}
          overall={summary.overallScores}
          contractVersion={contractVersion}
        />
      </section>

      <section className="rounded-2xl border border-[#E6DCC8] bg-white p-6 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs tracking-widest text-[#8B8272]">REPORT</div>
            <div className="text-base font-semibold text-[#3A3326]">评测报告正文</div>
          </div>
          <div className="max-w-[28rem] text-right text-[11px] leading-relaxed text-[#8B8272]">{reportHint}</div>
        </div>
        <div className="rounded-xl border border-[#F0E9D7] bg-[#FAF6EE] px-4 py-2.5 text-[12px] leading-relaxed text-[#6B6250]">
          本页只保留评分总表作为独立模块，其余诊断内容统一在正文里展开阅读。
        </div>
        <div className="pt-4">
          <MarkdownView content={report || "_（报告正文为空）_"} />
        </div>
      </section>
    </div>
  );
}

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
  hidden?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (hidden || versions.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((s) => !s)}
        className="flex items-center gap-1.5 rounded-lg border border-[#D6CCB5] bg-white px-3 py-1.5 text-xs text-[#3A3326] transition-colors hover:bg-[#F3EEDF]"
      >
        <span className="font-mono font-semibold">v{current}</span>
        {current === latest && <span className="rounded bg-[#5A7A47] px-1.5 py-0.5 text-[10px] text-white">最新</span>}
        <span className="text-[#8B8272]">· {versions.length} 个版本</span>
        <svg className="ml-1 h-3 w-3" viewBox="0 0 12 12" fill="none">
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
              className="absolute right-0 z-20 mt-1.5 w-56 overflow-hidden rounded-lg border border-[#E6DCC8] bg-white shadow-xl"
            >
              {[...versions].reverse().map((vm) => (
                <button
                  key={vm.v}
                  onClick={() => {
                    onPick(vm.v);
                    setOpen(false);
                  }}
                  className={clsx(
                    "flex w-full items-center justify-between border-b border-[#F0E9D7] px-3 py-2 text-xs last:border-b-0 hover:bg-[#FAF6EE]",
                    current === vm.v && "bg-[#FAF6EE] font-medium"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono font-semibold text-[#3A3326]">v{vm.v}</span>
                    {vm.v === latest && <span className="rounded bg-[#5A7A47] px-1 py-0.5 text-[10px] text-white">最新</span>}
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

function DimensionsTable({
  rubric,
  extras,
  overall,
  contractVersion,
}: {
  rubric: EvaluationOutboxPayload["summary"]["rubric"];
  extras: NonNullable<EvaluationOutboxPayload["summary"]["extraDimensions"]>;
  overall: EvaluationOutboxPayload["summary"]["overallScores"];
  contractVersion: ContractVersion;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const reportIds = orderReportIds(overall);
  const productNameMap = new Map(overall.map((o) => [o.reportId, o.productName]));
  const overallMap = new Map(overall.map((o) => [o.reportId, o]));
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

  const getRowMaxScore = (row: (typeof rows)[number]): number => {
    const values = reportIds
      .map((rid) => row.scores.find((item) => item.reportId === rid)?.score)
      .filter((score): score is number => typeof score === "number");
    return values.length > 0 ? Math.max(...values) : -Infinity;
  };

  const hasMultiple = reportIds.length > 1;

  return (
    <div className="overflow-hidden rounded-lg border border-[#E6DCC8]">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col style={{ width: "13rem" }} />
          {reportIds.map((rid) => (
            <col key={rid} />
          ))}
        </colgroup>
        <thead className="border-b border-[#E6DCC8] bg-[#F3ECD9] text-[#3A3326]">
          <tr>
            <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#6B6250]">
              评分维度
            </th>
            {reportIds.map((rid) => (
              <th key={rid} className="px-3 py-3 text-center">
                <span className="text-[15px] font-semibold leading-tight text-[#3A3326]">
                  {productNameMap.get(rid) ?? "—"}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-[#E6DCC8] bg-[#FAF6EE]">
            <td className="px-4 py-4 align-middle">
              <div className="text-[15px] font-semibold text-[#3A3326]">综合得分</div>
              <div className="mt-0.5 text-[11px] text-[#8B8272]">R1~R5 加权 · 满分 10</div>
            </td>
            {reportIds.map((rid) => {
              const item = overallMap.get(rid);
              const isBest = hasMultiple && item && item.score === maxOverall;
              return (
                <td key={rid} className="px-3 py-4 text-center align-middle">
                  {item ? (
                    <div className="inline-flex items-baseline gap-1">
                      <span
                        className={clsx(
                          "text-3xl leading-none tabular-nums",
                          isBest ? "font-bold text-amber-dark" : "font-semibold text-ink-900"
                        )}
                      >
                        {item.score.toFixed(1)}
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

          {rows.map((row, rowIdx) => {
            const isOpen = expanded === row.id;
            const rowMax = getRowMaxScore(row);
            const isLastCore = row.kind === "core" && rows[rowIdx + 1]?.kind === "extra";
            return (
              <Fragment key={row.id}>
                <tr
                  className={clsx(
                    "cursor-pointer border-t transition-colors hover:bg-[#FAF6EE]/50",
                    isLastCore ? "border-[#E6DCC8]" : "border-[#F0E9D7]"
                  )}
                  onClick={() => setExpanded(isOpen ? null : row.id)}
                >
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center gap-2">
                      <span
                        className={clsx(
                          "inline-block rounded px-1.5 py-0.5 text-[10px] font-mono leading-none",
                          row.kind === "core" ? "bg-[#E6DCC8] text-[#6B6250]" : "bg-[#F0E9D7] text-[#8B8272]"
                        )}
                      >
                        {row.id}
                      </span>
                      <span className="font-medium text-[#3A3326]">{row.name}</span>
                    </div>
                    <div className="ml-[34px] mt-0.5 text-[11px] text-[#8B8272]">{row.hint}</div>
                  </td>
                  {reportIds.map((rid) => {
                    const score = row.scores.find((item) => item.reportId === rid);
                    const isRowBest = hasMultiple && score && score.score === rowMax;
                    return (
                      <td key={rid} className="px-3 py-3 text-center align-middle">
                        {score ? (
                          <span
                            className={clsx(
                              "text-lg tabular-nums",
                              isRowBest ? "font-bold text-amber-dark" : "font-medium text-ink-900"
                            )}
                          >
                            {score.score.toFixed(1)}
                          </span>
                        ) : (
                          <span className="text-[#C5BBA6]">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
                {isOpen && (
                  <tr className="border-t border-[#F0E9D7] bg-[#FAF6EE]/70">
                    <td colSpan={1 + reportIds.length} className="px-4 py-3 text-xs leading-relaxed text-[#6B6250]">
                      {row.rationale && (
                        <div className="mb-2 text-[#8B6F3D]">
                          <span className="text-[#8B8272]">为什么加这个维度：</span>
                          {row.rationale}
                        </div>
                      )}
                      <div
                        className="grid gap-3"
                        style={{ gridTemplateColumns: `repeat(${reportIds.length}, minmax(0, 1fr))` }}
                      >
                        {reportIds.map((rid) => {
                          const score = row.scores.find((item) => item.reportId === rid);
                          if (!score) return <div key={rid} className="text-[#C5BBA6]">—</div>;
                          return (
                            <div key={rid} className="space-y-1">
                              <div className="text-[11px] font-semibold text-[#3A3326]">{productNameMap.get(rid)}</div>
                              <div className="whitespace-pre-wrap text-[#3A3326]">{score.comment || "_（无点评）_"}</div>
                              {"issueTags" in score && score.issueTags && score.issueTags.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {score.issueTags.map((tag) => (
                                    <span
                                      key={tag}
                                      className="rounded border border-[#A8522B]/30 bg-[#A8522B]/10 px-1.5 py-0.5 text-[10px] text-[#A8522B]"
                                    >
                                      {tag}
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
