/**
 * codeRegistry.ts
 *
 * 全局唯一的 **评测编号注册簿**（Code Registry）。
 *
 * ─────────────────────────────────────────────────────────────
 * 设计原点
 * ─────────────────────────────────────────────────────────────
 * 每一条 query 一经创建，就必须拿到一个 **永不重复、永不回收、全局共识**
 * 的业务编号（目前形如 `EV-0001`）。以前的实现把"下一个编号"的决策权
 * 留在前端内存里，靠 `max(existing.code) + 1` 来推算，因此会被下述场景
 * 打破唯一性：
 *
 *   1. 浏览器多 tab 并发创建 → 各自读到同一个 maxNum，分配出相同编号
 *   2. 前端刚刷新、state 还没从 IndexedDB 加载完 → maxNum 读到 0
 *      → 新建出的 EV-0001 和历史已有的 EV-0001 撞车
 *   3. seed snapshot 与 runtime snapshot 是两个彼此失明的 code 空间，
 *      seed 占了 EV-0001，runtime 新建时完全不知道
 *
 * 本模块把 **编号分配** 从前端内存决策，升级为后端持久化的原子操作：
 *   - 所有已分配编号永久落盘到 `.evaluations/_code-registry.json`
 *   - 分配流程：
 *       registerByQueryId(queryId) → 若已注册则幂等返回旧 code；
 *                                    否则取 nextNumber、写盘、递增
 *   - 编号永不回收：即使 query 被删除，它占用过的编号也不复用
 *     （避免旧 outbox/inbox 文件的前缀跟新 query 张冠李戴）
 *
 * ─────────────────────────────────────────────────────────────
 * 文件结构：.evaluations/_code-registry.json
 * ─────────────────────────────────────────────────────────────
 *   {
 *     "version": 1,
 *     "prefix": "EV",
 *     "padWidth": 4,
 *     "nextNumber": 7,
 *     "entries": [
 *       {
 *         "code": "EV-0001",
 *         "queryId": "q-bd-2026",
 *         "registeredAt": "2026-04-16T09:00:00.000Z",
 *         "note": "seed"
 *       },
 *       ...
 *     ]
 *   }
 *
 * `entries` 按 `registeredAt` 升序保存；`nextNumber` 永远严格大于所有
 * 已用的数字部分。即使 entries 有缺失（例如旧编号删除），nextNumber 也
 * 只会单调递增，绝不回头。
 *
 * ─────────────────────────────────────────────────────────────
 * 启动期自检（reconcile）
 * ─────────────────────────────────────────────────────────────
 * dev server 启动时会跑一次 `reconcile()`：
 *   1. 从 seed snapshot + runtime snapshot 里把所有 query 捞出来，按
 *      createdAt 升序排好
 *   2. 对每条 query：
 *      a) 如果 queryId 已在 registry 里 → 沿用老编号（可能和它目前
 *         在 snapshot 上的 code 不一致，这种以 registry 为准，后续
 *         会回写 snapshot + 重命名磁盘文件）
 *      b) 否则分配新编号；**先尝试把它原来的 code 认领下来**——
 *         只有当那个 code 还没被其他 queryId 占用时才成功，否则
 *         走 nextNumber
 *   3. 扫描 inbox/outbox 目录，任何 `{oldCode}-xxxxxx` 如果实际归属
 *      的 queryId 已经被分配了不同的 {newCode}，就把文件/目录重命名为
 *      `{newCode}-xxxxxx`
 *   4. 回写 _runtime-snapshot.json，把里面 query.code 字段也对齐到
 *      registry（_seed-snapshot.json 不改——它代表不可变的 seed 源）
 *
 * reconcile 幂等：反复跑不会导致变化。每次 dev server 启动都跑一次。
 */

import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────

