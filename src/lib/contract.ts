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

/**
 * 档位（v2.0 契约新增）。S=10 / A=8 / B=6 / C=4 / D=2。
 * v1.0 产物不含此字段。
 */
export type RubricTier = "S" | "A" | "B" | "C" | "D";

/**
 * 打分确信度（v2.0 契约新增）。
 * - high：客观可数/可核查（如信源数量、数字准确性）
 * - medium：主观判断但有一定依据（如论证深度）
 * - low：几乎全凭感觉（如风格契合度）
 */
export type Confidence = "high" | "medium" | "low";

export interface OverallScoreItem {
  reportId: string;
  productName: string;
  score: number;
  verdict: VerdictLevel | string;
  /**
   * 一票否决是否触发（v2.0 契约新增）。
   * R1 存在重大事实错误时为 true，总分封顶 6.9、verdict ≤ "合格"。
   * v1.0 产物没有此字段，前端读取时按 false 处理。
   */
  vetoTriggered?: boolean;
  /** vetoTriggered=true 时的触发原因说明 */
  vetoReason?: string;
}

export interface RubricDimensionScore {
  reportId: string;
  score: number;
  comment: string;
  issueTags?: string[];
  /** v2.0 档位标签，与 score 严格对应（S=10/A=8/B=6/C=4/D=2） */
  tier?: RubricTier;
  /** v2.0 打分确信度 */
  confidence?: Confidence;
}

/**
 * R1 子档（v2.2 契约新增）。
 * 显式把 R1（0.40）拆成 R1a 事实准确（0.28） + R1b 逻辑准确（0.12），
 * 让前端可以展开展示"事实层 vs 推理链层"两档，并帮助 linter 校验 R1 合成分。
 *
 * 仅 R1 维度（dimensionId === "R1"）填写；v2.2 必填、历史版本没有此字段。
 */
export interface R1Subscore {
  score: number;
  tier?: RubricTier;
  /** 固定 0.28（R1a） / 0.12（R1b），由 linter 机械校验 */
  weight: number;
  comment: string;
}

export interface RubricDimensionBlock {
  /** R1 ~ R5 */
  dimensionId: "R1" | "R2" | "R3" | "R4" | "R5";
  name: string;
  weight: number;
  scores: RubricDimensionScore[];
  /** v2.2 R1 专属：事实(R1a 0.28) + 逻辑(R1b 0.12) 子档 */
  subscores?: {
    R1a: R1Subscore;
    R1b: R1Subscore;
  };
}

export interface ExtraDimensionScore {
  reportId: string;
  score: number;
  comment: string;
  tier?: RubricTier;
  confidence?: Confidence;
  issueTags?: string[];
}

export interface ExtraDimensionBlock {
  /** X1, X2, X3 */
  dimensionId: string;
  name: string;
  rationale: string;
  /**
   * 是否激活纳入总分（v2.0 契约新增）。
   * 激活时 weight 必填（0.05 / 0.10 / 0.15），R1~R5 权重等比缩减。
   * v1.0 产物没有此字段，前端按 false 处理。
   */
  activated?: boolean;
  /** activated=true 时必填的权重（0.05 / 0.10 / 0.15） */
  weight?: number;
  scores: ExtraDimensionScore[];
}

export type SbsWinner = "A" | "B" | "tie" | "draw";

/**
 * SBS 对比结构。
 *
 * v2.2 起升级字段：
 * - `reportIdA` / `reportIdB`：替代旧的 `productA` / `productB`（按 reportId 匹配，消除 UI 歧义）
 * - `margin`：改为英文枚举（`overwhelming` / `clear` / `slight` / `tie`），但仍兼容旧的中文 margin
 * - `dimensionDriver`：主要由哪个/哪些维度拉开差距（例如 `"R1"` 或 `["R1", "R3"]`）
 *
 * v2.1 及以前产物使用 productA/productB + 中文 margin，前端要兼容渲染两种结构。
 */
