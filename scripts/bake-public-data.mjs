#!/usr/bin/env node
/**
 * bake-public-data.mjs
 *
 * 把 .evaluations/ 目录 + seed + 运行时 snapshot 烘焙成一组静态 JSON/MD，
 * 放进 public/data/，供 `vite build` 收进 dist，发布到 GitHub Pages。
 *
 * 前端在 prod 模式下（import.meta.env.PROD）会把 `/_bus/*` 请求映射到
 * `/data/*.json`（由 src/lib/dataSource.ts 的 toStaticUrl 决定）。本脚本
 * 产出的文件结构必须与那里的映射表严格对齐。
 *
 * 产物清单（均写入 ${OUT_DIR}/ = public/data/）：
 *   standard.json             ←  镜像 /_bus/standard        （RUBRIC_STANDARD.md 原文 + 元信息）
 *   contract.json             ←  镜像 /_bus/contract        （EVALUATION_CONTRACT.md 原文 + 元信息）
 *   products.json             ←  镜像 /_bus/products        （PRODUCTS.json + 元信息）
 *   outbox/index.json         ←  镜像 /_bus/outbox          （{results: OutboxListItem[]}）
 *   outbox/{taskId}/bundle.json
 *                             ←  镜像 /_bus/outbox/:taskId  （{taskId,latestVersion,versions,latest}）
 *   outbox/{taskId}/v{n}.json ←  原样拷贝 .evaluations/outbox/{taskId}/v{n}.json
 *   public-bundle.json        ←  首次打开网页时载入的 queries+submissions+products 元数据
 *                                （不含 submission.content 正文，避免 bundle 过大）
 *   reports/{submissionId}.md ←  每条 submission 的正文单拆一份 md，懒加载
 *   health.json               ←  {ok:true,dir:"<baked>"}   纯占位，让 prod 下 /_bus/health 也能应答
 *   bake-manifest.json        ←  本次烘焙的元信息（bakedAt、文件 hash、来源 snapshot 等）
 *
 * 数据源（优先级从高到低）：
 *   (1) .evaluations/*                                               ←  唯一事实源
 *   (2) .evaluations/_runtime-snapshot.json（可选）                   ←  管理员用 npm run export-snapshot 导出
 *   (3) src/seed.ts 的 SEED_SNAPSHOT                                 ←  兜底（首次打开网页也是用它）
 *
 * 冲突策略：若同一个 id 在 (2) 和 (3) 都出现，(2) 覆盖 (3)，因为 runtime snapshot
 * 是最新的。但脚本会在 stderr 打印 "overrode from snapshot" 帮助你确认。
 *
 * 严格校验（fail fast）：
 *   - outbox JSON 里出现的所有 reportId 必须在合并后的 submissions 里能找到
 *   - 若不满足，脚本直接 exit 1 并列出悬挂 reportId 对应的 taskId
 *     → 管理员需要先跑 `npm run export-snapshot` 把本地最新 submissions 倒出来
 *
 * 调用姿势：
 *   node scripts/bake-public-data.mjs                  # 正常烘焙
 *   node scripts/bake-public-data.mjs --allow-orphan   # 放宽校验（仅调试用）
 *   node scripts/bake-public-data.mjs --out dist-data  # 自定义输出目录
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { checkBakeFreshness } from "./check-bake-freshness.mjs";

// ------------------------------------------------------------
// CLI args
// ------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const idx = argv.indexOf(name);
  if (idx >= 0 && idx < argv.length - 1) return argv[idx + 1];
  return fallback;
};

const ALLOW_ORPHAN = flag("--allow-orphan");

// ------------------------------------------------------------
// 路径
// ------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const EV_DIR = path.join(PROJECT_ROOT, ".evaluations");
const OUT_DIR = path.resolve(PROJECT_ROOT, option("--out", "public/data"));
const RUNTIME_SNAPSHOT_PATH = path.join(EV_DIR, "_runtime-snapshot.json");

function rel(p) {
  return path.relative(PROJECT_ROOT, p);
}

function log(level, ...args) {
  const tag = level === "error" ? "\x1b[31m[bake:error]\x1b[0m" : level === "warn" ? "\x1b[33m[bake:warn]\x1b[0m" : "\x1b[36m[bake]\x1b[0m";
  // eslint-disable-next-line no-console
  console[level === "error" ? "error" : "log"](tag, ...args);
}

function die(msg, extra) {
  log("error", msg);
  if (extra) log("error", extra);
  process.exit(1);
}

// ------------------------------------------------------------
// 基础 IO
// ------------------------------------------------------------
function readJson(filePath, required = true) {
  if (!fs.existsSync(filePath)) {
    if (required) die(`File not found: ${rel(filePath)}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    die(`Invalid JSON: ${rel(filePath)}`, String(err?.message ?? err));
    return null;
  }
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) die(`File not found: ${rel(filePath)}`);
  return fs.readFileSync(filePath, "utf8");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(target, payload) {
  ensureDir(path.dirname(target));
  const body = JSON.stringify(payload, null, 2);
  fs.writeFileSync(target, body);
  return body.length;
}

function writeText(target, content) {
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, content);
  return content.length;
}

function sha1(s) {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
}

function statMs(p) {
  return fs.statSync(p).mtimeMs;
}

// ------------------------------------------------------------
// 清理旧产物（避免残留已删除的 outbox）
// ------------------------------------------------------------
function cleanOutDir() {
  if (!fs.existsSync(OUT_DIR)) return;
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
}

// ------------------------------------------------------------
// 读取 seed（从 TS 源码里用正则抠 SEED_SNAPSHOT 不可靠，改用 subprocess 加载）
//
// 注意：我们不用 tsx/ts-node，直接运行同目录的 CJS/ESM 版 loader；
// 这里选择从 .evaluations/_seed-export.json 读——
// 如果没生成，就自己从 src/seed.ts 解析一遍。
//
// 更稳的做法：让 package.json 的 build:public 脚本在跑本脚本前先用
// vite build-ssr/esbuild 把 seed 编译成 cjs/json；但为了不引新依赖，
// 我们采用一个"简单但够用"的方案：用 esbuild-less 的纯 Node 动态 import
// + .ts 转换——不行；所以本脚本直接从 .evaluations/_seed-export.json 读。
// 生成这份 JSON 的逻辑放在 scripts/export-snapshot.mjs 里（也会顺带
// dump 当前浏览器的 localStorage；两者合并得到最终 submissions）。
// ------------------------------------------------------------

/**
 * 读 seed 作为基础层。
 *
 * 路径优先级：
 *   1) .evaluations/_seed-snapshot.json （由 `npm run seed:dump` 生成，推荐）
 *   2) 如果没有，抛出明确的错误提示用户跑 seed:dump
 *
 * seed 是类型安全的 TS 源码，直接在 Node 里 import .ts 会失败；
 * 所以把 seed "物化" 成 JSON 是最简单的架构。
 * 这个 JSON 也进 git，保证 CI 上无 Node 转译依赖就能 bake。
 */
