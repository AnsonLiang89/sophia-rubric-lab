// ============================================================
// ManageSourcesModal
//
// "编辑对比源" 一站式管理面板（替代旧的"追加对比源"）。
//
// 设计目标：
//   把原本散在 Hero / RawReportModal 里的"新增 / 查看 / 删除 / 修改正文"
//   四类动作聚合到一个 Modal，减少 ReportPage 用户的操作路径。
//
// 三层交互：
//   顶层 = 对比源列表（产品名 / 版本 / 报告生成时间 / 字符数 / 原文链接 + 三按钮）
//   右侧抽屉 = 编辑元数据 或 替换正文（二选一，非并发）
//   底部 = ➕ 新增 按钮（点开一个与编辑元数据共用的抽屉）
//
// 关键约束：
//   1. **同一 AI 产品在一次评测里只能有 1 份报告**（v3.3 项目约定）。
//      新增面板会把 cohort 里已参评产品从下拉剔除。
//   2. **修改正文 = 追加 inbox reportVersions**（只追加不删，审计轨硬约束）。
//      走 PATCH /_bus/inbox/:taskId；前端并行更新 submission.content 镜像。
//      必填 replacedReason ≥ 6 字，避免无意义的版本噪音。
//   3. **删除 submission 不联动 inbox**。留下的 orphan candidate 由
//      `scripts/cleanup-orphan-inbox.mjs` 定期扫。这是项目约定（MEMORY.md）。
//   4. **新增默认不触发召唤评测**。给用户一个可选的 checkbox。
//   5. **时区无损**：form 里"编辑时间"收 YYYY-MM-DDTHH:mm（本地 datetime-local），
//      落盘时按本地时区构造 Date → toISOString()，避免东八区用户填本地 08:00
//      落到前一天 UTC 的陈年 bug。空值兜底走"现在"（create/replace）或"原记录"
//      （edit-meta），用户默认什么都不用点。
//
// 只读模式（IS_READONLY=true）下，ReportPage 根本不会 render 本组件，
// 因此内部不再做双重守卫。
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import type { AIProduct, Submission } from "../types";
import { displayProductName } from "../lib/sortProducts";
import { formatDate } from "../lib/score";
import { contractBus, computeContentHash, type InboxReportVersion } from "../lib/contract";

// ------------------------------------------------------------
// 用户操作结构化日志
//
// 为什么要打：所有"编辑对比源"入口（新增 / 改元数据 / 删除 / 替换正文）都是
// 纯前端 localStorage 写，没有服务端返回可看。早期用户误以为"点了保存 → 落盘",
// 发生"UI 显示有、inbox 实际没有"的认知断层（典型案例：2026-04-27 晚 v5 事件）。
// 统一 console.info 让用户在 DevTools 一眼看清每次操作的轨迹。
//
// tag 约定：`[sources]` 保持短，stage 用 `begin` / `done` / `fail`，payload 用结构化对象
// （不要 stringify，DevTools 可折叠查看）。
// ------------------------------------------------------------
type LogStage = "begin" | "done" | "fail";
function srcLog(
  action:
    | "create"
    | "update-meta"
    | "delete"
    | "replace-content"
    | "summon-after-create",
  stage: LogStage,
  payload: Record<string, unknown>
): void {
  // 统一前缀方便过滤（DevTools 里搜 `[sources]` 即可看到全部对比源相关操作）
  console.info(`[sources] ${action} ${stage}`, payload);
}

// ------------------------------------------------------------
// 工具：日期互转（YYYY-MM-DDTHH:mm ↔ ISO）
//
// 历史：旧版只收 YYYY-MM-DD，落盘强制用本地 12:00 作为锚点时区无损。
// 2026-04-27 升级为"时分级精度"——用户希望看到具体的小时和分钟，
// datetime-local 控件默认填当前时间，允许微调，不增加必填项。
// ------------------------------------------------------------

/**
 * 两位数补零。
 */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * ISO 字符串 → input[type=datetime-local] 所需的 `YYYY-MM-DDTHH:mm`（本地时区）。
 *
 * 故意读本地时区分量：用户填本地 14:30 应在界面上看到 14:30，不能因为时区偏移显示成
 * 06:30 或 22:30。
 *
 * ⚠️ 此函数只接受合法 ISO（带时分信息）。纯日期字符串 "YYYY-MM-DD" 请走
 *    `dateOnlyStringToNowDatetimeLocal`，否则会被 new Date() 当作 UTC 零点解析，
 *    在东八区下渲染成 08:00（历史 bug，2026-04-27 晚已拆分）。
 */
