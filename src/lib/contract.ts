// ============================================================
// contract.ts
// 新架构（契约 v1）下，前端与 .evaluations/ 文件系统的桥梁
//
// 职责：
//  1. 定义 inbox/outbox JSON 的 TypeScript 类型（与 EVALUATION_CONTRACT.md 对齐）
//  2. 封装 /_bus/* 的 HTTP 调用
//  3. 从前端 Submission/Query/Product 构造 InboxTask
//
// 不负责：
//  - 真正的评分（那是 LLM 的事）
//  - Zustand store 的状态管理（由调用方决定如何消费产物）
// ============================================================

import type { Query, Submission, AIProduct } from "../types";
import { makeDataSource, IS_READONLY, ReadOnlyError } from "./dataSource";

export { IS_READONLY, ReadOnlyError };

// ------------------------------------------------------------
// Inbox（网站 → LLM）
// ------------------------------------------------------------

export interface InboxCandidate {
  /** 对应前端 Submission.id，LLM 必须原样回写到 outbox */
  reportId: string;
  productName: string;
  productVersion?: string;
  authorNote?: string;
  /** 报告 markdown 正文，直接内联，LLM 不需再外部取数 */
  report: string;
}

export interface InboxTask {
  taskId: string;
  createdAt: string;
  contractVersion: "1.0";
  query: {
    id: string;
    code: string;
    title: string;
    type: string;
    description?: string;
    prompt?: string;
    domain?: string;
  };
  candidates: InboxCandidate[];
}

// ------------------------------------------------------------
// Outbox（LLM → 网站）
// ------------------------------------------------------------

export type VerdictLevel = "卓越" | "优秀" | "合格" | "待改进" | "不合格";

export interface OverallScoreItem {
  reportId: string;
  productName: string;
  score: number;
  verdict: VerdictLevel | string;
}

export interface RubricDimensionScore {
  reportId: string;
  score: number;
  comment: string;
  issueTags?: string[];
}

export interface RubricDimensionBlock {
  /** R1 ~ R5 */
  dimensionId: "R1" | "R2" | "R3" | "R4" | "R5";
  name: string;
  weight: number;
  scores: RubricDimensionScore[];
}

export interface ExtraDimensionBlock {
  /** X1, X2, X3 */
  dimensionId: string;
  name: string;
  rationale: string;
  scores: Array<{
    reportId: string;
    score: number;
    comment: string;
  }>;
}

export type SbsWinner = "A" | "B" | "tie";

export interface SbsPair {
  productA: string;
  productB: string;
  winner: SbsWinner;
  margin: string; // "压倒性" | "明显优势" | "略微领先" | "势均力敌"
  keyReason: string;
}

export interface EvaluationSummary {
  overallScores: OverallScoreItem[];
  rubric: RubricDimensionBlock[];
  extraDimensions?: ExtraDimensionBlock[];
  sbs?: { pairs: SbsPair[] } | null;
}

export interface EvaluationOutboxPayload {
  taskId: string;
  version: number;
  evaluator: string;
  evaluatedAt: string;
  /**
   * 契约版本号。当前唯一合法值为 "1.0"。
   * 未来升级到 "2.0" 时，此处扩为联合类型（如 "1.0" | "2.0"），
   * 并在渲染路径上按版本分支兼容旧产物。
   */
  contractVersion: "1.0";
  summary: EvaluationSummary;
  /** 自由 markdown 正文 */
  report: string;
}

// ------------------------------------------------------------
// Bus 列表返回
// ------------------------------------------------------------

export interface InboxListItem {
  taskId: string;
  queryCode?: string;
  mtime: number;
  size: number;
}

export interface OutboxVersionMeta {
  v: number;
  mtime: number;
  size: number;
}

export interface OutboxListItem {
  taskId: string;
  queryCode?: string;
  latestVersion: number;
  latestMtime: number;
  versions: OutboxVersionMeta[];
}

export interface OutboxBundle {
  taskId: string;
  latestVersion: number;
  versions: OutboxVersionMeta[];
  latest: EvaluationOutboxPayload;
}