function loadSeedSnapshot() {
  const file = path.join(EV_DIR, "_seed-snapshot.json");
  if (fs.existsSync(file)) {
    const j = readJson(file);
    log("log", `seed: loaded ${rel(file)} (${(j.queries ?? []).length} queries, ${(j.submissions ?? []).length} submissions)`);
    return j;
  }
  die(
    `Missing ${rel(file)}. Run \`npm run seed:dump\` first to materialize src/seed.ts into JSON. ` +
    `This step decouples the bake script from TS toolchain.`
  );
  return null;
}

/**
 * 读运行时 snapshot（可选）。
 * 结构与 LabSnapshot 一致：{ version, exportedAt, products, queries, submissions }
 */
function loadRuntimeSnapshot() {
  if (!fs.existsSync(RUNTIME_SNAPSHOT_PATH)) {
    log("log", `runtime snapshot: ${rel(RUNTIME_SNAPSHOT_PATH)} not present; using seed only`);
    return null;
  }
  const j = readJson(RUNTIME_SNAPSHOT_PATH);
  log("log", `runtime snapshot: loaded ${rel(RUNTIME_SNAPSHOT_PATH)} (${(j.queries ?? []).length} queries, ${(j.submissions ?? []).length} submissions, exportedAt=${j.exportedAt ?? "?"})`);
  return j;
}

