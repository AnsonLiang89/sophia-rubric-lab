#!/usr/bin/env node
/**
 * check-bake-freshness.mjs
 *
 * 用途：检查 public/data/ 下的对外版产物是否"跟得上" .evaluations/ 里的源文件。
 *
 * **背景：为什么需要这个脚本**
 *
 * 对外版（GitHub Pages）的数据来自 bake 产物 public/data/*.json，是静态快照。
 * 但源文件（.evaluations/RUBRIC_STANDARD.md / EVALUATION_CONTRACT.md / outbox/*.json 等）
 * 会被频繁修改。两者之间**没有强绑定**，管理员编辑完源文件后如果忘了跑 bake，
 * 对外版就会"悄悄陈旧"——标准 tab 还是老版本、新产物看不到。
 *
 * 本脚本扮演"机械警卫"：
 *   - dev server 启动时调 checkBakeFreshness() 打印终端警告
 *   - 管理员 UI 通过 /_bus/bake-freshness 端点查询，页脚渲染红点
 *   - CI/pre-publish 钩子可以用它做 fail-fast 检查
 *
 * **检查规则**（有哪些源 + 如何判断"陈旧"）
 *
 * 1. RUBRIC_STANDARD.md → public/data/standard.json 里的 content 字段
 * 2. EVALUATION_CONTRACT.md → public/data/contract.json 里的 content 字段
 * 3. PRODUCTS.json → public/data/products.json 里的 path/updatedAt
 * 4. .evaluations/outbox/{taskId}/v{n}.json → public/data/outbox/{taskId}/v{n}.json
 *
 * 判断方式采用"**内容 hash 对比**"而非 mtime，原因：
 *   - mtime 在不同操作、git checkout 后不稳定
 *   - hash 能精确反映"实质内容是否一致"
 *   - 内容对齐 = 对外版已同步；不齐 = 需要 bake
 *
 * 退出码（CLI 调用）：
 *   0 = 全部新鲜（对外版已同步所有源文件）
 *   1 = 至少一项过期（详情在 stderr）
 *   2 = 运行时错误（缺失关键文件等）
 *
 * 也可作为模块 import：
 *   import { checkBakeFreshness } from "./check-bake-freshness.mjs";
 *   const result = checkBakeFreshness();  // {fresh: boolean, items: [...], checkedAt}
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const EV_DIR = path.join(PROJECT_ROOT, ".evaluations");
const BAKE_DIR = path.join(PROJECT_ROOT, "public", "data");

function sha1(s) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function readTextSafe(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * 核心 API：返回一个结构化报告，告诉调用方哪些产物是陈旧的。
 *
 * @returns {{
 *   fresh: boolean,
 *   bakePresent: boolean,
 *   items: Array<{id:string, kind:string, fresh:boolean, detail:string}>,
 *   stale: Array<{id:string, kind:string, detail:string}>,
 *   checkedAt: string,
 * }}
 */
