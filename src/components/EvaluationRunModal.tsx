import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { motion, AnimatePresence } from "framer-motion";
import { buildInboxTask, buildSummonPrompt, contractBus, fillInboxContentHashes } from "../lib/contract";
import type { AIProduct, Query, Submission } from "../types";

/**
 * 评测任务提交 Modal（契约 v1）
 *
 * 新架构下网站只做两件事：
 *   1. 把待评测任务（query + candidates.report）写到 .evaluations/inbox/{taskId}.json
 *   2. 展示一段"召唤口令"，让用户贴到 WorkBuddy 对话框里让 LLM 跑真评测
 *
 * 本 Modal 就是第一步 + 第二步的 UI。
 * 真正的评分、写 outbox 全部发生在对话框里，与本组件无关。
 */

export interface EvaluationTaskSpec {
  query: Query;
  submissions: Submission[];
  products: AIProduct[];
}

type Phase = "idle" | "submitting" | "submitted" | "error";

export default function EvaluationRunModal({
  open,
  spec,
  onClose,
  onFinished,
}: {
  open: boolean;
  spec: EvaluationTaskSpec | null;
  onClose: () => void;
  /** 用户点"完成"或关闭时回调，用于上层刷新列表 */
  onFinished?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /**
   * 以 spec 引用为 key 记录"这个 spec 是否已提交过"。
   *
   * 旧实现（`submittedRef = boolean` + 关闭时重置）的 bug：
   * 用户在 submitting 期间快速关闭会把 ref 清零；若再打开同一个 spec，
   * 会触发第二次 submitInbox（同一 taskId 写两次，或者 nano6 重新生成新
   * taskId 导致磁盘残留孤儿）。用 Set<spec> 代替布尔后，同一 spec 最多
   * 提交一次；切换到新 spec 才会再提交。
   *
   * 注：WeakSet 让 spec 被 GC 后自动清出，不会常驻内存。
   */
  const submittedSpecs = useRef<WeakSet<EvaluationTaskSpec>>(new WeakSet());

  // 打开 Modal 时自动提交 inbox 任务（每个 spec 只提交一次；切换 spec 会重新提交）
  useEffect(() => {
    if (!open || !spec) return;
    if (submittedSpecs.current.has(spec)) return;
    submittedSpecs.current.add(spec);

    (async () => {
      setPhase("submitting");
      setErrorMsg(null);
      try {
        const task = buildInboxTask({
          query: spec.query,
          submissions: spec.submissions,
          products: spec.products,
        });
        // v2 schema 要求 reportVersions[].contentHash 有值（sha256 前 16 位 hex）。
        // buildInboxTask 只占位为 ""，必须在 POST 前异步算好——否则后端虽然当前不强校验，
        // 后续 lint:outbox / migrate 消费端都会报不一致。
        await fillInboxContentHashes(task);
        await contractBus.submitInbox(task);
        setTaskId(task.taskId);
        setPrompt(buildSummonPrompt(task.taskId));
        setPhase("submitted");
      } catch (err) {
        setErrorMsg((err as Error).message || "提交失败");
        setPhase("error");
      }
    })();
  }, [open, spec]);

  // Modal 彻底关闭（open=false）后，reset 本轮展示状态；
  // 但不清 submittedSpecs —— 同一个 spec 再次打开不应该重复提交。
  //
  // 注：这是标准的 "根据 props 变化重置内部 UI 状态" 场景，
  // react-hooks/set-state-in-effect 对此类用法会误报；运行时行为正确。
  // 不改写成 key-reset 是因为该 Modal 还有提交中的异步流程，卸载会打断。
  useEffect(() => {
    if (open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setPhase("idle");
    setTaskId(null);
    setPrompt("");
    setErrorMsg(null);
    setCopied(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  const handleCopy = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  const handleClose = () => {
    onFinished?.();
    onClose();
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
        onClick={handleClose}
      >
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ type: "spring", damping: 22, stiffness: 260 }}
          className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-[#E6DCC8] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-[#E6DCC8] bg-gradient-to-b from-[#FAF6EE] to-white">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs text-[#8B8272] tracking-widest">EVALUATION · SUMMON</div>
                <div className="text-lg font-semibold text-[#3A3326] mt-0.5">
                  召唤 Sophia 评测官
                </div>
                {spec?.query && (
                  <div className="text-xs text-[#6B6250] mt-1 truncate max-w-[420px]">
                    {spec.query.code} · {spec.query.title}
                  </div>
                )}
              </div>
              <button
                onClick={handleClose}
                className="text-[#8B8272] hover:text-[#3A3326] text-sm"
              >
                关闭
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="p-6 space-y-4">
            {phase === "submitting" && (
              <div className="text-sm text-[#6B6250] flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-[#C8941F] animate-pulse" />
                正在把任务写入收件箱...
              </div>
            )}

            {phase === "error" && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                {errorMsg}
              </div>
            )}

            {phase === "submitted" && taskId && (
              <>
                <div className="p-3 rounded-lg bg-[#F3EEDF] border border-[#E6DCC8] text-xs text-[#6B6250] leading-relaxed">
                  任务已写入 <code className="font-mono text-[#3A3326]">.evaluations/inbox/{taskId}.json</code>。
                  <br />
                  下一步：<b>复制下方口令</b>，到 <b>WorkBuddy 对话框</b>粘贴，让 LLM 按契约完成评测。
                  评测产物会落到 <code className="font-mono text-[#3A3326]">.evaluations/outbox/{taskId}/v{'{n}'}.json</code>，
                  回网站点「刷新」即可查看。
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-xs font-medium text-[#3A3326] tracking-wide">召唤口令</div>
                    <button
                      onClick={handleCopy}
                      className={clsx(
                        "text-xs px-3 py-1 rounded-md border transition-colors",
                        copied
                          ? "bg-[#5A7A47] text-white border-[#5A7A47]"
                          : "bg-white text-[#3A3326] border-[#D6CCB5] hover:bg-[#F3EEDF]"
                      )}
                    >
                      {copied ? "已复制 ✓" : "复制"}
                    </button>
                  </div>
                  <pre className="p-3 rounded-lg bg-[#FAF6EE] border border-[#E6DCC8] text-xs text-[#3A3326] whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-auto">
                    {prompt}
                  </pre>
                </div>

                <div className="text-[11px] text-[#8B8272] leading-relaxed">
                  提示：LLM 会自己扫 <code className="font-mono">outbox/{taskId}/</code> 目录决定版本号，
                  多次迭代（v1 → v2 → v3）不会覆盖历史；每次修订后回网站点「刷新」或打开报告页即可看到最新版。
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-[#E6DCC8] bg-[#FAF6EE] flex justify-end gap-2">
            <button
              onClick={handleClose}
              className="px-4 py-1.5 rounded-md text-sm bg-[#3A3326] text-white hover:bg-[#2A2318]"
            >
              知道了
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