function mergeSnapshots(seed, runtime) {
  if (!runtime) return seed;
  const byId = (arr) => {
    const m = new Map();
    for (const x of arr) m.set(x.id, x);
    return m;
  };
  const merge = (seedArr, rtArr, kind) => {
    const m = byId(seedArr);
    let overridden = 0;
    let added = 0;
    for (const x of rtArr ?? []) {
      if (m.has(x.id)) overridden++; else added++;
      m.set(x.id, x);
    }
    if (overridden || added) {
      log("log", `merge/${kind}: seed=${seedArr.length}, runtime=${(rtArr ?? []).length}, overridden=${overridden}, added=${added}`);
    }
    return Array.from(m.values());
  };
  return {
    version: runtime.version ?? seed.version,
    exportedAt: runtime.exportedAt ?? seed.exportedAt,
    products: merge(seed.products ?? [], runtime.products ?? [], "products"),
    queries: merge(seed.queries ?? [], runtime.queries ?? [], "queries"),
    submissions: merge(seed.submissions ?? [], runtime.submissions ?? [], "submissions"),
  };
}

// ------------------------------------------------------------
// 编号注册簿一致性校验（架构硬约束）
// ------------------------------------------------------------
// bake 脚本不该再"猜" code 是什么——编号的单一事实源是 _code-registry.json。
// 这里做两件事：
//   1) 如果注册簿存在：把每条 query.code 强制对齐到注册簿上的值（防御式纠错）
//   2) 校验合并后的 queries 数组中 code 全局唯一，若发现冲突直接 fail fast
//      （如果冲突，说明前端越过 register-code 端点直接造了 query，这是 bug）
//
// 注册簿缺失时（冷启动 / 老工程） 只做唯一性校验，给个 warn 就继续，
// 避免阻塞首次烘焙。
function alignWithCodeRegistry(snapshot) {
  const regFile = path.join(EV_DIR, "_code-registry.json");
  let registry = null;
  if (fs.existsSync(regFile)) {
    registry = readJson(regFile, false);
  }
  const queries = snapshot.queries ?? [];

  // Step A：注册簿存在时，按 queryId 同步 code
  if (registry && Array.isArray(registry.entries)) {
    const byQueryId = new Map(
      registry.entries.map((e) => [e.queryId, e.code])
    );
    let fixed = 0;
    for (const q of queries) {
      if (!q?.id) continue;
      const authoritative = byQueryId.get(q.id);
      if (authoritative && q.code !== authoritative) {
        log("warn", `query ${q.id}: code ${q.code} → ${authoritative} (registry)`);
        q.code = authoritative;
        fixed++;
      }
    }
    if (fixed) log("log", `code-registry: aligned ${fixed} query code(s) to registry`);
  } else {
    log("warn", `code-registry: ${rel(regFile)} not found; skipping authoritative alignment`);
  }

  // Step B：全局唯一性校验
  const codeCounts = new Map();
  for (const q of queries) {
    if (!q?.code) continue;
    const list = codeCounts.get(q.code) ?? [];
    list.push(q.id);
    codeCounts.set(q.code, list);
  }
  const dupes = [...codeCounts.entries()].filter(([, ids]) => ids.length > 1);
  if (dupes.length > 0) {
    const lines = dupes.map(
      ([code, ids]) => `  · ${code} → queryIds: ${ids.join(", ")}`
    );
    die(
      `Found duplicate query codes after merge (registry invariant violated):\n` +
        lines.join("\n") +
        `\n\nHint: delete ${rel(regFile)} then restart dev server — reconcile will reassign unique codes.`
    );
  }
  log("log", `code-registry: uniqueness check passed (${queries.length} queries)`);
}