export function checkBakeFreshness() {
  const checkedAt = new Date().toISOString();
  const items = [];

  // bake 目录整体缺失：直接判整体过期
  const bakePresent = fs.existsSync(BAKE_DIR);
  if (!bakePresent) {
    return {
      fresh: false,
      bakePresent: false,
      items: [],
      stale: [
        {
          id: "__bake_missing__",
          kind: "bake",
          detail:
            "public/data/ 目录不存在。请跑 `npm run build:public` 生成对外版产物。",
        },
      ],
      checkedAt,
    };
  }

  // -------- 1) 标准 + 契约 + products（内容 hash 直接比） --------
  const textSources = [
    {
      id: "standard",
      kind: "contract-doc",
      srcPath: path.join(EV_DIR, "RUBRIC_STANDARD.md"),
      bakePath: path.join(BAKE_DIR, "standard.json"),
      extract: (json) => json?.content ?? null,
      label: "评测标准（RUBRIC_STANDARD.md）",
    },
    {
      id: "contract",
      kind: "contract-doc",
      srcPath: path.join(EV_DIR, "EVALUATION_CONTRACT.md"),
      bakePath: path.join(BAKE_DIR, "contract.json"),
      extract: (json) => json?.content ?? null,
      label: "评测契约（EVALUATION_CONTRACT.md）",
    },
  ];
  for (const s of textSources) {
    const srcText = readTextSafe(s.srcPath);
    if (srcText == null) {
      items.push({
        id: s.id,
        kind: s.kind,
        fresh: false,
        detail: `源文件缺失：${path.relative(PROJECT_ROOT, s.srcPath)}`,
      });
      continue;
    }
    const bakeJson = readJsonSafe(s.bakePath);
    if (!bakeJson) {
      items.push({
        id: s.id,
        kind: s.kind,
        fresh: false,
        detail: `对外版产物缺失或损坏：${path.relative(PROJECT_ROOT, s.bakePath)}（${s.label}）`,
      });
      continue;
    }
    const bakeText = s.extract(bakeJson);
    if (bakeText == null) {
      items.push({
        id: s.id,
        kind: s.kind,
        fresh: false,
        detail: `对外版产物字段缺失（.content 未写入）：${path.relative(PROJECT_ROOT, s.bakePath)}`,
      });
      continue;
    }
    if (sha1(srcText) === sha1(bakeText)) {
      items.push({
        id: s.id,
        kind: s.kind,
        fresh: true,
        detail: `已同步（${s.label}）`,
      });
    } else {
      items.push({
        id: s.id,
        kind: s.kind,
        fresh: false,
        detail: `${s.label}：源文件内容与对外版不一致，需重新 bake`,
      });
    }
  }

  // PRODUCTS.json：比较解析后的 products 数组序列化结果
  {
    const srcJson = readJsonSafe(path.join(EV_DIR, "PRODUCTS.json"));
    const bakeJson = readJsonSafe(path.join(BAKE_DIR, "products.json"));
    if (!srcJson) {
      items.push({
        id: "products",
        kind: "contract-doc",
        fresh: false,
        detail: "源文件 .evaluations/PRODUCTS.json 缺失或损坏",
      });
    } else if (!bakeJson) {
      items.push({
        id: "products",
        kind: "contract-doc",
        fresh: false,
        detail: "对外版产物 public/data/products.json 缺失或损坏",
      });
    } else {
      const srcCanon = JSON.stringify(srcJson.products ?? []);
      const bakeCanon = JSON.stringify(bakeJson.products ?? []);
      if (srcCanon === bakeCanon && srcJson.updatedAt === bakeJson.updatedAt) {
        items.push({
          id: "products",
          kind: "contract-doc",
          fresh: true,
          detail: "评测主体清单（PRODUCTS.json）已同步",
        });
      } else {
        items.push({
          id: "products",
          kind: "contract-doc",
          fresh: false,
          detail: "评测主体清单（PRODUCTS.json）内容不一致，需重新 bake",
        });
      }
    }
  }

  // -------- 2) outbox 产物（存在性 + 数量对齐） --------
  {
    const srcOutboxDir = path.join(EV_DIR, "outbox");
    const bakeOutboxDir = path.join(BAKE_DIR, "outbox");
    const srcTasks = fs.existsSync(srcOutboxDir)
      ? fs.readdirSync(srcOutboxDir).filter((f) =>
          fs.statSync(path.join(srcOutboxDir, f)).isDirectory()
        )
      : [];
    const bakeTasks = fs.existsSync(bakeOutboxDir)
      ? fs.readdirSync(bakeOutboxDir).filter((f) =>
          fs.statSync(path.join(bakeOutboxDir, f)).isDirectory()
        )
      : [];
    const bakeTaskSet = new Set(bakeTasks);

    // 2.1 源里有但 bake 里没有的 task（整份任务没出现在对外版）
    const missingTasks = srcTasks.filter((t) => !bakeTaskSet.has(t));
    for (const t of missingTasks) {
      items.push({
        id: `outbox:${t}`,
        kind: "outbox-task",
        fresh: false,
        detail: `outbox 任务 ${t} 存在于 .evaluations/ 但未出现在对外版产物中`,
      });
    }

    // 2.2 逐 task 比较每个 v{n}.json 的内容 hash
    for (const taskId of srcTasks) {
      if (!bakeTaskSet.has(taskId)) continue; // 已在 2.1 里报过
      const srcTaskDir = path.join(srcOutboxDir, taskId);
      const bakeTaskDir = path.join(bakeOutboxDir, taskId);
      const versionFiles = fs
        .readdirSync(srcTaskDir)
        .filter((f) => /^v\d+\.json$/.test(f));
      for (const vf of versionFiles) {
        const srcContent = readJsonSafe(path.join(srcTaskDir, vf));
        const bakeContent = readJsonSafe(path.join(bakeTaskDir, vf));
        if (!srcContent) {
          items.push({
            id: `outbox:${taskId}/${vf}`,
            kind: "outbox-version",
            fresh: false,
            detail: `源 outbox 文件损坏：.evaluations/outbox/${taskId}/${vf}`,
          });
          continue;
        }
        if (!bakeContent) {
          items.push({
            id: `outbox:${taskId}/${vf}`,
            kind: "outbox-version",
            fresh: false,
            detail: `对外版缺失或损坏：public/data/outbox/${taskId}/${vf}`,
          });
          continue;
        }
        // bake 会在 payload 上冗余注入 queryId，不能直接比 hash
        // 所以复制一份剔除 queryId 再比
        const stripQueryId = (j) => {
          if (!j || typeof j !== "object") return j;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { queryId, ...rest } = j;
          return rest;
        };
        const srcCanon = JSON.stringify(stripQueryId(srcContent));
        const bakeCanon = JSON.stringify(stripQueryId(bakeContent));
        if (srcCanon === bakeCanon) {
          items.push({
            id: `outbox:${taskId}/${vf}`,
            kind: "outbox-version",
            fresh: true,
            detail: `outbox ${taskId}/${vf} 已同步`,
          });
        } else {
          items.push({
            id: `outbox:${taskId}/${vf}`,
            kind: "outbox-version",
            fresh: false,
            detail: `outbox ${taskId}/${vf} 内容不一致，需重新 bake`,
          });
        }
      }
    }
  }

  const stale = items.filter((i) => !i.fresh);
  return {
    fresh: stale.length === 0,
    bakePresent: true,
    items,
    stale,
    checkedAt,
  };
}