export interface SbsPair {
  /** v2.2 新字段：参与对比的报告 A id */
  reportIdA?: string;
  /** v2.2 新字段：参与对比的报告 B id */
  reportIdB?: string;
  /** v2.1 及以前字段：保留兼容 */
  productA?: string;
  /** v2.1 及以前字段：保留兼容 */
  productB?: string;
  winner: SbsWinner;
  /**
   * margin 枚举：
   * - v2.2：`overwhelming` / `clear` / `slight` / `tie`
   * - v2.1 及以前：`压倒性` / `明显优势` / `略微领先` / `势均力敌`
   */
  margin: string;
  /** v2.2 新字段：主要由哪个/哪些维度拉开差距（单个或多个 Rx/Xy） */
  dimensionDriver?: string | string[];
  keyReason: string;
}

/**
 * 每份报告的结构化反馈（v2.1 契约新增，必填）。
 *
 * 给网站做结构化展示用（每份报告一张"反馈卡"），避免让"做得好/不好/建议"只藏在 report markdown 里。
 * 每个数组至少 1 条；每条都应指向具体维度 + 具体事例（禁止"整体不错"这种空泛写法）。
 */
export interface PerReportFeedback {
  reportId: string;
  productName: string;
  /** 该报告的显著强项（指向维度 + 具体事例） */
  strengths: string[];
  /** 该报告的显著短板（与 issueTags / vetoReason 呼应） */
  weaknesses: string[];
  /** 可操作的改进建议（告诉作者"下次怎么写能更好"） */
  improvements: string[];
}

// ------------------------------------------------------------
// v2.2 新增：Claim 核验 / Checklist 完成度 / 时间预算
// ------------------------------------------------------------

/** 承重 claim 类型 */
export type ClaimType = "fact" | "number" | "logic" | "source";

/** claim 承重等级 */
export type ClaimSupportWeight = "high" | "medium";

/**
 * 承重 claim 清单项（v2.2 新增）。
 *
 * 每份报告 3~5 条（Top 5 封顶），其中至少 1 条 `type === "logic"`。
 */
export interface ClaimInventoryItem {
  /** 全 payload 内唯一，建议 c1/c2/... */
  claimId: string;
  reportId: string;
  type: ClaimType;
  claim: string;
  supportWeight: ClaimSupportWeight;
  /** 可选：回溯原文位置 */
  locationHint?: string;
}

/** claim 核验状态 */
export type ClaimCheckStatus =
  | "verified-correct"
  | "refuted"
  | "inconclusive"
  | "skipped-time-budget"
  | "skipped-out-of-scope";

/** 由哪个 Pass 完成 */
export type ClaimCheckedBy =
  | "pass1-skim"
  | "pass2-external-search"
  | "pass2-arithmetic"
  | "pass3-logic"
  | "pass3-cross-section";

/** Veto 错误模式代号（v2.2 与 RUBRIC_STANDARD.md R1 一票否决清单对齐） */
export type VetoMode = "V1" | "V2" | "V3" | "V4" | "V5";

/**
 * 单条 claim 的核验结果（v2.2 新增）。
 *
 * 每个 `claimInventory` 项都必须在 `claimChecks` 里有对应记录。
 * 覆盖率硬约束：`(verified-correct + refuted + inconclusive) / 非 skipped ≥ 85%`。
 */
export interface ClaimCheckItem {
  claimId: string;
  status: ClaimCheckStatus;
  /** 对照源 + 结论（verified/refuted 必填；skipped 可省略） */
  evidence?: string;
  checkedBy?: ClaimCheckedBy;
  /** 仅 status=refuted 且触发 veto 时写 */
  vetoMode?: VetoMode;
}

/**
 * 单个维度的 checklist 完成度项（v2.2 新增）。
 *
 * `label` 是 checklist 项的简写标题（见 RUBRIC_STANDARD.md 每维度的"必查 checklist"）；
 * `passedFor` 是通过该项的 reportId 列表，没通过的不出现在数组里（可为空）。
 */