// ------------------------------------------------------------
// 扫 outbox
// ------------------------------------------------------------
function parseQueryCode(taskId) {
  // 与 vite-plugins/evaluationBus.ts 的 parseQueryCode 对齐：
  // 取第一段 "-" 之前的前缀作为 queryCode（EV-0001-o13pwo → "EV-0001"）
  const m = taskId.match(/^([A-Z]+-\d+)/);
  return m ? m[1] : undefined;
}

function listOutboxTasks() {
  const outboxDir = path.join(EV_DIR, "outbox");
  if (!fs.existsSync(outboxDir)) {
    log("warn", `${rel(outboxDir)} not present; no evaluations will be baked`);
    return [];
  }
  const taskDirs = fs
    .readdirSync(outboxDir)
    .filter((f) => fs.statSync(path.join(outboxDir, f)).isDirectory());

  const tasks = [];
  for (const taskId of taskDirs) {
    const dir = path.join(outboxDir, taskId);
    const files = fs
      .readdirSync(dir)
      .map((f) => {
        const m = f.match(/^v(\d+)\.json$/);
        if (!m) return null;
        const full = path.join(dir, f);
        const stat = fs.statSync(full);
        return { v: Number(m[1]), file: f, full, mtime: stat.mtimeMs, size: stat.size };
      })
      .filter(Boolean)
      .sort((a, b) => a.v - b.v);
    if (files.length === 0) continue;
    tasks.push({
      taskId,
      queryCode: parseQueryCode(taskId),
      versions: files,
    });
  }
  return tasks;
}

// ------------------------------------------------------------
// 产物烘焙
// ------------------------------------------------------------
function bakeStandard() {
  const src = path.join(EV_DIR, "RUBRIC_STANDARD.md");
  const content = readText(src);
  const stat = fs.statSync(src);
  const payload = {
    path: rel(src),
    mtime: stat.mtimeMs,
    size: stat.size,
    content,
  };
  const out = path.join(OUT_DIR, "standard.json");
  writeJson(out, payload);
  return out;
}

function bakeContract() {
  const src = path.join(EV_DIR, "EVALUATION_CONTRACT.md");
  const content = readText(src);
  const stat = fs.statSync(src);
  const payload = {
    path: rel(src),
    mtime: stat.mtimeMs,
    size: stat.size,
    content,
  };
  const out = path.join(OUT_DIR, "contract.json");
  writeJson(out, payload);
  return out;
}

function bakeProducts() {
  const src = path.join(EV_DIR, "PRODUCTS.json");
  const raw = readText(src);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    die(`PRODUCTS.json is not valid JSON: ${err.message}`);
    return null;
  }
  const stat = fs.statSync(src);
  const payload = {
    path: rel(src),
    mtime: stat.mtimeMs,
    size: stat.size,
    updatedAt: parsed?.updatedAt ?? null,
    products: Array.isArray(parsed?.products) ? parsed.products : [],
  };
  const out = path.join(OUT_DIR, "products.json");
  writeJson(out, payload);
  return out;
}

function bakeHealth(bakedAt) {
  const out = path.join(OUT_DIR, "health.json");
  writeJson(out, { ok: true, dir: "baked", bakedAt });
  return out;
}

