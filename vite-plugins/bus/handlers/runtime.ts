/**
 * bus/handlers/runtime.ts
 *
 * runtime snapshot 相关端点：
 *   POST /_bus/runtime-snapshot    管理员从浏览器一键导出 localStorage → 写 _runtime-snapshot.json
 *   GET  /_bus/runtime-snapshot    读取回显（没有返回 204）
 *
 * 注：一键发布 (POST /_bus/publish) 也会写这份文件，但走 publish.ts 里的内部逻辑。
 * 这里是独立的"只写不发"路径，给管理员做增量快照用。
 */
import fs from "node:fs";
import path from "node:path";
import { send, readBody, respondBodyError, readJson } from "../helpers";
import type { BusContext, BusReq, BusRes } from "../types";

/** POST /_bus/runtime-snapshot */
export async function handlePostRuntimeSnapshot(
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
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return send(res, 400, { error: "invalid json" });
  }
  // Sanity：必须有 products / queries / submissions 三个数组
  for (const k of ["products", "queries", "submissions"] as const) {
    if (!Array.isArray(parsed[k])) {
      return send(res, 400, {
        error: `snapshot.${k} must be an array`,
      });
    }
  }
  const file = path.join(ctx.busRoot, "_runtime-snapshot.json");
  const payload = {
    version: typeof parsed.version === "number" ? parsed.version : 2,
    exportedAt: new Date().toISOString(),
    products: parsed.products,
    queries: parsed.queries,
    submissions: parsed.submissions,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return send(res, 200, {
    ok: true,
    file: path.relative(ctx.root, file),
    stats: {
      products: (payload.products as unknown[]).length,
      queries: (payload.queries as unknown[]).length,
      submissions: (payload.submissions as unknown[]).length,
    },
  });
}

/** GET /_bus/runtime-snapshot */
export function handleGetRuntimeSnapshot(res: BusRes, ctx: BusContext): void {
  const file = path.join(ctx.busRoot, "_runtime-snapshot.json");
  if (!fs.existsSync(file)) {
    res.statusCode = 204;
    res.end();
    return;
  }
  const j = readJson(file);
  if (!j) return send(res, 500, { error: "corrupt runtime snapshot" });
  return send(res, 200, j);
}
