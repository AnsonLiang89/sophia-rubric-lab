/**
 * bus/handlers/outbox.ts
 *
 * 四个 outbox 端点：
 *   GET    /_bus/outbox                   列出所有有产物的任务 + 最新版元信息
 *   GET    /_bus/outbox/:taskId           返回 {versions, latest: 最新版 JSON}
 *   GET    /_bus/outbox/:taskId/v/:n      读指定版本
 *   DELETE /_bus/outbox/:taskId           删除整个任务目录（所有历史版本）
 *
 * 前端读取 payload 时会调"列表"+"详情"两个端点组合；
 * 详情端点会在 payload 里冗余注入 queryId（从 codeRegistry 反查），
 * 方便前端 outboxAgg 做稳定回链。
 */
import fs from "node:fs";
import path from "node:path";
import {
  send,
  readJson,
  listVersions,
  parseQueryCode,
  isSafeTaskId,
} from "../helpers";
import type { BusContext, BusRes } from "../types";

/** GET /_bus/outbox — 列出所有有产物的任务 */
export function handleListOutbox(res: BusRes, ctx: BusContext): void {
  const taskIds = fs
    .readdirSync(ctx.outboxDir)
    .filter((f) => fs.statSync(path.join(ctx.outboxDir, f)).isDirectory());
  const items = taskIds
    .map((taskId) => {
      const versions = listVersions(ctx.outboxDir, taskId);
      if (versions.length === 0) return null;
      const latest = versions[versions.length - 1];
      const queryCode = parseQueryCode(taskId);
      // 冗余写 queryId（从注册簿反查），给前端 outboxAgg 做稳定回链
      const queryId = queryCode
        ? ctx.codeRegistry.lookupByCode(queryCode)?.queryId ?? null
        : null;
      return {
        taskId,
        queryCode,
        queryId,
        latestVersion: latest.v,
        latestMtime: latest.mtime,
        versions: versions.map((v) => ({
          v: v.v,
          mtime: v.mtime,
          size: v.size,
        })),
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        (b as { latestMtime: number }).latestMtime -
        (a as { latestMtime: number }).latestMtime
    );
  return send(res, 200, { results: items });
}

/** GET /_bus/outbox/:taskId/v/:n — 读指定版本（冗余注入 queryId） */
export function handleGetOutboxVersion(
  res: BusRes,
  ctx: BusContext,
  taskId: string,
  n: number
): void {
  if (!isSafeTaskId(taskId)) {
    return send(res, 400, { error: `unsafe taskId: ${taskId}` });
  }
  const file = path.join(ctx.outboxDir, taskId, `v${n}.json`);
  if (!fs.existsSync(file)) {
    res.statusCode = 204;
    res.end();
    return;
  }
  const j = readJson(file);
  if (!j) return send(res, 500, { error: "corrupt outbox json" });
  // 冗余注入 queryId（不覆盖已有 queryId）
  if (typeof j === "object" && !(j as { queryId?: string }).queryId) {
    const code = parseQueryCode(taskId);
    const qId = code ? ctx.codeRegistry.lookupByCode(code)?.queryId ?? null : null;
    if (qId) (j as { queryId?: string }).queryId = qId;
  }
  return send(res, 200, j);
}

/** GET /_bus/outbox/:taskId — 返回版本列表 + 最新版内容 */
export function handleGetOutboxTask(
  res: BusRes,
  ctx: BusContext,
  taskId: string
): void {
  if (!isSafeTaskId(taskId)) {
    return send(res, 400, { error: `unsafe taskId: ${taskId}` });
  }
  const versions = listVersions(ctx.outboxDir, taskId);
  if (versions.length === 0) {
    res.statusCode = 204;
    res.end();
    return;
  }
  const latest = versions[versions.length - 1];
  const latestContent = readJson(path.join(ctx.outboxDir, taskId, latest.file));
  const code = parseQueryCode(taskId);
  const queryId = code
    ? ctx.codeRegistry.lookupByCode(code)?.queryId ?? null
    : null;
  // payload 层也注入（不覆盖已有）
  if (
    latestContent &&
    typeof latestContent === "object" &&
    !(latestContent as { queryId?: string }).queryId &&
    queryId
  ) {
    (latestContent as { queryId?: string }).queryId = queryId;
  }
  return send(res, 200, {
    taskId,
    queryId,
    latestVersion: latest.v,
    versions: versions.map((v) => ({ v: v.v, mtime: v.mtime, size: v.size })),
    latest: latestContent,
  });
}

/** DELETE /_bus/outbox/:taskId — 删除整个任务目录（所有历史版本） */
export function handleDeleteOutboxTask(
  res: BusRes,
  ctx: BusContext,
  taskId: string
): void {
  if (!isSafeTaskId(taskId)) {
    return send(res, 400, { error: `unsafe taskId: ${taskId}` });
  }
  const dir = path.join(ctx.outboxDir, taskId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return send(res, 200, { ok: true });
}