/**
 * 把 .evaluations/_publish-log.json 的只读副本烘焙到 public/data/publish-log.json。
 *
 * - 管理员版直读 /_bus/publish-log（文件本身）
 * - 对外版通过 ${BASE}/data/publish-log.json 拿到同一份副本
 *
 * 同时返回最近一次"成功发布"的时间戳，用来写进 public-bundle.meta.lastPublishedAt
 * （供页脚展示"上次更新时间"）。找不到日志或日志为空时返回 null。
 */
function bakePublishLog() {
  const src = path.join(EV_DIR, "_publish-log.json");
  const out = path.join(OUT_DIR, "publish-log.json");
  if (!fs.existsSync(src)) {
    // 第一次部署或从未发布过：写一份空的，保持契约不变
    writeJson(out, { version: 1, entries: [] });
    return { lastPublishedAt: null, lastOk: null };
  }
  const raw = readJson(src, false);
  if (!raw || !Array.isArray(raw.entries)) {
    writeJson(out, { version: 1, entries: [] });
    return { lastPublishedAt: null, lastOk: null };
  }
  writeJson(out, { version: 1, entries: raw.entries });
  // 找最近一次 ok=true 的发布
  const okEntries = raw.entries.filter((e) => e && e.ok);
  const last = okEntries.length ? okEntries[okEntries.length - 1] : null;
  return {
    lastPublishedAt: last?.publishedAt ?? null,
    lastOk: last ?? null,
  };
}

function bakeOutbox(tasks, codeToQueryId) {
  const outboxOut = path.join(OUT_DIR, "outbox");
  ensureDir(outboxOut);

  /**
   * 从 queryCode 反查 queryId 并注入 payload（冗余字段）。
   * - 原本前端靠 taskId 前缀解析 code，再用 code 匹配 query
   * - 加 queryId 之后，前端可以直接 payload.queryId → query，不依赖 code
   * - 如果哪天 code 再被改，只要 queryId 稳定（它是永久 id），查找就不会断
   * 找不到对应 queryId 时注入 null；前端按 fallback 走。
   */
  const resolveQueryId = (queryCode) => {
    if (!queryCode) return null;
    return codeToQueryId?.get(queryCode) ?? null;
  };

  // index.json
  const indexItems = tasks
    .map((t) => {
      const latest = t.versions[t.versions.length - 1];
      return {
        taskId: t.taskId,
        queryCode: t.queryCode,
        queryId: resolveQueryId(t.queryCode),
        latestVersion: latest.v,
        latestMtime: latest.mtime,
        versions: t.versions.map((v) => ({ v: v.v, mtime: v.mtime, size: v.size })),
      };
    })
    .sort((a, b) => b.latestMtime - a.latestMtime);
  writeJson(path.join(outboxOut, "index.json"), { results: indexItems });

  // 每个 task：bundle.json + 所有 v{n}.json
  const allPayloads = new Map(); // taskId -> latest payload (供 reportId 校验)
  for (const t of tasks) {
    const dir = path.join(outboxOut, t.taskId);
    ensureDir(dir);
    const qId = resolveQueryId(t.queryCode);
    const versionPayloads = [];
    for (const v of t.versions) {
      const j = readJson(v.full);
      // 注入 queryId 冗余字段（不覆盖已有的 queryId，兼容历史数据）
      if (j && typeof j === "object" && !j.queryId && qId) {
        j.queryId = qId;
      }
      versionPayloads.push({ v: v.v, payload: j });
      writeJson(path.join(dir, `v${v.v}.json`), j);
    }
    const latest = versionPayloads[versionPayloads.length - 1];
    const bundle = {
      taskId: t.taskId,
      queryId: qId,
      latestVersion: latest.v,
      versions: t.versions.map((v) => ({ v: v.v, mtime: v.mtime, size: v.size })),
      latest: latest.payload,
    };
    writeJson(path.join(dir, "bundle.json"), bundle);
    allPayloads.set(t.taskId, latest.payload);
  }
  return { indexCount: indexItems.length, allPayloads };
}

