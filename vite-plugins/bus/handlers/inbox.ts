/**
 * bus/handlers/inbox.ts
 *
 * inbox 任务的 CRUD 端点：
 *   POST   /_bus/inbox            写 inbox/{taskId}.json（taskId 从 body.taskId 拿）
 *   GET    /_bus/inbox            列出所有待评测任务 id + queryCode + mtime
 *   GET    /_bus/inbox/:taskId    读取某任务（调试/回显用）
 *   PATCH  /_bus/inbox/:taskId    替换某 candidate 的激活报告版本（v2 schema 专用）
 *   DELETE /_bus/inbox/:taskId    删除某 inbox 任务
 *
 * v3.4（2026-04-28）taskId 扁平化后：
 *   taskId === queryCode（如 `EV-0002`），同一 query 在 inbox 里只有一个 `EV-XXXX.json`。
 *   POST 时若文件已存在，采用"按 candidateId 合并"语义：
 *     - 新 candidate → 追加到 candidates[]
 *     - 已存在 candidateId → 保留磁盘侧的 reportVersions（含历史追加）、productVersion、authorNote 等，
 *       避免前端重新提交时把服务端 PATCH 过的历史覆盖成 v1
 *   这样"召唤评测"会把新对比源补进去，又不会把历史版本轧平。
 */
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import {
  send,
  readBody,
  respondBodyError,
  readJson,
  parseQueryCode,
  isSafeTaskId,
  readInboxSchemaVersion,
} from "../helpers";
import type { BusContext, BusReq, BusRes } from "../types";

/** 计算报告 content 的 sha256 前 16 位 hex（8 字节）。与 src/lib/contract.ts 的 computeContentHash 必须保持一致。 */
function computeContentHashNode(content: string): string {
  const hash = crypto.createHash("sha256").update(content, "utf8").digest();
  return hash.subarray(0, 8).toString("hex");
}

/** POST /_bus/inbox */
export async function handlePostInbox(
  req: BusReq,
  res: BusRes,
  ctx: BusContext
): Promise<void> {
  let raw: string;
  try {
    raw = await readBody(req);
  } catch (e) {
    return respondBodyError(res, e);
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return send(res, 400, { error: "invalid json" });
  }
  const taskIdRaw = payload.taskId;
  if (typeof taskIdRaw !== "string" || taskIdRaw.length === 0) {
    return send(res, 400, {
      error: "taskId is required and must be a non-empty string",
    });
  }
  if (!isSafeTaskId(taskIdRaw)) {
    return send(res, 400, {
      error: `taskId contains unsafe characters or is too long: ${taskIdRaw}`,
    });
  }
  // v2 schema 入口守卫：禁止再写入 v1 payload（历史遗留文件由启动期 migrate-inbox 一次性迁移）
  // 这里 inboxSchemaVersion 指的是 **inbox schema 版本**，不是 outbox payload.contractVersion。
  // 兼容读：优先 inboxSchemaVersion，回退 contractVersion（2026-04-27 前的旧字段名）。
  const inboxSchemaVersion = readInboxSchemaVersion(payload);
  if (inboxSchemaVersion !== "2.0") {
    return send(res, 400, {
      error: `inbox schema version must be "2.0"; got ${JSON.stringify(inboxSchemaVersion ?? null)}. 前端请用 buildInboxTask + fillInboxContentHashes 构造 v2 payload（字段名 inboxSchemaVersion）`,
    });
  }
  // v2 结构最基本的一致性校验：candidates[].reportVersions[activeReportVersion] 必须存在
  const candidatesRaw = payload.candidates;
  if (!Array.isArray(candidatesRaw) || candidatesRaw.length === 0) {
    return send(res, 400, { error: "candidates must be a non-empty array" });
  }
  for (const [i, c] of candidatesRaw.entries()) {
    const obj = c as Record<string, unknown> | null;
    if (!obj || typeof obj !== "object") {
      return send(res, 400, { error: `candidates[${i}] must be an object` });
    }
    if (typeof obj.candidateId !== "string" || !obj.candidateId) {
      return send(res, 400, { error: `candidates[${i}].candidateId required (non-empty string)` });
    }
    const versions = obj.reportVersions;
    if (!Array.isArray(versions) || versions.length === 0) {
      return send(res, 400, { error: `candidates[${i}].reportVersions required (non-empty array)` });
    }
    const active = Number(obj.activeReportVersion);
    if (!Number.isFinite(active) || active < 1) {
      return send(res, 400, { error: `candidates[${i}].activeReportVersion must be a positive integer` });
    }
    const hit = (versions as Array<Record<string, unknown>>).find(
      (v) => Number(v?.version) === active
    );
    if (!hit) {
      return send(res, 400, {
        error: `candidates[${i}].activeReportVersion=${active} not found in reportVersions[]`,
      });
    }
  }

  const taskId = taskIdRaw;
  const file = path.join(ctx.inboxDir, `${taskId}.json`);

  // v3.4 扁平化：同 taskId（= queryCode）已存在时，走"按 candidateId 合并"语义。
  // 保留磁盘侧的 reportVersions / activeReportVersion / productVersion / authorNote，
  // 只把新出现的 candidate 追加进去。这样前端"召唤评测"增补对比源时不会轧平 PATCH 历史。
  if (fs.existsSync(file)) {
    const existing = readJson(file);
    if (!existing) {
      return send(res, 500, {
        error: `inbox/${taskId}.json exists but is corrupt; refuse to overwrite`,
      });
    }
    const existingSchema = readInboxSchemaVersion(existing);
    if (existingSchema !== "2.0") {
      return send(res, 400, {
        error: `existing inbox/${taskId}.json is schema v${existingSchema ?? "1.0"}; run "npm run migrate-inbox" first`,
      });
    }
    const existingCandidates: Array<Record<string, unknown>> = Array.isArray(
      existing.candidates
    )
      ? (existing.candidates as Array<Record<string, unknown>>)
      : [];
    const existingById = new Map<string, Record<string, unknown>>();
    for (const c of existingCandidates) {
      if (typeof c.candidateId === "string") existingById.set(c.candidateId, c);
    }

    const mergedCandidates: Array<Record<string, unknown>> = [];
    let addedCount = 0;
    let keptCount = 0;
    for (const incoming of candidatesRaw as Array<Record<string, unknown>>) {
      const cid = String(incoming.candidateId);
      const hit = existingById.get(cid);
      if (hit) {
        // 保留磁盘侧的权威副本：reportVersions / activeReportVersion / productVersion / authorNote
        mergedCandidates.push(hit);
        keptCount += 1;
      } else {
        mergedCandidates.push(incoming);
        addedCount += 1;
      }
    }

    // 同步顶层 query 元信息（query.title / description / domain 可能被用户改过）——以新提交为准
    const merged: Record<string, unknown> = {
      ...existing,
      ...payload,
      candidates: mergedCandidates,
    };
    fs.writeFileSync(file, JSON.stringify(merged, null, 2));
    return send(res, 200, {
      ok: true,
      taskId,
      file: path.relative(ctx.root, file),
      merged: true,
      addedCandidates: addedCount,
      keptCandidates: keptCount,
    });
  }

  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return send(res, 200, {
    ok: true,
    taskId,
    file: path.relative(ctx.root, file),
  });
}