export interface DimensionChecklistItem {
  label: string;
  /** 通过该 check 的 reportId 列表 */
  passedFor: string[];
  /** 可选：对本 check 的简短说明 */
  note?: string;
}

/**
 * 单个维度的 checklist 完成度（v2.2 新增）。
 *
 * R1 应有 7 项 items；R2~R5 各 5 项。
 */
export interface DimensionChecklist {
  items: DimensionChecklistItem[];
  /** 可选：列出本评测覆盖的 reportId（跟 items[].passedFor 的候选集合） */
  reportIds?: string[];
}

/**
 * 5 维度 checklist 完成度（v2.2 新增）。
 *
 * R1~R5 五个键都必填；扩展维度可选。
 */
export interface DimensionChecklistsMap {
  R1: DimensionChecklist;
  R2: DimensionChecklist;
  R3: DimensionChecklist;
  R4: DimensionChecklist;
  R5: DimensionChecklist;
  [extraDimension: string]: DimensionChecklist;
}

/**
 * 评测阶段标识（v2.2）。
 * - read：读报告
 * - claim-inventory：抽取承重 claim
 * - pass1：快筛
 * - pass2：深核嫌疑
 * - pass3：逻辑一致性
 * - score：打分 + overallScore + SBS
 * - feedback：perReportFeedback + report 正文
 */
export type EvaluationPass =
  | "read"
  | "claim-inventory"
  | "pass1"
  | "pass2"
  | "pass3"
  | "score"
  | "feedback";

/**
 * 45 分钟时间盒的实际执行报表（v2.2 新增，必填）。
 */
export interface VerificationBudget {
  /** 固定 45 */
  targetMinutes: number;
  /** 实际耗时（分钟），硬约束 ≤ 50 */
  actualMinutes: number;
  /** 完成的阶段列表，前 6 个不可省略 */
  passesCompleted: EvaluationPass[];
  /** status=skipped-time-budget 的 claim 数 */
  claimsSkippedDueToBudget: number;
  /** status=skipped-out-of-scope 的 claim 数 */
  claimsOutOfScope: number;
  /** 自由备注：流程偏差、超时原因等 */
  notes?: string;
}

export interface EvaluationSummary {
  overallScores: OverallScoreItem[];
  rubric: RubricDimensionBlock[];
  extraDimensions?: ExtraDimensionBlock[];
  sbs?: { pairs: SbsPair[] } | null;
  /**
   * v2.1 必填字段：每份报告的结构化反馈。
   * v1.0 / v2.0 产物没有该字段，前端渲染时按"未提供反馈"容错展示。
   */
  perReportFeedback?: PerReportFeedback[];

  /**
   * v2.2 必填：承重 claim 清单（每份报告 3~5 条，Top 5 封顶，含 ≥1 条 logic 类）。
   * 历史版本没有此字段，前端按"未提供 claim 核验地图"容错展示。
   */
  claimInventory?: ClaimInventoryItem[];

  /**
   * v2.2 必填：逐条 claim 的核验结果。
   * 历史版本没有此字段。
   */
  claimChecks?: ClaimCheckItem[];

  /**
   * v2.2 必填：5 维度 checklist 完成度。
   * 历史版本没有此字段。
   */
  dimensionChecklists?: DimensionChecklistsMap;

  /**
   * v2.2 必填：45 分钟时间盒的实际执行报表。
   * 历史版本没有此字段。
   */
  verificationBudget?: VerificationBudget;
}

