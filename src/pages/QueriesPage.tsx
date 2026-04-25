import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLab } from "../store";
import { formatDate } from "../lib/score";
import {
  QUERY_TYPES,
  type QueryTypeId,
  type Query,
  type AIProduct,
  type Submission,
} from "../types";
import EvaluationRunModal, { type EvaluationTaskSpec } from "../components/EvaluationRunModal";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import { useOutboxAggregate, type PerReportAgg } from "../lib/outboxAgg";
import { sortProducts, isSophia, displayProductName } from "../lib/sortProducts";
import { IS_READONLY } from "../lib/dataSource";

/** 新建评测时：临时报告草稿 */
interface ReportDraft {
  key: string;
  productId: string;
  productVersion: string;
  content: string;
  sourceUrl: string;
}

type TypeFilter = QueryTypeId | "all";
type SortBy = "newest" | "oldest" | "score-desc" | "score-asc";

export default function QueriesPage() {
  const nav = useNavigate();
  const {
    queries,
    submissions,
    products,
    createQuery,
    createSubmission,
  } = useLab();

  const outbox = useOutboxAggregate();

  // ============ 筛选 & 排序（简化版：关键字 + Query 类型 + 排序） ============
  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("newest");

  const resetFilters = () => {
    setKeyword("");
    setTypeFilter("all");
    setSortBy("newest");
  };

  const filterActiveCount =
    (keyword ? 1 : 0) + (typeFilter !== "all" ? 1 : 0);

  // ============ 新增评测 Modal ============
  const [showForm, setShowForm] = useState(false);
  const [queryText, setQueryText] = useState("");
  const [domain, setDomain] = useState("");
  const [typeId, setTypeId] = useState<QueryTypeId | "">("");
  const [reportDate, setReportDate] = useState("");
  const [reports, setReports] = useState<ReportDraft[]>([
    { key: "r-0", productId: "", productVersion: "", content: "", sourceUrl: "" },
  ]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setQueryText("");
    setDomain("");
    setTypeId("");
    setReportDate("");
    setReports([{ key: "r-0", productId: "", productVersion: "", content: "", sourceUrl: "" }]);
    setErrorMsg(null);
    setProgress(null);
  }, []);

  useEffect(() => {
    if (!showForm) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        resetForm();
        setShowForm(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [showForm, submitting, resetForm]);

  const addReport = () =>
    setReports((prev) => [
      ...prev,
      {
        key: `r-${Date.now()}-${prev.length}`,
        productId: "",
        productVersion: "",
        content: "",
        sourceUrl: "",
      },
    ]);
  const updateReport = (key: string, patch: Partial<ReportDraft>) =>
    setReports((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeReport = (key: string) =>
    setReports((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.key !== key)));

  // 评测任务：创建完 Query + Submissions 后，把 task spec 喂给 EvaluationRunModal
  const [evalTask, setEvalTask] = useState<EvaluationTaskSpec | null>(null);
  const [pendingNavId, setPendingNavId] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!queryText.trim()) return setErrorMsg("请填写评测 Query");
    if (!typeId) return setErrorMsg("请选择评测 Query 类型（必填）");
    if (!reportDate) return setErrorMsg("请填写报告生成时间（必填）");

    const validReports = reports.filter((r) => r.productId && r.content.trim());
    if (validReports.length === 0)
      return setErrorMsg("至少需要输入 1 份 AI 报告（含产品选择和正文）");

    setSubmitting(true);
    try {
      setProgress("创建评测记录...");
      const q = await createQuery({
        code: "",
        title: queryText.trim(),
        domain: domain.trim() || undefined,
        typeId: typeId as QueryTypeId,
        reportDate: new Date(reportDate).toISOString(),
      } as Omit<Query, "id" | "createdAt" | "updatedAt">);

      setProgress(`落存 ${validReports.length} 份 AI 报告...`);
      const submittedAtIso = new Date(reportDate).toISOString();
      const createdSubs: Submission[] = [];
      for (const r of validReports) {
        const s = await createSubmission({
          queryId: q.id,
          productId: r.productId,
          productVersion: r.productVersion.trim() || undefined,
          submittedAt: submittedAtIso,
          contentFormat: "markdown",
          content: r.content,
          sourceUrl: r.sourceUrl.trim() || undefined,
        });
        createdSubs.push(s);
      }

      // 关表单，唤起评测 Modal
      resetForm();
      setShowForm(false);
      setPendingNavId(q.id);
      setEvalTask({ query: q, submissions: createdSubs, products });
    } catch (err) {
      setErrorMsg((err as Error).message || "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEvalFinished = () => {
    if (pendingNavId) {
      const id = pendingNavId;
      setPendingNavId(null);
      setEvalTask(null);
      nav(`/queries/${id}`);
    }
  };

  const handleEvalClose = () => {
    setEvalTask(null);
    if (pendingNavId) {
      const id = pendingNavId;
      setPendingNavId(null);
      nav(`/queries/${id}`);
    }
  };

  // ============ 列表视图数据（基于 outbox 聚合，与详情页对齐） ============
  const rows = useMemo(() => {
    return queries.map((q) => {
      const qSubs = submissions.filter((s) => s.queryId === q.id);
      const qAgg = q.code ? outbox.byQueryCode.get(q.code) : undefined;

      // 构造「参评产品 + 分数」列表：用于卡片上的对比条
      // 顺序遵循 sortProducts：Sophia 系列优先，其余按 order
      const subProducts: Array<{
        sub: Submission;
        product: AIProduct;
        agg: PerReportAgg | undefined;
      }> = [];
      for (const s of qSubs) {
        const p = products.find((x) => x.id === s.productId);
        if (!p) continue;
        subProducts.push({
          sub: s,
          product: p,
          agg: qAgg?.byReport.get(s.id),
        });
      }
      // 按产品排序
      subProducts.sort((a, b) => {
        const sorted = sortProducts([a.product, b.product]);
        return sorted[0].id === a.product.id ? -1 : 1;
      });

      // 主产品（Sophia 最新一版） —— 用于"按得分排序"的主参考
      const primary = subProducts.find((x) => isSophia(x.product))?.product;
      const primaryAgg = subProducts.find((x) => isSophia(x.product))?.agg;

      // 最高分（用于标红 & verdict 来源）
      const scored = subProducts.filter((x) => x.agg !== undefined);
      const maxScore = scored.length
        ? Math.max(...scored.map((x) => x.agg!.overallScore))
        : undefined;

      // verdict：优先从 Sophia 取；若无则从最高分的那份取
      const verdictSource =
        subProducts.find((x) => isSophia(x.product) && x.agg?.verdict) ??
        scored.find((x) => x.agg!.overallScore === maxScore && x.agg!.verdict);
      const verdictText = verdictSource?.agg?.verdict?.replace(/\*\*/g, "").trim() ?? "";

      const evaluatedCount = scored.length;
      const pending = subProducts.length - evaluatedCount;

      // 汇总该 Query 下所有 report 的 issueTags
      const tagSet = new Set<string>();
      if (qAgg) {
        for (const r of qAgg.byReport.values()) {
          r.issueTags.forEach((t) => tagSet.add(t));
        }
      }

      return {
        q,
        subProducts,
        primary,
        primaryAgg,
        maxScore,
        verdictText,
        evaluatedCount,
        pending,
        tags: Array.from(tagSet),
      };
    });
  }, [queries, submissions, outbox.byQueryCode, products]);

  const filtered = useMemo(() => {
    const lk = keyword.toLowerCase();
    return rows.filter(({ q }) => {
      if (lk) {
        const hit =
          q.title.toLowerCase().includes(lk) ||
          q.code?.toLowerCase().includes(lk) ||
          q.domain?.toLowerCase().includes(lk);
        if (!hit) return false;
      }
      if (typeFilter !== "all") {
        const tid = q.typeId ?? "other";
        if (tid !== typeFilter) return false;
      }
      return true;
    });
  }, [rows, keyword, typeFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortBy) {
      case "newest":
        arr.sort((a, b) => b.q.createdAt.localeCompare(a.q.createdAt));
        break;
      case "oldest":
        arr.sort((a, b) => a.q.createdAt.localeCompare(b.q.createdAt));
        break;
      case "score-desc":
        arr.sort(
          (a, b) =>
            (b.primaryAgg?.overallScore ?? -1) - (a.primaryAgg?.overallScore ?? -1)
        );
        break;
      case "score-asc":
        arr.sort(
          (a, b) =>
            (a.primaryAgg?.overallScore ?? 11) - (b.primaryAgg?.overallScore ?? 11)
        );
        break;
    }
    return arr;
  }, [filtered, sortBy]);

  return (
    <div className="space-y-6">
      {/* 顶部 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">评测</h1>
          <p className="text-sm text-ink-500 mt-1">
            由 Sophia 评测官为每一份 AI 深度研究报告自动评分 · 共 {queries.length} 条评测
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className={clsx(
            "bg-amber text-white px-4 py-2 rounded-lg hover:bg-amber-dark transition shadow-soft",
            IS_READONLY && "hidden"
          )}
        >
          + 新增评测
        </button>
      </div>

      {/* 轻量筛选条：关键字 + Query 类型 + 排序 */}
      <div className="bg-white rounded-xl shadow-soft border border-paper-200 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* 关键字搜索 */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索 Query / 编号 / 领域"
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-paper-300 rounded-lg bg-paper-50 focus:outline-none focus:border-amber focus:bg-white transition"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400 text-xs">
              🔍
            </span>
            {keyword && (
              <button
                type="button"
                onClick={() => setKeyword("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full hover:bg-paper-200 text-ink-400 text-xs"
                aria-label="清除"
              >
                ×
              </button>
            )}
          </div>

          {/* Query 类型 select（选项数较多，用下拉比 segmented 更节省宽度） */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-500">类型</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
              className="px-3 py-1.5 text-sm border border-paper-300 rounded-lg bg-paper-50 hover:bg-white focus:outline-none focus:border-amber transition"
            >
              <option value="all">全部类型</option>
              {QUERY_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* 排序 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-500">排序</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="px-3 py-1.5 text-sm border border-paper-300 rounded-lg bg-paper-50 hover:bg-white focus:outline-none focus:border-amber transition"
            >
              <option value="newest">最新在前</option>
              <option value="oldest">最早在前</option>
              <option value="score-desc">得分 · 高→低</option>
              <option value="score-asc">得分 · 低→高</option>
            </select>
          </div>

          {/* 计数 + 重置 */}
          <div className="ml-auto flex items-center gap-3 text-xs text-ink-500">
            <span>
              <span className="font-semibold text-ink-900">{sorted.length}</span>
              <span className="text-ink-400"> / {rows.length}</span>
            </span>
            {filterActiveCount > 0 && (
              <button
                onClick={resetFilters}
                className="text-amber-dark hover:underline"
              >
                重置
              </button>
            )}
            {outbox.loading && (
              <span className="text-ink-400 italic">同步评测结果…</span>
            )}
          </div>
        </div>
      </div>

      {/* 列表 */}
      <div className="space-y-3">
        {sorted.length === 0 ? (
          <div className="text-center py-16 text-ink-500 bg-white rounded-xl border border-dashed border-paper-300">
            {rows.length === 0
              ? IS_READONLY
                ? "目前还没有公开的评测数据，请稍后再来 ✨"
                : "还没有任何评测，点击右上角「+ 新增评测」开始"
              : "没有满足筛选条件的评测"}
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map((row) => (
              <EvaluationCard key={row.q.id} {...row} />
            ))}
          </div>
        )}
      </div>

      {/* 新增评测 Modal（只读模式不渲染） */}
      <AnimatePresence>
        {!IS_READONLY && showForm && (
          <motion.div
            key="newquery-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm flex items-start md:items-center justify-center p-4 overflow-y-auto"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                if (submitting) return;
                resetForm();
                setShowForm(false);
              }
            }}
          >
            <motion.form
              initial={{ opacity: 0, scale: 0.97, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 12 }}
              transition={{ duration: 0.18 }}
              onSubmit={handleCreate}
              className="relative bg-white rounded-2xl shadow-2xl border border-paper-200 w-full max-w-3xl my-8 flex flex-col max-h-[calc(100vh-4rem)]"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-paper-200 shrink-0">
                <div>
                  <div className="text-lg font-semibold text-ink-900">新增评测</div>
                  <div className="text-xs text-ink-500 mt-0.5">
                    录入 Query + 至少 1 份 AI 报告 · 提交后由 Sophia 评测官自动评分
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (submitting) return;
                    resetForm();
                    setShowForm(false);
                  }}
                  className="w-8 h-8 rounded-full hover:bg-paper-100 text-ink-500 text-xl leading-none"
                  aria-label="关闭"
                >
                  ×
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                <div>
                  <label className="text-sm font-medium text-ink-700">
                    评测 Query <span className="text-clay">*</span>
                  </label>
                  <p className="text-[11px] text-ink-400 mt-0.5 mb-1">
                    原样记录用户输入的 Query，不做总结
                  </p>
                  <textarea
                    value={queryText}
                    onChange={(e) => setQueryText(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-paper-300 rounded-lg focus:outline-none focus:border-amber bg-paper-50 text-sm"
                    placeholder="例：请帮我分析 2026 年 1-4 月中国创新药 BD 出海情况..."
                  />
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-ink-700">
                      评测 Query 类型 <span className="text-clay">*</span>
                    </label>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {QUERY_TYPES.map((t) => (
                        <button
                          type="button"
                          key={t.id}
                          onClick={() => setTypeId(t.id)}
                          className={clsx(
                            "px-3 py-1.5 text-xs rounded-full border transition",
                            typeId === t.id
                              ? "bg-amber text-white border-amber shadow-soft"
                              : "bg-paper-50 text-ink-700 border-paper-300 hover:border-amber/50"
                          )}
                          title={t.description}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-ink-700">
                      报告生成时间 <span className="text-clay">*</span>
                    </label>
                    <p className="text-[11px] text-ink-400 mt-0.5 mb-1">
                      AI 产出这批报告的日期
                    </p>
                    <input
                      type="date"
                      value={reportDate}
                      onChange={(e) => setReportDate(e.target.value)}
                      className="w-full px-3 py-2 border border-paper-300 rounded-lg focus:outline-none focus:border-amber bg-paper-50 text-sm"
                    />
                    <label className="text-sm font-medium text-ink-700 mt-3 block">领域</label>
                    <input
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                      className="mt-1 w-full px-3 py-2 border border-paper-300 rounded-lg focus:outline-none focus:border-amber bg-paper-50 text-sm"
                      placeholder="例:医药 / 产业研究（可选）"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-ink-700">
                      AI 报告 <span className="text-clay">*</span>{" "}
                      <span className="text-[11px] text-ink-400 font-normal">
                        至少 1 份（{reports.filter((r) => r.productId && r.content.trim()).length} 份已填写）
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={addReport}
                      className="text-xs text-amber-dark hover:underline"
                    >
                      + 再添加一份报告
                    </button>
                  </div>

                  <div className="mt-2 space-y-3">
                    {reports.map((r, idx) => {
                      const prod = products.find((p) => p.id === r.productId);
                      return (
                        <div
                          key={r.key}
                          className="rounded-lg border border-paper-300 bg-paper-50 p-4 space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm text-ink-700">
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-ink-900 text-white text-[10px]">
                                {idx + 1}
                              </span>
                              <span className="font-medium">报告 {idx + 1}</span>
                              {prod && (
                                <span
                                  className="text-[10px] px-1.5 py-0.5 rounded"
                                  style={{
                                    background: `${prod.color ?? "#8B8272"}20`,
                                    color: prod.color ?? "#8B8272",
                                  }}
                                >
                                  {displayProductName(prod)}
                                </span>
                              )}
                            </div>
                            {reports.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeReport(r.key)}
                                className="text-xs text-ink-400 hover:text-clay"
                              >
                                删除
                              </button>
                            )}
                          </div>
                          <div className="grid md:grid-cols-3 gap-2">
                            <select
                              value={r.productId}
                              onChange={(e) => updateReport(r.key, { productId: e.target.value })}
                              className="px-3 py-2 border border-paper-300 rounded-lg bg-white text-sm"
                            >
                              <option value="">-- 选择 AI 产品 --</option>
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {displayProductName(p)}
                                </option>
                              ))}
                            </select>
                            <input
                              value={r.productVersion}
                              onChange={(e) =>
                                updateReport(r.key, { productVersion: e.target.value })
                              }
                              placeholder="版本号（选填，例 v4.2）"
                              className="px-3 py-2 border border-paper-300 rounded-lg bg-white text-sm"
                            />
                            <input
                              value={r.sourceUrl}
                              onChange={(e) => updateReport(r.key, { sourceUrl: e.target.value })}
                              placeholder="原文链接（选填）"
                              className="px-3 py-2 border border-paper-300 rounded-lg bg-white text-sm"
                            />
                          </div>
                          <textarea
                            value={r.content}
                            onChange={(e) => updateReport(r.key, { content: e.target.value })}
                            rows={6}
                            placeholder="粘贴该 AI 产出的报告正文（Markdown）..."
                            className="w-full px-3 py-2 border border-paper-300 rounded-lg bg-white text-sm font-mono"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {errorMsg && (
                  <div className="text-sm text-clay bg-clay/10 border border-clay/30 rounded-lg px-3 py-2">
                    {errorMsg}
                  </div>
                )}

                {progress && (
                  <div className="text-sm text-amber-dark bg-amber/10 border border-amber/30 rounded-lg px-3 py-2 flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber animate-pulse" />
                    {progress}
                  </div>
                )}
              </div>

              <div className="shrink-0 px-6 py-4 border-t border-paper-200 bg-paper-50/60 flex items-center justify-between gap-2 rounded-b-2xl">
                <div className="text-[11px] text-ink-500">
                  提交后 Sophia 评测官会立即为每份报告评分，稍等几秒即可查看报告页
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      resetForm();
                      setShowForm(false);
                    }}
                    disabled={submitting}
                    className="px-4 py-2 rounded-lg text-ink-700 hover:bg-paper-100 text-sm"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className={clsx(
                      "px-5 py-2 rounded-lg font-medium transition shadow-soft text-sm",
                      submitting
                        ? "bg-paper-200 text-ink-400 cursor-not-allowed"
                        : "bg-amber text-white hover:bg-amber-dark"
                    )}
                  >
                    {submitting ? "创建 + AI 评测中..." : "🤖 创建并自动评测"}
                  </button>
                </div>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ==================== 评测进行中 Modal（只读模式不渲染） ==================== */}
      {!IS_READONLY && (
        <EvaluationRunModal
          open={!!evalTask}
          spec={evalTask}
          onClose={handleEvalClose}
          onFinished={handleEvalFinished}
        />
      )}
    </div>
  );
}

// ============================================================
// 评测卡片 — 核心要素预览
//
// 设计：
//   上：编号 + 类型徽章 + 领域 + 日期
//   中：Query 标题（2 行截断）
//   中：核心结论摘要（verdict 引用块，2 行）
//   下：参评 AI 对比条（各产品分数 mini bar，最高分 amber 高亮）
//   脚：问题标签 + 统计
// ============================================================
function EvaluationCard({
  q,
  subProducts,
  maxScore,
  verdictText,
  evaluatedCount,
  pending,
  tags,
}: {
  q: Query;
  subProducts: Array<{
    sub: Submission;
    product: AIProduct;
    agg: PerReportAgg | undefined;
  }>;
  primary: AIProduct | undefined;
  primaryAgg: PerReportAgg | undefined;
  maxScore: number | undefined;
  verdictText: string;
  evaluatedCount: number;
  pending: number;
  tags: string[];
}) {
  const qType = QUERY_TYPES.find((t) => t.id === (q.typeId ?? "other"));
  const shownTags = useMemo(() => tags.slice(0, 5), [tags]);
  const totalCount = subProducts.length;

  return (
    <Link
      to={`/queries/${q.id}`}
      className="block bg-white rounded-xl shadow-soft hover:shadow-lifted transition border border-paper-200 hover:border-amber/40 p-5 animate-slide-up group cursor-pointer"
    >
      {/* 头部：编号 + 类型 + 领域 + 时间 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-[11px] font-mono font-semibold text-amber-dark bg-amber/10 px-1.5 py-0.5 rounded">
          {q.code}
        </span>
        {qType && (
          <span
            className="text-[11px] px-1.5 py-0.5 rounded font-medium"
            style={{
              background: `${qType.color}15`,
              color: qType.color,
              border: `1px solid ${qType.color}40`,
            }}
          >
            {qType.name}
          </span>
        )}
        {q.domain && (
          <span className="text-[11px] text-ink-500 bg-paper-50 px-1.5 py-0.5 rounded">
            {q.domain}
          </span>
        )}
        <span className="text-[11px] text-ink-400 ml-auto">
          {q.reportDate && <>报告 {formatDate(q.reportDate)} · </>}
          创建 {formatDate(q.createdAt)}
        </span>
      </div>

      {/* Query 标题 */}
      <div className="text-sm text-ink-900 group-hover:text-amber-dark transition whitespace-pre-wrap line-clamp-2 font-medium leading-relaxed mb-3">
        {q.title}
      </div>

      {/* 核心结论摘要 */}
      {verdictText ? (
        <div className="text-[12.5px] text-ink-600 bg-paper-50 border-l-[3px] border-amber/70 pl-3 pr-2 py-2 rounded-r line-clamp-2 leading-relaxed mb-4">
          {verdictText}
        </div>
      ) : pending > 0 ? (
        <div className="text-xs text-ochre italic mb-4">
          Sophia 评测官尚未完成评测（{pending} 份报告待评）
        </div>
      ) : null}

      {/* 参评 AI 对比条 —— 卡片的视觉主角 */}
      {subProducts.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {subProducts.map(({ sub, product, agg }) => {
            const isHighest =
              agg !== undefined &&
              maxScore !== undefined &&
              agg.overallScore === maxScore &&
              evaluatedCount >= 2; // 只有 2 家以上才高亮"最高"
            const isPrimary = isSophia(product);
            return (
              <ScoreBar
                key={sub.id}
                name={displayProductName(product)}
                version={sub.productVersion}
                score={agg?.overallScore}
                color={product.color}
                isHighest={isHighest}
                isPrimary={isPrimary}
              />
            );
          })}
        </div>
      )}

      {/* 脚：标签 + 统计 */}
      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-paper-100">
        {shownTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {shownTags.map((t) => (
              <span
                key={t}
                className="text-[10px] px-1.5 py-0.5 rounded-full border border-paper-300 bg-paper-50 text-ink-600"
              >
                {t}
              </span>
            ))}
            {tags.length > shownTags.length && (
              <span className="text-[10px] text-ink-400 self-center">
                +{tags.length - shownTags.length}
              </span>
            )}
          </div>
        )}
        <div className="ml-auto text-[11px] text-ink-500 flex items-center gap-2">
          <span>
            {totalCount} 方参评
            <span className="text-ink-400"> · </span>
            <span className="text-ink-900 font-medium">{evaluatedCount}</span> 已评
            {pending > 0 && (
              <span className="text-ochre"> · {pending} 待评</span>
            )}
          </span>
          <span className="text-amber-dark opacity-0 group-hover:opacity-100 transition">
            详情 →
          </span>
        </div>
      </div>
    </Link>
  );
}