export interface RegistryEntry {
  code: string;
  queryId: string;
  /** ISO 字符串，用于审计；排序稳定性用 */
  registeredAt: string;
  /** 可选人类可读备注（如 "seed" / "reconciled from runtime snapshot"） */
  note?: string;
}

export interface RegistryFile {
  version: 1;
  prefix: string;
  padWidth: number;
  nextNumber: number;
  entries: RegistryEntry[];
}

/** 轻量 query 视图：reconcile 需要的最小字段 */
interface QueryLike {
  id: string;
  code?: string;
  createdAt?: string;
  /** 来源描述，用于日志 */
  source: "seed" | "runtime";
}

export interface ReconcileReport {
  /** 新注册的条目 */
  newlyRegistered: RegistryEntry[];
  /** 编号发生变化的 query（oldCode !== newCode） */
  relabeled: Array<{ queryId: string; oldCode: string; newCode: string }>;
  /** 被重命名的 inbox 文件 */
  renamedInbox: Array<{ from: string; to: string }>;
  /** 被重命名的 outbox 目录 */
  renamedOutbox: Array<{ from: string; to: string }>;
  /** 回写了 code 的 runtime snapshot 条目数（0 表示未改动） */
  runtimeSnapshotPatched: number;
  /** 未找到归属的孤儿文件（registry 里没有对应 queryId） */
  orphanInbox: string[];
  orphanOutbox: string[];
}

// ─────────────────────────────────────────────────────────────
// 常量 / 默认值
// ─────────────────────────────────────────────────────────────

const DEFAULT_PREFIX = "EV";
const DEFAULT_PAD_WIDTH = 4;
const REGISTRY_BASENAME = "_code-registry.json";

// ─────────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────────

function formatCode(prefix: string, padWidth: number, num: number): string {
  return `${prefix}-${String(num).padStart(padWidth, "0")}`;
}

function parseCodeNumber(prefix: string, code: string): number | null {
  const m = new RegExp(`^${prefix}-(\\d+)$`).exec(code);
  return m ? Number(m[1]) : null;
}

function readJson<T = unknown>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonAtomic(file: string, data: unknown) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function toIsoSafe(s: string | undefined): string {
  if (!s) return new Date(0).toISOString();
  const t = Date.parse(s);
  if (Number.isNaN(t)) return new Date(0).toISOString();
  return new Date(t).toISOString();
}

// ─────────────────────────────────────────────────────────────
// Registry 主体
// ─────────────────────────────────────────────────────────────

export class CodeRegistry {
  private file: string;
  private data: RegistryFile;
  /** queryId → entry 的索引，便于 O(1) 查找 */
  private byQueryId = new Map<string, RegistryEntry>();
  /** code → entry 的索引 */
  private byCode = new Map<string, RegistryEntry>();

  constructor(busRoot: string) {
    this.file = path.join(busRoot, REGISTRY_BASENAME);
    this.data = this.load();
    this.rebuildIndex();
  }

  // ── 持久化 ──────────────────────────────────────────────

  private load(): RegistryFile {
    if (fs.existsSync(this.file)) {
      const j = readJson<RegistryFile>(this.file);
      if (j && Array.isArray(j.entries) && typeof j.nextNumber === "number") {
        // 兜底：prefix/padWidth 可能是旧版本没有的字段
        return {
          version: 1,
          prefix: j.prefix ?? DEFAULT_PREFIX,
          padWidth: j.padWidth ?? DEFAULT_PAD_WIDTH,
          nextNumber: j.nextNumber,
          entries: j.entries,
        };
      }
      // 坏文件：备份 + 视为空
      const backup = `${this.file}.corrupt-${Date.now()}`;
      try {
        fs.copyFileSync(this.file, backup);
      } catch {
        // ignore
      }
    }
    return {
      version: 1,
      prefix: DEFAULT_PREFIX,
      padWidth: DEFAULT_PAD_WIDTH,
      nextNumber: 1,
      entries: [],
    };
  }

