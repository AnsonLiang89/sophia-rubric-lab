import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useLab } from "../store";
import { contractBus } from "../lib/contract";
import { displayProductName, isSophia } from "../lib/sortProducts";
import type { AIProduct } from "../types";

/**
 * ProductsPage（只读）
 *
 * 评测主体清单的唯一事实源是 `.evaluations/PRODUCTS.json`。
 * 前端不再提供新建/编辑/删除入口。
 * 如需调整，编辑 JSON 文件并刷新页面即生效。
 */
export default function ProductsPage() {
  const { products, productsUpdatedAt, productsSource, refreshProducts } = useLab();
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [mtime, setMtime] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // 页面加载时顺手读一下原始 meta（path/mtime），用作展示
  useEffect(() => {
    contractBus.getProducts().then((resp) => {
      if (resp) {
        setSourcePath(resp.path);
        setMtime(resp.mtime);
      }
    });
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshProducts();
      const resp = await contractBus.getProducts();
      if (resp) {
        setSourcePath(resp.path);
        setMtime(resp.mtime);
      }
    } finally {
      setRefreshing(false);
    }
  };

  const { sophiaList, othersList } = useMemo(() => {
    const sophiaList = products.filter((p) => isSophia(p));
    const othersList = products.filter((p) => !isSophia(p));
    return { sophiaList, othersList };
  }, [products]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs tracking-widest text-[#8B8272]">PRODUCTS</div>
          <h1 className="text-2xl font-bold mt-1">评测主体</h1>
          <p className="text-sm text-ink-500 mt-1 max-w-2xl">
            参与评测的 AI 产品清单。列表顺序遵循：SophiaAI 各版本永远在前（新版本在前），随后是外部对照产品。
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="px-3 py-1.5 text-sm rounded-lg border border-paper-300 text-ink-700 hover:bg-paper-100 transition disabled:opacity-50"
        >
          {refreshing ? "刷新中…" : "刷新"}
        </button>
      </div>

      {/* 源文件提示条 */}
      <div className="bg-[#F5EBDA] border border-[#E4D5B7] rounded-xl px-4 py-3 text-sm text-[#6B5A3A] space-y-1">
        <div>
          <strong>此页面只读。</strong>
          评测主体的唯一事实源是{" "}
          <code className="px-1 py-0.5 bg-white/60 rounded text-[#3D3730]">
            {sourcePath ?? ".evaluations/PRODUCTS.json"}
          </code>
          。直接编辑该文件并点击右上角「刷新」即可看到最新列表。
        </div>
        <div className="text-xs text-[#8B7A55]">
          {productsSource === "local-fallback" && (
            <span className="text-[#B04D3F]">
              ⚠ 未能从 bus 读取 PRODUCTS.json，当前展示的是 localStorage 缓存的历史数据。
            </span>
          )}
          {productsSource === "empty" && (
            <span className="text-[#B04D3F]">⚠ 列表为空。请检查 PRODUCTS.json 是否存在。</span>
          )}
          {productsSource === "bus" && (
            <>
              {productsUpdatedAt && (
                <>
                  PRODUCTS.json updatedAt：
                  <span className="ml-1">
                    {new Date(productsUpdatedAt).toLocaleString("zh-CN")}
                  </span>
                </>
              )}
              {mtime && (
                <span className="ml-3">
                  文件最后修改：{new Date(mtime).toLocaleString("zh-CN")}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Sophia 系列 */}
      {sophiaList.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-ink-700 mb-3">
            SophiaAI 系列 <span className="text-ink-400 font-normal">（版本从新到旧）</span>
          </h2>
          <ProductGrid products={sophiaList} highlightFirst />
        </section>
      )}

      {/* 外部对照 */}
      {othersList.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-ink-700 mb-3">外部对照</h2>
          <ProductGrid products={othersList} />
        </section>
      )}

      {products.length === 0 && (
        <div className="bg-white rounded-xl border border-paper-200 p-8 text-center text-ink-400">
          暂无评测主体
        </div>
      )}
    </div>
  );
}

interface GridProps {
  products: AIProduct[];
  /** 第一张卡片加"最新版本"徽章 */
  highlightFirst?: boolean;
}

function ProductGrid({ products, highlightFirst }: GridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
      {products.map((p: AIProduct, i: number) => (
        <motion.div
          key={p.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.03 }}
          className="relative bg-white rounded-xl border border-paper-200 shadow-soft p-4 flex items-start gap-3"
        >
          <div
            className="w-10 h-10 rounded-lg flex-shrink-0"
            style={{ background: p.color ?? "#8B8272" }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-ink-900 truncate">
                {displayProductName(p)}
              </span>
              {highlightFirst && i === 0 && (
                <span className="text-[10px] bg-amber text-white px-1.5 py-0.5 rounded font-normal">
                  最新
                </span>
              )}
            </div>
            <div className="text-xs text-ink-500 mt-1">
              {p.vendor ?? "—"}
            </div>
            <div className="text-[10px] text-ink-400 mt-2 font-mono truncate">
              id: {p.id}
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
