#!/usr/bin/env node
/**
 * migrate-consolidate-outbox.mjs
 *
 * 契约 v3.4（2026-04-28）一次性迁移：把历史碎片化的 taskId 目录扁平化成 queryCode 目录。
 *
 * 历史（v1.0 ~ v3.3）：
 *   .evaluations/outbox/EV-0002-N3e5zP/v1.json
 *   .evaluations/outbox/EV-0002-XDwwz7/v1.json
 *   .evaluations/outbox/EV-0002-o13pwo/v1.json
 *   .evaluations/outbox/EV-0002-pUlesZ/v1.json
 *
 *   .evaluations/inbox/EV-0002-N3e5zP.json
 *   .evaluations/inbox/EV-0002-XDwwz7.json
 *   …
 *
 * 目标（v3.4）：
 *   .evaluations/outbox/EV-0002/v1.json ~ v4.json   （按 mtime 顺序重编号）
 *   .evaluations/inbox/EV-0002.json                 （按 candidateId 合并）
 *
 * 使用：
 *   node scripts/migrate-consolidate-outbox.mjs           # dry-run，只打印计划
 *   node scripts/migrate-consolidate-outbox.mjs --apply   # 真正执行
 *
 * 策略：
 *   - 幂等：识别并跳过已扁平化的目录/文件
 *   - 安全：dry-run 默认打印到 stdout，不动磁盘
 *   - 产物内 taskId 字段一并重写为新值（扁平化后 taskId === queryCode）
 *   - 原目录/文件在 --apply 后会被删除（合并完成后）
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EV_DIR = path.join(ROOT, ".evaluations");
const OUTBOX_DIR = path.join(EV_DIR, "outbox");
const INBOX_DIR = path.join(EV_DIR, "inbox");

const APPLY = process.argv.includes("--apply");

const QUERY_CODE_RE = /^([A-Z]+-\d+)/;

/** 解析目录/文件名前缀 queryCode */
function parseQueryCode(name) {
  const base = name.replace(/\.json$/, "");
  const m = QUERY_CODE_RE.exec(base);
  return m ? m[1] : null;
}

function isFlattenedName(name) {
  // "EV-0002" 或 "EV-0002.json"
  return /^[A-Z]+-\d+(\.json)?$/.test(name);
}

function log(...args) {
  console.log(...args);
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    log(`  [!] 读取失败 ${p}: ${e.message}`);
    return null;
  }
}

function writeJsonAtomic(p, obj) {
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}

// ──────────────────────────────────────────────────────────
// outbox 迁移
// ──────────────────────────────────────────────────────────

function planOutbox() {
  if (!fs.existsSync(OUTBOX_DIR)) return [];
  const entries = fs.readdirSync(OUTBOX_DIR);

  // 按 queryCode 分组
  /** @type {Map<string, Array<{dir: string, versions: Array<{file: string, mtime: number, taskId: string}>}>>} */
  const byCode = new Map();

  for (const name of entries) {
    const full = path.join(OUTBOX_DIR, name);
    const stat = fs.statSync(full);
    if (!stat.isDirectory()) continue;

    const code = parseQueryCode(name);
    if (!code) {
      log(`  [skip] 无法解析 queryCode: ${name}`);
      continue;
    }

    const versions = [];
    for (const vf of fs.readdirSync(full)) {
      const m = vf.match(/^v(\d+)\.json$/);
      if (!m) continue;
      const stat2 = fs.statSync(path.join(full, vf));
      versions.push({
        file: vf,
        mtime: stat2.mtimeMs,
        originalTaskId: name,
        originalVersion: Number(m[1]),
      });
    }
    if (versions.length === 0) continue;

    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push({ dir: name, versions });
  }

  // 生成迁移计划
  const plan = [];
  for (const [code, dirs] of byCode) {
    // 已是扁平化目录且 queryCode 下没有其他旧目录 → 跳过
    if (dirs.length === 1 && dirs[0].dir === code) continue;

    // 所有旧版本按 mtime 排序，重新编号为 v1..vN
    const allVersions = [];
    for (const d of dirs) {
      for (const v of d.versions) {
        allVersions.push({ ...v, fromDir: d.dir });
      }
    }
    allVersions.sort((a, b) => a.mtime - b.mtime);
    const reassigned = allVersions.map((v, i) => ({
      ...v,
      newVersion: i + 1,
    }));

    plan.push({ code, dirs, reassigned });
  }
  return plan;
}

