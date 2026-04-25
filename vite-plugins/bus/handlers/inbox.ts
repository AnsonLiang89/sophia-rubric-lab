/**
 * bus/handlers/inbox.ts
 *
 * inbox 任务的 CRUD 端点：
 *   POST   /_bus/inbox            写 inbox/{taskId}.json（taskId 从 body.taskId 拿）
 *   GET    /_bus/inbox            列出所有待评测任务 id + queryCode + mtime
 *   GET    /_bus/inbox/:taskId    读取某任务（调试/回显用）
 *   DELETE /_bus/inbox/:taskId    删除某 inbox 任务
 *
 * 注意：POST 时若同 taskId 已存在，直接返回 409（前端 makeTaskId 有 nano6 几乎不会碰撞，
 * 此处是额外兜底；碰撞时前端需要重新生成 taskId 再试）。
 */
import fs from "node:fs";
import path from "node:path";
import {
  send,
  readBody,
  respondBodyError,
  readJson,
  parseQueryCode,
  isSafeTaskId,
} from "../helpers";
import type { BusContext, BusReq, BusRes } from "../types";

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
  const taskId = taskIdRaw;
  const file = path.join(ctx.inboxDir, `${taskId}.json`);
  if (fs.existsSync(file)) {
    return send(res, 409, {
      error: `inbox/${taskId}.json already exists`,
      taskId,
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
