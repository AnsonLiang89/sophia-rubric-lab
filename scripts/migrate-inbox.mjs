#!/usr/bin/env node
/**
 * migrate-inbox.mjs
 *
 * 把 .evaluations/inbox/*.json 里的 v1 schema 升级到 v2 schema（方案 B+，2026-04-27 新增）。
 *
 * v1 → v2 映射规则（无损）：
 *   - 顶层 inboxSchemaVersion: "1.0" → "2.0"（2026-04-27 前此字段名为 contractVersion，已迁移）
 *   - 每个 candidate 增加：
 *       candidateId = reportId（稳定复用）
 *       activeReportVersion = 1
 *       reportVersions = [{
 *         version: 1,
 *         content: candidate.report,
 *         contentHash: sha256(content).slice(0,16),
 *         submittedAt: task.createdAt,
 *         producedAt: candidate.report 时间未知，留空
 *       }]
 *   - 保留原有 candidate.report 字段作为冗余镜像（v1 消费路径依然生效）
 *
 * 额外任务（2026-04-27 字段改名兼容层）：
 *   - 已经是 v2 schema 但顶层字段还叫 `contractVersion` 的旧文件，一次性改名为 `inboxSchemaVersion`
 *     并删除旧字段，避免长期两字段并存。
 *
 * CLI:
 *   node scripts/migrate-inbox.mjs            # dry-run，列出将要变更的文件
 *   node scripts/migrate-inbox.mjs --apply    # 实际就地写回
 *   node scripts/migrate-inbox.mjs --apply --task EV-0005-LlSiEs  # 只处理单个
 *
 * 幂等：已经是新字段名 + v2 的文件自动跳过（不会二次追加 version）。
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

/**
 * 兼容读取 inbox schema 版本：优先 `inboxSchemaVersion`，回退 `contractVersion`（旧字段名）。
 * 返回 undefined 表示两者都没有。
 */
function readInboxSchemaVersion(task) {
  if (!task || typeof task !== "object") return undefined;
  if (typeof task.inboxSchemaVersion === "string") return task.inboxSchemaVersion;
  if (typeof task.contractVersion === "string") return task.contractVersion;
  return undefined;
}

/**
 * 把单个任务（已 JSON.parse 过的对象）迁移到 v2。
 * 返回 { changed, task }。
 *
 * 两种 changed 场景：
 *   A) 结构升级：v1 → v2（补齐 candidateId / activeReportVersion / reportVersions）
 *   B) 字段改名：已是 v2 schema，但顶层字段还叫 `contractVersion`，改为 `inboxSchemaVersion`
 */
export function migrateTask(task) {
  if (!task || typeof task !== "object") {
    return { changed: false, task };
  }
  const version = readInboxSchemaVersion(task);

  // 场景 B：已是 v2 schema，但可能字段名还是旧的 `contractVersion`
  if (version === "2.0") {
    if ("contractVersion" in task && !("inboxSchemaVersion" in task)) {
      // 旧字段名 → 新字段名，保持字段顺序尽量稳定
      const renamed = { ...task, inboxSchemaVersion: "2.0" };
      delete renamed.contractVersion;
      return { changed: true, task: renamed };
    }
    return { changed: false, task };
  }

  if (version !== "1.0" && version !== undefined) {
    throw new Error(
      `unsupported inbox schema version: ${version} (expected "1.0" or "2.0")`
    );
  }

  // 场景 A：v1 → v2 结构升级
  const createdAt = typeof task.createdAt === "string" ? task.createdAt : new Date().toISOString();
  const candidates = Array.isArray(task.candidates) ? task.candidates : [];

  const newCandidates = candidates.map((c) => {
    if (!c || typeof c !== "object") return c;
    const content = typeof c.report === "string" ? c.report : "";
    const version1 = {
      version: 1,
      content,
      contentHash: computeContentHash(content),
      submittedAt: createdAt,
    };
    if (typeof c.producedAt === "string" && c.producedAt) {
      version1.producedAt = c.producedAt;
    }
    if (typeof c.sourceUrl === "string" && c.sourceUrl) {
      version1.sourceUrl = c.sourceUrl;
    }
    return {
      ...c,
      candidateId: typeof c.candidateId === "string" && c.candidateId ? c.candidateId : c.reportId,
      activeReportVersion: 1,
      reportVersions: [version1],
      // 保留 c.report 作为冗余镜像（v1 消费路径依然生效）
    };
  });

  const migrated = {
    ...task,
    inboxSchemaVersion: "2.0",
    candidates: newCandidates,
  };
  // 清掉旧字段名，避免 v1 文件迁移完后仍残留 contractVersion
  delete migrated.contractVersion;
  return { changed: true, task: migrated };
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const taskArgIdx = args.indexOf("--task");
  const onlyTask = taskArgIdx >= 0 ? args[taskArgIdx + 1] : null;

  if (!fs.existsSync(INBOX_DIR)) {
    console.error(`[migrate-inbox] inbox dir not found: ${INBOX_DIR}`);
    process.exit(2);
  }

  const files = fs
    .readdirSync(INBOX_DIR)
    .filter((f) => f.endsWith(".json") && f !== ".gitkeep");

  const toProcess = onlyTask
    ? files.filter((f) => f === `${onlyTask}.json`)
    : files;

  if (toProcess.length === 0) {
    console.log(`[migrate-inbox] nothing to process`);
    return;
  }

  const changes = [];
  const skipped = [];
  for (const f of toProcess) {
    const full = path.join(INBOX_DIR, f);
    let raw;
    try {
      raw = fs.readFileSync(full, "utf8");
    } catch (e) {
      console.error(`[migrate-inbox] read failed ${f}: ${e.message}`);
      continue;
    }
    let task;
    try {
      task = JSON.parse(raw);
    } catch (e) {
      console.error(`[migrate-inbox] invalid json ${f}: ${e.message}`);
      continue;
    }
    try {
      const { changed, task: migrated } = migrateTask(task);
      if (!changed) {
        skipped.push(f);
        continue;
      }
      changes.push({ file: f, full, migrated });
    } catch (e) {
      console.error(`[migrate-inbox] migrate failed ${f}: ${e.message}`);
    }
  }

  console.log(
    `[migrate-inbox] ${apply ? "APPLY" : "DRY-RUN"}  todo=${changes.length}  skipped(already v2 + new field name)=${skipped.length}`
  );
  for (const { file } of changes) {
    console.log(`  ↳ ${file}`);
  }

  if (apply) {
    for (const { full, migrated } of changes) {
      fs.writeFileSync(full, JSON.stringify(migrated, null, 2));
    }
    console.log(`[migrate-inbox] wrote ${changes.length} files`);
  } else if (changes.length > 0) {
    console.log(`\n  re-run with --apply to write changes`);
  }
}

// ESM 模块直接运行检测
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
