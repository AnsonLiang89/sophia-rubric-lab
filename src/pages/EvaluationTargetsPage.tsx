// ============================================================
// EvaluationTargetsPage —— 评测对象管理器（仅管理员版可见）
//
// 定位：.evaluations/PRODUCTS.json 的 CRUD UI。把"评测对象"（SophiaAI v4 /
// v5 / MiroThink / Manus / Gemini / Kimi 等）以**完全平行**的方式呈现，
// 不对 Sophia 做任何特殊合并——它的不同版本就是不同的独立产品。
//
// 落地：
//   1. 打开时 GET /_bus/products 拿到当前列表（本地草稿模式）。
//   2. 用户在本页做增/改/删——改动只保存在组件 state 里（dirty）。
//   3. 点击"保存"才会 POST /_bus/products 整体落盘到 PRODUCTS.json。
//   4. 发布走原有的「⇪ 对外更新」流程（本页不触达对外版，仅写仓库源）。
//
// 可见性：对外版（IS_READONLY=true）下 Layout 不会渲染导航入口；
// 若被直接访问，本页也会降级为只读说明页并隐藏所有写按钮。
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { contractBus, type BusProduct } from "../lib/contract";
import { IS_READONLY } from "../lib/dataSource";
import { useLab } from "../store";

/** 本地草稿里的 row shape——与 BusProduct 对齐，但字段全部规整为字符串/数字方便表单处理 */
interface DraftRow {
  /** 前端临时 key（用于 React key / 未保存时的稳定标识）；落盘前若是新建的会沿用 id */
  key: string;
  id: string;
  name: string;
  version: string; // 空串代表 null
  vendor: string; // 空串代表 null
  color: string; // 空串代表 null
  order: string; // 空串代表 null；数字字符串
  description: string; // 空串代表 null
  /** 标记此行来源：bus 加载的 / 本地新增的 */
  origin: "bus" | "new";
}

function busToDraft(p: BusProduct): DraftRow {
  return {
    key: p.id,
    id: p.id,
    name: p.name,
    version: p.version ?? "",
    vendor: p.vendor ?? "",
    color: p.color ?? "",
    order: typeof p.order === "number" ? String(p.order) : "",
    description: p.description ?? "",
    origin: "bus",
  };
}

function draftToBus(d: DraftRow): BusProduct {
  const out: BusProduct = {
    id: d.id.trim(),
    name: d.name.trim(),
  };
  const v = d.version.trim();
  if (v) out.version = v;
  const ve = d.vendor.trim();
  if (ve) out.vendor = ve;
  const c = d.color.trim();
  if (c) out.color = c;
  const o = d.order.trim();
  if (o) {
    const n = Number(o);
    if (Number.isFinite(n)) out.order = n;
  }
  const desc = d.description.trim();
  if (desc) out.description = desc;
  return out;
}

/** 浅比较两个草稿是否等价，用来判断 dirty */
function rowsEqual(a: DraftRow[], b: DraftRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.version !== y.version ||
      x.vendor !== y.vendor ||
      x.color !== y.color ||
      x.order !== y.order ||
      x.description !== y.description
    ) {
      return false;
    }
  }
  return true;
}

