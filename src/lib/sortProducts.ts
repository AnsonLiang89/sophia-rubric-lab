// ============================================================
// sortProducts — 统一的 AI 产品展示顺序 helper
//
// 规则：
//   1. 名称以 "SophiaAI" / "Sophia" 开头的产品永远排在最前面
//   2. 多个 Sophia 版本按 version 字段降序（v5 > v4 > v3 > 无版本）
//   3. 其余产品按 order 字段升序；order 缺失视为 999；
//      order 相同时按 name 字母序
// ============================================================
import type { AIProduct } from "../types";

/** 判断是否是 Sophia 系列 */
export function isSophia(p: Pick<AIProduct, "name">): boolean {
  const n = (p.name ?? "").trim().toLowerCase();
  return n === "sophia" || n === "sophiaai" || n.startsWith("sophia");
}

/** 把 "v5"、"V4"、"5"、"v5.1" 这样的版本号规整成可比较的数字元组 */
function parseVersion(v?: string | null): number[] {
  if (!v) return [];
  const cleaned = v.replace(/^v/i, "").trim();
  if (!cleaned) return [];
  return cleaned
    .split(/[.\-_]/)
    .map((seg) => {
      const n = parseInt(seg, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

/** 版本比较：返回负数表示 a < b；正数表示 a > b；相等为 0 */
function compareVersion(a?: string | null, b?: string | null): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/**
 * 对产品列表排序。不修改入参，返回新数组。
 * `orderHint` 是 PRODUCTS.json 里的 order 字段的 map，可选：
 *   如果不传，会尝试从 product 自身读 (product as any).order。
 */
export function sortProducts(
  products: AIProduct[],
  orderHint?: Map<string, number>
): AIProduct[] {
  const getOrder = (p: AIProduct): number => {
    if (orderHint?.has(p.id)) return orderHint.get(p.id)!;
    const self = (p as unknown as { order?: number | null }).order;
    return typeof self === "number" ? self : 999;
  };

  return [...products].sort((a, b) => {
    const sa = isSophia(a);
    const sb = isSophia(b);
    if (sa && !sb) return -1;
    if (!sa && sb) return 1;
    if (sa && sb) {
      // Sophia 内部：version 降序（新版本在前）
      return -compareVersion(a.version, b.version);
    }
    // 非 Sophia：order 升序，次序相同按 name 字母序
    const oa = getOrder(a);
    const ob = getOrder(b);
    if (oa !== ob) return oa - ob;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}

/** 展示用的产品全名：name + version（若有） */
export function displayProductName(p: Pick<AIProduct, "name" | "version">): string {
  if (!p.version || p.version === "—") return p.name;
  return `${p.name} ${p.version}`;
}

/**
 * 选"主评测对象"（Dashboard / ReportPage 顶部展示的 AI）。
 *
 * 语义：当前项目是 "Sophia 自测套"——Sophia 自己永远是主体，其他是对照组。
 * 策略：
 *   1. 在 products 中找最新版本的 Sophia（通过 isSophia + compareVersion）
 *   2. 没有 Sophia → 兜底返回 products[0]（保持历史行为）
 *   3. products 为空 → undefined
 */
export function pickPrimaryProduct(products: AIProduct[]): AIProduct | undefined {
  if (products.length === 0) return undefined;
  const sophias = products.filter(isSophia);
  if (sophias.length > 0) {
    // Sophia 内部按 version 降序排，取第一个
    return [...sophias].sort((a, b) => -compareVersion(a.version, b.version))[0];
  }
  return products[0];
}
