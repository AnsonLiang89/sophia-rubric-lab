import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import { useLab } from "../store";
import { QUERY_TYPES, type AIProduct, type Submission } from "../types";
import { formatDate } from "../lib/score";
import { pickPrimaryProduct, displayProductName } from "../lib/sortProducts";
import MarkdownView from "../components/MarkdownView";
import EvaluationRunModal, { type EvaluationTaskSpec } from "../components/EvaluationRunModal";
import EvaluationReportView from "../components/EvaluationReportView";
import { contractBus, IS_READONLY, type OutboxListItem, type InboxReportVersion } from "../lib/contract";
import { flattenTaskVersions, type FlatTaskVersion } from "../lib/outboxUtils";
import { computeSubmissionDisplayCodes } from "../lib/submissionDisplayCode";
import { getReadonlyReportLoader } from "../storage";

/**
 * 评测报告页（契约 v1）
 * 路由：/queries/:id
 *
 * 版本管理模型（2026-04-20 简化）：
 *   Query 是唯一基本单元；该 Query 下的所有评测产物按时间升序统一重编号为
 *   v1 / v2 / v3 ...（v1 最早、vN 最新）。用户不需要关心磁盘里每个产物
 *   来自哪次"召唤"（taskId），也不需要关心 LLM 在同一次召唤里写了几版。
 *   对外呈现 = 一条线性的版本时间轴，默认载入最新（vN）。
 *
 *   磁盘存储仍是 `.evaluations/outbox/{taskId}/v{n}.json`（这是和 LLM 的契约，
 *   不动）。UI 层把所有 (taskId, n) 对扁平化 + 重编号。
 *
 * 结构：
 *   Hero 区：面包屑 + 操作区（召唤评测 / 追加对比源 / 删除） + Query 主文 + 元信息 + 参评 AI 胶囊
 *   评测产物区：统一一个"版本"下拉 + 内容区
 */

type CohortItem = {
  sub: Submission;
  product: AIProduct;
};

/**
 * 扁平化的报告条目：一份具体产物对应一个显示版本号。
 * 实现已抽到 `src/lib/outboxUtils.ts` 的 FlatTaskVersion，这里保留别名
 * 以减少本文件其它地方的连带改动。
 */
type FlatReport = FlatTaskVersion;

/**
 * Inbox 审计轨条目：一个 submission（candidateId）对应它在 inbox 里的全部历史版本。
 *
 * 用于 RawReportModal 的"历史版本"折叠入口——展示 replacedReason / 版本切换 /
 * 任意历史版本的正文。只有 dev 模式下可见（prod 不可读 inbox）。
 */
type CandidateHistoryEntry = {
  taskId: string;
  candidateId: string;
  activeVersion: number;
  versions: InboxReportVersion[];
};

