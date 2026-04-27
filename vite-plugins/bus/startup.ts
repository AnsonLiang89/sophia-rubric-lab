/**
 * bus/startup.ts
 *
 * dev server 启动时的一次性动作：
 *   1. reconcile：把 seed / runtime snapshot 里的每条 query 登记到 _code-registry.json，
 *      冲突时按 createdAt 重新编号，同步重命名 inbox/outbox 目录前缀
 *   2. bake freshness：检查对外版产物是否落后于源文件，落后就打印警告
 *   3. inbox auto-migrate：扫 .evaluations/inbox/*.json，若发现 v1 schema（contractVersion!="2.0"）
 *      自动就地升级到 v2。保持 POST /_bus/inbox 入口的 v2 硬约束不会因为老文件而爆。
 *
 * 三者都是**非阻塞**——即使失败也允许 dev server 继续启动。
 */
import fs from "node:fs";
import path from "node:path";
import { reconcile } from "../codeRegistry";
import type { CodeRegistry } from "../codeRegistry";
// @ts-expect-error — .mjs 没有类型声明但运行时可直接 import
import { checkBakeFreshness } from "../../scripts/check-bake-freshness.mjs";
// @ts-expect-error — .mjs 没有类型声明但运行时可直接 import
import { migrateTask } from "../../scripts/migrate-inbox.mjs";

function runInboxAutoMigrate(busRoot: string): void {
  const inboxDir = path.join(busRoot, "inbox");
  if (!fs.existsSync(inboxDir)) return;
  const files = fs.readdirSync(inboxDir).filter((f) => f.endsWith(".json"));
  let migrated = 0;
  for (const f of files) {
    const full = path.join(inboxDir, f);
    let raw: string;
    try {
      raw = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    let task: unknown;
    try {
      task = JSON.parse(raw);
    } catch {
            console.warn(`[inbox-migrate] skip invalid json: ${f}`);
      continue;
    }
    try {
      const { changed, task: next } = migrateTask(task) as {
        changed: boolean;
        task: unknown;
      };
      if (changed) {
        fs.writeFileSync(full, JSON.stringify(next, null, 2));
        migrated++;
            console.log(`[inbox-migrate] ${f} → v2.0`);
      }
    } catch (e) {
            console.warn(
        `[inbox-migrate] migrate failed ${f}: ${(e as Error).message}`
      );
    }
  }
  if (migrated > 0) {
        console.log(`\x1b[32m[inbox-migrate]\x1b[0m ✓ 自动迁移 ${migrated} 份 inbox 到 v2.0 schema`);
  }
}

export function runStartup(busRoot: string, codeRegistry: CodeRegistry): void {
  // ===== 1. reconcile =====
  try {
    reconcile(busRoot, codeRegistry, (msg) =>
            console.log(msg)
    );
  } catch (e) {
    // reconcile 不应阻塞 dev server 启动——即使失败也允许手动修
        console.error(
      "[codeRegistry] reconcile failed (non-fatal):",
      (e as Error).message
    );
  }

  // ===== 2. inbox auto-migrate =====
  //
  // 为什么放 reconcile 之后、bake-freshness 之前？
  //   reconcile 可能重命名 inbox/{taskId}.json（query 冲突时重编号），必须先完成；
  //   bake-freshness 只读不写，放最后。
  //   migrate 的意义：POST /_bus/inbox 有 v2 硬约束，如果本地还有历史 v1 文件
  //   直接跑 dev server 也不会报错，但一旦后续 PATCH 会被挡住。这里一次性升级干净。
  try {
    runInboxAutoMigrate(busRoot);
  } catch (e) {
        console.error(
      "[inbox-migrate] startup check failed (non-fatal):",
      (e as Error).message
    );
  }

  // ===== 3. bake freshness =====
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
            console.warn(
        `\x1b[33m[bake-freshness]\x1b[0m ⚠ 对外版产物落后于源文件（${freshness.stale.length} 项过期）。`
      );
      for (const s of freshness.stale.slice(0, 5)) {
                console.warn(`  · ${s.detail}`);
      }
      if (freshness.stale.length > 5) {
                console.warn(
          `  ……还有 ${freshness.stale.length - 5} 项未列出，访问 /_bus/bake-freshness 查看完整列表`
        );
      }
            console.warn(
        `\x1b[33m[bake-freshness]\x1b[0m 修复：\`npm run bake:public\` 或在管理员页点「一键发布」。`
      );
    } else {
            console.log(
        `\x1b[32m[bake-freshness]\x1b[0m ✓ 对外版产物与源文件同步。`
      );
    }
  } catch (e) {
        console.error(
      "[bake-freshness] startup check failed (non-fatal):",
      (e as Error).message
    );
  }
}
