#!/usr/bin/env node
/**
 * lint-outbox.mjs
 *
 * 用途：对 .evaluations/outbox/ 下所有 outbox 产物做 schema 校验。
 *
 * **背景：为什么需要这个脚本**
 *
 * 契约 v2.1 的 outbox payload schema 已经在 EVALUATION_CONTRACT.md §3.1 详细规定
 * （必填字段 / 枚举值 / 字段名 / 类型等），也在 src/lib/contract.ts 有 TS 类型。
 * 但产物是 LLM 手写/脚本构造的 JSON，**缺乏机器可执行的 schema 验证**——
 * 字段漏写（例：rubric[].name 漏写）、字段名错（reports vs scores）、档位分数错（7/5 非法档间分）
 * 等问题都只能靠评测官自觉或用户肉眼发现。历史上已经出过好几次。
 *
 * 本脚本扮演"自动巡检员"：
 *   - CLI 调用：扫所有 outbox 产物，违规立即 exit 1
 *   - 模块 import：作为 bake 前置检查，schema 不过 → bake 不跑
 *   - CI 钩子：pre-push / pre-publish 可以调它
 *
 * **检查规则**（按 contractVersion 分档）
 *
 * 通用（所有版本）：
 *   - JSON 合法
 *   - taskId / version / contractVersion 必填，类型正确
 *   - summary / summary.overallScores 存在非空
 *   - summary.overallScores[].productName 非空、无括号版本号（"Name (vN)" ✗）、同一 payload 内唯一
 *   - rubric 覆盖 R1~R5；每个维度 id/name/weight/scores 必填
 *   - rubric[].scores 字段名必须是 `scores`（不是 `reports`，历史踩坑点）
 *   - extraDimensions 同上（如存在）
 *
 * v2.0 / v2.1 额外：
 *   - score ∈ {10, 8, 6, 4, 2}（档位制）
 *   - tier ∈ {S, A, B, C, D}，且与 score 严格对应
 *   - confidence ∈ {high, medium, low}
 *   - overallScores[].vetoTriggered 必填布尔；触发时 vetoReason 必填且总分 ≤ 6.9
 *   - overallScore ≈ 加权和（容差 0.05）
 *
 * v2.1 额外：
 *   - perReportFeedback 必填，覆盖所有 candidates
 *   - 每份 feedback 的 strengths/weaknesses/improvements 非空数组
 *
 * v2.2 额外（2026-04-25 起）：
 *   - 继承 v2.1 所有规则（档位制 / veto / perReportFeedback）
 *   - summary.claimInventory 必填非空数组；每份报告 3~5 条（Top 5 封顶）
 *     * 至少 1 条 type === "logic" 的 claim（全局或每份报告）
 *     * type ∈ {fact, number, logic, source}；supportWeight ∈ {high, medium}
 *   - summary.claimChecks 必填；每个 claimId 必须在 claimChecks 里有一条记录
 *     * status ∈ {verified-correct, refuted, inconclusive, skipped-time-budget, skipped-out-of-scope}
 *     * 核验覆盖率（verified+refuted+inconclusive）/ 非 skipped 总数 ≥ 85%
 *     * status=refuted 且触发 veto 时，vetoMode 必填 ∈ {V1~V5}
 *   - summary.dimensionChecklists 必填，R1~R5 五个键齐备
 *     * R1 items ≥ 7 条；R2~R5 items ≥ 5 条
 *     * 每项 label 非空、passedFor 为 reportId 数组（可空）
 *   - summary.verificationBudget 必填
 *     * targetMinutes = 45；actualMinutes > 0（自 v3.0 起不再设硬上限，仅观测）
 *     * passesCompleted 包含前 6 个阶段（read / claim-inventory / pass1 / pass2 / pass3 / score）
 *   - R1 的 rubric block 必填 subscores.R1a + subscores.R1b
 *     * 权重必须 R1a=0.28、R1b=0.12（当 R1 权重是 0.40 的默认情况下）
 *   - SBS pair 结构必须含 reportIdA + reportIdB + winner + margin + dimensionDriver
 *     * winner ∈ {A, B, tie, draw}
 *     * margin ∈ {overwhelming, clear, slight, tie}（v2.2 英文枚举）
 *
 * v3.0 额外（2026-04-25 晚起）：
 *   - 继承 v2.2 所有规则（claim/checklist/budget/SBS/R1 子档）
 *   - tier C/D 的 comment 必须含原文引用片段（≥15 字，用「」或 "" 包裹）
 *   - claimChecks 中 refuted / inconclusive 的 evidence 必须含原文引用，且长度 ≥ 30 字
 *   - summary.crossProductInsights 在 candidates ≥ 2 时必填；focusProductName / 三组 insight 结构合法
 *   - report 必须含 3 个稳定锚点 heading，且顺序固定：总评 → 评分总表 → SBS 结论
 *
 * 退出码：
 *   0 = 所有 outbox 产物合法
 *   1 = 至少一项违规（详情在 stderr）
 *   2 = 运行时错误（目录不存在等）
 *
 * 也可作为模块 import：
 *   import { lintOutbox } from "./lint-outbox.mjs";
 *   const result = lintOutbox();  // {ok: boolean, errors: [...], checkedFiles: N}
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTBOX_DIR = path.join(PROJECT_ROOT, ".evaluations", "outbox");
const INBOX_DIR = path.join(PROJECT_ROOT, ".evaluations", "inbox");

const TIER_TO_SCORE = { S: 10, A: 8, B: 6, C: 4, D: 2 };
const VALID_SCORES = new Set([10, 8, 6, 4, 2]);
const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);
const VALID_VERDICTS = new Set(["卓越", "优秀", "合格", "待改进", "不合格"]);

const REQUIRED_RUBRIC_IDS = ["R1", "R2", "R3", "R4", "R5"];

// 契约 v2.1 的 R1~R5 权重（未激活扩展维度）
const DEFAULT_WEIGHTS_V2 = { R1: 0.4, R2: 0.15, R3: 0.2, R4: 0.1, R5: 0.15 };

// v2.2 规则常量
const VALID_CLAIM_TYPES = new Set(["fact", "number", "logic", "source"]);
const VALID_CLAIM_SUPPORT = new Set(["high", "medium"]);
const VALID_CLAIM_STATUS = new Set([
  "verified-correct",
  "refuted",
  "inconclusive",
  "skipped-time-budget",
  "skipped-out-of-scope",
]);
const VALID_VETO_MODES = new Set(["V1", "V2", "V3", "V4", "V5"]);
const VALID_SBS_WINNERS = new Set(["A", "B", "tie", "draw"]);
const VALID_SBS_MARGINS_V22 = new Set(["overwhelming", "clear", "slight", "tie"]);
const REQUIRED_PASSES_V22 = ["read", "claim-inventory", "pass1", "pass2", "pass3", "score"];
// checklist 每维度最少项数
const CHECKLIST_MIN_ITEMS = { R1: 7, R2: 5, R3: 5, R4: 5, R5: 5 };
// 承重 claim 核验覆盖率硬约束
const CLAIM_COVERAGE_MIN = 0.85;
// 时间盒：不再设硬上限（v3.0 起评测耗时仅作为观测指标，不再做封顶约束）
const QUOTED_SNIPPET_RE = /「([^」]+)」|"([^"]+)"/g;
const REPORT_HEADING_RE = /^(#{2,6})\s+(.+?)\s*$/gm;

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function hasQuotedSnippet(text, minLen = 15) {
  if (!isNonEmptyString(text)) return false;
  for (const match of text.matchAll(QUOTED_SNIPPET_RE)) {
    const snippet = (match[1] ?? match[2] ?? "").trim();
    if (snippet.length >= minLen) return true;
  }
  return false;
}

function findHeadingIndex(report, kind) {
  if (!isNonEmptyString(report)) return -1;
  const headings = [...report.matchAll(REPORT_HEADING_RE)].map((m) => m[2].trim());
  const matcher =
    kind === "summary"
      ? (title) => /总评|评测结论/.test(title)
      : kind === "score"
        ? (title) => /(评分总表|横评分数矩阵|打分对照|评分)/.test(title)
        : kind === "dimension"
          ? (title) => /按维度|维度展开|维度分析/.test(title)
          : kind === "keyIssue"
            ? (title) => /额外重点问题|重点问题|关键问题/.test(title)
            : kind === "prosCons"
              ? (title) => /优缺点|改进建议|主体表现/.test(title)
              : (title) => /(SBS|Side-?by-?Side|对比|胜负总结)/i.test(title);
  return headings.findIndex(matcher);
}

function hasExternalValidationCue(text) {
  if (!isNonEmptyString(text)) return false;
  return /(外部|公开来源|一手源|官网|官方|检索|查询|核验|不可核|无法核验|未检索到)/.test(text);
}

function readJsonSafe(p) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** 在 errors 累积一条违规 */
function pushErr(errors, file, path, msg) {
  errors.push({ file: path_rel(file), path, msg });
}

