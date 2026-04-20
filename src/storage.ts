// ============================================================
// Storage Adapter - 存储层抽象（本地版 + 只读公开版）
//
// 注：自契约 v1 起，评测结果由 LLM 写入 `.evaluations/outbox/` JSON，
// localStorage 只负责 Product / Query / Submission 三张表；
// Evaluation/Comment 已下线，见 EVALUATION_CONTRACT.md。
//
// 2026-04-20 新增只读公开版适配器 `PublicBundleAdapter`：
//   - 首屏从 `${BASE}/data/public-bundle.json` 载入 queries + submissions 元信息
//   - Submission 正文按需从 `${BASE}/data/reports/{id}.md` 懒加载
//   - 所有写接口 no-op（UI 侧应该已经隐藏，但加一道兜底）
// ============================================================
import type {
  AIProduct,
  LabSnapshot,
  Query,
  Submission,
} from "./types";
import { IS_READONLY } from "./lib/dataSource";

export interface StorageAdapter {
  // Products
  listProducts(): Promise<AIProduct[]>;
  upsertProduct(p: AIProduct): Promise<void>;
  deleteProduct(id: string): Promise<void>;

  // Queries
  listQueries(): Promise<Query[]>;
  upsertQuery(q: Query): Promise<void>;
  deleteQuery(id: string): Promise<void>;

  // Submissions
  listSubmissions(queryId?: string): Promise<Submission[]>;
  upsertSubmission(s: Submission): Promise<void>;
  deleteSubmission(id: string): Promise<void>;

  // Import / Export
  exportAll(): Promise<LabSnapshot>;
  importAll(snapshot: LabSnapshot, mode: "merge" | "replace"): Promise<void>;
}

// ============================================================
// 本地存储实现
// ============================================================
const KEY = "sophia-rubric-lab:v1";

interface Bucket {
  products: AIProduct[];
  queries: Query[];
  submissions: Submission[];
}

function emptyBucket(): Bucket {
  return { products: [], queries: [], submissions: [] };
}

/**
 * 读取 bucket；兼容老快照里可能仍含 evaluations/comments 字段——
 * 这些字段会被默默丢弃，不会再进入内存或导出。
 */
function read(): Bucket {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyBucket();
    const parsed = JSON.parse(raw) as Partial<Bucket> & Record<string, unknown>;
    return {
      products: Array.isArray(parsed.products) ? parsed.products : [],
      queries: Array.isArray(parsed.queries) ? parsed.queries : [],
      submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [],
    };
  } catch {
    return emptyBucket();
  }
}

function write(b: Bucket) {
  localStorage.setItem(KEY, JSON.stringify(b));
}

function upsertInto<T extends { id: string }>(arr: T[], item: T): T[] {
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx >= 0) {
    const copy = arr.slice();
    copy[idx] = item;
    return copy;
  }
  return [...arr, item];
}

export class LocalStorageAdapter implements StorageAdapter {
  async listProducts() {
    return read().products;
  }
  async upsertProduct(p: AIProduct) {
    const b = read();
    b.products = upsertInto(b.products, p);
    write(b);
  }
  async deleteProduct(id: string) {
    const b = read();
    b.products = b.products.filter((x) => x.id !== id);
    write(b);
  }

  async listQueries() {
    return read().queries;
  }
  async upsertQuery(q: Query) {
    const b = read();
    b.queries = upsertInto(b.queries, q);
    write(b);
  }
  async deleteQuery(id: string) {
    const b = read();
    b.queries = b.queries.filter((x) => x.id !== id);
    // 级联删 submission（对应评测产物由 store.deleteQuery 调用 contractBus 清理）
    b.submissions = b.submissions.filter((s) => s.queryId !== id);
    write(b);
  }

  async listSubmissions(queryId?: string) {
    const all = read().submissions;
    return queryId ? all.filter((x) => x.queryId === queryId) : all;
  }
  async upsertSubmission(s: Submission) {
    const b = read();
    b.submissions = upsertInto(b.submissions, s);
    write(b);
  }
  async deleteSubmission(id: string) {
    const b = read();
    b.submissions = b.submissions.filter((x) => x.id !== id);
    write(b);
  }

  async exportAll(): Promise<LabSnapshot> {
    const b = read();
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      ...b,
    };
  }

  async importAll(snapshot: LabSnapshot, mode: "merge" | "replace") {
    // 兼容 v1 快照（含 evaluations/comments 字段）：忽略这些字段，只吃 products/queries/submissions
    if (mode === "replace") {
      write({
        products: snapshot.products ?? [],
        queries: snapshot.queries ?? [],
        submissions: snapshot.submissions ?? [],
      });
      return;
    }
    const b = read();
    snapshot.products?.forEach((p) => (b.products = upsertInto(b.products, p)));
    snapshot.queries?.forEach((q) => (b.queries = upsertInto(b.queries, q)));
    snapshot.submissions?.forEach((s) => (b.submissions = upsertInto(b.submissions, s)));
    write(b);
  }
}

// ============================================================
// 占位：未来云端 API 适配器
// ============================================================
// export class ApiStorageAdapter implements StorageAdapter {
//   constructor(private baseUrl: string, private token: string) {}
//   // ...调用 REST/GraphQL API
// }

