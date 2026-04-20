import { Link, NavLink, Outlet } from "react-router-dom";
import clsx from "clsx";
import { useLab } from "../store";
import { storage } from "../storage";
import type { LabSnapshot } from "../types";
import { useEffect, useRef, useState } from "react";
import BusErrorBanner from "./BusErrorBanner";
import { IS_READONLY } from "../lib/dataSource";
import { contractBus } from "../lib/contract";

export default function Layout() {
  const { refresh } = useLab();
  const fileRef = useRef<HTMLInputElement>(null);

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

  const handleExport = async () => {
    const snap = await storage.exportAll();
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rubric-lab-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const snap = JSON.parse(text) as LabSnapshot;
      const mode = confirm("点击「确定」替换全部数据；点击「取消」合并导入") ? "replace" : "merge";
      await storage.importAll(snap, mode);
      await refresh();
      alert("导入完成");
    } catch {
      alert("导入失败，文件格式不正确");
    }
    e.target.value = "";
  };

  /**
   * 管理员导出运行时快照：把 localStorage 里的 products+queries+submissions
   * 一键写到 `.evaluations/_runtime-snapshot.json`，供 bake 脚本合并到对外版。
   * 仅 dev 下可用（IS_READONLY=false）。
   */
  const handleExportRuntime = async () => {
    const snap = await storage.exportAll();
    try {
      const resp = await contractBus.exportRuntimeSnapshot({
        version: snap.version ?? 2,
        products: snap.products ?? [],
        queries: snap.queries ?? [],
        submissions: snap.submissions ?? [],
      });
      if (resp?.ok) {
        alert(
          `✓ 已写入 .evaluations/_runtime-snapshot.json\n\n` +
            `products: ${resp.stats.products}\n` +
            `queries:  ${resp.stats.queries}\n` +
            `submissions: ${resp.stats.submissions}\n\n` +
            `接下来执行 \`npm run bake:public\` 烘焙对外版数据。`
        );
      } else {
        alert("导出失败：bus 未响应，请检查 dev server 是否正常");
      }
    } catch (err) {
      alert(`导出失败：${(err as Error).message}`);
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
            {/* 管理员版（dev）才有导入导出、导出 runtime 快照；对外版全部隐藏 */}
            {!IS_READONLY && (
              <>
                <button
                  onClick={() => void handleExportRuntime()}
                  className="text-xs text-ink-500 hover:text-amber-dark px-2 py-1"
                  title="把 localStorage 导出到 .evaluations/_runtime-snapshot.json，供 bake:public 烘焙对外版"
                >
                  ⬇ 快照
                </button>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="text-xs text-ink-500 hover:text-amber-dark px-2 py-1"
                  title="导入 JSON"
                >
                  ⇣ 导入
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleImport}
                />
                <button
                  onClick={handleExport}
                  className="text-xs text-ink-500 hover:text-amber-dark px-2 py-1"
                  title="导出 JSON 快照"
                >
                  ⇡ 导出
                </button>
              </>
            )}
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
            : "本地数据存储 · 支持导出 JSON 迁移至云端"}
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