function path_rel(abs) {
  return path.relative(PROJECT_ROOT, abs);
}

/** 校验单个 outbox payload；把错误累积到 errors 数组。
 *
 * 也作为模块导出供单测调用（传入虚拟 file 名即可）。
 */
export function validatePayload(file, payload, errors) {
  // 通用顶层
  if (typeof payload.taskId !== "string" || !payload.taskId) {
    pushErr(errors, file, "taskId", "缺失或非字符串");
    return; // 没有 taskId 无法继续
  }
  if (typeof payload.version !== "number") {
    pushErr(errors, file, "version", "缺失或非 number");
  }
  const cv = payload.contractVersion;
  if (!["1.0", "2.0", "2.1", "2.2", "3.0", "3.1", "3.2", "3.3"].includes(cv)) {
    pushErr(errors, file, "contractVersion", `必须是 "1.0" / "2.0" / "2.1" / "2.2" / "3.0" / "3.1" / "3.2" / "3.3"，实际：${JSON.stringify(cv)}`);
  }
  // v2.0+ 共享档位制/veto 校验；v2.2+ 共享 claim/checklist/budget/SBS/R1 子档；v3.x 额外有焦点诊断与证据密度校验；
  // v3.3 在 v3.2 基础上：claim Top 上限 5→10、verificationBudget.targetMinutes 不再硬锁 45
  const isV2Plus = cv === "2.0" || cv === "2.1" || cv === "2.2" || cv === "3.0" || cv === "3.1" || cv === "3.2" || cv === "3.3";
  const isV22Plus = cv === "2.2" || cv === "3.0" || cv === "3.1" || cv === "3.2" || cv === "3.3";
  const isV3 = cv === "3.0" || cv === "3.1" || cv === "3.2" || cv === "3.3";
  const isV31 = cv === "3.1";
  const isV32 = cv === "3.2";
  const isV33 = cv === "3.3";
  if (!payload.summary || typeof payload.summary !== "object") {
    pushErr(errors, file, "summary", "缺失或非对象");
    return;
  }
  const s = payload.summary;

  // overallScores
  if (!Array.isArray(s.overallScores) || s.overallScores.length === 0) {
    pushErr(errors, file, "summary.overallScores", "缺失或空数组");
    return;
  }
  const reportIds = s.overallScores.map((o) => o.reportId);
  for (const [i, o] of s.overallScores.entries()) {
    const pref = `summary.overallScores[${i}]`;
    if (!o.reportId) pushErr(errors, file, `${pref}.reportId`, "必填");
    if (typeof o.score !== "number") pushErr(errors, file, `${pref}.score`, "缺失或非 number");
    if (!VALID_VERDICTS.has(o.verdict))
      pushErr(errors, file, `${pref}.verdict`, `必须是 ${[...VALID_VERDICTS].join("/")}；实际：${JSON.stringify(o.verdict)}`);

    if (isV2Plus) {
      if (typeof o.vetoTriggered !== "boolean")
        pushErr(errors, file, `${pref}.vetoTriggered`, "v2.0+ 必须是 boolean");
      if (o.vetoTriggered === true) {
        if (!o.vetoReason || typeof o.vetoReason !== "string")
          pushErr(errors, file, `${pref}.vetoReason`, "vetoTriggered=true 时必填");
        if (typeof o.score === "number" && o.score > 6.9 + 1e-9)
          pushErr(errors, file, `${pref}.score`, `一票否决触发时必须 ≤ 6.9，实际 ${o.score}`);
      }
    }
  }

  // productName 唯一性与格式规范（通用）
  // 背景：同一份 payload 内出现重名（尤其是两条都叫 "SophiaAI"）会让评分总表表头无法区分；
  //       括号风格 "SophiaAI (v4)" 与常规 "SophiaAI v4" 混用也会导致展示不一致。
  {
    const nameCount = new Map();
    for (const o of s.overallScores) {
      const n = typeof o.productName === "string" ? o.productName.trim() : "";
      if (!n) {
        pushErr(
          errors,
          file,
          `summary.overallScores[reportId=${o.reportId}].productName`,
          "必填非空字符串"
        );
        continue;
      }
      // 禁止括号风格的版本号
      if (/[（(]\s*v\d/i.test(n)) {
        pushErr(
          errors,
          file,
          `summary.overallScores[reportId=${o.reportId}].productName`,
          `版本号不允许用括号包裹，应写作 "Name vN"（当前：${JSON.stringify(n)}）`
        );
      }
      nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
    }
    for (const [n, c] of nameCount) {
      if (c > 1) {
        pushErr(
          errors,
          file,
          "summary.overallScores",
          `productName 重复：${JSON.stringify(n)} 出现 ${c} 次。不同版本必须写成 "Name v4"、"Name v5" 等以示区分`
        );
      }
    }
  }

  // rubric
  if (!Array.isArray(s.rubric)) {
    pushErr(errors, file, "summary.rubric", "必须是数组");
    return;
  }
  const presentIds = s.rubric.map((r) => r.dimensionId);
  for (const id of REQUIRED_RUBRIC_IDS) {
    if (!presentIds.includes(id))
      pushErr(errors, file, "summary.rubric", `缺失必需维度 ${id}`);
  }
  for (const [i, r] of s.rubric.entries()) {
    const pref = `summary.rubric[${i}](${r.dimensionId ?? "?"})`;
    if (!r.dimensionId) pushErr(errors, file, `${pref}.dimensionId`, "必填");
    if (!r.name || typeof r.name !== "string")
      pushErr(errors, file, `${pref}.name`, "必填非空字符串");
    if (typeof r.weight !== "number")
      pushErr(errors, file, `${pref}.weight`, "必填 number");
    // 字段名硬约束：必须是 scores 不是 reports（历史踩坑点）
    if ("reports" in r && !("scores" in r))
      pushErr(errors, file, `${pref}.scores`, "字段名错误：用了 `reports`，契约规定是 `scores`（历史踩坑点，会导致前端 dim.scores is not iterable 白屏）");
    if (!Array.isArray(r.scores))
      pushErr(errors, file, `${pref}.scores`, "必须是数组");
    else {
      const coveredIds = r.scores.map((x) => x.reportId);
      for (const rid of reportIds) {
        if (!coveredIds.includes(rid))
          pushErr(errors, file, `${pref}.scores`, `未覆盖 reportId=${rid}`);
      }
      for (const [j, sc] of r.scores.entries()) {
        const spref = `${pref}.scores[${j}]`;
        if (isV2Plus) {
          if (!VALID_SCORES.has(sc.score))
            pushErr(errors, file, `${spref}.score`, `必须是 10/8/6/4/2，实际 ${sc.score}`);
          if (!sc.tier || TIER_TO_SCORE[sc.tier] === undefined)
            pushErr(errors, file, `${spref}.tier`, `必须是 S/A/B/C/D，实际 ${JSON.stringify(sc.tier)}`);
          else if (TIER_TO_SCORE[sc.tier] !== sc.score)
            pushErr(errors, file, `${spref}.tier`, `与 score 不对应：tier=${sc.tier} 应对应 ${TIER_TO_SCORE[sc.tier]}，实际 score=${sc.score}`);
          if (!sc.confidence || !VALID_CONFIDENCE.has(sc.confidence))
            pushErr(errors, file, `${spref}.confidence`, `必须是 high/medium/low，实际 ${JSON.stringify(sc.confidence)}`);
        }
        if (!sc.comment || typeof sc.comment !== "string") {
          pushErr(errors, file, `${spref}.comment`, "必填非空字符串");
        } else if (isV3 && (sc.tier === "C" || sc.tier === "D") && !hasQuotedSnippet(sc.comment, 15)) {
          pushErr(errors, file, `${spref}.comment`, "v3.0 下 tier C/D 的低分 comment 必须含 ≥15 字原文引用片段（用「」或 \"\" 包裹）");
        }
      }
    }

    // v2.2+：R1 必须含 subscores.R1a + subscores.R1b
    if (isV22Plus && r.dimensionId === "R1") {
      const sub = r.subscores;
      if (!sub || typeof sub !== "object") {
        pushErr(errors, file, `${pref}.subscores`, `${cv} 下 R1 必填（R1a 事实 + R1b 逻辑）`);
      } else {
        for (const key of ["R1a", "R1b"]) {
          const entry = sub[key];
          const spref2 = `${pref}.subscores.${key}`;
          if (!entry || typeof entry !== "object") {
            pushErr(errors, file, spref2, "必填对象");
            continue;
          }
          if (!VALID_SCORES.has(entry.score))
            pushErr(errors, file, `${spref2}.score`, `必须是 10/8/6/4/2，实际 ${entry.score}`);
          if (entry.tier && TIER_TO_SCORE[entry.tier] !== undefined && TIER_TO_SCORE[entry.tier] !== entry.score)
            pushErr(errors, file, `${spref2}.tier`, `与 score 不对应：tier=${entry.tier} 应对应 ${TIER_TO_SCORE[entry.tier]}，实际 ${entry.score}`);
          const expectedWeight = key === "R1a" ? 0.28 : 0.12;
          // 仅当 R1 默认权重（0.40）未被扩展维度挤压时才严格校验
          if (typeof r.weight === "number" && Math.abs(r.weight - 0.4) < 0.01) {
            if (typeof entry.weight !== "number" || Math.abs(entry.weight - expectedWeight) > 0.005)
              pushErr(errors, file, `${spref2}.weight`, `R1 权重=0.40 时，${key} 权重应为 ${expectedWeight}（R1a:R1b = 7:3），实际 ${entry.weight}`);
          }
          if (!entry.comment || typeof entry.comment !== "string")
            pushErr(errors, file, `${spref2}.comment`, "必填非空字符串");
        }
      }
    }
  }

  // extraDimensions（可选，但如果存在必须合规）
  if (s.extraDimensions !== undefined) {
    if (!Array.isArray(s.extraDimensions))
      pushErr(errors, file, "summary.extraDimensions", "必须是数组或省略");
    else {
      for (const [i, x] of s.extraDimensions.entries()) {
        const pref = `summary.extraDimensions[${i}](${x.dimensionId ?? x.id ?? "?"})`;
        if (!x.dimensionId && !x.id)
          pushErr(errors, file, `${pref}.dimensionId`, "必填");
        if (!x.name || typeof x.name !== "string")
          pushErr(errors, file, `${pref}.name`, "必填非空字符串");
        if ("reports" in x && !("scores" in x))
          pushErr(errors, file, `${pref}.scores`, "字段名错误：用了 `reports`，契约规定是 `scores`");
        if (!Array.isArray(x.scores))
          pushErr(errors, file, `${pref}.scores`, "必须是数组");
        if (isV2Plus) {
          if (typeof x.activated !== "boolean")
            pushErr(errors, file, `${pref}.activated`, "v2.0+ 必须是 boolean");
          if (x.activated === true) {
            if (![0.05, 0.1, 0.15].includes(x.weight))
              pushErr(errors, file, `${pref}.weight`, `activated=true 时必须 ∈ {0.05, 0.10, 0.15}，实际 ${x.weight}`);
          }
        }
      }
    }
  }

  // overallScore 加权和校验（v2.0+ 档位制下是精确校验）
  if (isV2Plus) {
    // 构造 dim->weight 映射（从 payload 读，不做推断——payload 自己说多少就多少）
    const dimWeights = {};
    for (const r of s.rubric ?? [])
      if (typeof r.weight === "number") dimWeights[r.dimensionId] = r.weight;
    const activeExtras = (s.extraDimensions ?? []).filter((x) => x.activated === true);
    for (const x of activeExtras) {
      const id = x.dimensionId ?? x.id;
      if (typeof x.weight === "number" && id) dimWeights[id] = x.weight;
    }
    // 权重总和约束（允许 0.01 浮动）
    const weightSum = Object.values(dimWeights).reduce((a, b) => a + b, 0);
    if (Math.abs(weightSum - 1.0) > 0.01) {
      pushErr(
        errors,
        file,
        "summary.rubric + extraDimensions[activated].weight",
        `权重总和应为 1.0（±0.01 容差），实际 ${weightSum.toFixed(3)}`
      );
    }

    for (const o of s.overallScores) {
      const rid = o.reportId;
      let calc = 0;
      let missing = false;
      for (const dim of [...(s.rubric ?? []), ...activeExtras]) {
        const did = dim.dimensionId ?? dim.id;
        const w = dimWeights[did];
        if (typeof w !== "number") {
          missing = true;
          break;
        }
        const sc = (dim.scores ?? []).find((x) => x.reportId === rid);
        if (!sc) {
          missing = true;
          break;
        }
        calc += sc.score * w;
      }
      if (missing) continue;
      if (o.vetoTriggered === true) calc = Math.min(calc, 6.9);
      if (typeof o.score === "number" && Math.abs(calc - o.score) > 0.05) {
        pushErr(
          errors,
          file,
          `summary.overallScores[reportId=${rid}].score`,
          `加权和不匹配：calc=${calc.toFixed(3)}，declared=${o.score}`
        );
      }
    }
  }

  // sbs（candidates ≥ 2 时必填）
  if (s.overallScores.length >= 2) {
    if (!s.sbs || !Array.isArray(s.sbs.pairs) || s.sbs.pairs.length === 0) {
      pushErr(errors, file, "summary.sbs", "candidates ≥ 2 时 sbs.pairs 必填且非空");
    } else if (isV22Plus) {
      // v2.2+ SBS 结构：reportIdA + reportIdB + winner + margin + dimensionDriver + keyReason
      for (const [i, p] of s.sbs.pairs.entries()) {
        const pref = `summary.sbs.pairs[${i}]`;
        if (!p.reportIdA || typeof p.reportIdA !== "string")
          pushErr(errors, file, `${pref}.reportIdA`, `${cv} 必填非空字符串（禁用旧字段 productA）`);
        if (!p.reportIdB || typeof p.reportIdB !== "string")
          pushErr(errors, file, `${pref}.reportIdB`, `${cv} 必填非空字符串（禁用旧字段 productB）`);
        if (p.reportIdA && !reportIds.includes(p.reportIdA))
          pushErr(errors, file, `${pref}.reportIdA`, `reportId 不存在于 candidates：${p.reportIdA}`);
        if (p.reportIdB && !reportIds.includes(p.reportIdB))
          pushErr(errors, file, `${pref}.reportIdB`, `reportId 不存在于 candidates：${p.reportIdB}`);
        if (!VALID_SBS_WINNERS.has(p.winner))
          pushErr(errors, file, `${pref}.winner`, `必须 ∈ {A, B, tie, draw}，实际 ${JSON.stringify(p.winner)}`);
        if (!VALID_SBS_MARGINS_V22.has(p.margin))
          pushErr(errors, file, `${pref}.margin`, `${cv} 必须 ∈ {overwhelming, clear, slight, tie}，实际 ${JSON.stringify(p.margin)}`);
        // dimensionDriver：契约允许 string 或 string[]（拉开差距的主导维度，可 1 个或多个 Rx/Xy）
        {
          const dd = p.dimensionDriver;
          const isValidString = typeof dd === "string" && dd.trim().length > 0;
          const isValidArray =
            Array.isArray(dd) &&
            dd.length > 0 &&
            dd.every((d) => typeof d === "string" && d.trim().length > 0);
          if (!isValidString && !isValidArray) {
            pushErr(
              errors,
              file,
              `${pref}.dimensionDriver`,
              `${cv} 必填：非空字符串或非空字符串数组（拉开差距的主导维度，如 "R1" 或 ["R1","R3"]）`
            );
          }
        }
        if (!p.keyReason || typeof p.keyReason !== "string")
          pushErr(errors, file, `${pref}.keyReason`, "必填非空字符串");
      }
    }
  }

  // perReportFeedback（v2.1 起必填，v3.x 继续）
  if (cv === "2.1" || cv === "2.2" || cv === "3.0" || cv === "3.1" || cv === "3.2" || cv === "3.3") {
    if (!Array.isArray(s.perReportFeedback)) {
      pushErr(errors, file, "summary.perReportFeedback", `${cv} 必填数组`);
    } else {
      const covered = s.perReportFeedback.map((f) => f.reportId);
      for (const rid of reportIds)
        if (!covered.includes(rid))
          pushErr(errors, file, "summary.perReportFeedback", `未覆盖 reportId=${rid}`);
      for (const [i, f] of s.perReportFeedback.entries()) {
        const pref = `summary.perReportFeedback[${i}]`;
        for (const k of ["strengths", "weaknesses", "improvements"]) {
          if (!Array.isArray(f[k]) || f[k].length === 0)
            pushErr(errors, file, `${pref}.${k}`, "必须是非空数组");
        }
      }
    }
  }

  // ============================================================
  // v2.2+：claimInventory / claimChecks / dimensionChecklists / verificationBudget
  // ============================================================
  if (isV22Plus) {
    // --- claimInventory ---
    const claimIds = new Set();
    if (!Array.isArray(s.claimInventory) || s.claimInventory.length === 0) {
      pushErr(errors, file, "summary.claimInventory", "v2.2 必填非空数组");
    } else {
      const perReportClaims = new Map(); // reportId -> ClaimInventoryItem[]
      for (const [i, c] of s.claimInventory.entries()) {
        const pref = `summary.claimInventory[${i}]`;
        if (!c.claimId || typeof c.claimId !== "string")
          pushErr(errors, file, `${pref}.claimId`, "必填非空字符串");
        else if (claimIds.has(c.claimId))
          pushErr(errors, file, `${pref}.claimId`, `claimId 重复：${c.claimId}`);
        else claimIds.add(c.claimId);
        if (!c.reportId || !reportIds.includes(c.reportId))
          pushErr(errors, file, `${pref}.reportId`, `reportId 必须存在于 candidates，实际 ${JSON.stringify(c.reportId)}`);
        if (!c.claim || typeof c.claim !== "string")
          pushErr(errors, file, `${pref}.claim`, "必填非空字符串");
        if (!VALID_CLAIM_TYPES.has(c.type))
          pushErr(errors, file, `${pref}.type`, `必须 ∈ {fact, number, logic, source}，实际 ${JSON.stringify(c.type)}`);
        if (!VALID_CLAIM_SUPPORT.has(c.supportWeight))
          pushErr(errors, file, `${pref}.supportWeight`, `必须 ∈ {high, medium}，实际 ${JSON.stringify(c.supportWeight)}`);
        if (c.reportId) {
          const arr = perReportClaims.get(c.reportId) ?? [];
          arr.push(c);
          perReportClaims.set(c.reportId, arr);
        }
      }
      // 每份报告承重 claim 数量硬约束：v2.2~v3.2 为 3~5，v3.3 起放宽到 3~10（含 ≥1 条 logic）
      const maxClaimsPerReport = isV33 ? 10 : 5;
      for (const rid of reportIds) {
        const arr = perReportClaims.get(rid) ?? [];
        if (arr.length < 3 || arr.length > maxClaimsPerReport) {
          pushErr(
            errors,
            file,
            `summary.claimInventory[reportId=${rid}]`,
            `每份报告应抽 3~${maxClaimsPerReport} 条承重 claim（contractVersion=${cv}），实际 ${arr.length}`
          );
        }
        if (arr.length > 0 && !arr.some((c) => c.type === "logic")) {
          pushErr(
            errors,
            file,
            `summary.claimInventory[reportId=${rid}]`,
            "必须至少 1 条 type=\"logic\" 的 claim"
          );
        }
      }
    }

    // --- claimChecks ---
    if (!Array.isArray(s.claimChecks)) {
      pushErr(errors, file, "summary.claimChecks", "v2.2 必填数组");
    } else {
      const checkedIds = new Set();
      let verifiedLike = 0; // verified-correct + refuted + inconclusive
      let skipped = 0; // time-budget + out-of-scope
      for (const [i, ck] of s.claimChecks.entries()) {
        const pref = `summary.claimChecks[${i}]`;
        if (!ck.claimId || typeof ck.claimId !== "string") {
          pushErr(errors, file, `${pref}.claimId`, "必填非空字符串");
          continue;
        }
        if (claimIds.size > 0 && !claimIds.has(ck.claimId))
          pushErr(errors, file, `${pref}.claimId`, `claimId 不在 claimInventory 中：${ck.claimId}`);
        if (checkedIds.has(ck.claimId))
          pushErr(errors, file, `${pref}.claimId`, `claimChecks 中 claimId 重复：${ck.claimId}`);
        else checkedIds.add(ck.claimId);
        if (!VALID_CLAIM_STATUS.has(ck.status)) {
          pushErr(
            errors,
            file,
            `${pref}.status`,
            `必须 ∈ {verified-correct, refuted, inconclusive, skipped-time-budget, skipped-out-of-scope}，实际 ${JSON.stringify(ck.status)}`
          );
        } else {
          if (
            ck.status === "verified-correct" ||
            ck.status === "refuted" ||
            ck.status === "inconclusive"
          )
            verifiedLike += 1;
          else skipped += 1;
        }
        if (ck.status === "refuted" && ck.vetoMode !== undefined && ck.vetoMode !== null) {
          if (!VALID_VETO_MODES.has(ck.vetoMode))
            pushErr(errors, file, `${pref}.vetoMode`, `必须 ∈ {V1, V2, V3, V4, V5}，实际 ${JSON.stringify(ck.vetoMode)}`);
        }
        // 非 skipped 的核验项必须有 evidence
        if (
          (ck.status === "verified-correct" ||
            ck.status === "refuted" ||
            ck.status === "inconclusive") &&
          (!ck.evidence || typeof ck.evidence !== "string")
        ) {
          pushErr(errors, file, `${pref}.evidence`, "非 skipped 状态必填 evidence 说明");
        } else if (
          isV3 &&
          (ck.status === "refuted" || ck.status === "inconclusive") &&
          typeof ck.evidence === "string"
        ) {
          if (ck.evidence.trim().length < 30) {
            pushErr(errors, file, `${pref}.evidence`, "v3.0+ 下 refuted / inconclusive 的 evidence 长度必须 ≥ 30 字");
          }
          if (!hasQuotedSnippet(ck.evidence, 15)) {
            pushErr(errors, file, `${pref}.evidence`, "v3.0+ 下 refuted / inconclusive 的 evidence 必须含报告原文引用片段（用「」或 \"\" 包裹）");
          }
          if (isV31 && !hasExternalValidationCue(ck.evidence)) {
            pushErr(errors, file, `${pref}.evidence`, "v3.1 下 refuted / inconclusive 的 evidence 还必须包含外部核验结论（或不可核说明）");
          }
        }
      }
      // 每个 claimId 必须有 check
      for (const cid of claimIds) {
        if (!checkedIds.has(cid))
          pushErr(errors, file, "summary.claimChecks", `claimInventory 的 ${cid} 没有对应核验记录`);
      }
      // 核验覆盖率 ≥ 85%
      const nonSkipped = claimIds.size - skipped;
      if (nonSkipped > 0) {
        const coverage = verifiedLike / nonSkipped;
        if (coverage < CLAIM_COVERAGE_MIN - 1e-9) {
          pushErr(
            errors,
            file,
            "summary.claimChecks",
            `核验覆盖率 ${(coverage * 100).toFixed(1)}% 未达 ${(CLAIM_COVERAGE_MIN * 100).toFixed(0)}% 硬约束（verifiedLike=${verifiedLike} / nonSkipped=${nonSkipped}）`
          );
        }
      }
    }

    // --- dimensionChecklists ---
    if (!s.dimensionChecklists || typeof s.dimensionChecklists !== "object") {
      pushErr(errors, file, "summary.dimensionChecklists", "v2.2 必填对象");
    } else {
      for (const dimId of REQUIRED_RUBRIC_IDS) {
        const checklist = s.dimensionChecklists[dimId];
        const pref = `summary.dimensionChecklists.${dimId}`;
        if (!checklist || typeof checklist !== "object") {
          pushErr(errors, file, pref, "v2.2 必填对象");
          continue;
        }
        if (!Array.isArray(checklist.items) || checklist.items.length === 0) {
          pushErr(errors, file, `${pref}.items`, "必填非空数组");
          continue;
        }
        const minItems = CHECKLIST_MIN_ITEMS[dimId] ?? 5;
        if (checklist.items.length < minItems) {
          pushErr(
            errors,
            file,
            `${pref}.items`,
            `${dimId} 必查项应 ≥ ${minItems} 条，实际 ${checklist.items.length} 条`
          );
        }
        for (const [i, item] of checklist.items.entries()) {
          const ipref = `${pref}.items[${i}]`;
          if (!item.label || typeof item.label !== "string")
            pushErr(errors, file, `${ipref}.label`, "必填非空字符串");
          if (!Array.isArray(item.passedFor))
            pushErr(errors, file, `${ipref}.passedFor`, "必填数组（通过该项的 reportId 列表，可空数组）");
          else {
            for (const rid of item.passedFor) {
              if (!reportIds.includes(rid))
                pushErr(errors, file, `${ipref}.passedFor`, `reportId 不存在：${rid}`);
            }
          }
        }
      }
    }

    // --- verificationBudget ---
    if (!s.verificationBudget || typeof s.verificationBudget !== "object") {
      pushErr(errors, file, "summary.verificationBudget", "v2.2 必填对象");
    } else {
      const b = s.verificationBudget;
      if (isV33) {
        // v3.3 起 targetMinutes 仅作节奏参考，不再硬锁 45；但仍需是正数
        if (typeof b.targetMinutes !== "number" || b.targetMinutes <= 0)
          pushErr(errors, file, "summary.verificationBudget.targetMinutes", `v3.3 需为 >0 的数字（节奏参考），实际 ${b.targetMinutes}`);
      } else {
        if (b.targetMinutes !== 45)
          pushErr(errors, file, "summary.verificationBudget.targetMinutes", `${cv} 固定为 45，实际 ${b.targetMinutes}`);
      }
      if (typeof b.actualMinutes !== "number" || b.actualMinutes <= 0)
        pushErr(errors, file, "summary.verificationBudget.actualMinutes", `必须是 >0 的数字，实际 ${b.actualMinutes}`);
      if (!Array.isArray(b.passesCompleted)) {
        pushErr(errors, file, "summary.verificationBudget.passesCompleted", "必填数组");
      } else {
        for (const required of REQUIRED_PASSES_V22) {
          if (!b.passesCompleted.includes(required)) {
            pushErr(
              errors,
              file,
              "summary.verificationBudget.passesCompleted",
              `缺少必经阶段：${required}`
            );
          }
        }
      }
      if (
        b.claimsSkippedDueToBudget !== undefined &&
        (typeof b.claimsSkippedDueToBudget !== "number" || b.claimsSkippedDueToBudget < 0)
      )
        pushErr(
          errors,
          file,
          "summary.verificationBudget.claimsSkippedDueToBudget",
          `必须是 ≥0 的数字，实际 ${b.claimsSkippedDueToBudget}`
        );
      if (
        b.claimsOutOfScope !== undefined &&
        (typeof b.claimsOutOfScope !== "number" || b.claimsOutOfScope < 0)
      )
        pushErr(
          errors,
          file,
          "summary.verificationBudget.claimsOutOfScope",
          `必须是 ≥0 的数字，实际 ${b.claimsOutOfScope}`
        );
    }
  }

  // v3.0：聚焦 Sophia 的跨产品诊断
  if (isV3 && s.overallScores.length >= 2) {
    const cpi = s.crossProductInsights;
    const productNames = s.overallScores
      .map((o) => (typeof o.productName === "string" ? o.productName.trim() : ""))
      .filter(Boolean);
    const hasSophia = productNames.some((name) => /^SophiaAI\b/i.test(name));
    const claimIdSet = new Set(
      Array.isArray(s.claimInventory)
        ? s.claimInventory
            .map((c) => (typeof c?.claimId === "string" ? c.claimId : ""))
            .filter(Boolean)
        : []
    );

    if (!cpi || typeof cpi !== "object") {
      pushErr(errors, file, "summary.crossProductInsights", "v3.0 在 candidates ≥ 2 时必填对象");
    } else {
      if (!isNonEmptyString(cpi.focusProductName)) {
        pushErr(errors, file, "summary.crossProductInsights.focusProductName", "必填非空字符串");
      } else if (cpi.focusProductName === "none") {
        if (hasSophia) {
          pushErr(errors, file, "summary.crossProductInsights.focusProductName", "本轮含 Sophia 参评时不能填 \"none\"");
        }
      } else {
        if (!/^SophiaAI\b/i.test(cpi.focusProductName)) {
          pushErr(errors, file, "summary.crossProductInsights.focusProductName", "v3.0 聚焦对象必须是 SophiaAI 家族或 \"none\"");
        }
        if (!productNames.includes(cpi.focusProductName)) {
          pushErr(errors, file, "summary.crossProductInsights.focusProductName", `focusProductName 不在 candidates 中：${cpi.focusProductName}`);
        }
      }

      const validateQuote = (quote, pref, requireKnownProduct = true) => {
        const productLabel =
          typeof quote?.productName === "string"
            ? quote.productName.trim()
            : typeof quote?.product === "string"
              ? quote.product.trim()
              : "";
        if (!productLabel) {
          pushErr(errors, file, `${pref}.productName`, "必填产品名（兼容旧字段 product）");
        } else if (requireKnownProduct && !productNames.includes(productLabel)) {
          pushErr(errors, file, `${pref}.productName`, `产品名不在 candidates 中：${productLabel}`);
        }
        if (!isNonEmptyString(quote?.quote)) {
          pushErr(errors, file, `${pref}.quote`, "必填非空字符串");
        }
        return productLabel;
      };

      const validateInsight = (insight, pref, kind) => {
        if (!insight || typeof insight !== "object") {
          pushErr(errors, file, pref, "必填对象");
          return;
        }
        if (!isNonEmptyString(insight.dimension) || !/^(R[1-5](?:[ab])?|X[1-3])$/.test(insight.dimension.trim())) {
          pushErr(errors, file, `${pref}.dimension`, `维度代号非法：${JSON.stringify(insight.dimension)}`);
        }
        if (!isNonEmptyString(insight.gapSummary)) {
          pushErr(errors, file, `${pref}.gapSummary`, "必填非空字符串");
        }

        const peerField = kind === "sharedWeakness" ? (Array.isArray(insight.acrossProducts) ? "acrossProducts" : "vsProducts") : "vsProducts";
        const peers = insight[peerField];
        if (!Array.isArray(peers) || peers.length === 0) {
          pushErr(errors, file, `${pref}.${peerField}`, "必填非空数组");
        } else {
          for (const [idx, name] of peers.entries()) {
            if (!isNonEmptyString(name)) {
              pushErr(errors, file, `${pref}.${peerField}[${idx}]`, "必填非空字符串");
              continue;
            }
            if (!productNames.includes(name)) {
              pushErr(errors, file, `${pref}.${peerField}[${idx}]`, `产品名不在 candidates 中：${name}`);
            }
          }
        }

        if (kind !== "sharedWeakness") {
          if (!Array.isArray(insight.evidenceQuotes) || insight.evidenceQuotes.length === 0) {
            pushErr(errors, file, `${pref}.evidenceQuotes`, "必填非空数组");
          } else {
            let hasFocusQuote = false;
            for (const [idx, quote] of insight.evidenceQuotes.entries()) {
              const productLabel = validateQuote(quote, `${pref}.evidenceQuotes[${idx}]`);
              if (productLabel === cpi.focusProductName) hasFocusQuote = true;
            }
            if (cpi.focusProductName !== "none" && !hasFocusQuote) {
              pushErr(errors, file, `${pref}.evidenceQuotes`, "至少要有 1 条属于 focusProductName 的原文引用");
            }
          }
        } else if (Array.isArray(insight.evidenceQuotes)) {
          for (const [idx, quote] of insight.evidenceQuotes.entries()) {
            validateQuote(quote, `${pref}.evidenceQuotes[${idx}]`);
          }
        }

        if (insight.claimRefs !== undefined) {
          if (!Array.isArray(insight.claimRefs)) {
            pushErr(errors, file, `${pref}.claimRefs`, "如填写必须是数组");
          } else {
            for (const [idx, claimId] of insight.claimRefs.entries()) {
              if (!isNonEmptyString(claimId)) {
                pushErr(errors, file, `${pref}.claimRefs[${idx}]`, "必须是非空字符串");
              } else if (claimIdSet.size > 0 && !claimIdSet.has(claimId)) {
                pushErr(errors, file, `${pref}.claimRefs[${idx}]`, `claimId 不存在：${claimId}`);
              }
            }
          }
        }
      };

      for (const key of ["strongerThan", "weakerThan", "sharedWeakness"]) {
        if (!Array.isArray(cpi[key])) {
          pushErr(errors, file, `summary.crossProductInsights.${key}`, "必填数组（可为空）");
        }
      }

      for (const [idx, insight] of (Array.isArray(cpi.strongerThan) ? cpi.strongerThan : []).entries()) {
        validateInsight(insight, `summary.crossProductInsights.strongerThan[${idx}]`, "strongerThan");
      }
      for (const [idx, insight] of (Array.isArray(cpi.weakerThan) ? cpi.weakerThan : []).entries()) {
        validateInsight(insight, `summary.crossProductInsights.weakerThan[${idx}]`, "weakerThan");
      }
      for (const [idx, insight] of (Array.isArray(cpi.sharedWeakness) ? cpi.sharedWeakness : []).entries()) {
        validateInsight(insight, `summary.crossProductInsights.sharedWeakness[${idx}]`, "sharedWeakness");
      }

      if (
        cpi.focusProductName !== "none" &&
        Array.isArray(cpi.strongerThan) &&
        Array.isArray(cpi.weakerThan) &&
        cpi.strongerThan.length + cpi.weakerThan.length < 2
      ) {
        pushErr(errors, file, "summary.crossProductInsights", "focusProductName ≠ \"none\" 时，strongerThan + weakerThan 至少要有 2 条 insight");
      }
    }
  }

  // report 正文
  if (typeof payload.report !== "string" || !payload.report.trim()) {
    pushErr(errors, file, "report", "必填非空字符串");
  } else if (isV31 || isV32 || isV33) {
    const summaryIdx = findHeadingIndex(payload.report, "summary");
    const scoreIdx = findHeadingIndex(payload.report, "score");
    const dimensionIdx = findHeadingIndex(payload.report, "dimension");
    const keyIssueIdx = findHeadingIndex(payload.report, "keyIssue");
    const prosConsIdx = findHeadingIndex(payload.report, "prosCons");
    const versionLabel = isV33 ? "v3.3" : isV32 ? "v3.2" : "v3.1";
    // v3.2 起评分总表由 UI 固定展示，正文评分总表 heading 可选；v3.1 仍必填
    const scoreHeadingRequired = isV31;
    if (summaryIdx < 0) pushErr(errors, file, "report", `${versionLabel} 必须包含“评测结论/总评”锚点 heading`);
    if (scoreHeadingRequired && scoreIdx < 0) pushErr(errors, file, "report", "v3.1 必须包含“评分总表”锚点 heading");
    if (dimensionIdx < 0) pushErr(errors, file, "report", `${versionLabel} 必须包含“按维度展开”锚点 heading`);
    if (keyIssueIdx < 0) pushErr(errors, file, "report", `${versionLabel} 必须包含“额外重点问题”锚点 heading`);
    if (prosConsIdx < 0) pushErr(errors, file, "report", `${versionLabel} 必须包含“各主体优缺点与建议”锚点 heading`);
    if (
      summaryIdx >= 0 &&
      dimensionIdx >= 0 &&
      keyIssueIdx >= 0 &&
      prosConsIdx >= 0 &&
      !(summaryIdx < dimensionIdx && dimensionIdx < keyIssueIdx && keyIssueIdx < prosConsIdx)
    ) {
      pushErr(errors, file, "report", `${versionLabel} 的总-分-总锚点顺序必须是：评测结论 → 按维度展开 → 额外重点问题 → 各主体优缺点与建议`);
    }
    if (!scoreHeadingRequired && scoreIdx >= 0 && !(summaryIdx < scoreIdx && scoreIdx < dimensionIdx)) {
      pushErr(errors, file, "report", `${versionLabel} 若显式写出“评分总表”heading，应放在评测结论之后、按维度展开之前`);
    }
  } else if (cv === "3.0") {
    const summaryIdx = findHeadingIndex(payload.report, "summary");
    const scoreIdx = findHeadingIndex(payload.report, "score");
    const sbsIdx = findHeadingIndex(payload.report, "sbs");
    if (summaryIdx < 0) pushErr(errors, file, "report", "v3.0 必须包含“总评”稳定锚点 heading");
    if (scoreIdx < 0) pushErr(errors, file, "report", "v3.0 必须包含“评分总表”稳定锚点 heading");
    if (sbsIdx < 0) pushErr(errors, file, "report", "v3.0 必须包含“SBS 结论”稳定锚点 heading");
    if (summaryIdx >= 0 && scoreIdx >= 0 && sbsIdx >= 0 && !(summaryIdx < scoreIdx && scoreIdx < sbsIdx)) {
      pushErr(errors, file, "report", "v3.0 的三个稳定锚点顺序必须是：总评 → 评分总表 → SBS 结论");
    }
  }
}

/** 扫描 outbox 目录，返回所有 v{n}.json 文件路径 */
function listOutboxFiles() {
  if (!fs.existsSync(OUTBOX_DIR)) return [];
  const files = [];
  for (const taskId of fs.readdirSync(OUTBOX_DIR)) {
    const taskDir = path.join(OUTBOX_DIR, taskId);
    if (!fs.statSync(taskDir).isDirectory()) continue;
    for (const f of fs.readdirSync(taskDir)) {
      if (/^v\d+\.json$/.test(f)) files.push(path.join(taskDir, f));
    }
  }
  return files.sort();
}

/**
 * 校验 inbox v2 schema 的单个 task 文件。
 *
 * v2 硬约束（2026-04-27 起）：
 *   - inboxSchemaVersion === "2.0"（inbox 层的 schema version，
 *     与 outbox payload 的 contractVersion 独立，2026-04-27 前此字段名为 contractVersion）
 *   - candidates: 非空数组，每项含：
 *     * candidateId：非空字符串（稳定 id，给 PATCH 定位用）
 *     * reportVersions：非空数组；每条含 version:number / content:string / contentHash:string
 *       - version 从 1 递增且无重复
 *       - contentHash 为 16 位 hex
 *     * activeReportVersion：正整数，必须命中 reportVersions[].version 中的一条
 *     * report：v1 消费端镜像字段（非空字符串；必须等于 active 版本的 content）
 *   - query.id / query.code 非空字符串
 *   - taskId / createdAt 非空字符串
 *
 * 历史 v1 文件以及"v2 但顶层字段还叫 contractVersion"的旧文件不应出现在磁盘上——
 * 启动期 runStartup 会自动 migrate。这里一旦发现，直接判错，提示跑 `npm run migrate-inbox -- --apply`。
 */
export function validateInboxTask(file, task, errors) {
  if (!task || typeof task !== "object") {
    pushErr(errors, file, "<root>", "inbox 根必须是对象");
    return;
  }
  if (!isNonEmptyString(task.taskId)) pushErr(errors, file, "taskId", "必填非空字符串");
  if (!isNonEmptyString(task.createdAt)) pushErr(errors, file, "createdAt", "必填非空字符串");

  // schema 版本校验：严格要求新字段名 `inboxSchemaVersion`。
  // 任何旧字段名 `contractVersion` 残留都要判错并引导跑 migrate-inbox。
  const hasNew = typeof task.inboxSchemaVersion === "string";
  const hasOld = typeof task.contractVersion === "string";
  if (hasOld && !hasNew) {
    pushErr(
      errors,
      file,
      "inboxSchemaVersion",
      `顶层字段名仍是旧的 "contractVersion"（值=${JSON.stringify(task.contractVersion)}），请改名为 "inboxSchemaVersion"。修复：npm run migrate-inbox -- --apply`
    );
  } else if (!hasNew) {
    pushErr(
      errors,
      file,
      "inboxSchemaVersion",
      `必填字符串 "2.0"，实际 ${JSON.stringify(task.inboxSchemaVersion ?? null)}。修复：npm run migrate-inbox -- --apply`
    );
  } else if (task.inboxSchemaVersion !== "2.0") {
    pushErr(
      errors,
      file,
      "inboxSchemaVersion",
      `inbox schema 必须是 "2.0"，实际 ${JSON.stringify(task.inboxSchemaVersion)}。修复：npm run migrate-inbox -- --apply`
    );
  } else if (hasOld) {
    // 新旧字段并存（inboxSchemaVersion 已对，但 contractVersion 也还在）
    pushErr(
      errors,
      file,
      "contractVersion",
      `inbox 顶层已迁移到 inboxSchemaVersion，残留的旧字段 contractVersion 必须删除。修复：npm run migrate-inbox -- --apply`
    );
  }
  if (!task.query || typeof task.query !== "object") {
    pushErr(errors, file, "query", "必填对象");
  } else {
    if (!isNonEmptyString(task.query.id)) pushErr(errors, file, "query.id", "必填非空字符串");
    if (!isNonEmptyString(task.query.code)) pushErr(errors, file, "query.code", "必填非空字符串");
  }
  if (!Array.isArray(task.candidates) || task.candidates.length === 0) {
    pushErr(errors, file, "candidates", "必填非空数组");
    return;
  }
  for (const [i, c] of task.candidates.entries()) {
    const pref = `candidates[${i}]`;
    if (!c || typeof c !== "object") {
      pushErr(errors, file, pref, "必须是对象");
      continue;
    }
    if (!isNonEmptyString(c.candidateId)) {
      pushErr(errors, file, `${pref}.candidateId`, "v2 必填非空字符串");
    }
    if (!isNonEmptyString(c.report)) {
      pushErr(errors, file, `${pref}.report`, "必填非空字符串（v2 冗余镜像，保持 v1 消费端零改动）");
    }
    const versions = c.reportVersions;
    if (!Array.isArray(versions) || versions.length === 0) {
      pushErr(errors, file, `${pref}.reportVersions`, "v2 必填非空数组");
      continue;
    }
    const seen = new Set();
    for (const [j, v] of versions.entries()) {
      const vp = `${pref}.reportVersions[${j}]`;
      if (!v || typeof v !== "object") {
        pushErr(errors, file, vp, "必须是对象");
        continue;
      }
      if (!Number.isInteger(v.version) || v.version < 1) {
        pushErr(errors, file, `${vp}.version`, "必须是正整数");
      } else if (seen.has(v.version)) {
        pushErr(errors, file, `${vp}.version`, `版本号重复：${v.version}`);
      } else {
        seen.add(v.version);
      }
      if (!isNonEmptyString(v.content)) pushErr(errors, file, `${vp}.content`, "必填非空字符串");
      if (!isNonEmptyString(v.contentHash) || !/^[0-9a-f]{16}$/.test(v.contentHash)) {
        pushErr(errors, file, `${vp}.contentHash`, "必填 16 位 hex 字符串（sha256 前 8 字节）");
      }
    }
    const active = Number(c.activeReportVersion);
    if (!Number.isInteger(active) || active < 1) {
      pushErr(errors, file, `${pref}.activeReportVersion`, "必须是正整数");
    } else if (!seen.has(active)) {
      pushErr(
        errors,
        file,
        `${pref}.activeReportVersion`,
        `activeReportVersion=${active} 未在 reportVersions[].version 中找到`
      );
    } else {
      // report 字段必须镜像到 active 那版的 content
      const activeHit = versions.find((v) => Number(v?.version) === active);
      if (
        activeHit &&
        isNonEmptyString(activeHit.content) &&
        isNonEmptyString(c.report) &&
        activeHit.content !== c.report
      ) {
        pushErr(
          errors,
          file,
          `${pref}.report`,
          `与 reportVersions[version=${active}].content 不一致（v2 要求 report 字段镜像激活版本）`
        );
      }
    }
  }
}

/** 扫 .evaluations/inbox/*.json 做 v2 schema 校验 */
export function lintInbox() {
  if (!fs.existsSync(INBOX_DIR)) return { ok: true, errors: [], checkedFiles: 0, files: [] };
  const files = fs
    .readdirSync(INBOX_DIR)
    .filter((f) => f.endsWith(".json") && f !== ".gitkeep")
    .map((f) => path.join(INBOX_DIR, f))
    .sort();
  const errors = [];
  const checked = [];
  for (const f of files) {
    const res = readJsonSafe(f);
    if (!res.ok) {
      pushErr(errors, f, "<json>", `JSON 解析失败：${res.error}`);
      continue;
    }
    validateInboxTask(f, res.data, errors);
    checked.push(path_rel(f));
  }
  return {
    ok: errors.length === 0,
    errors,
    checkedFiles: checked.length,
    files: checked,
  };
}

/** 主入口：校验所有 outbox 产物 */
export function lintOutbox() {
  const files = listOutboxFiles();
  const errors = [];
  const checked = [];
  for (const f of files) {
    const res = readJsonSafe(f);
    if (!res.ok) {
      pushErr(errors, f, "<json>", `JSON 解析失败：${res.error}`);
      continue;
    }
    validatePayload(f, res.data, errors);
    checked.push(path_rel(f));
  }
  return {
    ok: errors.length === 0,
    errors,
    checkedFiles: checked.length,
    files: checked,
  };
}

// ---------- CLI ----------
function isMain() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);
  } catch {
    return false;
  }
}