// ------------------------------------------------------------
// taskId 生成
// ------------------------------------------------------------

const TASK_ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function nano6(): string {
  let s = "";
  const arr = new Uint8Array(6);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < 6; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < 6; i++) s += TASK_ID_CHARS[arr[i] % TASK_ID_CHARS.length];
  return s;
}

export function makeTaskId(queryCode: string): string {
  return `${queryCode}-${nano6()}`;
}

// ------------------------------------------------------------
// 组装 Inbox
// ------------------------------------------------------------

export function buildInboxTask(input: {
  query: Query;
  submissions: Submission[];
  products: AIProduct[];
  taskId?: string;
}): InboxTask {
  const taskId = input.taskId ?? makeTaskId(input.query.code);
  const productMap = new Map(input.products.map((p) => [p.id, p]));
  const candidates: InboxCandidate[] = input.submissions.map((s) => {
    const p = productMap.get(s.productId);
    return {
      reportId: s.id,
      productName: p?.name ?? "Unknown",
      productVersion: s.productVersion ?? p?.version,
      report: s.content,
    };
  });
  return {
    taskId,
    createdAt: new Date().toISOString(),
    contractVersion: "1.0",
    query: {
      id: input.query.id,
      code: input.query.code,
      title: input.query.title,
      type: input.query.typeId,
      description: input.query.description,
      domain: input.query.domain,
    },
    candidates,
  };
}

// ------------------------------------------------------------
// Bus 调用封装
// ------------------------------------------------------------

/**
 * 原始 HTTP 层：执行真正的 fetch + 错误归一化 + 事件广播。
 * dev 与 prod 都会复用它——区别仅在于 URL（dev 指向 /_bus/*，
 * prod 指向 `${BASE_URL}data/*.json`），由 dataSource 统一映射。
 *
 * silentErrors=true 时：任何失败（网络/4xx/5xx）都不会广播 bus-error 事件，
 * 但依然会抛 BusError（调用方可以自己决定降级还是上抛）。
 * 这是 prod 静态数据源的刚需——GitHub Pages 上拿不到某个 taskId 的 JSON 属于
 * "正常空态"，不应该让全局 banner 红成一片。
 */
async function rawBusFetch<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  silentErrors: boolean = false
): Promise<T | null> {
  // 对 GET 请求加上 cache-busting query 参数 + cache: "no-store"
  // 避免浏览器 memory cache 把"刷新"吃掉（服务端已发 Cache-Control: no-store，
  // 但部分浏览器对 memory cache 不完全遵守）。
  // prod 下访问的是 GitHub Pages 上的静态 JSON，同样需要绕过 CDN / 浏览器缓存，
  // 否则 bake 更新后用户看到的还是旧数据（GH Pages 不支持服务端 no-store 头）。
  let finalPath = path;
  if (method === "GET") {
    const ts = Date.now();
    finalPath = path.includes("?") ? `${path}&_=${ts}` : `${path}?_=${ts}`;
  }
  let res: Response;
  try {
    res = await fetch(finalPath, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch (err) {
    // 网络层失败（Vite 中间件不可达、用户离线、DNS 解析失败…）
    // 归一化为 BusError，同时派发全局事件让 UI banner 感知
    const message = err instanceof Error ? err.message : String(err);
    if (!silentErrors) emitBusError("network", `${method} ${path}: ${message}`);
    throw new BusError("network", `Bus ${method} ${path} · 网络不可达：${message}`);
  }
  if (res.status === 204) return null;
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) detail = j.error;
    } catch {
      /* noop */
    }
    const code = res.status >= 500 ? "server" : "client";
    const msg = `Bus ${method} ${path} -> ${res.status}${detail ? `: ${detail}` : ""}`;
    if (!silentErrors) emitBusError(code, msg);
    throw new BusError(code, msg, res.status);
  }
  return (await res.json()) as T;
}

