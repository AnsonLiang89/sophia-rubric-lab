import { create } from "zustand";
import { nanoid } from "nanoid";
import { storage } from "./storage";
import type {
  AIProduct,
  Query,
  Submission,
} from "./types";
import { contractBus, type BusProduct } from "./lib/contract";
import { IS_READONLY } from "./lib/dataSource";
import { sortProducts } from "./lib/sortProducts";

/**
 * 只读模式下所有写 action 的统一拦截。
 * 正常情况下 UI 已经把编辑入口全隐藏，这里只是兜底防御（配合 dataSource 的写守卫）。
 */
function readonlyWarn(op: string) {
  if (IS_READONLY) {
    console.warn(`[store] write action "${op}" is not available in public read-only mode.`);
    return true;
  }
  return false;
}

interface LabState {
  /** 评测主体清单（AI 产品）。**只读**，由 .evaluations/PRODUCTS.json 管理 */
  products: AIProduct[];
  /** PRODUCTS.json 里额外的 order 字段，给 sortProducts 用 */
  productOrderHint: Map<string, number>;
  /** 最近一次从 bus 拉到的原始 updatedAt，用于页面展示"数据新鲜度" */
  productsUpdatedAt: string | null;
  /** 若拉取失败，前端降级到 localStorage 旧数据（历史兼容），此处标记 */
  productsSource: "bus" | "local-fallback" | "empty";

  queries: Query[];
  submissions: Submission[];
  loaded: boolean;

  // actions
  refresh: () => Promise<void>;
  /** 手动重拉产品列表（ProductsPage 刷新按钮用） */
  refreshProducts: () => Promise<void>;

  createQuery: (q: Omit<Query, "id" | "createdAt" | "updatedAt">) => Promise<Query>;
  updateQuery: (q: Query) => Promise<void>;
  /**
   * 删除 Query，默认级联清理：
   *  1. localStorage 里的 query + 该 query 下的所有 submission
   *  2. `.evaluations/inbox/` 和 `outbox/` 下所有 taskId 以该 queryCode 开头的任务
   * 失败不会阻塞本地删除（防止磁盘清理一半失败导致孤儿数据）。
   */
  deleteQuery: (id: string) => Promise<void>;

  createSubmission: (
    s: Omit<Submission, "id" | "createdAt">
  ) => Promise<Submission>;
  updateSubmission: (s: Submission) => Promise<void>;
  deleteSubmission: (id: string) => Promise<void>;
}

/** 把 BusProduct 转成前端 AIProduct */
function busToAI(p: BusProduct): AIProduct {
  return {
    id: p.id,
    name: p.name,
    version: p.version ?? undefined,
    vendor: p.vendor ?? undefined,
    color: p.color ?? undefined,
    description: p.description ?? undefined,
    // PRODUCTS.json 不再区分主评测，统一 false（保留字段以免类型崩）
    isPrimary: false,
    // 没有 createdAt 概念，这里给当下时间让类型过
    createdAt: new Date().toISOString(),
  };
}

/** 从 bus 加载产品；失败则降级到 localStorage（防 dev 中间件缺席） */
async function loadProducts(): Promise<{
  products: AIProduct[];
  orderHint: Map<string, number>;
  updatedAt: string | null;
  source: "bus" | "local-fallback" | "empty";
}> {
  try {
    const resp = await contractBus.getProducts();
    if (resp && Array.isArray(resp.products)) {
      const orderHint = new Map<string, number>();
      for (const p of resp.products) {
        if (typeof p.order === "number") orderHint.set(p.id, p.order);
      }
      const products = sortProducts(resp.products.map(busToAI), orderHint);
      return {
        products,
        orderHint,
        updatedAt: resp.updatedAt,
        source: "bus",
      };
    }
  } catch {
    // 忽略，走 fallback
  }
  // 降级：读 localStorage
  const local = await storage.listProducts();
  if (local.length > 0) {
    return {
      products: sortProducts(local),
      orderHint: new Map(),
      updatedAt: null,
      source: "local-fallback",
    };
  }
  return {
    products: [],
    orderHint: new Map(),
    updatedAt: null,
    source: "empty",
  };
}