  private save() {
    // 保证落盘顺序稳定：按 registeredAt 升序；并列的按 code 升序
    this.data.entries.sort((a, b) => {
      const t = a.registeredAt.localeCompare(b.registeredAt);
      if (t !== 0) return t;
      return a.code.localeCompare(b.code);
    });
    writeJsonAtomic(this.file, this.data);
  }

  private rebuildIndex() {
    this.byQueryId.clear();
    this.byCode.clear();
    for (const e of this.data.entries) {
      this.byQueryId.set(e.queryId, e);
      this.byCode.set(e.code, e);
    }
  }

  // ── 读 API ─────────────────────────────────────────────

  get filePath(): string {
    return this.file;
  }

  get raw(): RegistryFile {
    // 返回一份浅拷贝防止外部乱改
    return { ...this.data, entries: this.data.entries.slice() };
  }

  lookupByQueryId(queryId: string): RegistryEntry | null {
    return this.byQueryId.get(queryId) ?? null;
  }

  lookupByCode(code: string): RegistryEntry | null {
    return this.byCode.get(code) ?? null;
  }

  /** 输出 queryId → code 映射（snapshot 回写、前端广播都用它） */
  exportMap(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of this.data.entries) out[e.queryId] = e.code;
    return out;
  }

  // ── 写 API ─────────────────────────────────────────────

  /**
   * 幂等注册。
   *
   * - queryId 已注册：原样返回老 entry，不改动
   * - 未注册：
   *     · 若 preferredCode 提供且尚未被占用，则认领它（保留历史编号）
   *     · 否则用 nextNumber 生成新编号
   *     · nextNumber 永远递增（不回收被认领的中间空号）
   *
   * 返回分配到的 entry。
   */
  register(
    queryId: string,
    opts: {
      preferredCode?: string;
      registeredAt?: string;
      note?: string;
    } = {}
  ): RegistryEntry {
    if (!queryId) throw new Error("queryId must be non-empty");
    const existing = this.byQueryId.get(queryId);
    if (existing) return existing;

    const registeredAt = opts.registeredAt ?? new Date().toISOString();
    let code: string;
    if (
      opts.preferredCode &&
      parseCodeNumber(this.data.prefix, opts.preferredCode) !== null &&
      !this.byCode.has(opts.preferredCode)
    ) {
      // 认领老编号
      code = opts.preferredCode;
      // nextNumber 需要确保严格大于所有已用编号（含刚认领的这个）
      const n = parseCodeNumber(this.data.prefix, code)!;
      if (n >= this.data.nextNumber) this.data.nextNumber = n + 1;
    } else {
      code = formatCode(this.data.prefix, this.data.padWidth, this.data.nextNumber);
      this.data.nextNumber += 1;
    }

    const entry: RegistryEntry = {
      code,
      queryId,
      registeredAt,
      ...(opts.note ? { note: opts.note } : {}),
    };
    this.data.entries.push(entry);
    this.byQueryId.set(queryId, entry);
    this.byCode.set(code, entry);
    this.save();
    return entry;
  }
}

// ─────────────────────────────────────────────────────────────
// reconcile：启动期自检 + 脏数据一次性修复
// ─────────────────────────────────────────────────────────────

/**
 * 聚合来自 seed 和 runtime snapshot 的所有 query。
 *
 * 若同一个 queryId 两边都有，runtime 覆盖 seed（和 bake:public 的合并
 * 策略保持一致）。返回按 createdAt 升序的数组。
 */