export interface EvaluationOutboxPayload {
  taskId: string;
  version: number;
  evaluator: string;
  evaluatedAt: string;
  /**
   * 契约版本号。
   * - `"1.0"`：2026-04-19 ~ 2026-04-21 使用的旧契约（0.5 精度打分、无 tier/confidence/veto）
   * - `"2.0"`：2026-04-21 使用的契约（档位制 10/8/6/4/2、一票否决、扩展维度可激活）
   * - `"2.1"`：2026-04-22 起使用的契约（外部核验硬约束、perReportFeedback、report 正文六大章节）
   * - `"2.2"`：2026-04-25 起使用的契约（claim 驱动的 R1 核验、R1 子档 R1a/R1b、双轴 tier 表、dimensionChecklists、verificationBudget、SBS 新结构）
   *
   * 前端渲染时按此字段分支兼容——历史版本保留原样展示，新版本启用新 UI 能力
   * （档位标签、veto 徽章、激活的扩展维度纳入总分展示、perReportFeedback 反馈卡、
   * claim 核验地图、checklist 完成度表、时间预算报表）。
   */
  contractVersion: "1.0" | "2.0" | "2.1" | "2.2";
  /**
   * 冗余写入的 query 永久 id（2026-04-21 方案 D 新增）。
   * - 由 bus / bake 统一注入，payload 原作者（LLM）不需要填
   * - 前端 outboxAgg 优先用 queryId 做反查，在 code 变更后依然能稳定回链
   * - 历史产物没有该字段时回退到 `parseQueryCode(taskId)` → code → query
   */
  queryId?: string;
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
  /** 冗余 query 永久 id，由 bus / bake 注入；缺失时前端回退到 queryCode 匹配 */
  queryId?: string | null;
  latestVersion: number;
  latestMtime: number;
  versions: OutboxVersionMeta[];
}