// ------------------------------------------------------------
// 严格校验：outbox 里提到的 reportId 必须能在 submissions 中找到
// ------------------------------------------------------------
function validateReportIds(allPayloads, submissions) {
  const subIds = new Set(submissions.map((s) => s.id));
  const dangling = []; // {taskId, reportId, productName}
  for (const [taskId, payload] of allPayloads) {
    const items = payload?.summary?.overallScores ?? [];
    for (const o of items) {
      if (!subIds.has(o.reportId)) {
        dangling.push({ taskId, reportId: o.reportId, productName: o.productName });
      }
    }
  }
  if (dangling.length === 0) {
    log("log", `report-id integrity: ok (${submissions.length} submissions, ${allPayloads.size} outbox tasks)`);
    return;
  }
  const lines = dangling.map((d) => `  · ${d.taskId}  reportId=${d.reportId}  (product=${d.productName})`);
  const msg =
    `Found ${dangling.length} dangling reportId(s) in outbox—these reports won't resolve to any submission:\n` +
    lines.join("\n") +
    `\n\nHint: run \`npm run export-snapshot\` to dump your local admin browser localStorage ` +
    `into .evaluations/_runtime-snapshot.json, then re-run bake.`;
  if (ALLOW_ORPHAN) {
    log("warn", msg);
  } else {
    die(msg);
  }
}

