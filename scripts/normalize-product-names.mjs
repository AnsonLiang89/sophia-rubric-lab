#!/usr/bin/env node
/**
 * 规范化 outbox 产物中 productName 字段：
 * - 以 inbox 的 candidates[].productName + productVersion 为事实源
 * - 所有 overallScores[].productName 必须唯一，且 Sophia 带上版本号（"SophiaAI v4" / "SophiaAI v5" ...）
 * - 同步修正 summary.sideBySide.pairs 里若出现文案引用的版本名（保守：不动文案）
 *
 * 用法：node scripts/normalize-product-names.mjs [--check]
 *   --check：只报告不修改（用于 CI / 人工复核）
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const inboxDir = path.join(repoRoot, ".evaluations", "inbox");
const outboxDir = path.join(repoRoot, ".evaluations", "outbox");

const checkOnly = process.argv.includes("--check");

/** 读取 inbox → 返回 { taskId: { reportId: displayName } } */
function buildInboxMap() {
  const map = {};
  if (!fs.existsSync(inboxDir)) return map;
  for (const name of fs.readdirSync(inboxDir)) {
    if (!name.endsWith(".json")) continue;
    const full = path.join(inboxDir, name);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(full, "utf-8"));
    } catch (err) {
      console.warn(`[warn] 解析 inbox 失败：${full}`, err.message);
      continue;
    }
    const taskId = data.taskId || name.replace(/\.json$/, "");
    map[taskId] = {};
    for (const c of data.candidates || []) {
      const base = String(c.productName || "").trim();
      const ver = c.productVersion && c.productVersion !== "—" ? String(c.productVersion).trim() : "";
      const display = ver ? `${base} ${ver}` : base;
      if (c.reportId) map[taskId][c.reportId] = display;
    }
  }
  return map;
}

/** 从 outbox 文件路径推出 taskId（目录名） */
function taskIdFromOutbox(filePath) {
  const rel = path.relative(outboxDir, filePath);
  return rel.split(path.sep)[0];
}

const inboxMap = buildInboxMap();

const changes = []; // {file, before, after, location}
const unresolved = []; // 无法从 inbox 查到映射的

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".json")) out.push(full);
  }
  return out;
}

const files = fs.existsSync(outboxDir) ? walk(outboxDir) : [];

for (const file of files) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (err) {
    console.warn(`[warn] 解析 outbox 失败：${file}`, err.message);
    continue;
  }
  const taskId = taskIdFromOutbox(file);
  const refMap = inboxMap[taskId] || {};
  let mutated = false;

  // summary.overallScores[]
  const overallScores = data?.summary?.overallScores;
  if (Array.isArray(overallScores)) {
    for (const item of overallScores) {
      const rid = item?.reportId;
      const expected = refMap[rid];
      if (!expected) {
        unresolved.push({ file, reportId: rid, current: item?.productName });
        continue;
      }
      if (item.productName !== expected) {
        changes.push({
          file,
          location: `summary.overallScores[reportId=${rid}].productName`,
          before: item.productName,
          after: expected,
        });
        item.productName = expected;
        mutated = true;
      }
    }
  }

  // summary.perReportFeedback[].productName
  const feedback = data?.summary?.perReportFeedback;
  if (Array.isArray(feedback)) {
    for (const fb of feedback) {
      const rid = fb?.reportId;
      const expected = refMap[rid];
      if (!expected) continue;
      if (fb.productName && fb.productName !== expected) {
        changes.push({
          file,
          location: `summary.perReportFeedback[reportId=${rid}].productName`,
          before: fb.productName,
          after: expected,
        });
        fb.productName = expected;
        mutated = true;
      }
    }
  }

  // rubric[].scores[].reportId 不含 productName，这里不处理
  // reports[].productName（如存在）
  if (Array.isArray(data.reports)) {
    for (const r of data.reports) {
      const rid = r?.reportId;
      const expected = refMap[rid];
      if (!expected) continue;
      if (r.productName && r.productName !== expected) {
        changes.push({
          file,
          location: `reports[reportId=${rid}].productName`,
          before: r.productName,
          after: expected,
        });
        r.productName = expected;
        mutated = true;
      }
    }
  }

  if (mutated && !checkOnly) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf-8");
  }
}

if (changes.length === 0) {
  console.log("✔ 所有 outbox 的 productName 已与 inbox 一致");
} else {
  console.log(`共检测到 ${changes.length} 处需要规范化：`);
  for (const c of changes) {
    const rel = path.relative(repoRoot, c.file);
    console.log(`  - ${rel}  ${c.location}`);
    console.log(`      "${c.before}"  →  "${c.after}"`);
  }
  if (checkOnly) {
    console.log("\n(仅检查模式，未写入)");
  } else {
    console.log("\n✔ 已写入修正");
  }
}

if (unresolved.length) {
  console.log(`\n⚠ 有 ${unresolved.length} 条记录未能在 inbox 中找到对应映射（保留原值）：`);
  for (const u of unresolved) {
    console.log(`  - ${path.relative(repoRoot, u.file)}  reportId=${u.reportId}  current="${u.current}"`);
  }
}

if (checkOnly && changes.length > 0) {
  process.exit(1);
}