function main() {
  try {
    const outRes = lintOutbox();
    const inRes = lintInbox();
    const totalChecked = outRes.checkedFiles + inRes.checkedFiles;
    const totalErrors = outRes.errors.length + inRes.errors.length;
    if (outRes.ok && inRes.ok) {
      console.log(
        `✅ lint OK: checked ${outRes.checkedFiles} outbox + ${inRes.checkedFiles} inbox files, no violations`
      );
      process.exit(0);
    }
    console.error(
      `❌ lint FAILED: ${totalErrors} violations across ${totalChecked} files\n`
    );
    const allErrors = [
      ...outRes.errors.map((e) => ({ ...e, kind: "outbox" })),
      ...inRes.errors.map((e) => ({ ...e, kind: "inbox" })),
    ];
    // 按文件分组输出
    const byFile = new Map();
    for (const e of allErrors) {
      if (!byFile.has(e.file)) byFile.set(e.file, []);
      byFile.get(e.file).push(e);
    }
    for (const [file, errs] of byFile) {
      console.error(`  📄 ${file}`);
      for (const e of errs) console.error(`     ✗ ${e.path}: ${e.msg}`);
    }
    console.error(
      "\n修复方式：outbox 参照 .evaluations/EVALUATION_CONTRACT.md §3.1 字段硬约束表 + §5.1 自检清单；inbox v2 迁移请跑 `npm run migrate-inbox -- --apply`。"
    );
    process.exit(1);
  } catch (err) {
    console.error("lint runtime error:", err);
    process.exit(2);
  }
}

if (isMain()) main();
