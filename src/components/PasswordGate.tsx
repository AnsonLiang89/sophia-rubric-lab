// ============================================================
// PasswordGate.tsx
//
// 对外只读版（GitHub Pages）的访问口令门禁。
//
// 定位与边界（务必清楚）：
//   - GitHub Pages 是纯静态托管，没有服务端，口令校验只能发生在浏览器里。
//   - 因此这是「挡住无关路人」的轻量门禁，不是真正的服务端鉴权——
//     懂技术的人仍可通过读打包源码 / 调试绕过。
//   - 不在代码里存明文口令：只内置口令的 SHA-256 哈希；用户输入后做同样
//     的哈希再比对，匹配才放行。打包产物里看不到明文。
//
// 行为：
//   - 仅在只读公开版（IS_READONLY === true）生效；本地管理员版(dev)不拦截。
//   - 校验通过后写 sessionStorage，本标签页内刷新 / 跳转子页面不再重复输入。
//     （sessionStorage 而非 localStorage：关掉标签页就需要重新输入，更稳妥。）
// ============================================================

import { useState, type ReactNode } from "react";
import { IS_READONLY } from "../lib/dataSource";

// 口令哈希：sha256("sophia-rubric-lab::v1::<明文口令>")。
// 加固定 salt 前缀只是避免裸口令哈希被通用彩虹表直接命中，不改变其轻量定位。
const PASSWORD_SALT = "sophia-rubric-lab::v1::";
const PASSWORD_HASH =
  "7fd431ec3da44a90bfe5821bac0c0bb619528bb96a538f8f14f162ab367a9874";

// sessionStorage 标记：存"已通过"的同一份哈希，避免存任何明文。
const AUTH_STORAGE_KEY = "sophia-rubric-lab:gate";

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function readRememberedUnlock(gateEnabled: boolean): boolean {
  if (!gateEnabled) return true;
  try {
    return sessionStorage.getItem(AUTH_STORAGE_KEY) === PASSWORD_HASH;
  } catch {
    return false;
  }
}

export default function PasswordGate({ children }: { children: ReactNode }) {
  // dev 管理员版：完全不拦截。
  // 用常量直接短路，构建时即可被 tree-shake。
  const gateEnabled = IS_READONLY;

  const [unlocked, setUnlocked] = useState(() => readRememberedUnlock(gateEnabled));
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(false);
    try {
      const hash = await sha256Hex(PASSWORD_SALT + pwd);
      if (hash === PASSWORD_HASH) {
        try {
          sessionStorage.setItem(AUTH_STORAGE_KEY, PASSWORD_HASH);
        } catch {
          /* 存不进去也不影响本次放行 */
        }
        setUnlocked(true);
      } else {
        setError(true);
        setPwd("");
      }
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (unlocked) return <>{children}</>;

  // ---------------- 登录页 ----------------
  return (
    <div className="min-h-screen flex items-center justify-center bg-paper-50 px-6">
      <div className="w-full max-w-sm">
        {/* 站点标识 */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="relative w-11 h-11 rounded-xl bg-gradient-to-br from-amber to-amber-dark flex items-center justify-center shadow-soft">
            <span className="text-white font-serif text-xl font-bold">S</span>
            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-moss border-2 border-paper-50" />
          </div>
          <div className="text-left">
            <div className="font-semibold text-ink-900 leading-tight text-[15px]">
              Sophia's Rubric Lab
            </div>
            <div className="text-[11px] text-ink-500 leading-tight">
              AI 深度研究报告评测台
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-lifted border border-paper-200 p-7">
          <h1 className="text-lg font-semibold text-ink-900 mb-1.5">
            访问受限
          </h1>
          <p className="text-[13px] text-ink-500 leading-relaxed mb-6">
            本评测台为受邀访问。请输入访问口令以继续。
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="password"
                autoFocus
                value={pwd}
                onChange={(e) => {
                  setPwd(e.target.value);
                  if (error) setError(false);
                }}
                placeholder="访问口令"
                autoComplete="current-password"
                className={
                  "w-full px-4 py-2.5 rounded-lg border bg-paper-50 text-ink-900 " +
                  "placeholder:text-ink-400 outline-none transition-colors " +
                  (error
                    ? "border-clay focus:border-clay"
                    : "border-paper-300 focus:border-amber")
                }
              />
              {error && (
                <p className="mt-2 text-[12px] text-clay">
                  口令不正确，请重试。
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting || !pwd}
              className={
                "w-full py-2.5 rounded-lg text-sm font-medium transition-colors " +
                (submitting || !pwd
                  ? "bg-paper-200 text-ink-400 cursor-not-allowed"
                  : "bg-amber text-white hover:bg-amber-dark shadow-soft")
              }
            >
              {submitting ? "验证中…" : "进入"}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-ink-400 mt-6">
          如需访问权限，请联系站点维护者。
        </p>
      </div>
    </div>
  );
}