// ------------------------------------------------------------
// CLI entrypoint
// ------------------------------------------------------------
function isMain() {
  // 兼容 Unix / Windows / 符号链接各种路径形态：比较绝对路径而不是 file:// URL
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);
  } catch {
    return false;
  }
}

function main() {
  const result = checkBakeFreshness();
  const staleGrouped = {};
  for (const s of result.stale) {
    staleGrouped[s.kind] = (staleGrouped[s.kind] ?? 0) + 1;
  }

  if (result.fresh) {
    // eslint-disable-next-line no-console
    console.log(
      `\x1b[32m[bake-freshness]\x1b[0m ✓ 对外版产物与源文件完全同步（${result.items.length} 项均已检查）。`
    );
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(
    `\x1b[33m[bake-freshness]\x1b[0m ⚠ 发现 ${result.stale.length} 项过期（${Object.entries(
      staleGrouped
    )
      .map(([k, v]) => `${k}:${v}`)
      .join(", ")}），对外版可能落后于源文件。`
  );
  for (const s of result.stale.slice(0, 20)) {
    // eslint-disable-next-line no-console
    console.error(`  · ${s.detail}`);
  }
  if (result.stale.length > 20) {
    // eslint-disable-next-line no-console
    console.error(`  ……还有 ${result.stale.length - 20} 项未列出`);
  }
  // eslint-disable-next-line no-console
  console.error(
    `\x1b[33m[bake-freshness]\x1b[0m 修复方式：跑 \`npm run bake:public\`（或一键发布），让 public/data 跟上源文件。`
  );
  process.exit(1);
}

if (isMain()) {
  try {
    main();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[bake-freshness] unexpected failure:", err);
    process.exit(2);
  }
}
