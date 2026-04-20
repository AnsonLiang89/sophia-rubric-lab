#!/usr/bin/env node
/**
 * dump-seed.mjs
 *
 * 把 src/seed.ts 的 SEED_SNAPSHOT 物化成 .evaluations/_seed-snapshot.json。
 * 这份 JSON 会进 git，保证 bake-public-data.mjs 在任何环境（本地 / CI）都
 * 不用依赖 TS 编译就能读到 seed。
 *
 * 依赖：Node 22.6+（`--experimental-strip-types` 能直接 import .ts）。
 * 本地 WorkBuddy 管理的 node 版本是 22.12，满足要求。
 * CI（.github/workflows/deploy.yml）也固定到 Node 22。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "..");
const SEED_SRC = path.join(PROJECT_ROOT, "src", "seed.ts");
const OUT = path.join(PROJECT_ROOT, ".evaluations", "_seed-snapshot.json");

async function main() {
  if (!fs.existsSync(SEED_SRC)) {
    console.error(`[dump-seed] missing: ${SEED_SRC}`);
    process.exit(1);
  }
  // 动态 import .ts —— 需要本脚本以 `node --experimental-strip-types` 启动
  const mod = await import(SEED_SRC);
  const snapshot = mod.SEED_SNAPSHOT;
  if (!snapshot || typeof snapshot !== "object") {
    console.error("[dump-seed] SEED_SNAPSHOT is not exported or not an object");
    process.exit(1);
  }
  // Sanity check：必要字段齐全
  const required = ["products", "queries", "submissions"];
  for (const k of required) {
    if (!Array.isArray(snapshot[k])) {
      console.error(`[dump-seed] SEED_SNAPSHOT.${k} is not an array`);
      process.exit(1);
    }
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2));
  console.log(
    `[dump-seed] wrote ${path.relative(PROJECT_ROOT, OUT)} ` +
      `(${snapshot.products.length} products, ${snapshot.queries.length} queries, ${snapshot.submissions.length} submissions)`
  );
}

main().catch((err) => {
  console.error("[dump-seed] failed:", err?.stack ?? err);
  process.exit(1);
});