/** 生成一个新建行的临时 key */
function makeNewKey(): string {
  return `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function EvaluationTargetsPage() {
  const { refreshProducts } = useLab();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 最近一次从 bus 拉到的快照，用来做 dirty 对比 + 放弃改动 */
  const [pristine, setPristine] = useState<DraftRow[]>([]);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setSaveSuccess(null);
    try {
      const resp = await contractBus.getProducts();
      if (!resp) {
        setLoadError("bus 未响应或返回空（/_bus/products）");
        setRows([]);
        setPristine([]);
        return;
      }
      const drafts = resp.products.map(busToDraft);
      setRows(drafts);
      setPristine(drafts);
      setUpdatedAt(resp.updatedAt ?? null);
    } catch (e) {
      setLoadError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const dirty = useMemo(() => !rowsEqual(rows, pristine), [rows, pristine]);

  /** 行内字段更新 */
  const patchRow = (key: string, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setSaveSuccess(null);
  };

  const deleteRow = (key: string) => {
    const target = rows.find((r) => r.key === key);
    if (!target) return;
    const label = target.name + (target.version ? ` ${target.version}` : "");
    if (!window.confirm(`确认删除「${label || target.id}」？此操作仅更新本地草稿，点击「保存」才会写入 PRODUCTS.json。`)) {
      return;
    }
    setRows((prev) => prev.filter((r) => r.key !== key));
    setSaveSuccess(null);
  };

  const addRow = () => {
    const key = makeNewKey();
    setRows((prev) => [
      ...prev,
      {
        key,
        id: "",
        name: "",
        version: "",
        vendor: "",
        color: "#8B8272",
        order: "",
        description: "",
        origin: "new",
      },
    ]);
    setSaveSuccess(null);
  };

  const reset = () => {
    if (!dirty) return;
    if (!window.confirm("放弃未保存的改动？")) return;
    setRows(pristine);
    setSaveError(null);
    setSaveSuccess(null);
  };

  /** 提交前做一次本地校验，把服务器必拒的错误提前暴露 */
  function validateLocal(draft: DraftRow[]): string | null {
    const seenId = new Set<string>();
    for (let i = 0; i < draft.length; i++) {
      const r = draft[i];
      if (!r.id.trim()) return `第 ${i + 1} 行：id 必填`;
      if (!r.name.trim()) return `第 ${i + 1} 行（id=${r.id}）：name 必填`;
      if (seenId.has(r.id.trim())) return `id 重复：${JSON.stringify(r.id.trim())}`;
      seenId.add(r.id.trim());
      if (r.order.trim() && !Number.isFinite(Number(r.order))) {
        return `第 ${i + 1} 行（id=${r.id}）：order 必须是数字或留空`;
      }
    }
    return null;
  }

  const save = async () => {
    if (saving) return;
    const err = validateLocal(rows);
    if (err) {
      setSaveError(err);
      setSaveSuccess(null);
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const payload = rows.map(draftToBus);
      const resp = await contractBus.putProducts(payload, new Date().toISOString());
      if (!resp) {
        setSaveError("保存失败：bus 未响应");
        return;
      }
      // 同步本地快照 + 刷新全局 store（Dashboard / Report 等页面会拿到最新列表）
      const fresh = resp.products.map(busToDraft);
      setRows(fresh);
      setPristine(fresh);
      setUpdatedAt(resp.updatedAt);
      setSaveSuccess(
        `已写入 ${resp.path}（${resp.products.length} 条，updatedAt ${new Date(resp.updatedAt).toLocaleString("zh-CN")}）。记得在完成全部编辑后去导航栏点「⇪ 对外更新」发布到线上。`
      );
      // 让导航 / 其他页面拿到最新 products
      await refreshProducts();
    } catch (e) {
      setSaveError((e as Error).message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  // 对外版兜底：被直接访问时显示只读说明页
  if (IS_READONLY) {
    return (
      <div className="space-y-4">
        <div className="text-xs tracking-widest text-[#8B8272]">TARGETS</div>
        <h1 className="text-2xl font-bold">评测对象管理</h1>
        <div className="bg-[#F5EBDA] border border-[#E4D5B7] rounded-xl px-4 py-3 text-sm text-[#6B5A3A]">
          此页面仅在管理员版可用。对外版请跳转到 /products 查看只读评测主体列表。
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 标题栏 */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs tracking-widest text-[#8B8272]">TARGETS · ADMIN</div>
          <h1 className="text-2xl font-bold mt-1">评测对象管理</h1>
          <p className="text-sm text-ink-500 mt-1 max-w-2xl">
            这里管理所有参与评测的 AI 产品。SophiaAI 的不同版本（v3 / v4 / v5）与 MiroThink / Manus / Gemini / Kimi 等**完全平行**，都是独立的评测对象。「描述」字段仅本页可见，不对外展示。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            disabled={loading || saving}
            className="px-3 py-1.5 text-sm rounded-lg border border-paper-300 text-ink-700 hover:bg-paper-100 transition disabled:opacity-50"
          >
            {loading ? "加载中…" : "刷新"}
          </button>
          <button
            onClick={addRow}
            disabled={loading || saving}
            className="px-3 py-1.5 text-sm rounded-lg border border-amber/40 text-amber-dark hover:bg-amber/10 transition disabled:opacity-50"
          >
            ＋ 新增评测对象
          </button>
          <button
            onClick={reset}
            disabled={!dirty || saving}
            className="px-3 py-1.5 text-sm rounded-lg border border-paper-300 text-ink-500 hover:bg-paper-100 transition disabled:opacity-50"
            title="放弃所有未保存的改动"
          >
            放弃
          </button>
          <button
            onClick={() => void save()}
            disabled={!dirty || saving || loading}
            className="px-3 py-1.5 text-sm rounded-lg bg-amber text-white hover:bg-amber-dark transition disabled:opacity-50"
            title="把当前改动写回 .evaluations/PRODUCTS.json"
          >
            {saving ? "保存中…" : dirty ? "保存" : "无改动"}
          </button>
        </div>
      </div>

      {/* 状态条 */}
      <div className="bg-[#F5EBDA] border border-[#E4D5B7] rounded-xl px-4 py-3 text-sm text-[#6B5A3A] space-y-1">
        <div>
          数据源：<code className="px-1 py-0.5 bg-white/60 rounded text-[#3D3730]">.evaluations/PRODUCTS.json</code>
          。保存后请去导航栏右上角点「⇪ 对外更新」才会发布到线上对外版。
        </div>
        <div className="text-xs text-[#8B7A55]">
          {updatedAt && (
            <span>
              PRODUCTS.json updatedAt：{new Date(updatedAt).toLocaleString("zh-CN")}
            </span>
          )}
          {dirty && (
            <span className="ml-3 text-[#B04D3F]">
              · 有 {rows.length}{" "}
              条草稿未保存
            </span>
          )}
        </div>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          加载失败：{loadError}
        </div>
      )}
      {saveError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          保存失败：{saveError}
        </div>
      )}
      {saveSuccess && (
        <div className="bg-moss/10 border border-moss/30 rounded-xl px-4 py-3 text-sm text-moss">
          {saveSuccess}
        </div>
      )}

      {/* 表格 */}
      <div className="bg-white rounded-xl border border-paper-200 shadow-soft overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper-50 text-ink-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left w-[60px]">色</th>
                <th className="px-3 py-2 text-left min-w-[140px]">id*</th>
                <th className="px-3 py-2 text-left min-w-[140px]">name*</th>
                <th className="px-3 py-2 text-left min-w-[100px]">version</th>
                <th className="px-3 py-2 text-left min-w-[100px]">vendor</th>
                <th className="px-3 py-2 text-left min-w-[100px]">color</th>
                <th className="px-3 py-2 text-left w-[80px]">order</th>
                <th className="px-3 py-2 text-left min-w-[260px]">description（仅此页可见）</th>
                <th className="px-3 py-2 text-right w-[80px]">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-ink-400">
                    暂无评测对象。点击「＋ 新增评测对象」添加第一个。
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <motion.tr
                  key={r.key}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15 }}
                  className="border-t border-paper-200 hover:bg-paper-50/60"
                >
                  <td className="px-3 py-2">
                    <div
                      className="w-7 h-7 rounded-md border border-paper-200"
                      style={{ background: r.color || "#8B8272" }}
                      title={r.color || "（未设置颜色）"}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={r.id}
                      onChange={(e) => patchRow(r.key, { id: e.target.value })}
                      placeholder="如 sophia-v5"
                      className="w-full px-2 py-1 text-xs font-mono bg-transparent border border-transparent focus:border-paper-300 focus:bg-white rounded"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={r.name}
                      onChange={(e) => patchRow(r.key, { name: e.target.value })}
                      placeholder="如 SophiaAI"
                      className="w-full px-2 py-1 bg-transparent border border-transparent focus:border-paper-300 focus:bg-white rounded"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={r.version}
                      onChange={(e) => patchRow(r.key, { version: e.target.value })}
                      placeholder="v5 / v4 / 空"
                      className="w-full px-2 py-1 text-xs font-mono bg-transparent border border-transparent focus:border-paper-300 focus:bg-white rounded"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={r.vendor}
                      onChange={(e) => patchRow(r.key, { vendor: e.target.value })}
                      placeholder="内部 / Google / …"
                      className="w-full px-2 py-1 text-xs bg-transparent border border-transparent focus:border-paper-300 focus:bg-white rounded"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={r.color}
                      onChange={(e) => patchRow(r.key, { color: e.target.value })}
                      placeholder="#C8941F"
                      className="w-full px-2 py-1 text-xs font-mono bg-transparent border border-transparent focus:border-paper-300 focus:bg-white rounded"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={r.order}
                      onChange={(e) => patchRow(r.key, { order: e.target.value })}
                      placeholder="10"
                      className="w-full px-2 py-1 text-xs font-mono text-right bg-transparent border border-transparent focus:border-paper-300 focus:bg-white rounded"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <textarea
                      value={r.description}
                      onChange={(e) => patchRow(r.key, { description: e.target.value })}
                      placeholder="（可选）内部说明：能力边界、版本差异、使用注意等；不对外展示"
                      rows={2}
                      className="w-full px-2 py-1 text-xs bg-transparent border border-transparent focus:border-paper-300 focus:bg-white rounded resize-y min-h-[2.5rem]"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => deleteRow(r.key)}
                      className="text-xs text-red-500 hover:text-red-700 hover:underline"
                      title="删除此行（需保存才会写回）"
                    >
                      删除
                    </button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 提示 */}
      <div className="text-xs text-ink-400 leading-relaxed">
        · 提示：<strong>id</strong> 一旦被历史评测产物引用就不要改，否则会断链。<strong>name + version</strong> 是展示层用的组合（如 "SophiaAI v4"），不同 Sophia 版本请显式写出 version 以避免重名。color 请用 hex（如 <code className="font-mono">#C8941F</code>）。order 越小越靠前；Sophia 系列的 order 只是"备注"，实际排序由前端 <code className="font-mono">sortProducts()</code> 保证 Sophia 新版本永远在前。
      </div>
    </div>
  );
}