/** GET /_bus/inbox — 列出所有待评测任务 */
export function handleListInbox(res: BusRes, ctx: BusContext): void {
  const files = fs
    .readdirSync(ctx.inboxDir)
    .filter((f) => f.endsWith(".json"));
  const items = files.map((f) => {
    const full = path.join(ctx.inboxDir, f);
    const taskId = f.replace(/\.json$/, "");
    const stat = fs.statSync(full);
    const j = readJson(full);
    const queryCode =
      (typeof j?.query === "object" && j?.query
        ? (j.query as { code?: string }).code
        : undefined) ?? parseQueryCode(taskId);
    return {
      taskId,
      queryCode,
      mtime: stat.mtimeMs,
      size: stat.size,
    };
  });
  return send(res, 200, { tasks: items });
}

/** GET /_bus/inbox/:taskId — 读取某任务 */
export function handleGetInboxTask(
  res: BusRes,
  ctx: BusContext,
  taskId: string
): void {
  if (!isSafeTaskId(taskId)) {
    return send(res, 400, { error: `unsafe taskId: ${taskId}` });
  }
  const file = path.join(ctx.inboxDir, `${taskId}.json`);
  if (!fs.existsSync(file)) {
    res.statusCode = 204;
    res.end();
    return;
  }
  const j = readJson(file);
  if (!j) return send(res, 500, { error: "corrupt inbox json" });
  return send(res, 200, j);
}

/**
 * PATCH /_bus/inbox/:taskId
 *
 * Body:
 *   {
 *     candidateId: string;            // v2 schema 的稳定 id
 *     content: string;                // 新版本报告正文
 *     contentHash: string;            // 新版本 contentHash（服务端会重算并校验）
 *     producedAt?: string;
 *     replacedReason?: string;
 *     sourceUrl?: string;
 *     productVersion?: string;
 *     authorNote?: string;
 *   }
 *
 * 语义：
 *   - 在 candidates[candidateId] 上追加一条 reportVersions[]，version = max(prev) + 1
 *   - activeReportVersion 指向新 version
 *   - candidate.report 镜像为新 content（保持 v1 消费端零改动）
 *   - 历史版本只追加不删
 *
 * 错误：
 *   - 400：任务不是 v2 schema（需先迁移）、body 缺字段、contentHash 与服务端重算不一致
 *   - 404：任务不存在、candidate 不存在
 *   - 409：contentHash 与当前 activeReportVersion 一致（内容未变，不要创建重复版本）
 */
