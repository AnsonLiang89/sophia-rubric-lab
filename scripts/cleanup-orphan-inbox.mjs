#!/usr/bin/env node
/**
 * 清理孤儿 inbox 任务
 *
 * 孤儿 inbox = .evaluations/inbox/{taskId}.json 存在，
 *              但 .evaluations/outbox/{taskId}/ 下不存在任何 v*.json 产物。
 *
 * 常见成因：
 *   - 用户召唤了评测但 LLM 还没写完（此时不应误删）
 *   - 用户中途取消，留下无主任务（应该删）
 *
 * 为避免误伤"刚发起、LLM 还在写"的任务，默认规则：
 *   - mtime 超过 24h 仍无 outbox 产物 → 判定孤儿
 *   - 24h 以内 → 保留
 *
 * 用法：
 *   node scripts/cleanup-orphan-inbox.mjs          # 仅扫描并打印
 *   node scripts/cleanup-orphan-inbox.mjs --apply  # 真删
 *   node scripts/cleanup-orphan-inbox.mjs --apply --max-age-hours=0   # 忽略年龄全删（危险）
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INBOX_DIR = path.join(ROOT, ".evaluations/inbox");
const OUTBOX_DIR = path.join(ROOT, ".evaluations/outbox");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const maxAgeArg = args.find((a) => a.startsWith("--max-age-hours="));
const MAX_AGE_HOURS = maxAgeArg ? Number(maxAgeArg.split("=")[1]) : 24;

function hasOutbox(taskId) {
  const dir = path.join(OUTBOX_DIR, taskId);
  if (!fs.existsSync(dir)) return false;
  const entries = fs.readdirSync(dir);
  return entries.some((f) => /^v\d+\.json$/.test(f));
}

function listInbox() {
  if (!fs.existsSync(INBOX_DIR)) return [];
  return fs
    .readdirSync(INBOX_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const taskId = f.replace(/\.json$/, "");
      const full = path.join(INBOX_DIR, f);
      const stat = fs.statSync(full);
      return { taskId, file: full, mtimeMs: stat.mtimeMs };
    });
}

function main() {
  const now = Date.now();
  const cutoff = MAX_AGE_HOURS > 0 ? now - MAX_AGE_HOURS * 3600 * 1000 : now + 1;

  const all = listInbox();
  const orphans = [];
  const keep = [];

  for (const it of all) {
    if (hasOutbox(it.taskId)) continue; // 有产物不是孤儿
    if (it.mtimeMs > cutoff) {
      keep.push(it);
    } else {
      orphans.push(it);
    }
  }

  console.log("=== Cleanup orphan inbox ===");
  console.log(`root      : ${ROOT}`);
  console.log(`inbox     : ${INBOX_DIR}`);
  console.log(`outbox    : ${OUTBOX_DIR}`);
  console.log(`maxAge(h) : ${MAX_AGE_HOURS} ${MAX_AGE_HOURS === 0 ? "(ignore age)" : ""}`);
  console.log(`apply     : ${APPLY}`);
  console.log("");
  console.log(`total inbox        : ${all.length}`);
  console.log(`hasOutbox (skip)   : ${all.length - orphans.length - keep.length}`);
  console.log(`young (keep)       : ${keep.length}`);
  console.log(`orphans (to clean) : ${orphans.length}`);
  console.log("");

  if (keep.length > 0) {
    console.log("-- Kept (young inbox without outbox yet) --");
    for (const k of keep) {
      const ageH = ((now - k.mtimeMs) / 3600 / 1000).toFixed(2);
      console.log(`  ${k.taskId}   age=${ageH}h`);
    }
    console.log("");
  }

  if (orphans.length === 0) {
    console.log("No orphan inbox found. Bye.");
    return;
  }

  console.log("-- Orphans --");
  for (const o of orphans) {
    const ageH = ((now - o.mtimeMs) / 3600 / 1000).toFixed(2);
    console.log(`  ${o.taskId}   age=${ageH}h`);
  }
  console.log("");

  if (!APPLY) {
    console.log("(dry run) rerun with --apply to delete.");
    return;
  }

  let deleted = 0;
  for (const o of orphans) {
    try {
      fs.unlinkSync(o.file);
      deleted++;
    } catch (e) {
      console.error(`  failed: ${o.taskId}: ${e.message}`);
    }
  }
  console.log(`Deleted ${deleted} / ${orphans.length} orphan inbox files.`);
}

main();
