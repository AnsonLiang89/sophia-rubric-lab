import { Link, NavLink, Outlet } from "react-router-dom";
import clsx from "clsx";
import { useEffect, useState } from "react";
import BusErrorBanner from "./BusErrorBanner";
import { IS_READONLY } from "../lib/dataSource";
import { contractBus } from "../lib/contract";
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
  // 对外更新：等价于原"快照"按钮，把本地 localStorage 导出到
  // `.evaluations/_runtime-snapshot.json`，供下一次 bake/CI 使用。
  // 真正的"推到公网"需要 `git commit && git push`（CI 会自动 bake+deploy），
  // 这里只做"导出快照"——这是发布前的必经一步。
  // 仅 dev 下可用（IS_READONLY=false）。
  // ------------------------------------------------------------
  const [publishing, setPublishing] = useState(false);
  const handlePublishSnapshot = async () => {
    if (publishing) return;
    setPublishing(true);
    try {
      const snap = await storage.exportAll();
      const resp = await contractBus.exportRuntimeSnapshot({
        version: snap.version ?? 2,
        products: snap.products ?? [],
        queries: snap.queries ?? [],
        submissions: snap.submissions ?? [],
      });
      if (resp?.ok) {
        alert(
          `✓ 本地快照已写入 .evaluations/_runtime-snapshot.json\n\n` +
            `products: ${resp.stats.products}\n` +
            `queries:  ${resp.stats.queries}\n` +
            `submissions: ${resp.stats.submissions}\n\n` +
            `接下来用 \`git add . && git commit && git push\` 推到 GitHub，\n` +
            `CI 会自动 bake + 部署到对外版（约 1~2 分钟）。`
        );
      } else {
        alert("对外更新失败：bus 未响应，请检查 dev server 是否正常");
      }
    } catch (err) {
      alert(`对外更新失败：${(err as Error).message}`);
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
                  onClick={() => void handlePublishSnapshot()}
                  disabled={publishing}
                  className={clsx(
                    "text-xs px-2.5 py-1 rounded-md border transition-colors",
                    publishing
                      ? "text-ink-400 border-paper-200 cursor-wait"
                      : "text-amber-dark border-amber/40 hover:bg-amber/10"
                  )}
                  title="把本地 localStorage 导出到 .evaluations/_runtime-snapshot.json；后续 git push 触发 CI 自动部署到对外版"
                >
                  {publishing ? "导出中…" : "⇪ 对外更新"}
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
    </div>
  );
}
