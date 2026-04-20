import { useEffect, useState } from "react";
import type { BusErrorEventDetail } from "../lib/contract";

/**
 * 全局 Bus 错误 Banner
 *
 * 监听 `window` 上的 `bus-error` 事件（由 contract.ts 的 busFetch 派发），
 * 对用户展示"数据通道异常"的提示。
 *
 * 特点：
 *  - 5 秒内连续错误只计一次（避免抖动）
 *  - 网络层错误（Vite dev server 未启动 / 后端不可达）用红色 error
 *  - 5xx 服务端错误同上
 *  - 4xx 客户端错误用琥珀色 warning（通常是业务侧问题，不代表整体不可用）
 *  - 支持手动关闭；被关闭后如果 10 秒内再次出错会重新弹出
 *
 * 设计刻意不用 toast 库，避免引入额外依赖。
 */
export default function BusErrorBanner() {
  const [state, setState] = useState<{
    code: "network" | "client" | "server";
    message: string;
    visible: boolean;
  } | null>(null);

  useEffect(() => {
    let lastAt = 0;
    const handler = (e: Event) => {
      const ce = e as CustomEvent<BusErrorEventDetail>;
      const now = Date.now();
      // 5 秒内重复抖动合并
      if (now - lastAt < 5000 && state?.visible) return;
      lastAt = now;
      setState({ code: ce.detail.code, message: ce.detail.message, visible: true });
    };
    window.addEventListener("bus-error", handler as EventListener);
    return () => window.removeEventListener("bus-error", handler as EventListener);
  }, [state?.visible]);

  if (!state || !state.visible) return null;

  const isError = state.code === "network" || state.code === "server";
  const title =
    state.code === "network"
      ? "数据通道离线"
      : state.code === "server"
        ? "数据服务异常"
        : "请求被拒绝";
  const hint =
    state.code === "network"
      ? "请检查 Vite dev server 是否运行（npm run dev）；或刷新页面重试。"
      : state.code === "server"
        ? "可能是 .evaluations/ 目录结构受损，查看控制台详情。"
        : "请求格式不符合契约；查看控制台详情。";

  return (
    <div
      role="alert"
      className={
        isError
          ? "bg-red-50 border-b border-red-200 text-red-900"
          : "bg-amber/10 border-b border-amber/40 text-amber-dark"
      }
    >
      <div className="max-w-7xl mx-auto px-6 py-2 flex items-center gap-3 text-sm">
        <span className="text-base" aria-hidden>
          {isError ? "⚠️" : "ℹ️"}
        </span>
        <div className="flex-1 min-w-0">
          <span className="font-medium">{title}</span>
          <span className="mx-2 text-ink-400">·</span>
          <span className="text-ink-600">{hint}</span>
        </div>
        <span className="hidden sm:inline text-[11px] font-mono text-ink-400 truncate max-w-[40%]">
          {state.message}
        </span>
        <button
          type="button"
          onClick={() => setState((s) => (s ? { ...s, visible: false } : s))}
          className="text-xs text-ink-500 hover:text-ink-900 px-2"
          title="关闭"
        >
          ×
        </button>
      </div>
    </div>
  );
}
