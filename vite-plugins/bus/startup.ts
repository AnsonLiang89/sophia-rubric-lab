/**
 * bus/startup.ts
 *
 * dev server 启动时的一次性动作：
 *   1. reconcile：把 seed / runtime snapshot 里的每条 query 登记到 _code-registry.json，
 *      冲突时按 createdAt 重新编号，同步重命名 inbox/outbox 目录前缀
 *   2. bake freshness：检查对外版产物是否落后于源文件，落后就打印警告
 *
 * 两者都是**非阻塞**——即使失败也允许 dev server 继续启动。
 */
import { reconcile } from "../codeRegistry";
import type { CodeRegistry } from "../codeRegistry";
// @ts-expect-error — .mjs 没有类型声明但运行时可直接 import
import { checkBakeFreshness } from "../../scripts/check-bake-freshness.mjs";

export function runStartup(busRoot: string, codeRegistry: CodeRegistry): void {
  // ===== 1. reconcile =====
  try {
    reconcile(busRoot, codeRegistry, (msg) =>
      // eslint-disable-next-line no-console
      console.log(msg)
    );
  } catch (e) {
    // reconcile 不应阻塞 dev server 启动——即使失败也允许手动修
    // eslint-disable-next-line no-console
    console.error(
      "[codeRegistry] reconcile failed (non-fatal):",
      (e as Error).message
    );
  }

  // ===== 2. bake freshness =====
  //
  // 为什么需要这一行？——历史教训：编辑完 .evaluations/*.md 或加新 outbox 后
  // 如果忘了跑 `npm run bake:public` 或点"一键发布"，对外版（GitHub Pages）
  // 会悄悄陈旧，管理员完全无感。这里在 dev server 启动瞬间打出提醒，
  // 配合 /_bus/bake-freshness 端点 + 管理员 UI 页脚红点，形成三道保险。
  try {
    const freshness = checkBakeFreshness() as {
      fresh: boolean;
      stale: Array<{ detail: string }>;
    };
    if (!freshness.fresh) {
      // eslint-disable-next-line no-console
      console.warn(
        `\x1b[33m[bake-freshness]\x1b[0m ⚠ 对外版产物落后于源文件（${freshness.stale.length} 项过期）。`
      );
      for (const s of freshness.stale.slice(0, 5)) {
        // eslint-disable-next-line no-console
        console.warn(`  · ${s.detail}`);
      }
      if (freshness.stale.length > 5) {
        // eslint-disable-next-line no-console
        console.warn(
          `  ……还有 ${freshness.stale.length - 5} 项未列出，访问 /_bus/bake-freshness 查看完整列表`
        );
      }
      // eslint-disable-next-line no-console
      console.warn(
        `\x1b[33m[bake-freshness]\x1b[0m 修复：\`npm run bake:public\` 或在管理员页点「一键发布」。`
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `\x1b[32m[bake-freshness]\x1b[0m ✓ 对外版产物与源文件同步。`
      );
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(
      "[bake-freshness] startup check failed (non-fatal):",
      (e as Error).message
    );
  }
}