/**
 * 数据源单例：根据 IS_READONLY 在 dev(/_bus) 和 prod(/data) 之间切换。
 * - read：prod 下静态文件 404/网络错误降级为 null（空态兜底）
 * - write：prod 下抛 ReadOnlyError（UI 已隐藏，只是兜底）
 */
const dataSource = makeDataSource(rawBusFetch);

/**
 * 统一入口，保留原 busFetch 的函数签名，方便站内既有调用点几乎不改。
 * GET → dataSource.read；其余 → dataSource.write。
 */
async function busFetch<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown
): Promise<T | null> {
  if (method === "GET") {
    return dataSource.read<T>(path);
  }
  return dataSource.write<T>(path, method, body);
}

// ------------------------------------------------------------
// 错误归一化（让 UI 层可以优雅降级 + 显示 banner）
// ------------------------------------------------------------

export type BusErrorCode = "network" | "client" | "server";

export class BusError extends Error {
  readonly code: BusErrorCode;
  readonly status?: number;
  constructor(code: BusErrorCode, message: string, status?: number) {
    super(message);
    this.name = "BusError";
    this.code = code;
    this.status = status;
  }
}

/**
 * 全局错误广播：UI 层可以监听 window 上的 "bus-error" 事件
 * 来做 banner/toast 提示，而不用把 try/catch 铺满全站。
 *
 * 设计刻意走 window event 而非 Zustand：避免为一个"可选的离线提示"
 * 在核心 store 里加新 state，也避免循环依赖（contract.ts 不应该依赖 store）。
 */
export interface BusErrorEventDetail {
  code: BusErrorCode;
  message: string;
  at: number;
}

function emitBusError(code: BusErrorCode, message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<BusErrorEventDetail>("bus-error", {
      detail: { code, message, at: Date.now() },
    })
  );
}

export interface ContractDocument {
  /** 相对 workspace root 的路径 */
  path: string;
  /** 文件最后修改时间（epoch ms） */
  mtime: number;
  size: number;
  /** md 原文 */
  content: string;
}

/** PRODUCTS.json 里单条产品的原始结构（与前端 AIProduct 基本一致，但由 bus 保证只读） */
export interface BusProduct {
  id: string;
  name: string;
  version?: string | null;
  vendor?: string | null;
  color?: string | null;
  /** 可选：手动指定展示序，sortProducts 会在 Sophia 分桶后再看它 */
  order?: number | null;
}

export interface ProductsResponse {
  /** 相对 workspace root 的路径 */
  path: string;
  mtime: number;
  size: number;
  /** PRODUCTS.json 里的 updatedAt 字段（可能为 null） */
  updatedAt: string | null;
  products: BusProduct[];
}