// ------------------------------------------------------------
// 烘焙 public-bundle + reports
// ------------------------------------------------------------
function bakePublicBundle(snapshot, bakedAt, publishMeta) {
  // 只发布 outbox 相关的 queries 与 submissions：
  //   - 凡是在 outbox 里被引用过的 query.code → 全保留
  //   - 凡是在 outbox 里被引用过的 submission.id → 全保留
  //   - 其他"只在本地 localStorage 里但没评测结果"的数据不对外发布
  //
  // 这样可以避免管理员本地的实验性草稿、未完成 query 泄露到公网。
  // 同时确保每条发布的评测都"有得看"（reportId 能落到 submission）。
  //
  // 注意：一个 query 如果压根没 outbox 任务，也会被裁掉——这是刻意的：
  // 对外版只展示"已经评过的题"，没评的题按空态处理（通过 QueriesPage
  // 的 outboxAgg 自然空过，不需要单独处理）。
  const outboxDir = path.join(EV_DIR, "outbox");
  let usedReportIds = new Set();
  let usedQueryCodes = new Set();
  if (fs.existsSync(outboxDir)) {
    for (const taskId of fs.readdirSync(outboxDir)) {
      const code = parseQueryCode(taskId);
      if (code) usedQueryCodes.add(code);
      const dir = path.join(outboxDir, taskId);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const file of fs.readdirSync(dir)) {
        if (!/^v\d+\.json$/.test(file)) continue;
        const j = readJson(path.join(dir, file), false);
        for (const o of j?.summary?.overallScores ?? []) {
          if (o.reportId) usedReportIds.add(o.reportId);
        }
      }
    }
  }

  const queries = (snapshot.queries ?? []).filter((q) => usedQueryCodes.has(q.code));

  // --- P0-1 双向完整性校验：每个 outbox 引用的 queryCode 必须能在裁剪后的 queries 中找到 ---
  // 症状（若失守）：对外版 /data/outbox/index.json 有某 taskId，但 public-bundle 的 queries
  // 里没对应 queryCode，outboxAgg 按 code 匹配不上 → 任务在对外版静默消失，管理员无感。
  // 典型触发：管理员本地删除了 query 但 `.evaluations/outbox/{taskId}/` 没手动清；或
  // export-snapshot 晚于删除动作。失败就 fail fast，强制管理员清理孤儿 outbox 再发布。
  {
    const codesInQueries = new Set(queries.map((q) => q.code));
    const missing = [...usedQueryCodes].filter((c) => c && !codesInQueries.has(c));
    if (missing.length > 0) {
      const lines = missing.map((code) => `  · queryCode=${code}`);
      die(
        `Found ${missing.length} outbox queryCode(s) without matching query in snapshot:\n` +
          lines.join("\n") +
          `\n\nHint: 孤儿 outbox 任务——对应 query 已从 snapshot 中移除，但磁盘上 .evaluations/outbox/ ` +
          `下仍有该 queryCode 前缀的 task 目录。\n` +
          `      请手动清理 .evaluations/outbox/ 下这些 taskId 目录后重试；或补回 snapshot 里的 query。`
      );
    }
    log("log", `outbox↔queries integrity: ok (${usedQueryCodes.size} referenced queryCodes all resolved)`);
  }

  const subs = (snapshot.submissions ?? []).filter((s) => usedReportIds.has(s.id));
  // 裁掉 submission.content，改拆到 reports/{id}.md；只保留轻量元数据
  const lightSubs = subs.map((s) => ({
    ...s,
    content: undefined,           // 正文转到 /data/reports/{id}.md
    contentRef: `reports/${s.id}.md`,
  }));

  // 写每份 submission 正文
  const reportsDir = path.join(OUT_DIR, "reports");
  ensureDir(reportsDir);
  for (const s of subs) {
    writeText(path.join(reportsDir, `${s.id}.md`), s.content ?? "");
  }

  const bundle = {
    bakedAt,
    contractVersion: "1.0",
    // 产品清单走 products.json（有独立端点），这里不重复；但为了首屏减少一次请求，
    // 也内嵌一份（ProductsPage 仍走 products.json 以取 updatedAt/path 等元信息）
    products: readJson(path.join(OUT_DIR, "products.json")).products,
    queries,
    submissions: lightSubs,
    /** 用来在 UI 上展示"距今多久前 baked"；若显示陈旧可提示用户刷新/反馈 */
    stats: {
      queriesCount: queries.length,
      submissionsCount: subs.length,
      reportsCount: subs.length,
    },
    /**
     * 最近一次"一键发布"的时间戳（来自 .evaluations/_publish-log.json）。
     * - bakedAt 反映"CI 打包"时间（每次 push 都会变）
     * - lastPublishedAt 反映"用户点对外更新按钮"时间（稳定可追溯）
     * 页脚应该优先展示 lastPublishedAt，让管理员和访客用同一个基准对比两端一致性。
     */
    meta: {
      lastPublishedAt: publishMeta?.lastPublishedAt ?? null,
      lastPublishOk: publishMeta?.lastOk ? true : null,
    },
  };
  const out = path.join(OUT_DIR, "public-bundle.json");
  const size = writeJson(out, bundle);
  log("log", `public-bundle: ${bundle.stats.queriesCount} queries, ${bundle.stats.submissionsCount} submissions, reports=${subs.length}, ${size} bytes`);
  return { out, bundle };
}

// ------------------------------------------------------------
// Manifest：记录 bake 自身的元信息（方便排查"发布的是哪份"）
// ------------------------------------------------------------
function bakeManifest(bakedAt, extras) {
  const manifest = {
    bakedAt,
    bakedBy: process.env.USER ?? process.env.USERNAME ?? "unknown",
    bakedFromCwd: PROJECT_ROOT,
    ...extras,
  };
  const out = path.join(OUT_DIR, "bake-manifest.json");
  writeJson(out, manifest);
  return out;
}