export interface OutboxBundle {
  taskId: string;
  /** 冗余 query 永久 id，由 bus / bake 注入 */
  queryId?: string | null;
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

/**
 * /_bus/bake-freshness 返回结构。dev-only。
 *
 * 每一个 items[] 元素都是一个检查项（比如"RUBRIC_STANDARD.md vs standard.json"）；
 * stale[] 是 items 里 fresh=false 的子集，供 UI 快速渲染红点和 tooltip。
 */
export interface BakeFreshnessItem {
  /** 唯一标识，例如 "standard" / "contract" / "outbox:EV-0005-CAP0sN/v2.json" */
  id: string;
  /** 分类，便于前端分组展示 */
  kind: "contract-doc" | "outbox-task" | "outbox-version" | "bake" | string;
  fresh: boolean;
  /** 人类可读描述（可直接展示在 tooltip） */
  detail: string;
}

export interface BakeFreshnessResult {
  /** 是否所有检查项都新鲜 */
  fresh: boolean;
  /** public/data 目录是否存在（首次 clone 时可能缺失） */
  bakePresent: boolean;
  items: BakeFreshnessItem[];
  stale: BakeFreshnessItem[];
  /** ISO 时间戳 */
  checkedAt: string;
}

export const contractBus = {
  health(): Promise<{ ok: true; dir: string } | null> {
    return busFetch<{ ok: true; dir: string }>("GET", "/_bus/health");
  },

  /**
   * 检查对外版产物（public/data）是否跟得上 .evaluations 源文件。
   *
   * - dev（管理员版）：调真实端点，返回结构化的陈旧项列表
   * - prod（对外版）：端点不存在，永远返回 null（调用方应按"无警告"处理）
   *
   * 设计目的：让管理员 UI 能在页脚显示红点，避免"改了标准但忘了 bake"。
   */
  getBakeFreshness(): Promise<BakeFreshnessResult | null> {
    return busFetch<BakeFreshnessResult>("GET", "/_bus/bake-freshness");
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

  /**
   * 幂等注册评测 query 的业务编号（EV-xxxx）。
   *
   * 流程：
   *   前端 createQuery 时先调这个端点拿到后端分配的 code，再写 localStorage。
   *   后端把所有分配记录持久化到 `.evaluations/_code-registry.json`，
   *   因此：
   *     - 多个 tab / 浏览器刷新 都不会分配到相同编号
   *     - 同一个 queryId 重复注册 → 返回老 code（reused=true），幂等
   *     - 后端永远基于磁盘上单一事实源算 nextNumber，前端无需关心
   *
   * prod 下走不到（readonly 模式会被 dataSource 拦截），因此只在管理员版生效。
   */
  registerCode(input: {
    queryId: string;
    preferredCode?: string;
    registeredAt?: string;
    note?: string;
  }): Promise<
    | {
        ok: true;
        reused: boolean;
        code: string;
        queryId: string;
        registeredAt: string;
        note?: string;
      }
    | null
  > {
    return busFetch("POST", "/_bus/register-code", input);
  },

  /** 读取完整编号注册簿（调试 / 管理员面板展示用） */
  getRegistry(): Promise<{
    version: 1;
    prefix: string;
    padWidth: number;
    nextNumber: number;
    entries: Array<{
      code: string;
      queryId: string;
      registeredAt: string;
      note?: string;
    }>;
    map: Record<string, string>;
  } | null> {
    return busFetch("GET", "/_bus/registry");
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

  /**
   * 一键发布到对外版（GitHub Pages）。
   *
   * 串行跑：写 runtime-snapshot → npm run build:public → git add → commit → push
   * 任一步失败返回 { ok: false, failedStep, steps: [...] }，前端据此展示具体错误日志。
   * 成功返回 { ok: true, commitMessage, publicUrl, steps: [...] }。
   *
   * 注意：
   *  - 这个请求可能跑 30 秒~2 分钟（build:public 是重操作），前端要做好 loading 态。
   *  - 因为会执行 git push，所以只能在管理员版（dev）用，prod 下 dataSource 会拦截。
   *  - busFetch 失败会抛 BusError，这里不 try/catch，让调用方自己决定怎么展示。
   */
  publishToPublic(
    snapshot: { products: unknown[]; queries: unknown[]; submissions: unknown[]; version?: number }
  ): Promise<PublishResult | null> {
    return busFetch("POST", "/_bus/publish", snapshot);
  },

  /**
   * 读发布历史（append-only）。
   *
   * 两端都可调用：
   *  - dev：直接读 `.evaluations/_publish-log.json`
   *  - prod：读 bake 出的 `${BASE}/data/publish-log.json` 静态副本
   *
   * 失败（文件不存在 / 网络错）统一归一化为 `{ version: 1, entries: [] }`。
   */
  getPublishLog(): Promise<PublishLogDoc | null> {
    return busFetch("GET", "/_bus/publish-log");
  },
};

// ------------------------------------------------------------
// Publish Log 类型
// ------------------------------------------------------------
export interface PublishLogEntry {
  /** ISO 时间戳：对用户而言的"上次更新时间" */
  publishedAt: string;
  /** 本次发布是否成功 */
  ok: boolean;
  /** 成功时的 commit message（通常是 `publish: <iso>`） */
  commit?: string;
  /** 失败时指明是哪一步 */
  failedStep?: string;
  /** 失败时的错误摘要（最多前 500 字） */
  error?: string;
  /** 快照时的数量统计（成功时才记） */
  stats?: Record<string, number>;
}

export interface PublishLogDoc {
  version: 1;
  entries: PublishLogEntry[];
}

// 发布流程每一步的日志条目
export interface PublishStep {
  name: string;
  command: string;
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  skipped?: boolean;
  note?: string;
}

export interface PublishResult {
  ok: boolean;
  /** 失败时指明是哪一步挂的 */
  failedStep?: string;
  /** 成功时给出 commit message（前端可展示） */
  commitMessage?: string;
  /** 成功时给出对外版 URL（前端可做"打开新标签"入口） */
  publicUrl?: string;
  steps: PublishStep[];
  /**
   * Preflight 硬错误（仅失败时返回）。每条一段中文描述，前端直接展示。
   * 出现 errors 时 failedStep === "preflight"。
   */
  preflightErrors?: string[];
  /**
   * Preflight 软警告（成功/失败都可能返回）。自动纠正的情况（例如 code 被对齐），
   * 都记在这里；前端应该在成功 modal 里显眼展示，提示用户刷新 localStorage。
   */
  preflightWarnings?: string[];
}

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