// ============================================================
// ScoreBar — 单个产品的评分对比条
//   ▪ 左：产品名（Sophia 系列粗体 + ★）
//   ▪ 中：mini bar（宽度 = score/10，颜色用产品自带 color 或 amber）
//   ▪ 右：分数文字（最高分用 amber-dark 加粗）
// ============================================================
function ScoreBar({
  name,
  version,
  score,
  color,
  isHighest,
  isPrimary,
}: {
  name: string;
  version?: string;
  score: number | undefined;
  color?: string;
  isHighest: boolean;
  isPrimary: boolean;
}) {
  const pct = score !== undefined ? Math.max(4, Math.min(100, (score / 10) * 100)) : 0;
  const barColor = color ?? "#B8A582";
  return (
    <div className="flex items-center gap-3 text-xs">
      {/* 产品名列：固定宽度对齐 */}
      <div className="w-[116px] shrink-0 flex items-center gap-1 min-w-0">
        <span
          className={clsx(
            "truncate",
            isPrimary ? "font-semibold text-ink-900" : "text-ink-700"
          )}
          title={name}
        >
          {name}
        </span>
        {isPrimary && (
          <span className="text-[10px] text-amber-dark shrink-0" title="本轮主评测对象">
            ★
          </span>
        )}
        {version && (
          <span className="text-[10px] text-ink-400 shrink-0">{version}</span>
        )}
      </div>

      {/* bar */}
      <div className="flex-1 h-1.5 bg-paper-100 rounded-full overflow-hidden relative min-w-[80px]">
        {score !== undefined ? (
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pct}%`,
              background: isHighest
                ? `linear-gradient(90deg, ${barColor}, #B8860B)`
                : barColor,
              opacity: isHighest ? 1 : 0.65,
            }}
          />
        ) : (
          <div
            className="h-full w-full"
            style={{
              background:
                "repeating-linear-gradient(45deg, transparent 0 4px, rgba(0,0,0,0.04) 4px 8px)",
            }}
          />
        )}
      </div>

      {/* 分数 */}
      <div
        className={clsx(
          "w-[48px] text-right tabular-nums shrink-0",
          score === undefined
            ? "text-ink-300 italic"
            : isHighest
            ? "text-amber-dark font-bold"
            : "text-ink-700 font-medium"
        )}
      >
        {score === undefined ? "待评" : score.toFixed(1)}
      </div>
    </div>
  );
}
