import { useEffect, useState } from "react";
import MarkdownView from "../components/MarkdownView";
import { contractBus, type ContractDocument } from "../lib/contract";

/**
 * 评测标准页（路由：/standard）
 *
 * 单一事实源：sophia-rubric-lab/.evaluations/RUBRIC_STANDARD.md
 *   - 本页从 /_bus/standard 实时读取该文件并渲染
 *   - LLM 评测官执行打分时也以本标准为依据
 *   - 修改标准 = 直接编辑这份 md，刷新页面即见最新
 *
 * 说明：本页只呈现"面向用户的评测宗旨、维度定义、权重"，
 * 不渲染工作协议（inbox/outbox schema、JSON 结构等实现细节）。
 * 实现细节另存于 EVALUATION_CONTRACT.md，供 LLM 工作时读取。
 */
export default function StandardPage() {
  const [doc, setDoc] = useState<ContractDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await contractBus.getStandard();
      if (!d) {
        setError("未找到 RUBRIC_STANDARD.md（dev server 未启用 bus？）");
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
    // load() 内部会同步 setLoading(true) / setError(null)，
    // 这是"组件首挂载时拉取数据"的标准模式，非级联渲染。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  return (
    <div className="space-y-6">
      {/* 页眉 */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs tracking-widest text-[#8B8272]">STANDARD</div>
          <h1 className="text-2xl font-serif font-semibold text-[#3A3326] mt-1">
            评测标准
          </h1>
          <p className="text-sm text-[#6B6250] mt-1 leading-relaxed max-w-2xl">
            我们如何判断一份 AI 产品报告的好坏 —— 评测宗旨、核心维度定义与权重、扩展维度规则、SBS 对比规则。
            一套 rubric，永远最新。改 md 即改标准，刷新即见最新。
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
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#5A7A47]" />
            单一事实源
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
          加载评测标准…
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
