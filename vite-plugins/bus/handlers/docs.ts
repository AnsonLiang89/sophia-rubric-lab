/**
 * bus/handlers/docs.ts
 *
 * 三个只读 md/json 文档端点：
 *   GET /_bus/standard  → .evaluations/RUBRIC_STANDARD.md 原文
 *   GET /_bus/contract  → .evaluations/EVALUATION_CONTRACT.md 原文
 *   GET /_bus/products  → .evaluations/PRODUCTS.json
 *
 * 这些端点前端每次都会走 cache-busting（?_=Date.now()），
 * 所以服务端不加任何缓存，实时读磁盘最新版本。
 */
import fs from "node:fs";
import path from "node:path";
import { send } from "../helpers";
import type { BusContext, BusRes } from "../types";

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