function isoToLocalDatetimeLocal(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

/**
 * 识别"纯日期"字符串（`YYYY-MM-DD`，不含时分）。
 * Query.reportDate 这类字段就是纯日期，直接 new Date() 会按 UTC 解析。
 */
function isDateOnlyString(s: string | undefined): boolean {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * `YYYY-MM-DDTHH:mm`（本地时区）→ ISO 字符串。
 *
 * 用 `new Date(y, m-1, d, h, mi)` 按本地时区构造，再 toISOString()——等价于
 * 用户看到什么就是什么。避免直接 `new Date("2026-04-20T14:30")` 在某些运行时按
 * UTC 解析导致 8 小时漂移。
 *
 * 空串或非法格式返回 ""，调用方决定兜底策略。
 */
function localDatetimeLocalToIso(v: string): string {
  if (!v) return "";
  // 允许兼容无秒 / 有秒两种形态，只取到分钟
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(v);
  if (!m) return "";
  const [, y, mo, d, h, mi] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), 0, 0);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

/**
 * 取"当前时间"的 datetime-local 形式，用作 create/replace 场景的默认值。
 * 用户默认什么都不填就能保存；想改再点输入框即可。
 */
function nowAsLocalDatetimeLocal(): string {
  return isoToLocalDatetimeLocal(new Date().toISOString());
}

// ------------------------------------------------------------
// 列表项类型
// ------------------------------------------------------------

export interface CohortRow {
  sub: Submission;
  product: AIProduct;
}

/**
 * 可选：外部传入的 inbox history map，用于"替换正文"定位 taskId + 当前哈希。
 *
 * key = submission.id（= candidateId）
 * value.taskId：该 candidate 在 inbox 里所在的 task
 * value.activeHash：当前激活版本的 contentHash（用于前端拦截"没变也替换"）
 */
export interface SubmissionInboxInfo {
  taskId: string;
  activeVersion: number;
  versions: InboxReportVersion[];
}

// ------------------------------------------------------------
// 三种抽屉模式
// ------------------------------------------------------------

type DrawerMode =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit-meta"; row: CohortRow }
  | { kind: "replace-content"; row: CohortRow };

// ------------------------------------------------------------
// Form payload：新增 / 元数据编辑
// ------------------------------------------------------------

interface MetaFormState {
  productId: string;       // create 时可选；edit-meta 时锁定
  productVersion: string;
  /** datetime-local 格式：YYYY-MM-DDTHH:mm（本地时区） */
  reportDate: string;
  sourceUrl: string;
  content: string;         // 仅 create 时用
  andSummon: boolean;      // 仅 create 时用；默认 false
}

interface ReplaceFormState {
  content: string;
  /** datetime-local 格式：YYYY-MM-DDTHH:mm（本地时区），可选；空则沿用旧 producedAt */
  reportDate: string;
  replacedReason: string;  // 必填 ≥ 6 字
}

// ============================================================
// 主组件
// ============================================================

interface ManageSourcesModalProps {
  open: boolean;
  onClose: () => void;
  rows: CohortRow[];
  allProducts: AIProduct[];
  /** 当前 query 的默认报告日期（新增时填入初值） */
  defaultReportDate?: string;
  /** inbox 历史 map（key=sub.id）；没有对应 entry 说明该 submission 还没被召唤过 */
  inboxInfo: Map<string, SubmissionInboxInfo>;
  /**
   * 新增一条 submission；父层负责调 store.createSubmission。
   * 返回新建的 Submission，用于"新增后召唤"场景里拼完整 cohort。
   */
  onCreate: (input: {
    productId: string;
    productVersion?: string;
    submittedAt: string; // ISO
    content: string;
    sourceUrl?: string;
  }) => Promise<Submission>;
  /**
   * 编辑元数据（不涉及 content/inbox）；父层调 store.updateSubmission。
   */
  onUpdateMeta: (input: {
    sub: Submission;
    productVersion?: string;
    submittedAt: string; // ISO
    sourceUrl?: string;
  }) => Promise<void>;
  /**
   * 删除；父层调 store.deleteSubmission。
   * 不联动 inbox（选项 A）。
   */
  onDelete: (sub: Submission) => Promise<void>;
  /**
   * 替换正文。父层只需：同步 submission.content/submittedAt（localStorage 镜像）。
   * inbox PATCH 由本组件内部直接通过 contractBus 发起。
   */
  onReplaceContentLocal: (input: {
    sub: Submission;
    content: string;
    submittedAt: string;
  }) => Promise<void>;
  /** 新增后若用户勾选了"立即召唤"，父层把新 submission + 现有 cohort 一起拉起 evalTask */
  onSummonAfterCreate: (newSub: Submission) => void;
  /** 替换/新增/删除完毕后父层要重拉 outbox/inbox；用一次统一回调触发 refreshTick */
  onMutated?: () => void;
}

export default function ManageSourcesModal({
  open,
  onClose,
  rows,
  allProducts,
  defaultReportDate,
  inboxInfo,
  onCreate,
  onUpdateMeta,
  onDelete,
  onReplaceContentLocal,
  onSummonAfterCreate,
  onMutated,
}: ManageSourcesModalProps) {
  const [drawer, setDrawer] = useState<DrawerMode>({ kind: "closed" });
  const [globalErr, setGlobalErr] = useState<string | null>(null);

  // ESC / 锁滚动
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 优先关抽屉；抽屉关闭时才关 Modal
      if (drawer.kind !== "closed") {
        setDrawer({ kind: "closed" });
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, drawer.kind, onClose]);

  // 关 Modal 时重置抽屉
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDrawer({ kind: "closed" });
      setGlobalErr(null);
    }
  }, [open]);

  const existingProductIds = useMemo(
    () => new Set(rows.map((r) => r.product.id)),
    [rows]
  );
  const availableProducts = useMemo(
    () => allProducts.filter((p) => !existingProductIds.has(p.id)),
    [allProducts, existingProductIds]
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="manage-sources-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-40 bg-ink-900/50 backdrop-blur-sm flex items-start md:items-center justify-center p-4 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget && drawer.kind === "closed") onClose();
          }}
        >
          <motion.div
            key="manage-sources-panel"
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 12 }}
            transition={{ duration: 0.18 }}
            className="relative bg-white rounded-2xl shadow-2xl border border-paper-200 w-full max-w-3xl my-8 flex flex-col max-h-[calc(100vh-4rem)]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-paper-200 shrink-0">
              <div className="min-w-0">
                <div className="text-lg font-semibold text-ink-900">编辑对比源</div>
                <div className="text-xs text-ink-500 mt-0.5 leading-relaxed">
                  登记参评 AI 的原始报告；同一 AI 产品每次评测只保留一份。
                  <br />
                  <span className="text-ink-400">
                    ⓘ 这里的新增/修改只写入<b>本地对比源池</b>，需要点右上方
                    <b>「🤖 召唤评测」</b>才会真正提交到评测系统（inbox）。
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-full hover:bg-paper-100 text-ink-500 text-xl leading-none shrink-0"
                title="关闭（ESC）"
              >
                ×
              </button>
            </div>

            {/* 列表 + 新增按钮 */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {globalErr && (
                <div className="text-sm text-clay bg-clay/10 border border-clay/30 rounded-lg px-3 py-2">
                  {globalErr}
                </div>
              )}

              {rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-paper-300 bg-paper-50/60 px-4 py-8 text-center">
                  <div className="text-sm text-ink-500 mb-1">还没有任何对比源</div>
                  <div className="text-xs text-ink-400">
                    点下方「➕ 新增对比源」添加第一份参评报告
                  </div>
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {rows.map((row) => (
                    <SourceRow
                      key={row.sub.id}
                      row={row}
                      inbox={inboxInfo.get(row.sub.id)}
                      onEditMeta={() => setDrawer({ kind: "edit-meta", row })}
                      onReplaceContent={() =>
                        setDrawer({ kind: "replace-content", row })
                      }
                      onDelete={async () => {
                        if (
                          !confirm(
                            `确定删除「${displayProductName(row.product)}」这份对比源吗？\n\n` +
                              `· 会从本评测中彻底移除该份报告\n` +
                              `· inbox 审计轨不联动（若该 AI 已被召唤评测过，历史版本保留为孤儿，待 cleanup 脚本定期清理）\n` +
                              `· 产品本身（v4/v5/...）不会被删除`
                          )
                        ) {
                          return;
                        }
                        srcLog("delete", "begin", {
                          submissionId: row.sub.id,
                          productId: row.sub.productId,
                          productName: row.product.name,
                        });
                        try {
                          await onDelete(row.sub);
                          srcLog("delete", "done", {
                            submissionId: row.sub.id,
                            hint: "仅本地镜像被删；inbox 若已存在同 candidate 留为 orphan",
                          });
                          onMutated?.();
                        } catch (err) {
                          srcLog("delete", "fail", {
                            submissionId: row.sub.id,
                            error: (err as Error).message,
                          });
                          setGlobalErr(
                            `删除失败：${(err as Error).message || "未知错误"}`
                          );
                        }
                      }}
                    />
                  ))}
                </ul>
              )}

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setDrawer({ kind: "create" })}
                  disabled={availableProducts.length === 0}
                  className={clsx(
                    "w-full border border-dashed rounded-xl px-4 py-3 text-sm transition inline-flex items-center justify-center gap-2",
                    availableProducts.length === 0
                      ? "border-paper-200 text-ink-400 cursor-not-allowed"
                      : "border-paper-300 text-ink-700 hover:border-amber hover:text-amber-dark hover:bg-amber-50/40"
                  )}
                  title={
                    availableProducts.length === 0
                      ? "所有已登记的 AI 产品都已参评本题"
                      : "追加一份新的参评 AI 报告"
                  }
                >
                  <span className="text-lg leading-none">＋</span>
                  <span>
                    {availableProducts.length === 0
                      ? "所有 AI 产品都已参评（到「评测对象」页登记新产品）"
                      : "新增对比源"}
                  </span>
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="shrink-0 px-6 py-3 border-t border-paper-200 bg-paper-50/60 flex items-center justify-between gap-2 rounded-b-2xl text-xs text-ink-500">
              <span>
                共 {rows.length} 份 · 可登记产品总数 {allProducts.length}
              </span>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg text-ink-700 hover:bg-paper-100"
              >
                完成
              </button>
            </div>

            {/* 右侧抽屉（新增 / 编辑元数据 / 替换正文） */}
            <AnimatePresence>
              {drawer.kind !== "closed" && (
                <motion.div
                  key={`drawer-${drawer.kind}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-ink-900/30 flex justify-end rounded-2xl overflow-hidden"
                  onClick={(e) => {
                    if (e.target === e.currentTarget) setDrawer({ kind: "closed" });
                  }}
                >
                  <motion.div
                    initial={{ x: 40, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: 40, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="w-full max-w-xl bg-white h-full flex flex-col shadow-2xl"
                  >
                    {drawer.kind === "create" && (
                      <CreateForm
                        availableProducts={availableProducts}
                        defaultReportDate={defaultReportDate}
                        onCancel={() => setDrawer({ kind: "closed" })}
                        onSubmit={async (form) => {
                          // 默认就已经填了"现在"；这里 fallback 只为防御用户手动清空
                          const iso =
                            localDatetimeLocalToIso(form.reportDate) ||
                            new Date().toISOString();
                          srcLog("create", "begin", {
                            productId: form.productId,
                            productVersion: form.productVersion || null,
                            submittedAt: iso,
                            contentLen: form.content.length,
                            andSummon: form.andSummon,
                          });
                          try {
                            const newSub = await onCreate({
                              productId: form.productId,
                              productVersion: form.productVersion || undefined,
                              submittedAt: iso,
                              content: form.content,
                              sourceUrl: form.sourceUrl || undefined,
                            });
                            srcLog("create", "done", {
                              submissionId: newSub.id,
                              productId: newSub.productId,
                              willSummon: form.andSummon,
                              hint: "仅写入 localStorage；inbox 只有在召唤评测时才会同步",
                            });
                            setDrawer({ kind: "closed" });
                            onMutated?.();
                            if (form.andSummon) {
                              srcLog("summon-after-create", "begin", {
                                submissionId: newSub.id,
                              });
                              onSummonAfterCreate(newSub);
                            }
                          } catch (err) {
                            srcLog("create", "fail", {
                              error: (err as Error).message,
                            });
                            throw err;
                          }
                        }}
                      />
                    )}
                    {drawer.kind === "edit-meta" && (
                      <EditMetaForm
                        row={drawer.row}
                        onCancel={() => setDrawer({ kind: "closed" })}
                        onSubmit={async (form) => {
                          const iso =
                            localDatetimeLocalToIso(form.reportDate) ||
                            drawer.row.sub.submittedAt;
                          srcLog("update-meta", "begin", {
                            submissionId: drawer.row.sub.id,
                            productId: drawer.row.sub.productId,
                            productVersion: form.productVersion || null,
                            submittedAt: iso,
                            sourceUrl: form.sourceUrl || null,
                          });
                          try {
                            await onUpdateMeta({
                              sub: drawer.row.sub,
                              productVersion: form.productVersion || undefined,
                              submittedAt: iso,
                              sourceUrl: form.sourceUrl || undefined,
                            });
                            srcLog("update-meta", "done", {
                              submissionId: drawer.row.sub.id,
                            });
                            setDrawer({ kind: "closed" });
                            onMutated?.();
                          } catch (err) {
                            srcLog("update-meta", "fail", {
                              submissionId: drawer.row.sub.id,
                              error: (err as Error).message,
                            });
                            throw err;
                          }
                        }}
                      />
                    )}
                    {drawer.kind === "replace-content" && (
                      <ReplaceContentForm
                        row={drawer.row}
                        inbox={inboxInfo.get(drawer.row.sub.id)}
                        onCancel={() => setDrawer({ kind: "closed" })}
                        onSubmit={async (form) => {
                          // 编辑时间：以用户填写为准；空则沿用原有
                          const producedIso =
                            localDatetimeLocalToIso(form.reportDate) ||
                            drawer.row.sub.submittedAt;
                          const info = inboxInfo.get(drawer.row.sub.id);
                          srcLog("replace-content", "begin", {
                            submissionId: drawer.row.sub.id,
                            contentLen: form.content.length,
                            reasonLen: form.replacedReason.length,
                            producedAt: producedIso,
                            willPatchInbox: !!info,
                            inboxTaskId: info?.taskId ?? null,
                            inboxActiveVersion: info?.activeVersion ?? null,
                          });
                          try {
                            // 先同步 localStorage 镜像（即使 inbox PATCH 失败也先保住前端视图一致）
                            await onReplaceContentLocal({
                              sub: drawer.row.sub,
                              content: form.content,
                              submittedAt: producedIso,
                            });

                            // 再 PATCH inbox（如果这个 submission 被召唤过）
                            let newInboxVersion: number | null = null;
                            if (info) {
                              const hash = await computeContentHash(form.content);
                              const resp = await contractBus.replaceInboxCandidateReport(
                                info.taskId,
                                {
                                  candidateId: drawer.row.sub.id,
                                  content: form.content,
                                  contentHash: hash,
                                  producedAt: producedIso,
                                  replacedReason: form.replacedReason,
                                  sourceUrl: drawer.row.sub.sourceUrl,
                                  productVersion: drawer.row.sub.productVersion,
                                }
                              );
                              newInboxVersion =
                                (resp &&
                                  typeof resp.activeReportVersion === "number" &&
                                  resp.activeReportVersion) ||
                                null;
                            }
                            srcLog("replace-content", "done", {
                              submissionId: drawer.row.sub.id,
                              newInboxVersion,
                              hint: info
                                ? "已同步到 inbox 审计轨"
                                : "该 submission 未被召唤过，只改了本地镜像",
                            });
                            setDrawer({ kind: "closed" });
                            onMutated?.();
                          } catch (err) {
                            srcLog("replace-content", "fail", {
                              submissionId: drawer.row.sub.id,
                              error: (err as Error).message,
                            });
                            throw err;
                          }
                        }}
                      />
                    )}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ============================================================
// 单行：对比源卡片
// ============================================================

function SourceRow({
  row,
  inbox,
  onEditMeta,
  onReplaceContent,
  onDelete,
}: {
  row: CohortRow;
  inbox?: SubmissionInboxInfo;
  onEditMeta: () => void;
  onReplaceContent: () => void;
  onDelete: () => void;
}) {
  const { sub, product } = row;
  const chars = sub.content?.length ?? 0;
  const hasHistory = !!inbox && inbox.versions.length > 1;

  return (
    <li className="rounded-xl border border-paper-200 bg-white hover:border-paper-300 transition">
      <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ background: product.color ?? "#8B8272" }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-ink-900 text-sm truncate">
              {displayProductName(product)}
            </span>
            {sub.productVersion && sub.productVersion !== product.version && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-paper-100 text-ink-600 border border-paper-200 font-mono"
                title="此份报告保留的版本号快照（与产品当前版本不同）"
              >
                {sub.productVersion}
              </span>
            )}
            {hasHistory && inbox && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-dark border border-amber-100"
                title={`审计轨：共 ${inbox.versions.length} 版（激活 v${inbox.activeVersion}）`}
              >
                审计轨 {inbox.versions.length} 版
              </span>
            )}
          </div>
          <div className="mt-1 text-[11.5px] text-ink-500 flex items-center gap-2 flex-wrap">
            <span title="对比源最近一次编辑时间">
              编辑于 {formatDate(sub.submittedAt, true)}
            </span>
            <span className="text-ink-300">·</span>
            <span>{chars.toLocaleString()} 字符</span>
            {sub.sourceUrl && (
              <>
                <span className="text-ink-300">·</span>
                <a
                  href={sub.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-amber-dark hover:underline truncate max-w-[16rem]"
                  onClick={(e) => e.stopPropagation()}
                  title={sub.sourceUrl}
                >
                  原文 ↗
                </a>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onEditMeta}
            className="text-[11.5px] px-2.5 py-1.5 rounded-lg border border-paper-300 bg-white text-ink-700 hover:border-amber hover:text-amber-dark transition"
            title="修改产品版本号 / 报告生成时间 / 原文链接"
          >
            ✏️ 编辑
          </button>
          <button
            type="button"
            onClick={onReplaceContent}
            className="text-[11.5px] px-2.5 py-1.5 rounded-lg border border-paper-300 bg-white text-ink-700 hover:border-amber hover:text-amber-dark transition"
            title={
              inbox
                ? "替换报告正文；会追加一个新的 inbox reportVersions（审计轨保留旧版）"
                : "替换报告正文"
            }
          >
            🔁 替换正文
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="text-[11.5px] px-2 py-1.5 rounded-lg text-ink-500 hover:text-clay hover:bg-clay/5 transition"
            title="删除此份对比源"
          >
            🗑️
          </button>
        </div>
      </div>
    </li>
  );
}

// ============================================================
// Drawer Form · 新增
// ============================================================

function CreateForm({
  availableProducts,
  defaultReportDate,
  onCancel,
  onSubmit,
}: {
  availableProducts: AIProduct[];
  defaultReportDate?: string;
  onCancel: () => void;
  onSubmit: (form: MetaFormState) => Promise<void>;
}) {
  const [form, setForm] = useState<MetaFormState>({
    productId: "",
    productVersion: "",
    // 默认填"现在"。新增的是一份刚粘进来的报告，编辑时间就是此刻。
    //
    // 历史坑（2026-04-27 晚修）：这里原本会优先用 defaultReportDate（= query.reportDate），
    // 但 query.reportDate 是 "YYYY-MM-DD" 纯日期串，new Date() 按 UTC 零点解析，
    // 东八区渲染成 08:00 —— 于是所有新增对比源时间默认跳成 08:00，与用户预期不符。
    // 修正：纯日期串不再覆盖当前时间；只有带时分的完整 ISO 才作为默认值。
    reportDate:
      defaultReportDate && !isDateOnlyString(defaultReportDate)
        ? isoToLocalDatetimeLocal(defaultReportDate) || nowAsLocalDatetimeLocal()
        : nowAsLocalDatetimeLocal(),
    sourceUrl: "",
    content: "",
    andSummon: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = !!form.productId && form.content.trim().length > 0 && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!form.productId) {
      setErr("请选择 AI 产品");
      return;
    }
    if (!form.content.trim()) {
      setErr("请粘贴报告正文");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(form);
    } catch (e) {
      setErr((e as Error).message || "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full">
      <DrawerHeader
        title="新增对比源"
        subtitle="仅登记到本地对比源池；如需参评需勾选底部「保存后立即召唤」，或稍后回主页面点「🤖 召唤评测」"
        onClose={onCancel}
      />
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
        <Field label="AI 产品" required>
          <select
            value={form.productId}
            onChange={(e) => setForm({ ...form, productId: e.target.value })}
            className="w-full px-3 py-2 border border-paper-300 rounded-lg bg-paper-50 text-sm"
          >
            <option value="">-- 选择尚未参评的 AI --</option>
            {availableProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {displayProductName(p)}
              </option>
            ))}
          </select>
          {availableProducts.length === 0 && (
            <p className="text-xs text-clay mt-1">
              所有已登记的 AI 产品都已参评本题。
              <br />
              如需加入新版本（例如 Sophia v6），先到「评测对象」页面登记，再回到这里新增。
            </p>
          )}
        </Field>
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="版本号快照">
            <input
              value={form.productVersion}
              onChange={(e) => setForm({ ...form, productVersion: e.target.value })}
              placeholder="通常留空，自动继承产品版本"
              className="w-full px-3 py-2 border border-paper-300 rounded-lg bg-paper-50 text-sm"
            />
          </Field>
          <Field label="编辑时间" hint="默认填入当前时间，可按需修改">
            <input
              type="datetime-local"
              value={form.reportDate}
              onChange={(e) => setForm({ ...form, reportDate: e.target.value })}
              className="w-full px-3 py-2 border border-paper-300 rounded-lg bg-paper-50 text-sm"
            />
          </Field>
        </div>
        <Field label="报告正文" required>
          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            rows={10}
            placeholder="粘贴 AI 产出的报告正文（Markdown）..."
            className="w-full px-3 py-2 border border-paper-300 rounded-lg bg-paper-50 text-sm font-mono leading-relaxed"
          />
          <p className="text-[11px] text-ink-400 mt-1">
            当前 {form.content.length.toLocaleString()} 字符
          </p>
        </Field>
        <Field label="原文链接" hint="选填，方便后续回查">
          <input
            value={form.sourceUrl}
            onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
            placeholder="https://..."
            className="w-full px-3 py-2 border border-paper-300 rounded-lg bg-paper-50 text-sm"
          />
        </Field>
        {err && (
          <div className="text-sm text-clay bg-clay/10 border border-clay/30 rounded-lg px-3 py-2">
            {err}
          </div>
        )}
      </div>
      <DrawerFooter
        leftSlot={
          <label className="inline-flex items-center gap-2 text-[12px] text-ink-600 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={form.andSummon}
              onChange={(e) => setForm({ ...form, andSummon: e.target.checked })}
              className="w-3.5 h-3.5 accent-amber-dark"
            />
            <span>保存后立即召唤评测（若不勾选，本次只是登记）</span>
          </label>
        }
        onCancel={onCancel}
        submitLabel={submitting ? "保存中…" : form.andSummon ? "保存并召唤" : "保存"}
        submitDisabled={!canSubmit}
      />
    </form>
  );
}

// ============================================================
// Drawer Form · 编辑元数据
// ============================================================

function EditMetaForm({
  row,
  onCancel,
  onSubmit,
}: {
  row: CohortRow;
  onCancel: () => void;
  onSubmit: (form: MetaFormState) => Promise<void>;
}) {
  const [form, setForm] = useState<MetaFormState>({
    productId: row.sub.productId,
    productVersion: row.sub.productVersion ?? "",
    // 已有 submission：把既有时间回填到 datetime-local。
    // 若记录异常（极旧种子数据只有 YYYY-MM-DD），兜底到"现在"。
    reportDate:
      isoToLocalDatetimeLocal(row.sub.submittedAt) || nowAsLocalDatetimeLocal(),
    sourceUrl: row.sub.sourceUrl ?? "",
    content: "",
    andSummon: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      await onSubmit(form);
    } catch (e) {
      setErr((e as Error).message || "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full">
      <DrawerHeader
        title={`编辑「${displayProductName(row.product)}」元数据`}
        subtitle="只修改标注信息，不动报告正文"
        onClose={onCancel}
      />
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
        <div className="rounded-lg bg-paper-50 border border-paper-200 px-3 py-2 text-[11.5px] text-ink-600">
          <div className="text-[10px] uppercase tracking-wider text-ink-400 mb-0.5">
            AI 产品（不可改）
          </div>
          <div className="font-medium text-ink-900">{displayProductName(row.product)}</div>
          <div className="text-[11px] text-ink-500 mt-0.5">
            若要换产品，请删除本条后新建
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="版本号快照" hint="覆盖产品默认版本，多版本混排场景用">
            <input
              value={form.productVersion}
              onChange={(e) => setForm({ ...form, productVersion: e.target.value })}
              placeholder={row.product.version ?? "（未填）"}
              className="w-full px-3 py-2 border border-paper-300 rounded-lg bg-paper-50 text-sm"
            />
          </Field>
          <Field label="编辑时间">
            <input
              type="datetime-local"
              value={form.reportDate}
              onChange={(e) => setForm({ ...form, reportDate: e.target.value })}
              className="w-full px-3 py-2 border border-paper-300 rounded-lg bg-paper-50 text-sm"
            />
          </Field>
        </div>
        <Field label="原文链接">
          <input
            value={form.sourceUrl}
            onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
            placeholder="https://..."
            className="w-full px-3 py-2 border border-paper-300 rounded-lg bg-paper-50 text-sm"
          />
        </Field>
        <div className="rounded-lg bg-amber-50/70 border border-amber-100 px-3 py-2 text-[11.5px] text-ink-700 leading-relaxed">
          <div className="font-medium text-ink-900 mb-0.5">💡 只改元数据</div>
          本表单不会改动正文与 inbox 审计轨。如需修正错字/漏段等正文问题，请在列表里点「🔁 替换正文」。
        </div>
        {err && (
          <div className="text-sm text-clay bg-clay/10 border border-clay/30 rounded-lg px-3 py-2">
            {err}
          </div>
        )}
      </div>
      <DrawerFooter
        onCancel={onCancel}
        submitLabel={submitting ? "保存中…" : "保存修改"}
        submitDisabled={submitting}
      />
    </form>
  );
}

// ============================================================
// Drawer Form · 替换正文
// ============================================================

function ReplaceContentForm({
  row,
  inbox,
  onCancel,
  onSubmit,
}: {
  row: CohortRow;
  inbox?: SubmissionInboxInfo;
  onCancel: () => void;
  onSubmit: (form: ReplaceFormState) => Promise<void>;
}) {
  const [form, setForm] = useState<ReplaceFormState>({
    content: row.sub.content ?? "",
    // 替换正文 = 新一轮编辑，默认填"现在"；用户想保留原时间可手动改
    reportDate: nowAsLocalDatetimeLocal(),
    replacedReason: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hashWarn, setHashWarn] = useState<string | null>(null);

  const reasonTrimmed = form.replacedReason.trim();
  const reasonOk = reasonTrimmed.length >= 6;
  const contentChanged = form.content !== (row.sub.content ?? "");
  const activeHash = inbox?.versions.find((v) => v.version === inbox.activeVersion)
    ?.contentHash;

  // 实时判断：用户粘贴的正文是否与当前激活版本完全一致
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!activeHash) {
        setHashWarn(null);
        return;
      }
      if (!form.content) {
        setHashWarn(null);
        return;
      }
      const h = await computeContentHash(form.content);
      if (cancelled) return;
      if (h === activeHash) {
        setHashWarn("正文与当前激活版本完全相同，替换会被服务端拒绝（409）。");
      } else {
        setHashWarn(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form.content, activeHash]);

  const canSubmit =
    !submitting &&
    form.content.trim().length > 0 &&
    reasonOk &&
    contentChanged &&
    !hashWarn;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!form.content.trim()) return setErr("正文不能为空");
    if (!reasonOk) return setErr("替换原因至少写 6 个字");
    if (!contentChanged) return setErr("正文没有变化，无需替换");
    setSubmitting(true);
    try {
      await onSubmit({ ...form, replacedReason: reasonTrimmed });
    } catch (e) {
      setErr((e as Error).message || "替换失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full">
      <DrawerHeader
        title={`替换「${displayProductName(row.product)}」正文`}
        subtitle={
          inbox
            ? `会追加一个新版本到 inbox 审计轨（当前激活 v${inbox.activeVersion}，共 ${inbox.versions.length} 版）`
            : "该 AI 尚未被召唤评测，只改本地存储"
        }
        onClose={onCancel}
      />
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
        <Field label="编辑时间" hint="默认填入当前时间，可按需修改为这份报告实际的完成时间">
          <input
            type="datetime-local"
            value={form.reportDate}
            onChange={(e) => setForm({ ...form, reportDate: e.target.value })}
            className="w-full px-3 py-2 border border-paper-300 rounded-lg bg-paper-50 text-sm"
          />
        </Field>
        <Field
          label="替换原因"
          required
          hint="会作为审计轨的 replacedReason 永久保留；请写清楚动机（≥ 6 字）"
        >
          <textarea
            value={form.replacedReason}
            onChange={(e) => setForm({ ...form, replacedReason: e.target.value })}
            rows={2}
            placeholder="例：上次粘错了草稿版本；AI 在 4/25 重新跑了一遍..."
            className="w-full px-3 py-2 border border-paper-300 rounded-lg bg-paper-50 text-sm"
          />
          <p
            className={clsx(
              "text-[11px] mt-1",
              reasonTrimmed.length > 0 && !reasonOk ? "text-clay" : "text-ink-400"
            )}
          >
            已输入 {reasonTrimmed.length} 字 / 至少 6 字
          </p>
        </Field>
        <Field label="新正文" required>
          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            rows={14}
            className="w-full px-3 py-2 border border-paper-300 rounded-lg bg-paper-50 text-sm font-mono leading-relaxed"
          />
          <div className="flex items-center justify-between mt-1">
            <p className="text-[11px] text-ink-400">
              当前 {form.content.length.toLocaleString()} 字符 ·{" "}
              {contentChanged ? (
                <span className="text-moss">已修改</span>
              ) : (
                <span>未修改</span>
              )}
            </p>
          </div>
        </Field>
        {hashWarn && (
          <div className="text-sm text-clay bg-clay/10 border border-clay/30 rounded-lg px-3 py-2">
            {hashWarn}
          </div>
        )}
        {err && (
          <div className="text-sm text-clay bg-clay/10 border border-clay/30 rounded-lg px-3 py-2">
            {err}
          </div>
        )}
      </div>
      <DrawerFooter
        onCancel={onCancel}
        submitLabel={submitting ? "替换中…" : "确认替换正文"}
        submitDisabled={!canSubmit}
      />
    </form>
  );
}

// ============================================================
// 抽屉通用：Header / Footer / Field
// ============================================================

function DrawerHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-paper-200 bg-paper-50/60">
      <div className="min-w-0">
        <div className="font-semibold text-ink-900 text-[15px] truncate">{title}</div>
        {subtitle && (
          <div className="text-[11.5px] text-ink-500 mt-0.5">{subtitle}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="w-8 h-8 rounded-full hover:bg-paper-100 text-ink-500 text-xl leading-none shrink-0"
        title="关闭抽屉（ESC）"
      >
        ×
      </button>
    </div>
  );
}

function DrawerFooter({
  leftSlot,
  onCancel,
  submitLabel,
  submitDisabled,
}: {
  leftSlot?: React.ReactNode;
  onCancel: () => void;
  submitLabel: string;
  submitDisabled: boolean;
}) {
  return (
    <div className="shrink-0 px-5 py-3 border-t border-paper-200 bg-paper-50/60 flex items-center justify-between gap-2">
      <div className="min-w-0">{leftSlot}</div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-ink-700 hover:bg-paper-100 text-sm"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={submitDisabled}
          className={clsx(
            "px-5 py-2 rounded-lg font-medium text-sm transition shadow-soft",
            submitDisabled
              ? "bg-paper-200 text-ink-400 cursor-not-allowed"
              : "bg-amber text-white hover:bg-amber-dark"
          )}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-ink-700 flex items-center gap-1.5">
        <span>{label}</span>
        {required && <span className="text-clay">*</span>}
      </label>
      {hint && <p className="text-[11px] text-ink-400 mt-0.5 mb-1">{hint}</p>}
      <div className="mt-1">{children}</div>
    </div>
  );
}