function applyOutboxPlan(plan) {
  for (const { code, dirs, reassigned } of plan) {
    const targetDir = path.join(OUTBOX_DIR, code);
    const targetExists = fs.existsSync(targetDir);

    if (APPLY) {
      // 若目标已存在且是 dirs 中之一（即 queryCode 本身就是一个旧目录）
      // 先挪到临时目录避免冲突
      let moved = false;
      if (targetExists && dirs.some((d) => d.dir === code)) {
        const tmp = path.join(OUTBOX_DIR, `__tmp_${code}`);
        fs.renameSync(targetDir, tmp);
        // 修正 fromDir 引用
        for (const r of reassigned) {
          if (r.fromDir === code) r.fromDir = `__tmp_${code}`;
        }
        moved = true;
      }
      fs.mkdirSync(targetDir, { recursive: true });
      log(`  [outbox] ${code}: 合并 ${dirs.length} 个源目录 → ${code}/ （共 ${reassigned.length} 个版本${moved ? "，已临时保护同名目录" : ""}）`);
    } else {
      log(`  [outbox] ${code}: 将合并 ${dirs.length} 个源目录 → ${code}/ （共 ${reassigned.length} 个版本）`);
    }

    // 写入新版本
    for (const v of reassigned) {
      const src = path.join(OUTBOX_DIR, v.fromDir, v.file);
      const dstName = `v${v.newVersion}.json`;
      const dst = path.join(targetDir, dstName);
      if (APPLY) {
        const j = readJsonSafe(src);
        if (!j) {
          log(`    [!] 跳过损坏文件 ${src}`);
          continue;
        }
        // 改写 payload 内部 taskId + version 字段
        j.taskId = code;
        j.version = v.newVersion;
        writeJsonAtomic(dst, j);
      }
      log(`    ${v.fromDir}/${v.file} (mtime=${new Date(v.mtime).toISOString()}) → ${code}/${dstName}`);
    }

    // 删除原目录
    if (APPLY) {
      for (const d of dirs) {
        if (d.dir === code) continue; // 目标目录本身不要删
        const toRemove = path.join(OUTBOX_DIR, d.dir);
        if (fs.existsSync(toRemove)) {
          fs.rmSync(toRemove, { recursive: true, force: true });
          log(`    [rm] ${d.dir}/`);
        }
      }
      // 清理可能的临时目录
      const tmp = path.join(OUTBOX_DIR, `__tmp_${code}`);
      if (fs.existsSync(tmp)) {
        fs.rmSync(tmp, { recursive: true, force: true });
        log(`    [rm] __tmp_${code}/`);
      }
    }
  }
}

// ──────────────────────────────────────────────────────────
// inbox 迁移
// ──────────────────────────────────────────────────────────

function planInbox() {
  if (!fs.existsSync(INBOX_DIR)) return [];
  const files = fs.readdirSync(INBOX_DIR).filter((f) => f.endsWith(".json"));

  /** @type {Map<string, Array<{file: string, mtime: number}>>} */
  const byCode = new Map();
  for (const f of files) {
    const code = parseQueryCode(f);
    if (!code) continue;
    const stat = fs.statSync(path.join(INBOX_DIR, f));
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push({ file: f, mtime: stat.mtimeMs });
  }

  const plan = [];
  for (const [code, items] of byCode) {
    // 已是扁平化且是唯一文件 → 跳过
    if (items.length === 1 && items[0].file === `${code}.json`) continue;
    items.sort((a, b) => a.mtime - b.mtime);
    plan.push({ code, items });
  }
  return plan;
}