export default function ReportPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { queries, submissions, products, createSubmission, deleteQuery } = useLab();

  const q = queries.find((x) => x.id === id);
  const subs = useMemo(
    () => submissions.filter((s) => s.queryId === id),
    [submissions, id]
  );

  const [addOpen, setAddOpen] = useState(false);
  const [evalTask, setEvalTask] = useState<EvaluationTaskSpec | null>(null);

  // outbox 任务列表：只保留当前 queryCode 的
  const [outboxTasks, setOutboxTasks] = useState<OutboxListItem[]>([]);
  // 扁平化后的"报告版本"列表（已按最新在前排序，统一重编号 v1/v2/.../vN）
  const flatReports = useMemo(() => flattenTaskVersions(outboxTasks), [outboxTasks]);
  // 当前选中的报告版本：用磁盘路径 (taskId, diskVersion) 精确定位；默认最新。
  const [activePick, setActivePick] = useState<{ taskId: string; diskVersion: number } | null>(
    null
  );
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const qCode = q?.code;

  useEffect(() => {
    if (!qCode) return;
    let cancelled = false;
    (async () => {
      setRefreshing(true);
      try {
        const resp = await contractBus.listOutbox();
        if (cancelled) return;
        const mine = (resp?.results ?? []).filter((r) => r.queryCode === qCode);
        setOutboxTasks(mine);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) {
          // 留一点点可见的反馈时间
          setTimeout(() => !cancelled && setRefreshing(false), 250);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qCode, refreshTick]);

  // 当 flatReports 变化时，维护 activePick 的有效性：优先保持当前选择，否则取最新（vN）
  // 这里的 setActivePick 是"根据派生数据 flatReports 修复自身 state"的受控场景，
  // 不是级联渲染（flatReports 是外部 useMemo 的结果，不会被本 effect 反向影响）。
  useEffect(() => {
    if (flatReports.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActivePick(null);
      return;
    }
    setActivePick((prev) => {
      if (
        prev &&
        flatReports.some(
          (r) => r.taskId === prev.taskId && r.diskVersion === prev.diskVersion
        )
      ) {
        return prev;
      }
      // flatReports[0] 是 mtime 最大的那条 = 用户视角的最新 vN
      const top = flatReports[0];
      return { taskId: top.taskId, diskVersion: top.diskVersion };
    });
  }, [flatReports]);

  if (!q) {
    return (
      <div className="py-16 text-center space-y-3">
        <div className="text-ink-500">评测不存在</div>
        <Link to="/queries" className="text-amber-dark hover:underline text-sm">
          ← 返回评测列表
        </Link>
      </div>
    );
  }

  const qType = QUERY_TYPES.find((t) => t.id === (q.typeId ?? "other"));

  // 新架构：主产品显式挑最新版 Sophia（没有则兜底第一个），避免 PRODUCTS.json 删掉 Sophia 后错拿其他产品
  const primaryId = pickPrimaryProduct(products)?.id;
  const cohort: CohortItem[] = subs
    .map((s) => ({
      sub: s,
      product: products.find((p) => p.id === s.productId),
    }))
    .filter((x): x is CohortItem => !!x.product)
    .sort((a, b) => {
      const ap = a.product.id === primaryId;
      const bp = b.product.id === primaryId;
      if (ap && !bp) return -1;
      if (!ap && bp) return 1;
      return a.product.name.localeCompare(b.product.name);
    });

  const handleDelete = async () => {
    if (!confirm(`确定删除评测 ${q.code} 及其所有报告？（outbox 里的评测产物文件不会自动删）`)) return;
    await deleteQuery(q.id);
    nav("/queries");
  };

  const handleRunEval = () => {
    if (cohort.length === 0) return;
    setEvalTask({
      query: q,
      submissions: cohort.map((c) => c.sub),
      products,
    });
  };

  // 刷新：强制跳回最新版本（用户按"刷新"本质就是"给我看最新的"）。
  // 清空 activePick 让 flatReports 到达后的兜底逻辑重新挑 flatReports[0] = 最新 vN。
  const handleRefresh = () => {
    setActivePick(null);
    setRefreshTick((t) => t + 1);
  };

  const handleDeleteVersion = async (taskId: string) => {
    // 磁盘存储单位是 taskId（一个 taskId 可能包含多个版本，同次召唤的迭代）。
    // 出于"一次删干净"的简单语义，删除就是删该 taskId 的全部产物。
    // 绝大多数情况下一个 taskId 只含一个版本，这个语义不会困扰用户。
    if (!confirm("确定删除这个评测版本？（若 LLM 在同一次召唤里写过多版，将一起清理）")) return;
    try {
      await contractBus.deleteOutbox(taskId);
      await contractBus.deleteInbox(taskId);
      setRefreshTick((t) => t + 1);
    } catch (err) {
      alert(`删除失败：${(err as Error).message}`);
    }
  };

  return (
    <div className="space-y-8">
      {/* ==================== Hero ==================== */}
      <ReportHero
        code={q.code}
        queryText={q.title}
        typeName={qType?.name}
        typeColor={qType?.color}
        domain={q.domain}
        reportDate={q.reportDate}
        createdAt={q.createdAt}
        cohort={cohort}
        primaryProductId={primaryId}
        onAddSource={() => setAddOpen(true)}
        onRunEval={handleRunEval}
        onDelete={handleDelete}
      />

      {/* ==================== 评测产物 ==================== */}
      <section>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">评测报告</h2>
            <p className="text-sm text-ink-500 mt-0.5">
              由 WorkBuddy 对话框中的 LLM（Sophia）按契约生成，产物落在
              <code className="font-mono mx-1">.evaluations/outbox/</code>
              下。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* 统一的"版本"下拉：把所有产物按 mtime 重编号为 v1/v2/.../vN */}
            {flatReports.length > 0 && (
              <ReportVersionPicker
                reports={flatReports}
                active={activePick}
                onPick={(taskId, diskVersion) => setActivePick({ taskId, diskVersion })}
                onDeleteVersion={handleDeleteVersion}
              />
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className={clsx(
                "text-xs px-3 py-1.5 rounded-lg border transition inline-flex items-center gap-1.5",
                refreshing
                  ? "border-paper-200 bg-paper-100 text-ink-400 cursor-wait"
                  : "border-paper-300 bg-white text-ink-700 hover:bg-paper-50 hover:border-amber/60"
              )}
              title="重新从磁盘读取最新产物"
            >
              <span
                className={clsx(
                  "inline-block",
                  refreshing && "animate-spin"
                )}
              >
                ↻
              </span>
              {refreshing ? "刷新中…" : "刷新"}
            </button>
          </div>
        </div>

        {activePick ? (
          <EvaluationReportView
            key={`${activePick.taskId}@v${activePick.diskVersion}`}
            taskId={activePick.taskId}
            version={activePick.diskVersion}
            refreshKey={refreshTick}
            emptyHint={
              <>
                任务 <code className="font-mono">{activePick.taskId}</code> 暂无产物，
                <br />
                请到 WorkBuddy 对话框粘贴召唤口令让 LLM 写入后再刷新。
              </>
            }
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-paper-300 bg-paper-50/50 p-10 text-center">
            <div className="text-sm text-ink-500 mb-1">暂无评测产物</div>
            <div className="text-xs text-ink-400 leading-relaxed">
              {IS_READONLY ? (
                <>该评测暂时没有公开的报告，敬请期待 ✨</>
              ) : (
                <>
                  点右上角「🤖 召唤评测」把任务写入收件箱，
                  <br />
                  然后到 WorkBuddy 对话框粘贴口令让 Sophia 跑评测。
                </>
              )}
            </div>
          </div>
        )}
      </section>

      {/* 追加对比源 Modal（只读模式不渲染） */}
      {!IS_READONLY && (
        <AddSubmissionModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          products={products}
          existingProductIds={cohort.map((c) => c.product.id)}
          onCreate={async (payload) => {
            const newSub = await createSubmission({
              queryId: q.id,
              productId: payload.productId,
              productVersion: payload.version || undefined,
              submittedAt: new Date(payload.reportDate || q.reportDate || new Date()).toISOString(),
              contentFormat: "markdown",
              content: payload.content,
              sourceUrl: payload.sourceUrl || undefined,
            });
            // 追加完后对 cohort + 新增一起发起评测
            setEvalTask({
              query: q,
              submissions: [...cohort.map((c) => c.sub), newSub],
              products,
            });
          }}
        />
      )}

      {/* 评测任务 Modal（把 inbox 写进去 + 展示召唤口令；只读模式不渲染） */}
      {!IS_READONLY && (
        <EvaluationRunModal
          open={!!evalTask}
          spec={evalTask}
          onClose={() => setEvalTask(null)}
          onFinished={() => {
            setEvalTask(null);
            // 用户合上 Modal 后刷新一次（可能产物已生成）
            setRefreshTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Hero 统领区
// ============================================================

function ReportHero({
  code,
  queryText,
  typeName,
  typeColor,
  domain,
  reportDate,
  createdAt,
  cohort,
  primaryProductId,
  onAddSource,
  onRunEval,
  onDelete,
}: {
  code: string;
  queryText: string;
  typeName?: string;
  typeColor?: string;
  domain?: string;
  reportDate?: string;
  createdAt: string;
  cohort: CohortItem[];
  primaryProductId?: string;
  onAddSource: () => void;
  onRunEval: () => void;
  onDelete: () => void;
}) {
  // 当前在弹窗中查看原文的 submission.id（一次只看一个）
  const [openSubId, setOpenSubId] = useState<string | null>(null);
  const current = openSubId
    ? cohort.find((c) => c.sub.id === openSubId) ?? null
    : null;

  // Submission 展示编号（EV-0005-R1 / R2 ...）
  // 纯计算，跟随当前权威 queryCode 变化。仅在原始报告弹窗标题处露出。
  const displayCodeMap = useMemo(
    () => computeSubmissionDisplayCodes(code, cohort.map((c) => c.sub)),
    [code, cohort]
  );
  const currentDisplayCode = current ? displayCodeMap.get(current.sub.id) : undefined;

  // ------------------------------------------------------------
  // Inbox 审计轨：按 candidateId 聚合报告版本历史
  //
  // 设计（2026-04-27 P2）：
  //  - 同一 query 下可能对应多个 inbox task（多次"召唤评测"），每个 task.candidates[] 里
  //    的 candidateId 对应唯一一个 Submission。当用 replace-report 或 PATCH 替换时，
  //    新版本会追加到那个 candidate 的 reportVersions[]（只追加不删）。
  //  - 因此 Map<candidateId, historyEntry> 足够定位任意 submission 的全部历史版本。
  //  - dev 模式下可用；prod(IS_READONLY) 下 listInbox 返回 null → 历史 Map 为空，
  //    审计轨 UI 自然隐藏（submission.reportVersions?.length ? 展开 : 隐藏）。
  // ------------------------------------------------------------
  const [inboxHistoryMap, setInboxHistoryMap] = useState<Map<string, CandidateHistoryEntry>>(
    () => new Map()
  );

  useEffect(() => {
    if (IS_READONLY) return;
    let cancelled = false;
    (async () => {
      try {
        const listed = await contractBus.listInbox();
        if (cancelled || !listed) return;
        const mine = listed.tasks.filter((t) => t.queryCode === code);
        if (mine.length === 0) {
          setInboxHistoryMap(new Map());
          return;
        }
        const tasks = await Promise.all(mine.map((m) => contractBus.getInbox(m.taskId)));
        if (cancelled) return;
        const map = new Map<string, CandidateHistoryEntry>();
        for (const t of tasks) {
          if (!t || !Array.isArray(t.candidates)) continue;
          for (const c of t.candidates) {
            const cid = c.candidateId ?? c.reportId;
            if (!cid) continue;
            const versions = Array.isArray(c.reportVersions) ? c.reportVersions : [];
            if (versions.length === 0) continue;
            // 同一个 candidateId 只可能落在一个 task 上（replace-report 只改追加现有 task）；
            // 但万一多个 inbox 各写一遍（比如重复召唤），保留"版本数最多"的那条。
            const prev = map.get(cid);
            if (!prev || versions.length > prev.versions.length) {
              map.set(cid, {
                taskId: t.taskId,
                candidateId: cid,
                activeVersion: c.activeReportVersion ?? 1,
                versions,
              });
            }
          }
        }
        setInboxHistoryMap(map);
      } catch {
        /* dev-only 调试能力，失败静默 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const currentHistory = current ? inboxHistoryMap.get(current.sub.id) : undefined;

  return (
    <header className="bg-white rounded-2xl shadow-soft border border-paper-200 overflow-hidden">
      {/* 第一行：面包屑 + 操作区 */}
      <div className="px-6 py-3 flex items-center justify-between gap-3 border-b border-paper-100 bg-paper-50/40 flex-wrap">
        <nav className="text-xs text-ink-500 inline-flex items-center gap-1.5 min-w-0">
          <Link to="/queries" className="hover:text-amber-dark">
            评测
          </Link>
          <span className="text-ink-300">/</span>
          <span className="font-mono text-amber-dark font-semibold">{code}</span>
        </nav>
        <div className={clsx("flex items-center gap-1.5 flex-wrap", IS_READONLY && "hidden")}>
          <button
            onClick={onAddSource}
            className="text-xs border border-paper-300 rounded-lg px-3 py-1.5 hover:border-amber hover:text-amber-dark transition"
          >
            + 追加对比源
          </button>
          <button
            onClick={onRunEval}
            disabled={cohort.length === 0}
            className={clsx(
              "text-xs rounded-lg px-3 py-1.5 transition",
              cohort.length === 0
                ? "bg-paper-200 text-ink-400 cursor-not-allowed"
                : "bg-ink-900 text-white hover:bg-ink-700"
            )}
            title="把任务写入 inbox，然后到 WorkBuddy 对话框粘贴口令让 LLM 跑评测"
          >
            🤖 召唤评测
          </button>
          <button
            onClick={onDelete}
            className="text-xs text-ink-400 hover:text-clay px-2 py-1.5"
          >
            删除
          </button>
        </div>
      </div>

      {/* 主体 */}
      <div className="px-6 py-5 space-y-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1.5">
            评测 Query
          </div>
          <p className="text-[15px] md:text-base text-ink-900 leading-relaxed whitespace-pre-wrap font-medium">
            {queryText}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-xs">
          {typeName && typeColor && (
            <span
              className="px-2 py-1 rounded font-medium"
              style={{
                background: `${typeColor}15`,
                color: typeColor,
                border: `1px solid ${typeColor}40`,
              }}
            >
              {typeName}
            </span>
          )}
          {domain && (
            <span className="px-2 py-1 bg-paper-100 text-ink-600 rounded">{domain}</span>
          )}
          {reportDate && (
            <span className="text-ink-500 py-1">报告生成 · {formatDate(reportDate)}</span>
          )}
          <span className="text-ink-400 py-1">创建于 {formatDate(createdAt, true)}</span>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1.5 flex items-center gap-2">
            <span>参评 AI · {cohort.length} 个</span>
            <span className="text-ink-300 normal-case tracking-normal">
              （点击胶囊查看原始报告）
            </span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {cohort.length === 0 && (
              <div className="text-xs text-ink-400 italic py-2">暂无报告</div>
            )}
            {cohort.map(({ sub, product }) => {
              const isPrimary = product.id === primaryProductId;
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => setOpenSubId(sub.id)}
                  className={clsx(
                    "shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition",
                    isPrimary
                      ? "bg-amber/10 border-amber/40 text-ink-900 hover:bg-amber/20"
                      : "bg-white border-paper-300 text-ink-700 hover:border-ink-400"
                  )}
                  title={`查看 ${displayProductName(product)} 的原始报告`}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: product.color ?? "#8B8272" }}
                  />
                  <span className="font-medium">{displayProductName(product)}</span>
                  <svg
                    className="w-3 h-3 text-ink-400"
                    viewBox="0 0 12 12"
                    fill="none"
                    aria-hidden="true"
                  >
                    {/* 斜向右上箭头：示意"在独立窗口打开阅读" */}
                    <path
                      d="M4.5 3.5h4v4"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M8.5 3.5L3.5 8.5"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 原始报告阅读弹窗 */}
      <RawReportModal
        open={!!current}
        sub={current?.sub ?? null}
        product={current?.product ?? null}
        displayCode={currentDisplayCode}
        history={currentHistory}
        onClose={() => setOpenSubId(null)}
      />
    </header>
  );
}

// ============================================================
// 原始报告阅读弹窗
// 大面积沉浸式阅读；支持 ESC 关闭、全屏切换、滚动。
// ============================================================

function RawReportModal({
  open,
  sub,
  product,
  displayCode,
  history,
  onClose,
}: {
  open: boolean;
  sub: Submission | null;
  product: AIProduct | null;
  displayCode?: string;
  history?: CandidateHistoryEntry;
  onClose: () => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);

  /**
   * 历史版本选择：
   *  - null：默认视图（读 submission.content = 当前激活版本的镜像）
   *  - number：选中某个历史 / 激活版本；正文直接从 inbox history.versions 同步取
   *
   * 为什么"激活版本"也给一个显式选项？因为当用户切到历史版本再点"回到激活"，
   * 我们要回到稳定的 number 状态（而不是 null），方便展开审计轨 bar 高亮。
   */
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  // 审计轨面板是否展开（仅 history 存在且版本 >1 时有意义）
  const [historyOpen, setHistoryOpen] = useState(false);

  /**
   * 对外版正文懒加载：
   *
   * prod 下 bake 把 submission.content 剥离成独立的 /data/reports/{id}.md
   * （见 scripts/bake-public-data.mjs 的 bakePublicBundle），listSubmissions
   * 返回的 `content` 是空字符串。必须显式调 getReadonlyReportLoader 去拉。
   *
   * dev 下 storage 是 LocalStorageAdapter，loader 为 null，直接用 sub.content。
   *
   * 历史版本走独立路径：直接从 inbox history.versions 同步取 content，
   * 因为 inbox v2 schema 把每版本的 content 都完整保留在内存里，无需懒加载。
   */
  const reportLoader = useMemo(() => getReadonlyReportLoader(), []);
  const [lazyContent, setLazyContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 当前应该渲染的正文：
  //  - selectedVersion 非 null：从 history.versions 里选取（同步即得）
  //  - 否则：走 lazyContent 懒加载路径
  const selectedVersionRecord = useMemo(() => {
    if (selectedVersion == null || !history) return null;
    return history.versions.find((v) => v.version === selectedVersion) ?? null;
  }, [selectedVersion, history]);
  const displayContent = selectedVersionRecord
    ? selectedVersionRecord.content
    : lazyContent;
  const displayLoading = !selectedVersionRecord && loading;

  useEffect(() => {
    // 激活版本路径（selectedVersion == null）才走懒加载
    if (!open || !sub || selectedVersion != null) return;
    // dev 模式：直接用 localStorage 里的完整 content
    if (!reportLoader) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLazyContent(sub.content);
      return;
    }
    // prod 模式：sub.content 为空字符串（bake 剥离），走懒加载
    // 但也兼容种子数据里意外带了 content 的情况
    if (sub.content && sub.content.length > 0) {
      setLazyContent(sub.content);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLazyContent(null);
    reportLoader(sub.id)
      .then((text) => {
        if (!cancelled) setLazyContent(text);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sub, reportLoader, selectedVersion]);

  // ESC 关闭 / 锁滚动
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (fullscreen) setFullscreen(false);
        else onClose();
      } else if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setFullscreen((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, fullscreen, onClose]);

  // 关闭时重置全屏态，避免下次开一进来就是全屏
  // 经典 "props 变化时同步重置内部 UI state" 场景，运行时正确。
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFullscreen(false);
      setLazyContent(null);
      setLoading(false);
      setSelectedVersion(null);
      setHistoryOpen(false);
    }
  }, [open]);

  // sub 变化时重置版本选择（不同 submission 的 history 互不相干）
  useEffect(() => {
    setSelectedVersion(null);
    setHistoryOpen(false);
  }, [sub?.id]);

  const hasHistory = !!history && history.versions.length > 1;

  return (
    <AnimatePresence>
      {open && sub && product && (
        <motion.div
          key="raw-report-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 bg-ink-900/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            key={`raw-report-${sub.id}-${fullscreen ? "fs" : "win"}`}
            initial={{ opacity: 0, scale: 0.98, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.18 }}
            className={clsx(
              "bg-white shadow-2xl border border-paper-200 flex flex-col overflow-hidden",
              fullscreen
                ? "fixed inset-0 w-screen h-screen rounded-none border-0"
                : "relative w-full max-w-5xl h-[min(88vh,900px)] rounded-2xl"
            )}
          >
            {/* 头部 */}
            <div className="shrink-0 flex items-center justify-between gap-3 px-5 md:px-7 py-3.5 border-b border-paper-200 bg-paper-50/60">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: product.color ?? "#8B8272" }}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    {displayCode && (
                      <span
                        className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-dark border border-amber-100 shrink-0"
                        title="报告展示编号"
                      >
                        {displayCode}
                      </span>
                    )}
                    <span className="font-semibold text-ink-900 text-[15px] truncate">
                      {displayProductName(product)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-ink-500 mt-0.5 flex-wrap">
                    <span>{formatDate(sub.submittedAt, true)}</span>
                    <span className="text-ink-300">·</span>
                    <span>
                      {displayLoading
                        ? "加载中…"
                        : displayContent != null
                        ? `${displayContent.length.toLocaleString()} 字符`
                        : "—"}
                    </span>
                    {selectedVersionRecord && (
                      <>
                        <span className="text-ink-300">·</span>
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-dark border border-amber-100 font-mono"
                          title="当前查看的历史版本"
                        >
                          v{selectedVersionRecord.version}
                          {selectedVersionRecord.version === history?.activeVersion && (
                            <span className="text-[10px] text-ink-500">（激活）</span>
                          )}
                        </span>
                      </>
                    )}
                    {sub.sourceUrl && (
                      <>
                        <span className="text-ink-300">·</span>
                        <a
                          href={sub.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-amber-dark hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          原文 ↗
                        </a>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setFullscreen((s) => !s)}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-ink-600 hover:bg-paper-200 transition"
                  title={fullscreen ? "退出全屏（ESC / F）" : "全屏查看（F）"}
                >
                  {fullscreen ? (
                    <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M5.5 1.5v3h-3M8.5 1.5v3h3M5.5 12.5v-3h-3M8.5 12.5v-3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M2 5V2h3M12 5V2H9M2 9v3h3M12 9v3H9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-8 h-8 inline-flex items-center justify-center rounded-full hover:bg-paper-200 text-ink-500 text-lg leading-none"
                  title="关闭（ESC）"
                >
                  ×
                </button>
              </div>
            </div>

            {/* 审计轨：历史版本折叠入口（dev-only；inbox v2 schema 的 reportVersions[]） */}
            {hasHistory && history && (
              <div className="shrink-0 border-b border-paper-200 bg-amber-50/40">
                <button
                  type="button"
                  onClick={() => setHistoryOpen((v) => !v)}
                  className="w-full flex items-center gap-2 px-5 md:px-7 py-2 text-[12px] text-ink-700 hover:bg-amber-50/80 transition"
                  aria-expanded={historyOpen}
                >
                  <svg
                    className={clsx(
                      "w-3 h-3 text-ink-500 transition-transform",
                      historyOpen && "rotate-90"
                    )}
                    viewBox="0 0 12 12"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M4 3l4 3-4 3"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="font-medium">
                    历史版本 · {history.versions.length} 版
                  </span>
                  <span className="text-ink-400">
                    （激活 v{history.activeVersion}；只追加不删，点击查看任意历史版本）
                  </span>
                </button>
                {historyOpen && (
                  <div className="px-5 md:px-7 pb-3 pt-1 space-y-1.5">
                    {/* 版本列表：最新在顶（倒序） */}
                    {[...history.versions]
                      .sort((a, b) => b.version - a.version)
                      .map((v) => {
                        const isSelected =
                          selectedVersion == null
                            ? v.version === history.activeVersion
                            : v.version === selectedVersion;
                        const isActive = v.version === history.activeVersion;
                        return (
                          <div
                            key={v.version}
                            className={clsx(
                              "rounded-lg border px-3 py-2 text-[11.5px] transition",
                              isSelected
                                ? "border-amber-dark bg-white shadow-sm"
                                : "border-paper-200 bg-white/60 hover:border-paper-400"
                            )}
                          >
                            <div className="flex items-start gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedVersion(
                                    selectedVersion === v.version ? null : v.version
                                  )
                                }
                                className={clsx(
                                  "shrink-0 font-mono px-1.5 py-0.5 rounded border",
                                  isActive
                                    ? "bg-amber-50 text-amber-dark border-amber-200"
                                    : "bg-paper-100 text-ink-600 border-paper-300",
                                  "hover:ring-1 hover:ring-amber"
                                )}
                                title={
                                  isSelected
                                    ? "再次点击回到默认视图"
                                    : `切换到 v${v.version} 的正文`
                                }
                              >
                                v{v.version}
                                {isActive && (
                                  <span className="ml-1 text-[10px] text-ink-500">激活</span>
                                )}
                              </button>
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex items-center gap-2 text-ink-500 text-[10.5px] flex-wrap">
                                  {v.replacedAt ? (
                                    <span title="替换进来的时间">
                                      替换于 {formatDate(v.replacedAt, true)}
                                    </span>
                                  ) : (
                                    <span title="初版写入 inbox 的时间">
                                      提交于 {formatDate(v.submittedAt, true)}
                                    </span>
                                  )}
                                  {v.producedAt && (
                                    <>
                                      <span className="text-ink-300">·</span>
                                      <span title="报告生成时间">
                                        报告生成 {formatDate(v.producedAt, true)}
                                      </span>
                                    </>
                                  )}
                                  <span className="text-ink-300">·</span>
                                  <span
                                    className="font-mono text-ink-400"
                                    title="contentHash（sha256 前 16 位）"
                                  >
                                    #{v.contentHash.slice(0, 8)}
                                  </span>
                                  <span className="text-ink-300">·</span>
                                  <span>{v.content.length.toLocaleString()} 字符</span>
                                </div>
                                {v.replacedReason && (
                                  <div className="text-ink-700 text-[11.5px] leading-relaxed">
                                    <span className="text-ink-400 mr-1">替换原因：</span>
                                    {v.replacedReason}
                                  </div>
                                )}
                                {!v.replacedReason && v.version > 1 && (
                                  <div className="text-ink-400 italic text-[11px]">
                                    （未填写替换原因）
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    {selectedVersion != null && (
                      <button
                        type="button"
                        onClick={() => setSelectedVersion(null)}
                        className="text-[11px] text-amber-dark hover:underline px-1 py-0.5"
                      >
                        ← 回到默认视图（激活版本）
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 正文：独立滚动区域，大尺寸沉浸阅读 */}
            <article className="flex-1 overflow-y-auto bg-white">
              <div
                className={clsx(
                  "mx-auto px-5 md:px-10 py-7",
                  fullscreen ? "max-w-4xl" : "max-w-none"
                )}
              >
                {displayLoading ? (
                  <div className="text-sm text-ink-500 py-12 text-center">
                    正在加载报告正文…
                  </div>
                ) : displayContent == null || displayContent.length === 0 ? (
                  <div className="text-sm text-ink-500 py-12 text-center">
                    （报告正文为空或加载失败）
                  </div>
                ) : (
                  <MarkdownView content={displayContent} />
                )}
              </div>
            </article>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ============================================================
// 报告版本选择器（2026-04-20 简化版）
// 纯粹的一维版本列表：v1 / v2 / v3 ... 按 mtime 升序编号；列表倒序展示（vN 最新在顶）。
// 不再暴露 taskId / "第 N 次召唤" 等实现细节给用户。
// ============================================================

function formatRelTime(mtime: number): string {
  const diff = Date.now() - mtime;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(mtime);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

function ReportVersionPicker({
  reports,
  active,
  onPick,
  onDeleteVersion,
}: {
  reports: FlatReport[];
  active: { taskId: string; diskVersion: number } | null;
  onPick: (taskId: string, diskVersion: number) => void;
  onDeleteVersion: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  if (reports.length === 0) return null;

  const current =
    reports.find(
      (r) => active && r.taskId === active.taskId && r.diskVersion === active.diskVersion
    ) ?? reports[0];
  const latestDisplayVersion = Math.max(...reports.map((r) => r.displayVersion));
  const isLatest = current.displayVersion === latestDisplayVersion;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((s) => !s)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-paper-300 bg-white text-xs text-ink-800 hover:bg-paper-50 transition-colors"
        title="切换到该 Query 的其他报告版本"
      >
        <span className="text-ink-400">版本</span>
        <span className="font-mono text-ink-900 font-semibold">v{current.displayVersion}</span>
        {isLatest && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-moss text-white">最新</span>
        )}
        <span className="text-ink-400">·</span>
        <span className="text-ink-500">{formatRelTime(current.mtime)}</span>
        <span className="text-ink-400 ml-0.5">· 共 {reports.length}</span>
        <svg
          className={clsx("w-3 h-3 ml-0.5 transition-transform", open && "rotate-180")}
          viewBox="0 0 12 12"
          fill="none"
        >
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute right-0 mt-1.5 w-[20rem] rounded-lg border border-paper-300 bg-white shadow-xl z-20 overflow-hidden max-h-[70vh] overflow-y-auto"
          >
            <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-ink-400 bg-paper-50 border-b border-paper-200 sticky top-0 z-10">
              报告版本（最新在上）
            </div>
            {reports.map((r) => {
              const isActive =
                !!active &&
                r.taskId === active.taskId &&
                r.diskVersion === active.diskVersion;
              const isLatestRow = r.displayVersion === latestDisplayVersion;
              return (
                <div
                  key={`${r.taskId}@v${r.diskVersion}`}
                  className={clsx(
                    "group flex items-center px-3 py-2 text-xs transition-colors border-b border-paper-100 last:border-b-0",
                    isActive ? "bg-amber/10" : "hover:bg-paper-50"
                  )}
                >
                  <button
                    onClick={() => {
                      onPick(r.taskId, r.diskVersion);
                      setOpen(false);
                    }}
                    className="flex items-center gap-2 flex-1 text-left"
                  >
                    <span
                      className={clsx(
                        "font-mono font-semibold",
                        isActive ? "text-amber-dark" : "text-ink-800"
                      )}
                    >
                      v{r.displayVersion}
                    </span>
                    {isLatestRow && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-moss text-white">
                        最新
                      </span>
                    )}
                    <span className="text-ink-500 ml-auto mr-2">
                      {formatRelTime(r.mtime)}
                    </span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteVersion(r.taskId);
                    }}
                    className={clsx(
                      "opacity-0 group-hover:opacity-100 text-[10px] text-ink-400 hover:text-clay transition-opacity shrink-0",
                      IS_READONLY && "hidden"
                    )}
                    title="删除该版本"
                  >
                    删除
                  </button>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
// 追加对比源 Modal（保留，未变）
// ============================================================

interface AddPayload {
  productId: string;
  version: string;
  reportDate: string;
  content: string;
  sourceUrl: string;
}

function AddSubmissionModal({
  open,
  onClose,
  products,
  existingProductIds,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  products: AIProduct[];
  existingProductIds: string[];
  onCreate: (p: AddPayload) => Promise<void>;
}) {
  const [payload, setPayload] = useState<AddPayload>({
    productId: "",
    version: "",
    reportDate: "",
    content: "",
    sourceUrl: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, submitting, onClose]);

  const reset = () => {
    setPayload({ productId: "", version: "", reportDate: "", content: "", sourceUrl: "" });
    setErr(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!payload.productId) return setErr("请选择 AI 产品");
    if (!payload.content.trim()) return setErr("请填写报告正文");
    setSubmitting(true);
    try {
      await onCreate(payload);
      reset();
      onClose();
    } catch (e) {
      setErr((e as Error).message || "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  const available = products.filter((p) => !existingProductIds.includes(p.id));

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm flex items-start md:items-center justify-center p-4 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget && !submitting) {
              reset();
              onClose();
            }
          }}
        >
          <motion.form
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 12 }}
            transition={{ duration: 0.18 }}
            onSubmit={handleSubmit}
            className="relative bg-white rounded-2xl shadow-2xl border border-paper-200 w-full max-w-2xl my-8 flex flex-col max-h-[calc(100vh-4rem)]"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-paper-200 shrink-0">
              <div>
                <div className="text-lg font-semibold text-ink-900">追加对比源</div>
                <div className="text-xs text-ink-500 mt-0.5">
                  增加一份 AI 报告用于对比；保存后会顺势召唤一次评测
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (submitting) return;
                  reset();
                  onClose();
                }}
                className="w-8 h-8 rounded-full hover:bg-paper-100 text-ink-500 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className="text-sm font-medium text-ink-700">
                  AI 产品 <span className="text-clay">*</span>
                </label>
                <select
                  value={payload.productId}
                  onChange={(e) => setPayload({ ...payload, productId: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-paper-300 rounded-lg bg-paper-50 text-sm"
                >
                  <option value="">-- 选择尚未参评的 AI --</option>
                  {available.map((p) => (
                    <option key={p.id} value={p.id}>
                      {displayProductName(p)}
                    </option>
                  ))}
                </select>
                {available.length === 0 && (
                  <p className="text-xs text-clay mt-1">所有已有 AI 产品都已参评本题</p>
                )}
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-ink-700">版本号</label>
                  <input
                    value={payload.version}
                    onChange={(e) => setPayload({ ...payload, version: e.target.value })}
                    placeholder="例 v4.2（选填）"
                    className="mt-1 w-full px-3 py-2 border border-paper-300 rounded-lg bg-paper-50 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-ink-700">报告生成时间</label>
                  <input
                    type="date"
                    value={payload.reportDate}
                    onChange={(e) => setPayload({ ...payload, reportDate: e.target.value })}
                    className="mt-1 w-full px-3 py-2 border border-paper-300 rounded-lg bg-paper-50 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-ink-700">
                  报告正文 <span className="text-clay">*</span>
                </label>
                <textarea
                  value={payload.content}
                  onChange={(e) => setPayload({ ...payload, content: e.target.value })}
                  rows={8}
                  placeholder="粘贴该 AI 产出的报告正文（Markdown）..."
                  className="mt-1 w-full px-3 py-2 border border-paper-300 rounded-lg bg-paper-50 text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-ink-700">原文链接</label>
                <input
                  value={payload.sourceUrl}
                  onChange={(e) => setPayload({ ...payload, sourceUrl: e.target.value })}
                  placeholder="选填"
                  className="mt-1 w-full px-3 py-2 border border-paper-300 rounded-lg bg-paper-50 text-sm"
                />
              </div>
              {err && (
                <div className="text-sm text-clay bg-clay/10 border border-clay/30 rounded-lg px-3 py-2">
                  {err}
                </div>
              )}
            </div>

            <div className="shrink-0 px-6 py-4 border-t border-paper-200 bg-paper-50/60 flex items-center justify-end gap-2 rounded-b-2xl">
              <button
                type="button"
                onClick={() => {
                  reset();
                  onClose();
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
                {submitting ? "保存中..." : "保存并召唤评测"}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