export async function handlePatchInboxTask(
  req: BusReq,
  res: BusRes,
  ctx: BusContext,
  taskId: string
): Promise<void> {
  if (!isSafeTaskId(taskId)) {
    return send(res, 400, { error: `unsafe taskId: ${taskId}` });
  }
  const file = path.join(ctx.inboxDir, `${taskId}.json`);
  if (!fs.existsSync(file)) {
    return send(res, 404, { error: `inbox/${taskId}.json not found` });
  }

  let rawBody: string;
  try {
    rawBody = await readBody(req);
  } catch (e) {
    return respondBodyError(res, e);
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return send(res, 400, { error: "invalid json body" });
  }

  const candidateId = body.candidateId;
  const content = body.content;
  const contentHash = body.contentHash;
  if (typeof candidateId !== "string" || !candidateId) {
    return send(res, 400, { error: "candidateId required" });
  }
  if (typeof content !== "string" || !content) {
    return send(res, 400, { error: "content required" });
  }
  if (typeof contentHash !== "string" || !contentHash) {
    return send(res, 400, { error: "contentHash required" });
  }

  // 服务端重算哈希，校验前端传来的一致（防止 race / 未更新的客户端）
  const serverHash = computeContentHashNode(content);
  if (serverHash !== contentHash) {
    return send(res, 400, {
      error: `contentHash mismatch: client=${contentHash} server=${serverHash}`,
    });
  }

  const task = readJson(file);
  if (!task) return send(res, 500, { error: "corrupt inbox json" });

  const diskInboxSchemaVersion = readInboxSchemaVersion(task);
  if (diskInboxSchemaVersion !== "2.0") {
    return send(res, 400, {
      error: `inbox task is schema v${diskInboxSchemaVersion ?? "1.0"}; run "npm run migrate-inbox" before PATCH`,
    });
  }

  const candidates: Array<Record<string, unknown>> | undefined = Array.isArray(
    task.candidates
  )
    ? (task.candidates as Array<Record<string, unknown>>)
    : undefined;
  if (!candidates) {
    return send(res, 400, { error: "task has no candidates" });
  }
  const candidate = candidates.find((c) => c.candidateId === candidateId);
  if (!candidate) {
    return send(res, 404, {
      error: `candidate ${candidateId} not found in task ${taskId}`,
    });
  }

  const versions: Array<Record<string, unknown>> = Array.isArray(
    candidate.reportVersions
  )
    ? (candidate.reportVersions as Array<Record<string, unknown>>)
    : [];
  const activeV = Number(candidate.activeReportVersion ?? 1);
  const active = versions.find((v) => Number(v.version) === activeV);
  if (active && active.contentHash === contentHash) {
    return send(res, 409, {
      error: `active version ${activeV} already has the same contentHash; nothing to replace`,
      taskId,
      candidateId,
      activeReportVersion: activeV,
    });
  }

  const maxV = versions.reduce(
    (acc, v) => Math.max(acc, Number(v.version) || 0),
    0
  );
  const newVersion = maxV + 1;
  const now = new Date().toISOString();
  const producedAt =
    typeof body.producedAt === "string" && body.producedAt
      ? body.producedAt
      : undefined;
  const replacedReason =
    typeof body.replacedReason === "string" && body.replacedReason
      ? body.replacedReason
      : undefined;
  const sourceUrl =
    typeof body.sourceUrl === "string" && body.sourceUrl
      ? body.sourceUrl
      : undefined;

  versions.push({
    version: newVersion,
    content,
    contentHash,
    producedAt,
    submittedAt: now,
    replacedAt: now,
    replacedReason,
    sourceUrl,
  });
  candidate.reportVersions = versions;
  candidate.activeReportVersion = newVersion;
  // 冗余镜像：保持 v1 消费路径直接取 candidate.report
  candidate.report = content;
  if (typeof body.productVersion === "string" && body.productVersion) {
    candidate.productVersion = body.productVersion;
  }
  if (typeof body.authorNote === "string") {
    candidate.authorNote = body.authorNote;
  }

  fs.writeFileSync(file, JSON.stringify(task, null, 2));
  return send(res, 200, {
    ok: true,
    taskId,
    candidateId,
    activeReportVersion: newVersion,
    totalVersions: versions.length,
  });
}

/** DELETE /_bus/inbox/:taskId */
export function handleDeleteInboxTask(
  res: BusRes,
  ctx: BusContext,
  taskId: string
): void {
  if (!isSafeTaskId(taskId)) {
    return send(res, 400, { error: `unsafe taskId: ${taskId}` });
  }
  const file = path.join(ctx.inboxDir, `${taskId}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return send(res, 200, { ok: true });
}