export const contractBus = {
  health(): Promise<{ ok: true; dir: string } | null> {
    return busFetch<{ ok: true; dir: string }>("GET", "/_bus/health");
  },

  /** 读取面向用户的评测标准 RUBRIC_STANDARD.md 原文 */
  getStandard(): Promise<ContractDocument | null> {
    return busFetch<ContractDocument>("GET", "/_bus/standard");
  },

  /** 读取面向 LLM 的工作协议 EVALUATION_CONTRACT.md 原文 */
  getContract(): Promise<ContractDocument | null> {
    return busFetch<ContractDocument>("GET", "/_bus/contract");
  },

  /** 读取评测主体清单 PRODUCTS.json（只读；前端不应写入） */
  getProducts(): Promise<ProductsResponse | null> {
    return busFetch<ProductsResponse>("GET", "/_bus/products");
  },

  submitInbox(task: InboxTask): Promise<{ ok: true; taskId: string; file: string } | null> {
    return busFetch("POST", "/_bus/inbox", task);
  },

  listInbox(): Promise<{ tasks: InboxListItem[] } | null> {
    return busFetch("GET", "/_bus/inbox");
  },

  getInbox(taskId: string): Promise<InboxTask | null> {
    return busFetch("GET", `/_bus/inbox/${encodeURIComponent(taskId)}`);
  },

  deleteInbox(taskId: string): Promise<{ ok: true } | null> {
    return busFetch("DELETE", `/_bus/inbox/${encodeURIComponent(taskId)}`);
  },

  listOutbox(): Promise<{ results: OutboxListItem[] } | null> {
    return busFetch("GET", "/_bus/outbox");
  },

  getOutbox(taskId: string): Promise<OutboxBundle | null> {
    return busFetch("GET", `/_bus/outbox/${encodeURIComponent(taskId)}`);
  },

  getOutboxVersion(taskId: string, v: number): Promise<EvaluationOutboxPayload | null> {
    return busFetch("GET", `/_bus/outbox/${encodeURIComponent(taskId)}/v/${v}`);
  },

  deleteOutbox(taskId: string): Promise<{ ok: true } | null> {
    return busFetch("DELETE", `/_bus/outbox/${encodeURIComponent(taskId)}`);
  },

  /**
   * 管理员一键导出本地 localStorage 快照到 `.evaluations/_runtime-snapshot.json`。
   * 这份 snapshot 会被 `npm run bake:public` 读取，确保对外版拿到的 queries/submissions
   * 与管理员本地保持一致（不会丢失 LLM 评过但 seed 里没有的 query）。
   * 仅在 dev 模式下可用（prod 下 dataSource 会抛 ReadOnlyError）。
   */
  exportRuntimeSnapshot(
    snapshot: { products: unknown[]; queries: unknown[]; submissions: unknown[]; version?: number }
  ): Promise<{ ok: true; file: string; stats: { products: number; queries: number; submissions: number } } | null> {
    return busFetch("POST", "/_bus/runtime-snapshot", snapshot);
  },
};

// ------------------------------------------------------------
// 便捷工具
// ------------------------------------------------------------

/** 把产物按 reportId 聚合，便于单份报告视角的展示 */
export function groupScoresByReport(payload: EvaluationOutboxPayload): Map<
  string,
  {
    overall?: OverallScoreItem;
    rubric: Array<{ dimensionId: string; name: string; weight: number } & RubricDimensionScore>;
    extra: Array<{ dimensionId: string; name: string; rationale: string; score: number; comment: string }>;
  }
> {
  const map = new Map<
    string,
    {
      overall?: OverallScoreItem;
      rubric: Array<{ dimensionId: string; name: string; weight: number } & RubricDimensionScore>;
      extra: Array<{ dimensionId: string; name: string; rationale: string; score: number; comment: string }>;
    }
  >();
  const ensure = (reportId: string) => {
    let entry = map.get(reportId);
    if (!entry) {
      entry = { rubric: [], extra: [] };
      map.set(reportId, entry);
    }
    return entry;
  };
  for (const o of payload.summary.overallScores) {
    ensure(o.reportId).overall = o;
  }
  for (const r of payload.summary.rubric) {
    for (const s of r.scores) {
      ensure(s.reportId).rubric.push({
        dimensionId: r.dimensionId,
        name: r.name,
        weight: r.weight,
        ...s,
      });
    }
  }
  for (const x of payload.summary.extraDimensions ?? []) {
    for (const s of x.scores) {
      ensure(s.reportId).extra.push({
        dimensionId: x.dimensionId,
        name: x.name,
        rationale: x.rationale,
        score: s.score,
        comment: s.comment,
      });
    }
  }
  return map;
}

/** 召唤口令：展示给用户，让他粘贴到 WorkBuddy 对话框 */
export function buildSummonPrompt(taskId: string): string {
  return `请扮演 Sophia 评测官，按 .evaluations/EVALUATION_CONTRACT.md 的契约处理评测任务 ${taskId}：
1. 先完整读一遍 .evaluations/EVALUATION_CONTRACT.md（如果尚未读过）
2. 读 .evaluations/inbox/${taskId}.json
3. 按契约完成评分 + 自由 markdown 正文
4. 写入 .evaluations/outbox/${taskId}/v{n}.json（版本号自己扫目录递增）
5. 完成后告诉我路径与版本号，我回网站刷新查看`;
}
