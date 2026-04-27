#!/usr/bin/env node
/**
 * replace-report.mjs
 *
 * 替换 inbox 任务某个 candidate 的激活报告版本（v2 schema 专用，2026-04-27 新增）。
 *
 * CLI 典型用法：
 *
 *   # 从文件读新内容
 *   node scripts/replace-report.mjs \
 *     --task EV-0007-QeLgZE \
 *     --candidate subm-abc \
 *     --content ./new-sophia-v5.md \
 *     --reason "原提交遗漏了 Q1 最新数据，以官网发布版为准"
 *
 *   # 直接传 literal（适合短报告）
 *   node scripts/replace-report.mjs --task xxx --candidate yyy --content-inline "..."
 *
 *   # 同时更新元数据
 *   node scripts/replace-report.mjs --task ... --candidate ... --content ./x.md \
 *     --product-version v5.1 --produced-at 2026-04-27T12:00:00Z
 *
 * 行为：
 *   - 原地修改 .evaluations/inbox/{taskId}.json
 *   - 若任务仍是 v1 schema：报错并提示先跑 migrate-inbox
 *   - 若 contentHash 与当前 activeReportVersion 一致：报错（没变就别覆盖）
 *   - reportVersions[] 永远 append，不修改历史
 *   - 同步刷新 candidate.report 镜像 + activeReportVersion
 *
 * 退出码：0=成功 1=业务错（任务不存在 / schema 不对 / 哈希冲突等）2=运行时错
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const INBOX_DIR = path.join(PROJECT_ROOT, ".evaluations", "inbox");

function computeContentHash(content) {
  const hash = crypto.createHash("sha256").update(content, "utf8").digest();
  return hash.subarray(0, 8).toString("hex");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function die(msg, code = 1) {
  console.error(`[replace-report] ${msg}`);
  process.exit(code);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const taskId = args.task;
  const candidateId = args.candidate;
  const contentPath = args.content;
  const contentInline = args["content-inline"];
  const reason = args.reason;
  const productVersion = args["product-version"];
  const producedAt = args["produced-at"];
  const sourceUrl = args["source-url"];

  if (!taskId) die("missing --task <taskId>");
  if (!candidateId) die("missing --candidate <candidateId>");
  if (!contentPath && !contentInline) {
    die("missing --content <file> or --content-inline <string>");
  }

  const file = path.join(INBOX_DIR, `${taskId}.json`);
  if (!fs.existsSync(file)) {
    die(`inbox task not found: ${file}`, 1);
  }

  let content;
  if (contentPath) {
    const abs = path.isAbsolute(contentPath)
      ? contentPath
      : path.resolve(process.cwd(), contentPath);
    if (!fs.existsSync(abs)) die(`content file not found: ${abs}`);
    content = fs.readFileSync(abs, "utf8");
  } else {
    content = String(contentInline);
  }
  if (!content) die("content is empty");

  const hash = computeContentHash(content);

  const raw = fs.readFileSync(file, "utf8");
  let task;
  try {
    task = JSON.parse(raw);
  } catch (e) {
    die(`invalid json: ${e.message}`, 2);
  }

  // 兼容读：优先 inboxSchemaVersion，回退 contractVersion（旧字段名，2026-04-27 前）
  const inboxSchemaVersion =
    typeof task.inboxSchemaVersion === "string"
      ? task.inboxSchemaVersion
      : typeof task.contractVersion === "string"
        ? task.contractVersion
        : undefined;
  if (inboxSchemaVersion !== "2.0") {
    die(
      `task is schema v${inboxSchemaVersion ?? "1.0"}; run "npm run migrate-inbox -- --apply" first`,
      1
    );
  }

  const candidate = (task.candidates ?? []).find(
    (c) => c.candidateId === candidateId
  );
  if (!candidate) {
    die(`candidate ${candidateId} not found in task ${taskId}`, 1);
  }

  const versions = Array.isArray(candidate.reportVersions)
    ? candidate.reportVersions
    : [];
  const activeV = Number(candidate.activeReportVersion ?? 1);
  const active = versions.find((v) => Number(v.version) === activeV);
  if (active && active.contentHash === hash) {
    die(
      `active version ${activeV} already has the same contentHash (${hash}); nothing to replace`,
      1
    );
  }

  const maxV = versions.reduce((acc, v) => Math.max(acc, Number(v.version) || 0), 0);
  const newVersion = maxV + 1;
  const now = new Date().toISOString();

  const rv = {
    version: newVersion,
    content,
    contentHash: hash,
    submittedAt: now,
    replacedAt: now,
  };
  if (producedAt) rv.producedAt = producedAt;
  if (reason) rv.replacedReason = reason;
  if (sourceUrl) rv.sourceUrl = sourceUrl;

  versions.push(rv);
  candidate.reportVersions = versions;
  candidate.activeReportVersion = newVersion;
  candidate.report = content;
  if (productVersion) candidate.productVersion = productVersion;

  fs.writeFileSync(file, JSON.stringify(task, null, 2));
  console.log(
    `[replace-report] ok  task=${taskId}  candidate=${candidateId}  activeReportVersion: ${activeV} → ${newVersion}  contentHash=${hash}`
  );
}

main();