function collectQueries(busRoot: string): QueryLike[] {
  const seedFile = path.join(busRoot, "_seed-snapshot.json");
  const runtimeFile = path.join(busRoot, "_runtime-snapshot.json");

  const seed = fs.existsSync(seedFile) ? readJson<{ queries?: QueryLike[] }>(seedFile) : null;
  const runtime = fs.existsSync(runtimeFile)
    ? readJson<{ queries?: QueryLike[] }>(runtimeFile)
    : null;

  const map = new Map<string, QueryLike>();
  for (const q of seed?.queries ?? []) {
    if (q && q.id) {
      map.set(q.id, { ...q, source: "seed" });
    }
  }
  for (const q of runtime?.queries ?? []) {
    if (q && q.id) {
      const merged = { ...(map.get(q.id) ?? {}), ...q };
      map.set(q.id, { ...merged, source: "runtime" } as QueryLike);
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    toIsoSafe(a.createdAt).localeCompare(toIsoSafe(b.createdAt))
  );
}

/** 按 `<code>-<suffix>` 解析 inbox/outbox 的前缀 code */
function parsePrefixCode(name: string, prefix: string): string | null {
  const m = new RegExp(`^(${prefix}-\\d+)-[^.]+`).exec(name);
  return m ? m[1] : null;
}

/**
 * 扫 inbox 建立 taskId（以及其后缀）到 queryId 的映射。
 *
 * 约定：taskId 格式 `${code}-${suffix}`，suffix 是一段随机 6 字符串。
 * 即使 inbox 因 reconcile 被改过 code 前缀，inbox 和 outbox 的 suffix
 * 永远一致（它是生成 taskId 时的随机种子）。因此本函数同时按 taskId
 * **和** suffix 建两组映射，下游遍历 outbox 目录时可以用这两种 key
 * 任一匹配得到 queryId，不依赖文件名前缀当前是否和 inbox 同步。
 */
function buildTaskIdToQueryIdMap(busRoot: string): {
  byTaskId: Map<string, string>;
  bySuffix: Map<string, string>;
} {
  const inboxDir = path.join(busRoot, "inbox");
  const byTaskId = new Map<string, string>();
  const bySuffix = new Map<string, string>();
  if (!fs.existsSync(inboxDir)) return { byTaskId, bySuffix };
  for (const f of fs.readdirSync(inboxDir)) {
    if (!f.endsWith(".json")) continue;
    const j = readJson<{ taskId?: string; query?: { id?: string } }>(
      path.join(inboxDir, f)
    );
    const taskId = j?.taskId ?? f.replace(/\.json$/, "");
    const queryId = j?.query?.id;
    if (!taskId || !queryId) continue;
    byTaskId.set(taskId, queryId);
    // suffix = taskId 中 `${code}-` 之后的那一段；兼容任何前缀格式
    const dash = taskId.indexOf("-");
    if (dash >= 0) {
      const afterFirst = taskId.slice(dash + 1);
      // 去掉可能的第二个 code 前缀（虽然我们的 taskId 一直是 code-suffix 两段，
      // 这里健壮点，以最后一段 `-` 后为 suffix）
      const lastDash = afterFirst.lastIndexOf("-");
      const suffix = lastDash >= 0 ? afterFirst.slice(lastDash + 1) : afterFirst;
      bySuffix.set(suffix, queryId);
    }
  }
  return { byTaskId, bySuffix };
}

/** 从 `${code}-${suffix}(.json)?` 里抽出 suffix 部分 */
function extractSuffix(name: string): string | null {
  const base = name.replace(/\.json$/, "");
  const m = /^[A-Za-z]+-\d+-(.+)$/.exec(base);
  return m ? m[1] : null;
}

/**
 * 对文件/目录做"前缀替换"式重命名。
 * `${oldCode}-xxxxxx(.json)?` → `${newCode}-xxxxxx(.json)?`
 * 如果目标已存在则跳过并在日志里记为冲突。
 */
function renamePrefix(
  parent: string,
  entryName: string,
  oldCode: string,
  newCode: string,
  log: (msg: string) => void
): { from: string; to: string } | null {
  if (!entryName.startsWith(`${oldCode}-`)) return null;
  const newName = newCode + entryName.slice(oldCode.length);
  const from = path.join(parent, entryName);
  const to = path.join(parent, newName);
  if (fs.existsSync(to)) {
    log(`[codeRegistry] rename skipped (target exists): ${from} -> ${to}`);
    return null;
  }
  fs.renameSync(from, to);
  return { from: entryName, to: newName };
}

/**
 * 执行启动期自检。幂等。返回本次发生的所有变更，方便调用方打日志。
 */
export function reconcile(
  busRoot: string,
  registry: CodeRegistry,
  log: (msg: string) => void = () => {}
): ReconcileReport {
  const report: ReconcileReport = {
    newlyRegistered: [],
    relabeled: [],
    renamedInbox: [],
    renamedOutbox: [],
    runtimeSnapshotPatched: 0,
    orphanInbox: [],
    orphanOutbox: [],
  };

  // ── Step 1. 让所有已知 query 登记上注册簿 ──────────────
  const queries = collectQueries(busRoot);
  for (const q of queries) {
    const before = registry.lookupByQueryId(q.id);
    if (before) {
      // 已登记：若 snapshot 上的 code 跟 registry 不一致，以 registry 为准
      if (q.code && q.code !== before.code) {
        report.relabeled.push({
          queryId: q.id,
          oldCode: q.code,
          newCode: before.code,
        });
      }
      continue;
    }
    const entry = registry.register(q.id, {
      preferredCode: q.code,
      registeredAt: toIsoSafe(q.createdAt),
      note: q.source === "seed" ? "seed" : "runtime-snapshot",
    });
    report.newlyRegistered.push(entry);
    if (q.code && q.code !== entry.code) {
      report.relabeled.push({
        queryId: q.id,
        oldCode: q.code,
        newCode: entry.code,
      });
    }
  }

  // ── Step 2. 构建 taskId / suffix → queryId 映射 ───────
  //   （必须在 inbox 重命名之前扫，否则旧文件名已经变了）
  const taskMap = buildTaskIdToQueryIdMap(busRoot);

  // 小工具：按 taskId 或 suffix 查 queryId（outbox 目录名可能还是旧前缀）
  const lookupQueryIdByName = (name: string): string | undefined => {
    const id = taskMap.byTaskId.get(name);
    if (id) return id;
    const sfx = extractSuffix(name);
    if (sfx) return taskMap.bySuffix.get(sfx);
    return undefined;
  };

  // ── Step 3. 重命名 inbox 文件 ────────────────────────
  const inboxDir = path.join(busRoot, "inbox");
  if (fs.existsSync(inboxDir)) {
    // 先把全部文件名快照下来，避免一边遍历一边 rename 出坑
    const files = fs.readdirSync(inboxDir).slice();
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const taskId = f.replace(/\.json$/, "");
      const queryId = lookupQueryIdByName(taskId);
      if (!queryId) {
        report.orphanInbox.push(f);
        continue;
      }
      const entry = registry.lookupByQueryId(queryId);
      if (!entry) {
        report.orphanInbox.push(f);
        continue;
      }
      const oldCode = parsePrefixCode(f, registry.raw.prefix);
      if (!oldCode || oldCode === entry.code) continue; // 前缀已对齐或解析不出
      const renamed = renamePrefix(inboxDir, f, oldCode, entry.code, log);
      if (renamed) {
        // 同步 inbox JSON 内部 taskId 字段 + query.code 字段
        const full = path.join(inboxDir, renamed.to);
        const j = readJson<Record<string, unknown>>(full);
        if (j && typeof j === "object") {
          j.taskId = renamed.to.replace(/\.json$/, "");
          if (j.query && typeof j.query === "object") {
            (j.query as Record<string, unknown>).code = entry.code;
          }
          writeJsonAtomic(full, j);
        }
        report.renamedInbox.push(renamed);
        // 把新 taskId 也登记到 map（紧接着 Step 4 遍历 outbox 时可能还按旧名查）
        const newTaskId = renamed.to.replace(/\.json$/, "");
        taskMap.byTaskId.set(newTaskId, queryId);
      }
    }
  }

  // ── Step 4. 重命名 outbox 目录 ──────────────────────
  const outboxDir = path.join(busRoot, "outbox");
  if (fs.existsSync(outboxDir)) {
    const dirs = fs.readdirSync(outboxDir).slice();
    for (const d of dirs) {
      const stat = fs.statSync(path.join(outboxDir, d));
      if (!stat.isDirectory()) continue;
      // outbox 目录名就是 taskId（无 .json 后缀）；可能 inbox 已经被改过 code 前缀，
      // 这时按 suffix fallback 依然能查到 queryId
      const queryId = lookupQueryIdByName(d);
      if (!queryId) {
        report.orphanOutbox.push(d);
        continue;
      }
      const entry = registry.lookupByQueryId(queryId);
      if (!entry) {
        report.orphanOutbox.push(d);
        continue;
      }
      const oldCode = parsePrefixCode(d, registry.raw.prefix);
      if (!oldCode || oldCode === entry.code) continue;
      const renamed = renamePrefix(outboxDir, d, oldCode, entry.code, log);
      if (renamed) {
        // 同步 outbox JSON 正文里的 taskId 字段（所有版本）
        const newFullDir = path.join(outboxDir, renamed.to);
        for (const vf of fs.readdirSync(newFullDir)) {
          if (!/^v\d+\.json$/.test(vf)) continue;
          const full = path.join(newFullDir, vf);
          const j = readJson<Record<string, unknown>>(full);
          if (j && typeof j === "object") {
            j.taskId = renamed.to;
            writeJsonAtomic(full, j);
          }
        }
        report.renamedOutbox.push(renamed);
      }
    }
  }

  // ── Step 5. 回写 _runtime-snapshot.json 的 query.code ──
  const runtimeFile = path.join(busRoot, "_runtime-snapshot.json");
  if (fs.existsSync(runtimeFile)) {
    const j = readJson<{ queries?: Array<{ id?: string; code?: string }> }>(
      runtimeFile
    );
    if (j && Array.isArray(j.queries)) {
      let touched = 0;
      for (const q of j.queries) {
        if (!q?.id) continue;
        const entry = registry.lookupByQueryId(q.id);
        if (entry && q.code !== entry.code) {
          q.code = entry.code;
          touched += 1;
        }
      }
      if (touched > 0) {
        writeJsonAtomic(runtimeFile, j);
        report.runtimeSnapshotPatched = touched;
      }
    }
  }

  // ── 输出日志 ────────────────────────────────────────
  if (
    report.newlyRegistered.length ||
    report.relabeled.length ||
    report.renamedInbox.length ||
    report.renamedOutbox.length ||
    report.runtimeSnapshotPatched
  ) {
    log(
      `[codeRegistry] reconcile: newlyRegistered=${report.newlyRegistered.length}, ` +
        `relabeled=${report.relabeled.length}, ` +
        `renamedInbox=${report.renamedInbox.length}, ` +
        `renamedOutbox=${report.renamedOutbox.length}, ` +
        `runtimeSnapshotPatched=${report.runtimeSnapshotPatched}, ` +
        `orphanInbox=${report.orphanInbox.length}, ` +
        `orphanOutbox=${report.orphanOutbox.length}`
    );
    for (const r of report.relabeled) {
      log(`[codeRegistry]   relabel: ${r.queryId}  ${r.oldCode} → ${r.newCode}`);
    }
    for (const r of report.renamedInbox) {
      log(`[codeRegistry]   inbox:   ${r.from} → ${r.to}`);
    }
    for (const r of report.renamedOutbox) {
      log(`[codeRegistry]   outbox:  ${r.from} → ${r.to}`);
    }
  } else {
    log(`[codeRegistry] reconcile: no-op (${registry.raw.entries.length} entries tracked)`);
  }
  return report;
}
