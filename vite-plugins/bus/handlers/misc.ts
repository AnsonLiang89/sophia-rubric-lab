/**
 * bus/handlers/misc.ts
 *
 * 汇集四个小端点：health / bake-freshness / registry（GET 只读簿） / register-code（POST 注册）
 * 都只有 10~30 行实现，没必要每个拆一个文件。
 */
import { send, readBody, respondBodyError } from "../helpers";
import type { BusContext, BusReq, BusRes } from "../types";
// @ts-expect-error — .mjs 没有类型声明
import { checkBakeFreshness } from "../../../scripts/check-bake-freshness.mjs";

/** GET /_bus/health */
export function handleHealth(res: BusRes, ctx: BusContext): void {
  return send(res, 200, { ok: true, dir: ctx.baseDir });
}

/** GET /_bus/bake-freshness — 对外版产物是否落后于源文件 */
export function handleBakeFreshness(res: BusRes): void {
  try {
    const result = checkBakeFreshness();
    return send(res, 200, result);
  } catch (e) {
    return send(res, 500, {
      error: "freshness check failed",
      detail: String((e as Error)?.message ?? e),
    });
  }
}

/** GET /_bus/registry — 编号注册簿全量（只读） */
export function handleGetRegistry(res: BusRes, ctx: BusContext): void {
  return send(res, 200, {
    ...ctx.codeRegistry.raw,
    map: ctx.codeRegistry.exportMap(),
  });
}

/**
 * POST /_bus/register-code — 幂等注册 queryId 的永久业务编号
 *
 * 请求体：{ queryId: string, preferredCode?: string, registeredAt?: string, note?: string }
 * 响应体：{ ok: true, reused: boolean, code, queryId, registeredAt, note? }
 *
 * 前端 createQuery 必须先调这个端点拿到 code，再写 localStorage。
 * 并发/多 tab 都安全：nextNumber 在磁盘单一事实源，Node 单线程天然串行化。
 */
export async function handleRegisterCode(
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
  const queryId = payload.queryId;
  if (typeof queryId !== "string" || queryId.length === 0) {
    return send(res, 400, {
      error: "queryId is required and must be a non-empty string",
    });
  }
  // queryId 既要作为文件系统 key 也要避免路径穿越
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(queryId) || queryId.includes("..")) {
    return send(res, 400, {
      error: `queryId contains unsafe characters or is too long: ${queryId}`,
    });
  }
  const before = ctx.codeRegistry.lookupByQueryId(queryId);
  if (before) {
    return send(res, 200, { ok: true, reused: true, ...before });
  }
  const entry = ctx.codeRegistry.register(queryId, {
    preferredCode:
      typeof payload.preferredCode === "string"
        ? payload.preferredCode
        : undefined,
    registeredAt:
      typeof payload.registeredAt === "string"
        ? payload.registeredAt
        : undefined,
    note: typeof payload.note === "string" ? payload.note : "api",
  });
  return send(res, 200, { ok: true, reused: false, ...entry });
}
