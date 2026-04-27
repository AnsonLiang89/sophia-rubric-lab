/**
 * bus/handlers/docs.ts
 *
 * md/json 文档端点：
 *   GET  /_bus/standard  → .evaluations/RUBRIC_STANDARD.md 原文（只读）
 *   GET  /_bus/contract  → .evaluations/EVALUATION_CONTRACT.md 原文（只读）
 *   GET  /_bus/products  → .evaluations/PRODUCTS.json
 *   POST /_bus/products  → 整体替换 .evaluations/PRODUCTS.json（评测对象管理器写回，管理员专用）
 *
 * 这些 GET 端点前端每次都会走 cache-busting（?_=Date.now()），
 * 所以服务端不加任何缓存，实时读磁盘最新版本。
 */
import fs from "node:fs";
import path from "node:path";
import { send, readBody, respondBodyError } from "../helpers";
import type { BusContext, BusReq, BusRes } from "../types";

/** GET /_bus/standard — RUBRIC_STANDARD.md 原文 */
export function handleGetStandard(res: BusRes, ctx: BusContext): void {
  const file = path.join(ctx.busRoot, "RUBRIC_STANDARD.md");
  if (!fs.existsSync(file)) {
    return send(res, 404, { error: "RUBRIC_STANDARD.md not found" });
  }
  const stat = fs.statSync(file);
  const content = fs.readFileSync(file, "utf8");
  return send(res, 200, {
    path: path.relative(ctx.root, file),
    mtime: stat.mtimeMs,
    size: stat.size,
    content,
  });
}

/** GET /_bus/contract — EVALUATION_CONTRACT.md 原文 */
export function handleGetContract(res: BusRes, ctx: BusContext): void {
  const file = path.join(ctx.busRoot, "EVALUATION_CONTRACT.md");
  if (!fs.existsSync(file)) {
    return send(res, 404, { error: "EVALUATION_CONTRACT.md not found" });
  }
  const stat = fs.statSync(file);
  const content = fs.readFileSync(file, "utf8");
  return send(res, 200, {
    path: path.relative(ctx.root, file),
    mtime: stat.mtimeMs,
    size: stat.size,
    content,
  });
}

/** GET /_bus/products — PRODUCTS.json（解析后返回 products 数组 + updatedAt） */
export function handleGetProducts(res: BusRes, ctx: BusContext): void {
  const file = path.join(ctx.busRoot, "PRODUCTS.json");
  if (!fs.existsSync(file)) {
    return send(res, 404, { error: "PRODUCTS.json not found" });
  }
  const stat = fs.statSync(file);
  const raw = fs.readFileSync(file, "utf8");
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return send(res, 500, {
      error: "PRODUCTS.json is not valid JSON",
      detail: String((e as Error).message ?? e),
    });
  }
  const products = Array.isArray(parsed?.products) ? parsed!.products : [];
  return send(res, 200, {
    path: path.relative(ctx.root, file),
    mtime: stat.mtimeMs,
    size: stat.size,
    updatedAt: parsed?.updatedAt ?? null,
    products,
  });
}

/**
 * POST /_bus/products — 整体替换 PRODUCTS.json（评测对象管理器的写回端点）
 *
 * 设计：前端把完整的 products 数组（包含增/改/删后的最终态）PUT 上来，
 *       服务端整体落盘。这样不用维护细粒度 diff，也没有并发写入问题
 *       （当前只有单管理员本地使用）。
 *
 * 入参 body：
 *   { products: BusProduct[], updatedAt?: string }
 * 校验：
 *   - products 必须是数组
 *   - 每条必须有非空字符串 id（不允许重复）、非空字符串 name
 *   - version/vendor/color/description/order 类型符合即可（允许 null/缺省）
 * 写回：
 *   - updatedAt 取 body 的值，未传就用 now 的 ISO
 *   - 保持 $schema / note 注释等顶层字段不丢：先读旧文件，合并顶层键，
 *     再覆写 products 和 updatedAt
 *
 * 只有管理员版（dev）能走到这个端点；对外版的数据源是 public/data，
 * 不会命中 /_bus/*，无需额外鉴权。
 */
export async function handlePutProducts(
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
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return send(res, 400, { error: "invalid json" });
  }

  const productsIn = (body as { products?: unknown }).products;
  if (!Array.isArray(productsIn)) {
    return send(res, 400, { error: "products must be an array" });
  }

  // 校验每条
  const seenIds = new Set<string>();
  const normalized: Record<string, unknown>[] = [];
  for (let i = 0; i < productsIn.length; i++) {
    const p = productsIn[i];
    if (!p || typeof p !== "object") {
      return send(res, 400, { error: `products[${i}] must be an object` });
    }
    const obj = p as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id.trim() : "";
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!id) return send(res, 400, { error: `products[${i}].id is required (non-empty string)` });
    if (!name) return send(res, 400, { error: `products[${i}].name is required (non-empty string)` });
    if (seenIds.has(id)) {
      return send(res, 400, { error: `products[${i}].id duplicated: ${JSON.stringify(id)}` });
    }
    seenIds.add(id);
    // 白名单清洗，防止前端灌进奇怪字段
    const clean: Record<string, unknown> = { id, name };
    if (typeof obj.version === "string" || obj.version === null) clean.version = obj.version;
    if (typeof obj.vendor === "string" || obj.vendor === null) clean.vendor = obj.vendor;
    if (typeof obj.color === "string" || obj.color === null) clean.color = obj.color;
    if (typeof obj.order === "number" || obj.order === null) clean.order = obj.order;
    if (typeof obj.description === "string" || obj.description === null) clean.description = obj.description;
    normalized.push(clean);
  }

  const file = path.join(ctx.busRoot, "PRODUCTS.json");

  // 读旧文件保留顶层 $schema/note 等注释字段，避免每次写回都丢
  let old: Record<string, unknown> = {};
  try {
    if (fs.existsSync(file)) {
      old = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    }
  } catch {
    // 旧文件损坏就当不存在，以新内容为准
    old = {};
  }

  const updatedAt =
    typeof (body as { updatedAt?: unknown }).updatedAt === "string"
      ? (body as { updatedAt: string }).updatedAt
      : new Date().toISOString();

  const next = {
    ...old,
    updatedAt,
    products: normalized,
  };

  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n", "utf8");

  const stat = fs.statSync(file);
  return send(res, 200, {
    ok: true,
    path: path.relative(ctx.root, file),
    mtime: stat.mtimeMs,
    size: stat.size,
    updatedAt,
    products: normalized,
  });
}
