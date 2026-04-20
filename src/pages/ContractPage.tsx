import { useEffect, useState } from "react";
import MarkdownView from "../components/MarkdownView";
import { contractBus, type ContractDocument } from "../lib/contract";

/**
 * 工作协议页（路由：/contract）
 *
 * 单一事实源：sophia-rubric-lab/.evaluations/EVALUATION_CONTRACT.md
 *   - 本页从 /_bus/contract 实时读取该文件并渲染（prod 下映射到 /data/contract.json）
 *   - LLM 评测官执行打分前必须先读这份协议，保证 inbox/outbox schema 对齐
 *   - 修改协议 = 直接编辑这份 md，刷新页面即见最新
 *
 * 说明：本页呈现"面向 LLM 的工作流程、inbox/outbox JSON 结构、字段要求"等
 * 实现细节；面向用户的评测宗旨与维度定义另见 /standard。
 */
export default function ContractPage() {
  const [doc, setDoc] = useState<ContractDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await contractBus.getContract();
      if (!d) {
        setError("未找到 EVALUATION_CONTRACT.md（dev server 未启用 bus 或数据尚未烘焙）");
        setDoc(null);
      } else {
        setDoc(d);
      }
    } catch (err) {
      setError((err as Error).message || "加载失败");
      setDoc(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  return (
    <div className="space-y-6">
      {/* 页眉 */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs tracking-widest text-[#8B8272]">CONTRACT</div>
          <h1 className="text-2xl font-serif font-semibold text-[#3A3326] mt-1">
            工作协议
          </h1>
          <p className="text-sm text-[#6B6250] mt-1 leading-relaxed max-w-2xl">
            LLM 评测官扮演 Sophia 打分时必须严格遵守的 inbox / outbox 协议 —— 任务文件结构、产物 JSON schema、版本迭代规则、硬约束。
            若你只想看评测标准本身，跳去 <a href="./standard" className="text-[#8B6F3D] underline underline-offset-2">评测标准</a>。
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg border border-[#D6CCB5] bg-white text-[#3A3326] hover:bg-[#FAF6EE] disabled:opacity-50"
          title="重新从文件系统拉取最新内容"
        >
          {loading ? "加载中…" : "⟳ 刷新"}
        </button>
      </div>

      {/* 元信息条 */}
      {doc && (
        <div className="rounded-xl border border-[#E6DCC8] bg-gradient-to-b from-[#FAF6EE] to-white px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-xs text-[#6B6250]">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#B08333]" />
            工作协议 · LLM 必读
          </span>
          <span>
            文件：
            <code className="font-mono text-[#3A3326]">{doc.path}</code>
          </span>
          <span>
            最后修改：
            <span className="text-[#3A3326]">
              {new Date(doc.mtime).toLocaleString()}
            </span>
          </span>
          <span>
            大小：
            <span className="text-[#3A3326]">{(doc.size / 1024).toFixed(1)} KB</span>
          </span>
        </div>
      )}

      {/* 错误 / 加载 */}
      {error && (
        <div className="rounded-xl border border-[#E8C4B8] bg-[#FBF0EC] text-[#8B4A3A] px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {loading && !doc && (
        <div className="rounded-2xl border border-dashed border-[#D6CCB5] bg-[#FAF6EE] p-10 text-center text-sm text-[#8B8272] animate-pulse">
          加载工作协议…
        </div>
      )}

      {/* 正文 */}
      {doc && (
        <article className="rounded-2xl border border-[#E6DCC8] bg-white p-8 shadow-sm">
          <MarkdownView content={doc.content} />
        </article>
      )}
    </div>
  );
}