/**
 * 合并多个 inbox payload：
 *   - 顶层字段（query / inboxSchemaVersion / createdAt）以最晚文件为准
 *   - candidates 按 candidateId 合并；同 candidateId 的 reportVersions 按 version 去重
 *   - activeReportVersion 以最晚文件的值为准（若该 version 在合并后的 reportVersions 存在）
 *   - taskId 改写为 code
 */
function mergeInboxPayloads(code, sortedItems) {
  /** @type {Record<string, unknown> | null} */
  let base = null;
  /** @type {Map<string, Record<string, unknown>>} */
  const candidateMap = new Map();

  for (const { file } of sortedItems) {
    const full = path.join(INBOX_DIR, file);
    const j = readJsonSafe(full);
    if (!j) continue;
    base = { ...(base ?? {}), ...j };
    const candidates = Array.isArray(j.candidates) ? j.candidates : [];
    for (const c of candidates) {
      const cid = c?.candidateId;
      if (typeof cid !== "string") continue;
      const prev = candidateMap.get(cid);
      if (!prev) {
        candidateMap.set(cid, { ...c });
      } else {
        // 合并 reportVersions
        const prevVs = Array.isArray(prev.reportVersions) ? prev.reportVersions : [];
        const nextVs = Array.isArray(c.reportVersions) ? c.reportVersions : [];
        const vMap = new Map();
        for (const v of prevVs) if (v?.version != null) vMap.set(Number(v.version), v);
        for (const v of nextVs) if (v?.version != null) vMap.set(Number(v.version), v);
        const mergedVs = Array.from(vMap.values()).sort(
          (a, b) => Number(a.version) - Number(b.version)
        );
        const merged = {
          ...prev,
          ...c,
          reportVersions: mergedVs,
        };
        // activeReportVersion 以最晚文件为准（c 覆盖 prev）
        candidateMap.set(cid, merged);
      }
    }
  }

  if (!base) return null;
  base.taskId = code;
  base.candidates = Array.from(candidateMap.values());
  return base;
}

function applyInboxPlan(plan) {
  for (const { code, items } of plan) {
    const target = path.join(INBOX_DIR, `${code}.json`);
    log(`  [inbox]  ${code}: 合并 ${items.length} 个文件 → ${code}.json`);
    for (const it of items) {
      log(`    ${it.file} (mtime=${new Date(it.mtime).toISOString()})`);
    }
    if (APPLY) {
      const merged = mergeInboxPayloads(code, items);
      if (!merged) {
        log(`    [!] ${code}: 合并结果为空，跳过`);
        continue;
      }
      // 若目标已存在且不在 items 中（不应发生，因为 items 就是所有 EV-XXXX* 文件）——直接覆盖
      writeJsonAtomic(target, merged);
      // 删除除 target 外的所有源文件
      for (const it of items) {
        if (it.file === `${code}.json`) continue;
        const src = path.join(INBOX_DIR, it.file);
        if (fs.existsSync(src)) {
          fs.unlinkSync(src);
          log(`    [rm] ${it.file}`);
        }
      }
    }
  }
}

// ──────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────

function main() {
  log(`migrate-consolidate-outbox  ${APPLY ? "(APPLY mode)" : "(dry-run, 加 --apply 真正执行)"}`);
  log("");

  const outboxPlan = planOutbox();
  const inboxPlan = planInbox();

  if (outboxPlan.length === 0 && inboxPlan.length === 0) {
    log("✓ 没有需要迁移的碎片，目录已经是扁平化形态。");
    return;
  }

  if (outboxPlan.length > 0) {
    log("── outbox 迁移计划 ──────────────────────");
    applyOutboxPlan(outboxPlan);
    log("");
  }
  if (inboxPlan.length > 0) {
    log("── inbox 迁移计划 ───────────────────────");
    applyInboxPlan(inboxPlan);
    log("");
  }

  if (APPLY) {
    log("✓ 迁移完成。建议接下来执行：");
    log("    npm run lint:outbox");
    log("    npm test");
    log("    tsc -p tsconfig.app.json --noEmit");
  } else {
    log("（dry-run）加 --apply 真正执行。");
  }
}

main();
