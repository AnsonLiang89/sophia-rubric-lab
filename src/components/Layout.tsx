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
  // Footer 展示"上次更新时间"（两端通用，精确到秒）
  //
  // 数据源：`/_bus/publish-log` 的最近一次 ok=true 条目的 publishedAt。
  // - dev：直接读 `.evaluations/_publish-log.json`
  // - prod：读 bake 出的 `public/data/publish-log.json`
  //
  // 这是"用户点对外更新按钮"的时间，两端展示同一个值 → 方便对齐。
  // 找不到（从未发过 / 文件丢了）退化为空态，页脚仅显示模式徽章。
  // ------------------------------------------------------------
  const [lastPublishedAt, setLastPublishedAt] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const doc = await contractBus.getPublishLog();
        if (!doc || !Array.isArray(doc.entries)) return;
        const okEntries = doc.entries.filter((e) => e && e.ok);
        const last = okEntries.length ? okEntries[okEntries.length - 1] : null;
        if (last?.publishedAt) setLastPublishedAt(last.publishedAt);
      } catch {
        /* 取不到不影响使用 */
      }
    })();
  }, []);

  /** 精确到秒的本地时间格式化 */
  const formatLocalTime = (iso: string): string => {
    try {
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, "0");
      return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
        `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
      );
    } catch {
      return iso;
    }
  };

  // ------------------------------------------------------------
  // 数据健康度徽章（2026-04-21 方案 B）
  //
  // 目的：在管理员版页脚显式展示"localStorage 里的 query.code 是否与
  // 注册簿 `_code-registry.json` 对齐"。这是之前一连串事故的根因信号——
  // localStorage 若飘了而用户没重启 dev server / 没触发 migration，
  // outboxAgg 按 code 查不到 Query，详情页就错位。
  //
  // 状态约定：
  //   ok       → 绿 ✓：所有 localStorage 里带 id 的 query.code 都等于注册簿权威值
  //   drift    → 琥珀 ⚠：至少有一条不一致（应用启动时的 migration v2 会自动修复，
  //              但这里的徽章让管理员能肉眼看到"修过了没"）
  //   no-reg   → 灰：拉不到注册簿（对外版、或 bus 不可用）——不展示徽章
  //   error    → 红 ✗：请求报错但不是 404
  //
  // 只在管理员版跑（对外版的 queries 已经在 bake 时对齐过，徽章没意义）。
  // ------------------------------------------------------------
  type HealthStatus = "ok" | "drift" | "no-reg" | "error" | "checking";
  const [health, setHealth] = useState<{
    status: HealthStatus;
    /** drift 数量 */
    count?: number;
    /** drift 详情（仅保留前 3 条，给 title 悬浮用） */
    sample?: { queryId: string; local: string; authoritative: string }[];
  }>({ status: "checking" });

  useEffect(() => {
    if (IS_READONLY) {
      setHealth({ status: "no-reg" });
      return;
    }
    let cancelled = false;
    const check = async () => {
      try {
        const reg = await contractBus.getRegistry();
        if (!reg || !reg.map) {
          if (!cancelled) setHealth({ status: "no-reg" });
          return;
        }
        const snap = await storage.exportAll();
        const drifts: { queryId: string; local: string; authoritative: string }[] = [];
        for (const q of snap.queries ?? []) {
          if (!q?.id) continue;
          const authoritative = (reg.map as Record<string, string>)[q.id];
          if (authoritative && authoritative !== q.code) {
            drifts.push({
              queryId: q.id,
              local: q.code ?? "(empty)",
              authoritative,
            });
          }
        }
        if (cancelled) return;
        if (drifts.length === 0) {
          setHealth({ status: "ok" });
        } else {
          setHealth({
            status: "drift",
            count: drifts.length,
            sample: drifts.slice(0, 3),
          });
        }
      } catch {
        if (!cancelled) setHealth({ status: "error" });
      }
    };
    check();
    // 页面重新聚焦时重跑（管理员切出去做 reconcile 相关操作再回来，可以即时看效果）
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // ------------------------------------------------------------
  // 对外版产物新鲜度徽章（2026-04-22，配合 /_bus/bake-freshness）
  //
  // 目的：让"改了 .evaluations/*.md 或 outbox 后忘了 bake"这类断层在页脚可见。
  // 三态：
  //   fresh → 不渲染任何标记（绿色安静）
  //   stale → 琥珀 ⚠：显示过期项数量 + tooltip 列前若干条
  //   error → 红 ✗：bus 端点挂了
  //   checking → 不渲染
  //
  // 仅管理员版（对外版 prod 没有 /_bus/bake-freshness 端点，且意义不大）。
  // ------------------------------------------------------------
  type FreshStatus = "fresh" | "stale" | "error" | "checking";
  const [freshness, setFreshness] = useState<{
    status: FreshStatus;
    /** 过期项数量 */
    count?: number;
    /** 过期项详情（仅保留前 5 条给 title 用） */
    sample?: { id: string; kind: string; detail: string }[];
    /** 是否 bake 目录整体缺失（要引导用户先跑 build:public） */
    bakeMissing?: boolean;
  }>({ status: "checking" });

  useEffect(() => {
    if (IS_READONLY) {
      setFreshness({ status: "fresh" });
      return;
    }
    let cancelled = false;
    const check = async () => {
      try {
        const result = await contractBus.getBakeFreshness();
        if (cancelled) return;
        if (!result) {
          setFreshness({ status: "error" });
          return;
        }
        if (result.fresh) {
          setFreshness({ status: "fresh" });
        } else {
          setFreshness({
            status: "stale",
            count: result.stale.length,
            sample: result.stale.slice(0, 5).map((s) => ({
              id: s.id,
              kind: s.kind,
              detail: s.detail,
            })),
            bakeMissing: !result.bakePresent,
          });
        }
      } catch {
        if (!cancelled) setFreshness({ status: "error" });
      }
    };
    check();
    // focus 时重跑：管理员跑完 bake 回来，页脚能立即消红
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
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
        // 成功时刷新"上次更新时间"footer（publish 端点已 append 了 log）
        if (resp.ok) {
          contractBus
            .getPublishLog()
            .then((doc) => {
              if (!doc || !Array.isArray(doc.entries)) return;
              const okEntries = doc.entries.filter((e) => e && e.ok);
              const last = okEntries.length ? okEntries[okEntries.length - 1] : null;
              if (last?.publishedAt) setLastPublishedAt(last.publishedAt);
            })
            .catch(() => undefined);
        }
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
                    "relative text-xs px-2.5 py-1 rounded-md border transition-colors",
                    publishing
                      ? "text-ink-400 border-paper-200 cursor-wait"
                      : "text-amber-dark border-amber/40 hover:bg-amber/10"
                  )}
                  title={
                    freshness.status === "stale"
                      ? `对外版有 ${freshness.count} 项过期，建议立即发布。\n` +
                        "一键发布到对外版：导出快照 → 烘焙 → git push → GitHub Actions 自动部署（约 30 秒~2 分钟）"
                      : "一键发布到对外版：导出快照 → 烘焙 → git push → GitHub Actions 自动部署（约 30 秒~2 分钟）"
                  }
                >
                  {publishing ? "发布中…" : "⇪ 对外更新"}
                  {freshness.status === "stale" && !publishing && (
                    // 小红点：stale 时在按钮右上角浮一颗，强化视觉提示
                    <span
                      className="absolute -top-1 -right-1 inline-block w-2 h-2 rounded-full bg-amber ring-2 ring-paper-50"
                      aria-hidden="true"
                    />
                  )}
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
        {lastPublishedAt && (
          <div className="text-ink-400/80">
            上次更新：{formatLocalTime(lastPublishedAt)}
            {IS_READONLY && (
              <span className="ml-2 text-ink-400/60">（对外版数据版本）</span>
            )}
            {!IS_READONLY && (
              <span className="ml-2 text-ink-400/60">（两端应一致）</span>
            )}
          </div>
        )}
        {/*
          数据健康度徽章：仅管理员版展示
          - ok：绿 ✓（所有 localStorage.query.code 与注册簿一致）
          - drift：琥珀 ⚠（有飘移；悬浮可看前 3 条示例）
          - error：红 ✗（请求异常）
          - no-reg / checking：不渲染（对外版 no-reg 就不打扰用户）
        */}
        {!IS_READONLY && health.status === "ok" && (
          <div className="text-moss/80">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-moss mr-1.5 align-middle" />
            本地数据与注册簿一致
          </div>
        )}
        {!IS_READONLY && health.status === "drift" && (
          <div
            className="text-amber"
            title={
              health.sample
                ? health.sample
                    .map(
                      (s) =>
                        `${s.queryId}: local=${s.local} → registry=${s.authoritative}`
                    )
                    .join("\n")
                : undefined
            }
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber mr-1.5 align-middle" />
            检测到 {health.count} 条 code 与注册簿不一致（下次启动会自动迁移）
          </div>
        )}
        {!IS_READONLY && health.status === "error" && (
          <div className="text-red-500/80">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5 align-middle" />
            健康度检查失败（bus 未响应）
          </div>
        )}
        {/*
          对外版新鲜度徽章（v2.1 配合 /_bus/bake-freshness 新增）：
          - 只在 stale / error 时露头，fresh 时安静
          - 点击应该能看到详情（这里用 title 先做最小版，鼠标悬停即见）
          - 文案里直接告诉用户怎么修复（跑 bake 或点一键发布）
        */}
        {!IS_READONLY && freshness.status === "stale" && (
          <div
            className="text-amber"
            title={
              freshness.sample
                ? freshness.sample.map((s) => `[${s.kind}] ${s.detail}`).join("\n") +
                  (freshness.count && freshness.count > freshness.sample.length
                    ? `\n……还有 ${freshness.count - freshness.sample.length} 项未列出`
                    : "")
                : undefined
            }
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber mr-1.5 align-middle" />
            {freshness.bakeMissing
              ? "对外版产物尚未生成（需先跑 npm run build:public）"
              : `对外版产物落后于源文件（${freshness.count} 项过期，请点"对外更新"或跑 bake）`}
          </div>
        )}
        {!IS_READONLY && freshness.status === "error" && (
          <div className="text-red-500/80">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5 align-middle" />
            新鲜度检查失败（bus 未响应）
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
                  {/* Preflight 软警告（自动纠正的 code 对齐等） */}
                  {publishResult.preflightWarnings &&
                    publishResult.preflightWarnings.length > 0 && (
                      <div className="bg-amber/10 border border-amber/30 rounded-lg p-3">
                        <div className="text-xs font-semibold text-amber-dark mb-1.5">
                          ⚠ 发布时自动纠正了以下问题（建议硬刷浏览器 Cmd+Shift+R 同步 localStorage）
                        </div>
                        <ul className="text-xs text-ink-700 space-y-1">
                          {publishResult.preflightWarnings.map((w, i) => (
                            <li key={i} className="font-mono">
                              · {w}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                </div>
              )}

              {/* Preflight 硬错误（failedStep === "preflight"） */}
              {publishResult &&
                !publishResult.ok &&
                publishResult.failedStep === "preflight" &&
                publishResult.preflightErrors && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-1.5">
                    <div className="text-xs font-semibold text-red-700">
                      数据一致性检查失败，发布已中止（数据未被推送）
                    </div>
                    <ul className="text-xs text-red-900 space-y-1">
                      {publishResult.preflightErrors.map((e, i) => (
                        <li key={i} className="font-mono">
                          · {e}
                        </li>
                      ))}
                    </ul>
                    <div className="text-xs text-ink-500 pt-1">
                      建议：硬刷管理员版（Cmd+Shift+R）触发 localStorage 迁移，或手动检查有问题的 query。
                    </div>
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