// ------------------------------------------------------------
// 主流程
// ------------------------------------------------------------
function main() {
  log("log", `project root: ${PROJECT_ROOT}`);
  log("log", `output dir:   ${OUT_DIR}`);
  cleanOutDir();
  ensureDir(OUT_DIR);

  const bakedAt = new Date().toISOString();

  // 1) 数据层：seed + runtime snapshot 合并
  const seed = loadSeedSnapshot();
  const runtime = loadRuntimeSnapshot();
  const snapshot = mergeSnapshots(seed, runtime);

  // 1.5) 注册簿对齐 + 全局唯一性校验（失败即退出）
  //      从 2026-04-20 架构升级起，code 的单一事实源是 _code-registry.json。
  //      任何 code 冲突都会在这里被识破并 fail fast。
  alignWithCodeRegistry(snapshot);

  // 2) 元数据产物
  bakeStandard();
  bakeContract();
  bakeProducts();
  bakeHealth(bakedAt);
  const publishMeta = bakePublishLog();
  if (publishMeta.lastPublishedAt) {
    log("log", `publish-log: last OK publish at ${publishMeta.lastPublishedAt}`);
  } else {
    log("log", `publish-log: no prior successful publishes`);
  }

  // 3) outbox 产物
  //    构建 code → queryId 映射（snapshot.queries 此时已经被 alignWithCodeRegistry
  //    强制对齐到注册簿，所以这里取出来的 code 是权威的）。
  //    bakeOutbox 会把 queryId 冗余写进 index/payload/bundle，
  //    即便将来 code 再被改，前端也能靠 queryId 稳定地回链 query。
  const codeToQueryId = new Map();
  for (const q of snapshot.queries ?? []) {
    if (q?.code && q?.id) codeToQueryId.set(q.code, q.id);
  }
  const outboxTasks = listOutboxTasks();
  log("log", `outbox tasks: ${outboxTasks.length}`);
  const { indexCount, allPayloads } = bakeOutbox(outboxTasks, codeToQueryId);
  log("log", `outbox baked: ${indexCount} tasks, ${[...allPayloads.values()].length} latest payloads`);

  // 4) 校验 reportId 完整性（失败即退出）
  validateReportIds(allPayloads, snapshot.submissions ?? []);

  // 5) public-bundle + reports/*.md
  const { bundle } = bakePublicBundle(snapshot, bakedAt, publishMeta);

  // 6) manifest
  bakeManifest(bakedAt, {
    seedHash: sha1(JSON.stringify(seed)),
    runtimeSnapshotPresent: runtime !== null,
    runtimeSnapshotHash: runtime ? sha1(JSON.stringify(runtime)) : null,
    outboxTasksCount: outboxTasks.length,
    publicBundleStats: bundle.stats,
  });

  // 7) 自检：烘焙完立即跑一次 freshness check，确认产物和源文件内容对齐
  //
  // 这是"机械警卫"——bake 逻辑写对了的话这里必过；但如果未来有人加了新产物却
  // 忘了同步到 check-bake-freshness 的规则，或者 bake 的某个字段拼写错了，
  // 这一层会立刻 fail fast，避免把"看起来成功、实际陈旧"的产物推到线上。
  //
  // 失败时 die() 让 CI/一键发布链路整体挂掉，比事后排查强一万倍。
  try {
    const post = checkBakeFreshness();
    if (!post.fresh) {
      const lines = post.stale.slice(0, 10).map((s) => `  · [${s.kind}] ${s.detail}`);
      die(
        `bake finished but self-check still reports ${post.stale.length} stale item(s):\n` +
          lines.join("\n") +
          (post.stale.length > 10 ? `\n  ……还有 ${post.stale.length - 10} 项` : "") +
          `\n\n这意味着 bake 脚本自身有 bug（新产物规则漏同步？字段拼错？）。不应该发布。`
      );
    }
    log("log", `self-check: bake artifacts fully aligned with source files (${post.items.length} items verified)`);
  } catch (e) {
    // die() 已经 exit(1)，这里只处理 checkBakeFreshness 本身的意外异常
    if (e?.message?.includes("still reports")) throw e;
    log("warn", `self-check failed to run (non-fatal): ${e?.message ?? e}`);
  }

  log("log", `done. bakedAt=${bakedAt}`);
}

try {
  main();
} catch (err) {
  log("error", "unexpected failure:", String(err?.stack ?? err));
  process.exit(1);
}