export const useLab = create<LabState>((set, get) => ({
  products: [],
  productOrderHint: new Map(),
  productsUpdatedAt: null,
  productsSource: "empty",

  queries: [],
  submissions: [],
  loaded: false,

  refresh: async () => {
    const [productState, queries, submissions] = await Promise.all([
      loadProducts(),
      storage.listQueries(),
      storage.listSubmissions(),
    ]);
    set({
      products: productState.products,
      productOrderHint: productState.orderHint,
      productsUpdatedAt: productState.updatedAt,
      productsSource: productState.source,
      queries,
      submissions,
      loaded: true,
    });
  },

  refreshProducts: async () => {
    const productState = await loadProducts();
    set({
      products: productState.products,
      productOrderHint: productState.orderHint,
      productsUpdatedAt: productState.updatedAt,
      productsSource: productState.source,
    });
  },

  createQuery: async (q) => {
    if (readonlyWarn("createQuery")) {
      // 返回一个"伪"对象避免调用方崩；UI 已隐藏此入口
      return { ...(q as Query), code: "", id: "", createdAt: "", updatedAt: "" } as Query;
    }
    const now = new Date().toISOString();
    // 先本地生成 queryId（稳定主键）。注意：code 不再由前端"猜"。
    const id = nanoid(10);
    // 把编号分配交给后端编号注册簿：
    //   - 后端读 `.evaluations/_code-registry.json` 里单一事实源的 nextNumber
    //   - 并发 / 多 tab / 刷新 都不会撞号（Node 单线程序列化 + 原子落盘）
    //   - 幂等：重试只会复用同一个 code（reused=true）
    // 若调用失败（bus 中间件不可达），此时不走"前端瞎猜"兜底——直接抛错，
    // 因为继续下去必然产生脏数据。用户可刷新/重启 dev server 再试。
    const providedCode = (q as Query).code;
    const registered = await contractBus.registerCode({
      queryId: id,
      preferredCode: providedCode || undefined,
      registeredAt: now,
      note: "createQuery",
    });
    if (!registered || !registered.code) {
      throw new Error(
        "无法向编号注册簿申请编号（_bus/register-code 未返回）。请确认 dev server 在运行后重试。"
      );
    }
    const item: Query = {
      ...(q as Query),
      code: registered.code,
      id,
      createdAt: now,
      updatedAt: now,
    };
    await storage.upsertQuery(item);
    await get().refresh();
    return item;
  },
  updateQuery: async (q) => {
    if (readonlyWarn("updateQuery")) return;
    const item = { ...q, updatedAt: new Date().toISOString() };
    await storage.upsertQuery(item);
    await get().refresh();
  },
  deleteQuery: async (id) => {
    if (readonlyWarn("deleteQuery")) return;
    // 先拿 queryCode 给下面的级联清理用
    const target = get().queries.find((q) => q.id === id);
    const queryCode = target?.code;
    await storage.deleteQuery(id);

    // 级联清理 .evaluations/inbox 与 outbox（默认全删，UI 侧已 confirm 过）
    if (queryCode) {
      try {
        const [inboxResp, outboxResp] = await Promise.all([
          contractBus.listInbox().catch(() => null),
          contractBus.listOutbox().catch(() => null),
        ]);
        const inboxTargets = (inboxResp?.tasks ?? []).filter(
          (t) => t.taskId.startsWith(`${queryCode}-`)
        );
        const outboxTargets = (outboxResp?.results ?? []).filter(
          (t) => t.taskId.startsWith(`${queryCode}-`)
        );
        // 并发清理，单条失败不影响其他
        await Promise.all([
          ...inboxTargets.map((t) =>
            contractBus.deleteInbox(t.taskId).catch(() => null)
          ),
          ...outboxTargets.map((t) =>
            contractBus.deleteOutbox(t.taskId).catch(() => null)
          ),
        ]);
      } catch {
        // 整体失败不阻断本地 query 删除——本地先删、磁盘尽力清
      }
    }
    await get().refresh();
  },

  createSubmission: async (s) => {
    if (readonlyWarn("createSubmission")) {
      return { ...s, id: "", createdAt: "" } as Submission;
    }
    const item: Submission = { ...s, id: nanoid(10), createdAt: new Date().toISOString() };
    await storage.upsertSubmission(item);
    // 落 localStorage 后打一条结构化 log。
    // 注意：这里写的是 localStorage 镜像，不是 inbox（inbox 只有在用户召唤评测时才会被写）。
    console.info("[store.submission] create", {
      id: item.id,
      queryId: item.queryId,
      productId: item.productId,
      productVersion: item.productVersion,
      contentLen: (item.content ?? "").length,
    });
    await get().refresh();
    return item;
  },
  updateSubmission: async (s) => {
    if (readonlyWarn("updateSubmission")) return;
    await storage.upsertSubmission(s);
    console.info("[store.submission] update", {
      id: s.id,
      queryId: s.queryId,
      productId: s.productId,
      productVersion: s.productVersion,
      contentLen: (s.content ?? "").length,
      submittedAt: s.submittedAt,
    });
    await get().refresh();
  },
  deleteSubmission: async (id) => {
    if (readonlyWarn("deleteSubmission")) return;
    await storage.deleteSubmission(id);
    console.info("[store.submission] delete", { id });
    await get().refresh();
  },
}));
