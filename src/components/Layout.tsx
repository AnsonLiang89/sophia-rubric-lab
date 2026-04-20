import { Link, NavLink, Outlet } from "react-router-dom";
import clsx from "clsx";
import { useEffect, useState } from "react";
import BusErrorBanner from "./BusErrorBanner";
import { IS_READONLY } from "../lib/dataSource";
import { contractBus, type PublishResult } from "../lib/contract";
import { storage } from "../storage";

/**
 * 对外版（GitHub Pages）线上地址。
 * 管理员版右上角的"对外版"按钮用它在新标签打开；
 * 如果未来仓库改名 / 换域名，改这里一处即可。
 */
const PUBLIC_SITE_URL = "https://ansonliang89.github.io/sophia-rubric-lab/";

export default function Layout() {
  // ------------------------------------------------------------
  // Footer 展示对外版的 bakedAt（让访客知道数据新鲜度）
  // 只在 IS_READONLY 模式下拉，dev 下展示本地进程时间即可
  // ------------------------------------------------------------
  const [bakedAt, setBakedAt] = useState<string | null>(null);
  useEffect(() => {
    if (!IS_READONLY) return;
    (async () => {
      try {
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        const resp = await fetch(`${base}/data/bake-manifest.json?_=${Date.now()}`, {
          cache: "no-store",
        });
        if (!resp.ok) return;
        const j = (await resp.json()) as { bakedAt?: string };
        if (j?.bakedAt) setBakedAt(j.bakedAt);
      } catch {
        /* 取不到不影响使用 */
      }
    })();
  }, []);

  // ------------------------------------------------------------
  // 对外更新：一键发布到 GitHub Pages 对外版。
  // 流程（由 bus /_bus/publish 端点串行完成）：
  //   1. 写 .evaluations/_runtime-snapshot.json（把 localStorage 导出）
  //   2. npm run build:public（dump-seed + bake + tsc + vite build）
  //   3. git add .evaluations/（public/data/ 在 .gitignore 里，CI 会现烤）
  //   4. git commit -m "publish: <iso>"（空改动时跳过）
  //   5. git push origin HEAD → GitHub Actions 自动部署
  // 任一步失败中止，展示日志 modal 让用户看 stderr。
  // 仅 dev 下可用（IS_READONLY=false）。
  // ------------------------------------------------------------
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const handlePublish = async () => {
    if (publishing) return;
    const confirmed = window.confirm(
      "即将执行一键发布到对外版：\n\n" +
        "  1. 导出 localStorage 快照\n" +
        "  2. 烘焙静态数据（build:public）\n" +
        "  3. git add / commit / push → GitHub Actions 自动部署\n\n" +
        "整个过程约 30 秒~2 分钟。继续？"
    );
    if (!confirmed) return;
    setPublishing(true);
    setPublishResult(null);
    setPublishError(null);
    try {
      const snap = await storage.exportAll();
      const resp = await contractBus.publishToPublic({
        version: snap.version ?? 2,
        products: snap.products ?? [],
        queries: snap.queries ?? [],
        submissions: snap.submissions ?? [],
      });
      if (!resp) {
        // HTTP 204 不该发生在这个端点，兜底
        setPublishError("bus 未响应，请检查 dev server 是否正常运行");
      } else {
        // 无论业务成功/失败，后端都返回 200 + ok 字段 + steps
        // 前端统一按 payload.ok 区分展示
        setPublishResult(resp);
      }
    } catch (err) {
      // 走到这里通常是网络层或真 500（bus 坏了），
      // 没有 steps 可展示，只能给用户一个字符串错误
      setPublishError((err as Error).message ?? String(err));
    } finally {
      setPublishing(false);
    }
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    clsx(
      "px-3 py-1.5 rounded-lg text-sm transition-colors",
      isActive
        ? "bg-amber text-white shadow-soft"
        : "text-ink-700 hover:bg-paper-100"
    );

  return (
    <div className="min-h-screen flex flex-col">
      <BusErrorBanner />
      <header className="sticky top-0 z-20 bg-paper-50/90 backdrop-blur-md border-b border-paper-200">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="relative w-9 h-9 rounded-lg bg-gradient-to-br from-amber to-amber-dark flex items-center justify-center shadow-soft">
              <span className="text-white font-serif text-lg font-bold">S</span>
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-moss border-2 border-paper-50" />
            </div>
            <div>
              <div className="font-semibold text-ink-900 leading-tight">
                Sophia's Rubric Lab
                {IS_READONLY && (
                  <span className="ml-1.5 text-[10px] font-normal text-[#8B8272] tracking-wider">
                    · PUBLIC
                  </span>
                )}
              </div>
              <div className="text-[11px] text-ink-500 leading-tight">
                AI 深度研究报告评测台
              </div>
            </div>
          </Link>

          <nav className="flex items-center gap-1 ml-4">
            <NavLink to="/" end className={linkClass}>
              总览
            </NavLink>
            <NavLink to="/queries" className={linkClass}>
              评测
            </NavLink>
            <NavLink to="/standard" className={linkClass}>
              标准
            </NavLink>
            <NavLink to="/contract" className={linkClass}>
              协议
            </NavLink>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {/* 管理员版（dev）独有的操作 */}
            {!IS_READONLY && (
              <>
                <button
                  onClick={() => void handlePublish()}
                  disabled={publishing}
                  className={clsx(
                    "text-xs px-2.5 py-1 rounded-md border transition-colors",
                    publishing
                      ? "text-ink-400 border-paper-200 cursor-wait"
                      : "text-amber-dark border-amber/40 hover:bg-amber/10"
                  )}
                  title="一键发布到对外版：导出快照 → 烘焙 → git push → GitHub Actions 自动部署（约 30 秒~2 分钟）"
                >
                  {publishing ? "发布中…" : "⇪ 对外更新"}
                </button>
                <a
                  href={PUBLIC_SITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-2.5 py-1 rounded-md border border-paper-200 text-ink-500 hover:text-amber-dark hover:border-amber/40 transition-colors"
                  title={`在新标签打开对外版：${PUBLIC_SITE_URL}`}
                >
                  ↗ 对外版
                </a>
              </>
            )}

            {/* 对外版（prod）独有的操作：提供一个回管理员本地的提示链接（仅当开发者也打开该站时方便） */}
            {/* 暂不做，对外访客看不到也不需要 */}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 animate-fade-in">
        <Outlet />
      </main>

      <footer className="border-t border-paper-200 py-6 text-center text-xs text-ink-400 space-y-1">
        <div>
          Sophia's Rubric Lab ·{" "}
          {IS_READONLY
            ? "只读公开版 · 所有评测由 LLM（Claude Opus 扮演 Sophia）按标准打分"
            : "本地管理员版 · 评测产物沉淀到 .evaluations/outbox/"}
        </div>
        {IS_READONLY && bakedAt && (
          <div className="text-ink-400/80">
            数据烘焙于 {new Date(bakedAt).toLocaleString()}
          </div>
        )}
      </footer>

      {/* ==================== 一键发布进度/结果 modal ==================== */}
      {/* publishing 态：只显示"正在发布"提示；
          publishResult 态：按步骤展示日志（成功绿色 / 失败红色 / 跳过灰色）；
          publishError 态：展示底层错误字符串（bus 未响应这种）。
          这三种态互斥，挑其中一种展示。 */}
      {(publishing || publishResult || publishError) && !IS_READONLY && (
        <div className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-paper-50 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-paper-200 flex items-center justify-between">
              <div className="font-semibold text-ink-900 flex items-center gap-2">
                {publishing && (
                  <>
                    <span className="inline-block w-2 h-2 rounded-full bg-amber animate-pulse" />
                    正在发布到对外版…
                  </>
                )}
                {publishResult && publishResult.ok && (
                  <>
                    <span className="text-moss">✓</span> 发布成功
                  </>
                )}
                {publishResult && !publishResult.ok && (
                  <>
                    <span className="text-red-500">✗</span> 发布失败（
                    {publishResult.failedStep}）
                  </>
                )}
                {publishError && (
                  <>
                    <span className="text-red-500">✗</span> 发布失败
                  </>
                )}
              </div>
              {!publishing && (
                <button
                  onClick={() => {
                    setPublishResult(null);
                    setPublishError(null);
                  }}
                  className="text-xs text-ink-500 hover:text-ink-900 px-2 py-1 rounded hover:bg-paper-100"
                >
                  关闭
                </button>
              )}
            </div>

            <div className="flex-1 overflow-auto px-5 py-4 text-sm">
              {publishing && (
                <div className="space-y-2 text-ink-600">
                  <div>
                    正在串行执行：写快照 → npm run build:public → git add /
                    commit / push
                  </div>
                  <div className="text-xs text-ink-400">
                    全程约 30 秒~2 分钟，请耐心等待（浏览器 tab 可以切走）。
                  </div>
                </div>
              )}

              {publishResult && publishResult.ok && (
                <div className="space-y-3">
                  <div className="text-ink-700">
                    已推送到 GitHub，workflow 正在后台部署。
                    约 1~2 分钟后访问{" "}
                    <a
                      href={publishResult.publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amber-dark underline"
                    >
                      对外版 ↗
                    </a>{" "}
                    查看。
                  </div>
                  {publishResult.commitMessage && (
                    <div className="text-xs text-ink-500 font-mono">
                      commit: {publishResult.commitMessage}
                    </div>
                  )}
                </div>
              )}

              {publishError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-900 font-mono text-xs whitespace-pre-wrap break-all">
                  {publishError}
                </div>
              )}

              {publishResult && publishResult.steps && (
                <div className="mt-4 space-y-2">
                  <div className="text-xs font-semibold text-ink-500 uppercase tracking-wider">
                    执行日志
                  </div>
                  {publishResult.steps.map((s, i) => (
                    <details
                      key={i}
                      open={!s.ok}
                      className={clsx(
                        "rounded-lg border text-xs",
                        s.skipped
                          ? "border-paper-200 bg-paper-100/50"
                          : s.ok
                            ? "border-moss/30 bg-moss/5"
                            : "border-red-200 bg-red-50"
                      )}
                    >
                      <summary
                        className={clsx(
                          "cursor-pointer px-3 py-2 flex items-center gap-2 font-medium",
                          s.skipped
                            ? "text-ink-500"
                            : s.ok
                              ? "text-moss"
                              : "text-red-700"
                        )}
                      >
                        <span>
                          {s.skipped ? "–" : s.ok ? "✓" : "✗"}
                        </span>
                        <span>{s.name}</span>
                        {s.note && (
                          <span className="text-ink-400 font-normal">
                            · {s.note}
                          </span>
                        )}
                        {s.code !== null && s.code !== 0 && !s.skipped && (
                          <span className="text-ink-400 font-normal ml-auto">
                            exit {s.code}
                          </span>
                        )}
                      </summary>
                      <div className="px-3 pb-3 font-mono text-ink-700 whitespace-pre-wrap break-all space-y-2">
                        <div className="text-ink-400">$ {s.command}</div>
                        {s.stdout && (
                          <div>
                            <div className="text-[10px] text-ink-400 uppercase tracking-wider">
                              stdout
                            </div>
                            <div>{s.stdout}</div>
                          </div>
                        )}
                        {s.stderr && (
                          <div>
                            <div className="text-[10px] text-ink-400 uppercase tracking-wider">
                              stderr
                            </div>
                            <div>{s.stderr}</div>
                          </div>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