// ============================================================
// 只读公开版适配器
// ------------------------------------------------------------
// 从 `${BASE}/data/public-bundle.json` 一次性装载 queries + submissions（轻量版，
// submission.content 用 `contentRef` 指向 reports/{id}.md）。
// 所有写接口都是 no-op（会记 console.warn，方便排查）。
//
// submission.content 采用按需拉取 + 进程内缓存：
//   - 第一次访问 listSubmissions 时只返回元信息（不含 content）
//   - 渲染详情页 / 正文时再 fetch 对应 md；缓存避免重复请求
//
// 之所以不把所有 content 都塞进 bundle：若未来报告数增多，bundle 会轻易
// 膨胀到几 MB，首屏加载成本过高。拆分之后首屏只需要 <100KB 元数据。
// ============================================================

interface PublicBundle {
  bakedAt: string;
  contractVersion: string;
  products: AIProduct[];
  queries: Query[];
  /** submissions 里 content 被置为 undefined，改用 contentRef 懒加载 */
  submissions: Array<Submission & { contentRef?: string }>;
  stats?: { queriesCount: number; submissionsCount: number; reportsCount: number };
}

export class PublicBundleAdapter implements StorageAdapter {
  private bundlePromise: Promise<PublicBundle | null> | null = null;
  /** submission.id → 正文 content；首次访问时懒加载 */
  private reportCache = new Map<string, string>();
  /** submission.id → 正文拉取中的 promise（去重并发请求） */
  private reportPending = new Map<string, Promise<string>>();

  private async loadBundle(): Promise<PublicBundle | null> {
    if (!this.bundlePromise) {
      this.bundlePromise = (async () => {
        try {
          const base = import.meta.env.BASE_URL.replace(/\/$/, "");
          const url = `${base}/data/public-bundle.json?_=${Date.now()}`;
          const resp = await fetch(url, { cache: "no-store" });
          if (!resp.ok) return null;
          return (await resp.json()) as PublicBundle;
        } catch {
          return null;
        }
      })();
    }
    return this.bundlePromise;
  }

  /**
   * 拉取某条 submission 的正文 markdown；结果缓存在内存中。
   * 外部调用：ReportPage 展开报告原文时使用。
   */
  async loadReportContent(submissionId: string): Promise<string> {
    const cached = this.reportCache.get(submissionId);
    if (cached !== undefined) return cached;
    const pending = this.reportPending.get(submissionId);
    if (pending) return pending;
    const p = (async () => {
      try {
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        const url = `${base}/data/reports/${encodeURIComponent(submissionId)}.md?_=${Date.now()}`;
        const resp = await fetch(url, { cache: "no-store" });
        if (!resp.ok) return "";
        return await resp.text();
      } catch {
        return "";
      }
    })();
    this.reportPending.set(submissionId, p);
    const text = await p;
    this.reportCache.set(submissionId, text);
    this.reportPending.delete(submissionId);
    return text;
  }

  private noopWarn(op: string) {
    // eslint-disable-next-line no-console
    console.warn(`[PublicBundleAdapter] write operation "${op}" ignored in public read-only mode.`);
  }

  async listProducts() {
    return (await this.loadBundle())?.products ?? [];
  }
  async upsertProduct() {
    this.noopWarn("upsertProduct");
  }
  async deleteProduct() {
    this.noopWarn("deleteProduct");
  }

  async listQueries() {
    return (await this.loadBundle())?.queries ?? [];
  }
  async upsertQuery() {
    this.noopWarn("upsertQuery");
  }
  async deleteQuery() {
    this.noopWarn("deleteQuery");
  }

  async listSubmissions(queryId?: string) {
    const all = (await this.loadBundle())?.submissions ?? [];
    // 返回"伪 content"：这里返回空字符串，正文由 UI 层显式调 loadReportContent 拉取
    // 也可以返回 contentRef 字段让 UI 判断是否未载入
    const mapped: Submission[] = all.map((s) => ({
      ...s,
      content: s.content ?? "",
    }));
    return queryId ? mapped.filter((x) => x.queryId === queryId) : mapped;
  }
  async upsertSubmission() {
    this.noopWarn("upsertSubmission");
  }
  async deleteSubmission() {
    this.noopWarn("deleteSubmission");
  }

  async exportAll(): Promise<LabSnapshot> {
    const bundle = await this.loadBundle();
    return {
      version: 2,
      exportedAt: bundle?.bakedAt ?? new Date().toISOString(),
      products: bundle?.products ?? [],
      queries: bundle?.queries ?? [],
      submissions: (bundle?.submissions ?? []).map((s) => ({
        ...s,
        content: s.content ?? "",
      })),
    };
  }

  async importAll() {
    this.noopWarn("importAll");
  }
}

// 默认导出：根据运行模式自动选择适配器
export const storage: StorageAdapter = IS_READONLY
  ? new PublicBundleAdapter()
  : new LocalStorageAdapter();

/**
 * 获取 PublicBundleAdapter 的 loadReportContent 方法（仅 prod 下有值）。
 * UI 层拿到 submission 时，如果 content 为空，应调用这个懒加载函数。
 */
export function getReadonlyReportLoader(): ((id: string) => Promise<string>) | null {
  if (storage instanceof PublicBundleAdapter) {
    return (id) => storage.loadReportContent(id);
  }
  return null;
}
