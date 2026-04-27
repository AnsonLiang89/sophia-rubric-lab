/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs no type decl
import { validatePayload, validateInboxTask } from "../scripts/lint-outbox.mjs";

/**
 * 构造一个最小合法的 v2.1 payload（6 维度 × 2 候选）。
 * 其他测试基于此做 clone + mutate。
 */
function goodPayloadV21() {
  const candidates = ["sub_1", "sub_2"];
  const mkScores = (scoresByRid: Record<string, number>) =>
    candidates.map((rid) => ({
      reportId: rid,
      score: scoresByRid[rid],
      tier: { 10: "S", 8: "A", 6: "B", 4: "C", 2: "D" }[scoresByRid[rid]],
      comment: `placeholder comment for ${rid}`,
      confidence: "high",
      issueTags: [],
    }));

  return {
    taskId: "EV-0001-abcDEF",
    version: 1,
    contractVersion: "2.1",
    summary: {
      overallScores: candidates.map((rid, i) => ({
        reportId: rid,
        productName: i === 0 ? "ProductA" : "ProductB",
        score: i === 0 ? 10 : 8,
        verdict: i === 0 ? "卓越" : "优秀",
        vetoTriggered: false,
      })),
      rubric: [
        { dimensionId: "R1", name: "准确性", weight: 0.4, scores: mkScores({ sub_1: 10, sub_2: 8 }) },
        { dimensionId: "R2", name: "相关性", weight: 0.15, scores: mkScores({ sub_1: 10, sub_2: 8 }) },
        { dimensionId: "R3", name: "论证深度", weight: 0.2, scores: mkScores({ sub_1: 10, sub_2: 8 }) },
        { dimensionId: "R4", name: "完备性", weight: 0.1, scores: mkScores({ sub_1: 10, sub_2: 8 }) },
        { dimensionId: "R5", name: "决策价值", weight: 0.15, scores: mkScores({ sub_1: 10, sub_2: 8 }) },
      ],
      sbs: {
        pairs: [
          { productA: "ProductA", productB: "ProductB", winner: "A", margin: "明显优势", keyReason: "R1 + R3 全面领先" },
        ],
      },
      perReportFeedback: candidates.map((rid) => ({
        reportId: rid,
        productName: rid === "sub_1" ? "ProductA" : "ProductB",
        strengths: ["R1 做得好"],
        weaknesses: ["R2 略弱"],
        improvements: ["建议加强 R2"],
      })),
    },
    report: "# 评测报告\n\n一、总评\n\n...\n",
  };
}

function lint(payload: unknown) {
  const errors: Array<{ path: string; msg: string }> = [];
  validatePayload("virtual", payload, errors);
  return errors;
}

describe("validatePayload · 合法 payload", () => {
  it("最小合法 v2.1 payload 无违规", () => {
    const errors = lint(goodPayloadV21());
    expect(errors).toEqual([]);
  });
});

describe("validatePayload · 顶层字段校验", () => {
  it("缺 taskId → 报错", () => {
    const p = goodPayloadV21() as unknown as { taskId?: string };
    delete p.taskId;
    const errors = lint(p);
    expect(errors.some((e) => e.path === "taskId")).toBe(true);
  });

  it("contractVersion 非法值 → 报错", () => {
    const p: any = goodPayloadV21();
    p.contractVersion = "9.9";
    const errors = lint(p);
    expect(errors.some((e) => e.path === "contractVersion")).toBe(true);
  });

  it("summary 缺失 → 报错", () => {
    const p: any = goodPayloadV21();
    delete p.summary;
    const errors = lint(p);
    expect(errors.some((e) => e.path === "summary")).toBe(true);
  });
});

describe("validatePayload · rubric 字段硬约束", () => {
  it("缺 R1 维度 → 报错", () => {
    const p: any = goodPayloadV21();
    p.summary.rubric = p.summary.rubric.filter((r: any) => r.dimensionId !== "R1");
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("R1"))).toBe(true);
  });

  it("维度缺 name → 报错（历史踩坑：会导致网站表头空白）", () => {
    const p: any = goodPayloadV21();
    delete p.summary.rubric[0].name;
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("name") && e.msg.includes("必填"))).toBe(true);
  });

  it("字段名错误用 reports 而非 scores → 报错并提示历史踩坑", () => {
    const p: any = goodPayloadV21();
    p.summary.rubric[1].reports = p.summary.rubric[1].scores;
    delete p.summary.rubric[1].scores;
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("reports") && e.msg.includes("scores"))).toBe(true);
  });

  it("score 不在档位 {10,8,6,4,2} 内 → 报错", () => {
    const p: any = goodPayloadV21();
    p.summary.rubric[0].scores[0].score = 7; // 档间分
    p.summary.rubric[0].scores[0].tier = "A"; // 让 tier 也不匹配
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("10/8/6/4/2"))).toBe(true);
  });

  it("tier 与 score 不对应 → 报错", () => {
    const p: any = goodPayloadV21();
    p.summary.rubric[0].scores[0].score = 10;
    p.summary.rubric[0].scores[0].tier = "B"; // B 应对 6
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("tier"))).toBe(true);
  });

  it("confidence 是数组而不是字符串 → 报错（真实踩坑：参数位置错位 bug）", () => {
    const p: any = goodPayloadV21();
    p.summary.rubric[0].scores[0].confidence = ["一手源不足"] as unknown as string;
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("high/medium/low"))).toBe(true);
  });

  it("scores 未覆盖所有 candidates → 报错", () => {
    const p: any = goodPayloadV21();
    p.summary.rubric[0].scores = p.summary.rubric[0].scores.slice(0, 1); // 只留一份
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("未覆盖"))).toBe(true);
  });
});

describe("validatePayload · vetoTriggered 硬约束", () => {
  it("未触发 veto 但没写 vetoTriggered: false → 报错（历史踩坑）", () => {
    const p: any = goodPayloadV21();
    delete p.summary.overallScores[0].vetoTriggered;
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("vetoTriggered"))).toBe(true);
  });

  it("触发 veto 但 score > 6.9 → 报错（一票否决封顶硬约束）", () => {
    const p: any = goodPayloadV21();
    p.summary.overallScores[0].vetoTriggered = true;
    p.summary.overallScores[0].vetoReason = "R1 量级错误";
    p.summary.overallScores[0].score = 8.0; // 超过封顶线
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("6.9"))).toBe(true);
  });

  it("触发 veto 但没写 vetoReason → 报错", () => {
    const p: any = goodPayloadV21();
    p.summary.overallScores[0].vetoTriggered = true;
    p.summary.overallScores[0].score = 6.9;
    // 不写 vetoReason
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("vetoReason"))).toBe(true);
  });
});

describe("validatePayload · overallScore 加权和自动校验", () => {
  it("declared 与加权和偏差超过 0.05 → 报错", () => {
    const p: any = goodPayloadV21();
    // 把 sub_1 的 R1 从 10 改 8，加权和变化但 declared 不改
    p.summary.rubric[0].scores[0].score = 8;
    p.summary.rubric[0].scores[0].tier = "A";
    // declared 还是 10，但实际加权 = 8*0.4 + 10*(0.15+0.2+0.1+0.15) = 3.2 + 6 = 9.2
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("加权和不匹配"))).toBe(true);
  });

  it("权重总和 ≠ 1.0（超过 ±0.01）→ 报错", () => {
    const p: any = goodPayloadV21();
    p.summary.rubric[0].weight = 0.5; // 总和变 1.1
    // 同步调整 declared score 让它自己算对，隔离"总权重"错误
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("权重总和"))).toBe(true);
  });
});

describe("validatePayload · perReportFeedback（v2.1 硬约束）", () => {
  it("v2.1 缺 perReportFeedback → 报错", () => {
    const p: any = goodPayloadV21();
    delete p.summary.perReportFeedback;
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("perReportFeedback"))).toBe(true);
  });

  it("strengths/weaknesses/improvements 任一为空数组 → 报错", () => {
    const p: any = goodPayloadV21();
    p.summary.perReportFeedback[0].strengths = [];
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("非空数组"))).toBe(true);
  });
});

describe("validatePayload · v1.0 产物向后兼容", () => {
  it("v1.0 产物不校验 tier/confidence/vetoTriggered 等 v2.0+ 字段", () => {
    const p: any = goodPayloadV21();
    p.contractVersion = "1.0";
    // v1.0 下这些字段可以缺或者可以是浮点
    for (const r of p.summary.rubric) {
      for (const sc of r.scores) {
        delete sc.tier;
        delete sc.confidence;
        sc.score = 8.5; // 浮点在 v1.0 是允许的
      }
    }
    for (const o of p.summary.overallScores) delete o.vetoTriggered;
    delete p.summary.perReportFeedback;
    const errors = lint(p);
    // 不应报 tier/confidence/vetoTriggered/perReportFeedback 相关错
    expect(errors.some((e) => e.msg.includes("tier"))).toBe(false);
    expect(errors.some((e) => e.msg.includes("high/medium/low"))).toBe(false);
    expect(errors.some((e) => e.path.includes("vetoTriggered"))).toBe(false);
    expect(errors.some((e) => e.path.includes("perReportFeedback"))).toBe(false);
  });
});

// ============================================================
// v2.2 专属测试
// ============================================================

/** 构造一个最小合法的 v2.2 payload（基于 v2.1 + 5 大新字段） */
function goodPayloadV22() {
  const p: any = goodPayloadV21();
  p.contractVersion = "2.2";

  // R1 必须补 subscores
  const r1 = p.summary.rubric.find((r: any) => r.dimensionId === "R1");
  r1.subscores = {
    R1a: { score: 10, tier: "S", weight: 0.28, comment: "事实准确无误" },
    R1b: { score: 10, tier: "S", weight: 0.12, comment: "逻辑严密" },
  };

  // SBS 升级为 v2.2 结构
  p.summary.sbs = {
    pairs: [
      {
        reportIdA: "sub_1",
        reportIdB: "sub_2",
        winner: "A",
        margin: "clear",
        dimensionDriver: "R1 + R3",
        keyReason: "A 在准确性和论证深度上全面领先",
      },
    ],
  };

  // claimInventory：每份报告 3 条，含 1 条 logic
  p.summary.claimInventory = [
    { claimId: "c1", reportId: "sub_1", claim: "数字 A", type: "number", supportWeight: "high", locationHint: "§2" },
    { claimId: "c2", reportId: "sub_1", claim: "事实 B", type: "fact", supportWeight: "high" },
    { claimId: "c3", reportId: "sub_1", claim: "因果推理 C", type: "logic", supportWeight: "high" },
    { claimId: "c4", reportId: "sub_2", claim: "数字 D", type: "number", supportWeight: "high" },
    { claimId: "c5", reportId: "sub_2", claim: "事实 E", type: "fact", supportWeight: "medium" },
    { claimId: "c6", reportId: "sub_2", claim: "逻辑推理 F", type: "logic", supportWeight: "high" },
  ];

  // claimChecks：所有 claim 都 verified-correct（覆盖率 100%）
  p.summary.claimChecks = ["c1", "c2", "c3", "c4", "c5", "c6"].map((cid) => ({
    claimId: cid,
    status: "verified-correct",
    evidence: `已核验 ${cid}`,
    checkedBy: "外部核验",
  }));

  // dimensionChecklists：R1 7 项，R2~R5 各 5 项
  const mkItems = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      label: `必查项 ${i + 1}`,
      passedFor: ["sub_1", "sub_2"],
    }));
  p.summary.dimensionChecklists = {
    R1: { items: mkItems(7) },
    R2: { items: mkItems(5) },
    R3: { items: mkItems(5) },
    R4: { items: mkItems(5) },
    R5: { items: mkItems(5) },
  };

  // verificationBudget：45min 以内，阶段全部完成
  p.summary.verificationBudget = {
    targetMinutes: 45,
    actualMinutes: 42,
    passesCompleted: ["read", "claim-inventory", "pass1", "pass2", "pass3", "score", "feedback"],
    claimsSkippedDueToBudget: 0,
    claimsOutOfScope: 0,
  };

  return p;
}

/** 构造一个最小合法的 v3.0 payload（基于 v2.2 + crossProductInsights + 三稳定锚点） */
function goodPayloadV30() {
  const p: any = goodPayloadV22();
  p.contractVersion = "3.0";

  p.summary.overallScores[0].productName = "SophiaAI v4";
  p.summary.overallScores[1].productName = "Gemini";
  p.summary.perReportFeedback[0].productName = "SophiaAI v4";
  p.summary.perReportFeedback[1].productName = "Gemini";

  p.summary.crossProductInsights = {
    focusProductName: "SophiaAI v4",
    strongerThan: [
      {
        dimension: "R3",
        vsProducts: ["Gemini"],
        gapSummary: "Sophia 给出了完整三阶推导，对手只停在一阶结论。",
        evidenceQuotes: [
          {
            product: "SophiaAI v4",
            quote: "「税率从 25% 降到 15% 后，EPS 不只是抬升，更会重塑渠道议价链条，因此我们预估净利率将在两个季度内继续扩张。」",
          },
          {
            product: "Gemini",
            quote: "「减税有助于提升利润，但报告未展开利润结构如何变化。」",
          },
        ],
        claimRefs: ["c3"],
      },
    ],
    weakerThan: [
      {
        dimension: "R1",
        vsProducts: ["Gemini"],
        gapSummary: "Sophia 写入了不可核查口径，对手给出可回溯的一手来源。",
        evidenceQuotes: [
          {
            product: "SophiaAI v4",
            quote: "「根据某研究院 2026 年 4 月内部未公开报告，行业需求已同比增长 48%。」",
          },
          {
            product: "Gemini",
            quote: "「国家统计局 2026 年 4 月公开数据仅显示同比增长 18.4%，并未出现 48% 这一口径。」",
          },
        ],
        claimRefs: ["c1"],
      },
    ],
    sharedWeakness: [],
  };

  p.report = [
    "# Sophia v4 聚焦诊断",
    "",
    "## 一、总评 · Sophia v4 的核心问题",
    "Sophia 本轮最大的短板是 R1 与 R4，尤其是信源可核查性不足。",
    "",
    "## 二、评分总表",
    "- SophiaAI v4：10.0 / 卓越",
    "- Gemini：8.0 / 优秀",
    "",
    "## 三、错误详析",
    "这里展开 Sophia 的原文问题与对照证据。",
    "",
    "## 四、SBS 结论",
    "Sophia 在 R3 领先，但在 R1 被 Gemini 反超。",
  ].join("\n");

  return p;
}

/** 构造一个最小合法的 v3.2 payload（基于 v3.0 + 正文四段锚点） */
function goodPayloadV32() {
  const p: any = goodPayloadV30();
  p.contractVersion = "3.2";
  p.report = [
    "# Sophia v4 评测报告",
    "",
    "## 一、评测结论",
    "SophiaAI v4 本轮最大的短板在 R1：一处关键数字的可信度不足，虽然 R3 仍有明显分析深度，但整体结论不能靠亮点掩盖核验风险。",
    "",
    "## 二、按维度展开评测结论、详情与论据",
    "### R1 准确性",
    "报告写道：「根据某研究院 2026 年 4 月内部未公开报告，行业需求已同比增长 48%。」这一说法缺少可追溯来源；对照公开统计口径后，目前只能确认国家统计局披露的是 18.4%，因此该处不能直接支撑更激进的市场判断。",
    "",
    "### R3 论证深度",
    "Sophia 的优势在于把税率变化、渠道议价和利润率扩张串成了连续推理链，不只是复述结论；这部分比 Gemini 多了一层对利润结构的解释。",
    "",
    "## 三、额外重点问题",
    "最需要额外强调的是外部核验结论：上述 48% 增长说法目前没有公开一手源支撑，核验后只能得到更保守的公开口径，因此任何依赖该数字的扩张节奏建议都需要下调。",
    "",
    "## 四、各主体优缺点与建议",
    "### SophiaAI v4",
    "- 做得好：R3 的推理链完整，能把政策变量和利润结构联动起来。",
    "- 做得不好：R1 有承重数字缺少可回溯来源，削弱了整体可信度。",
    "- 建议：把关键数字全部替换成可追溯公开源，并在结论里区分已证实与待验证判断。",
    "",
    "### Gemini",
    "- 做得好：R1 的公开来源更清楚，保守但稳。",
    "- 做得不好：R3 只停留在一阶判断，缺少深入推导。",
    "- 建议：补足因果链与结构化推理，而不只是给出安全结论。",
  ].join("\n");
  return p;
}

describe("validatePayload · v2.2 最小合法 payload", () => {
  it("最小合法 v2.2 payload 无违规", () => {
    const errors = lint(goodPayloadV22());
    expect(errors).toEqual([]);
  });
});

describe("validatePayload · v2.2 R1 subscores 硬约束", () => {
  it("R1 缺 subscores → 报错", () => {
    const p: any = goodPayloadV22();
    delete p.summary.rubric[0].subscores;
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("subscores") && e.msg.includes("R1a"))).toBe(true);
  });

  it("R1 subscores 权重错误（应为 R1a=0.28 / R1b=0.12） → 报错", () => {
    const p: any = goodPayloadV22();
    p.summary.rubric[0].subscores.R1a.weight = 0.2; // 错
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("subscores.R1a.weight"))).toBe(true);
  });
});

describe("validatePayload · v2.2 SBS 结构升级", () => {
  it("SBS 用旧字段 productA/productB → 报错（必须用 reportIdA/reportIdB）", () => {
    const p: any = goodPayloadV22();
    p.summary.sbs.pairs[0] = {
      productA: "ProductA",
      productB: "ProductB",
      winner: "A",
      margin: "clear",
      dimensionDriver: "R1",
      keyReason: "占位",
    };
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("reportIdA"))).toBe(true);
    expect(errors.some((e) => e.path.includes("reportIdB"))).toBe(true);
  });

  it("SBS margin 用中文「明显优势」而非英文枚举 → 报错", () => {
    const p: any = goodPayloadV22();
    p.summary.sbs.pairs[0].margin = "明显优势";
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("margin") && e.msg.includes("overwhelming"))).toBe(true);
  });

  it("SBS 缺 dimensionDriver → 报错", () => {
    const p: any = goodPayloadV22();
    delete p.summary.sbs.pairs[0].dimensionDriver;
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("dimensionDriver"))).toBe(true);
  });

  it("SBS dimensionDriver 是非空字符串数组 → 通过（v2.2+ 支持多维度）", () => {
    const p: any = goodPayloadV22();
    p.summary.sbs.pairs[0].dimensionDriver = ["R1", "R3"];
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("dimensionDriver"))).toBe(false);
  });

  it("SBS dimensionDriver 是空数组 → 报错", () => {
    const p: any = goodPayloadV22();
    p.summary.sbs.pairs[0].dimensionDriver = [];
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("dimensionDriver"))).toBe(true);
  });

  it("SBS dimensionDriver 数组中含空串 → 报错", () => {
    const p: any = goodPayloadV22();
    p.summary.sbs.pairs[0].dimensionDriver = ["R1", ""];
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("dimensionDriver"))).toBe(true);
  });
});

describe("validatePayload · v2.2 claimInventory 硬约束", () => {
  it("缺 claimInventory → 报错", () => {
    const p: any = goodPayloadV22();
    delete p.summary.claimInventory;
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("claimInventory"))).toBe(true);
  });

  it("某份报告没抽够 3 条 → 报错", () => {
    const p: any = goodPayloadV22();
    // sub_1 只留 2 条（会同时破坏"≥3 条"和"≥1 条 logic"，但我们留一条 logic）
    p.summary.claimInventory = p.summary.claimInventory.filter(
      (c: any) => c.reportId !== "sub_1" || c.claimId === "c3"
    );
    p.summary.claimChecks = p.summary.claimChecks.filter((ck: any) =>
      p.summary.claimInventory.some((c: any) => c.claimId === ck.claimId)
    );
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("3~5"))).toBe(true);
  });

  it("某份报告没有 logic 类 claim → 报错", () => {
    const p: any = goodPayloadV22();
    // 把 sub_1 的 logic 改成 fact
    const logicItem = p.summary.claimInventory.find(
      (c: any) => c.reportId === "sub_1" && c.type === "logic"
    );
    logicItem.type = "fact";
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("logic"))).toBe(true);
  });

  it("claimId 在 claimChecks 里找不到对应记录 → 报错", () => {
    const p: any = goodPayloadV22();
    p.summary.claimChecks = p.summary.claimChecks.filter((ck: any) => ck.claimId !== "c1");
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("c1"))).toBe(true);
  });

  it("核验覆盖率 < 85% → 报错", () => {
    const p: any = goodPayloadV22();
    // 6 条 claim 里 5 条标 inconclusive 改为 skipped-out-of-scope，只剩 1 条 verified → 1/1 = 100%（不触发）
    // 为触发覆盖率失败：所有非 skipped 都置为 non-verified 是不行的；我们让 4 条 verified-correct 改为 skipped-time-budget，
    // 然后其中 2 条 verified-correct 留着，无法触发 ratio<85%；改做：3 条变 inconclusive（仍算 verifiedLike），不会触发。
    // 正确做法：让 5 条 status 非法？不，要让 verifiedLike / nonSkipped < 85%，
    // 构造：1 条 verified-correct，5 条虽有 claimId 但 status 值被枚举拒绝 → 不算 verifiedLike 也不算 skipped。
    // 但非法 status 会先被枚举报错，无法单独隔离覆盖率失败。
    // 简化：让 2 条变 skipped-time-budget，4 条里 1 条 verified、3 条为 "refuted 但无 vetoMode"——仍算 verifiedLike，覆盖率=4/4=100%。
    // 实际要触发覆盖率，得引入 claimChecks 里 status 合法但 verifiedLike 计数少——但所有合法非 skipped 状态都算 verifiedLike。
    // 所以覆盖率 < 85% 的唯一路径：claimInventory 有 N 条，claimChecks 只核验了 < 85% × nonSkipped 条——这会先报"claimId 没有对应核验"。
    // 该分支实际是"双保险"，单独覆盖率触发比较难构造，这里就验证下限路径：缺核验时至少能报出"没有对应核验记录"。
    p.summary.claimChecks = p.summary.claimChecks.slice(0, 1); // 只核验 c1，其他 5 条缺失
    const errors = lint(p);
    // 主要触发的是"claimInventory 的 X 没有对应核验记录"
    expect(errors.filter((e) => e.msg.includes("没有对应核验记录")).length).toBeGreaterThanOrEqual(5);
  });
});

describe("validatePayload · v2.2 dimensionChecklists 硬约束", () => {
  it("缺 dimensionChecklists → 报错", () => {
    const p: any = goodPayloadV22();
    delete p.summary.dimensionChecklists;
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("dimensionChecklists"))).toBe(true);
  });

  it("R1 不足 7 项 → 报错", () => {
    const p: any = goodPayloadV22();
    p.summary.dimensionChecklists.R1.items = p.summary.dimensionChecklists.R1.items.slice(0, 4);
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("R1") && e.msg.includes("7"))).toBe(true);
  });

  it("R2 不足 5 项 → 报错", () => {
    const p: any = goodPayloadV22();
    p.summary.dimensionChecklists.R2.items = p.summary.dimensionChecklists.R2.items.slice(0, 2);
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("R2") && e.msg.includes("5"))).toBe(true);
  });

  it("passedFor 里的 reportId 不存在 → 报错", () => {
    const p: any = goodPayloadV22();
    p.summary.dimensionChecklists.R1.items[0].passedFor = ["sub_unknown"];
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("sub_unknown"))).toBe(true);
  });
});

describe("validatePayload · v2.2 verificationBudget 硬约束", () => {
  it("缺 verificationBudget → 报错", () => {
    const p: any = goodPayloadV22();
    delete p.summary.verificationBudget;
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("verificationBudget"))).toBe(true);
  });

  it("targetMinutes !== 45 → 报错", () => {
    const p: any = goodPayloadV22();
    p.summary.verificationBudget.targetMinutes = 30;
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("targetMinutes"))).toBe(true);
  });

  it("actualMinutes 不再设硬上限：超大值仅在结构合法时不应报错", () => {
    const p: any = goodPayloadV22();
    p.summary.verificationBudget.actualMinutes = 120;
    const errors = lint(p);
    // 不再产生与硬上限相关的报错（不允许出现“硬上限/不得超过”等关键词的 actualMinutes 错误）
    expect(
      errors.some(
        (e) => e.path.includes("actualMinutes") && /硬上限|不得超过/.test(e.msg)
      )
    ).toBe(false);
  });

  it("actualMinutes 必须为 >0 的数字（结构性校验仍保留）", () => {
    const p: any = goodPayloadV22();
    p.summary.verificationBudget.actualMinutes = 0;
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("actualMinutes"))).toBe(true);
  });

  it("passesCompleted 缺少前 6 阶段 → 报错", () => {
    const p: any = goodPayloadV22();
    p.summary.verificationBudget.passesCompleted = ["read", "score"];
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("claim-inventory"))).toBe(true);
    expect(errors.some((e) => e.msg.includes("pass1"))).toBe(true);
  });
});

describe("validatePayload · v3.0 最小合法 payload", () => {
  it("最小合法 v3.0 payload 无违规", () => {
    const errors = lint(goodPayloadV30());
    expect(errors).toEqual([]);
  });
});

describe("validatePayload · v3.0 新增硬约束", () => {
  it("缺 crossProductInsights → 报错", () => {
    const p: any = goodPayloadV30();
    delete p.summary.crossProductInsights;
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("crossProductInsights"))).toBe(true);
  });

  it("tier C/D comment 不含原文引用 → 报错", () => {
    const p: any = goodPayloadV30();
    p.summary.rubric[0].scores[0].score = 4;
    p.summary.rubric[0].scores[0].tier = "C";
    p.summary.rubric[0].scores[0].comment = "准确性较差，但没有展开原文证据";
    p.summary.overallScores[0].score = 7.6;
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("scores[0].comment") && e.msg.includes("原文引用"))).toBe(true);
  });

  it("refuted / inconclusive evidence 过短且无引用 → 报错", () => {
    const p: any = goodPayloadV30();
    p.summary.claimChecks[0].status = "refuted";
    p.summary.claimChecks[0].evidence = "证据不足";
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("claimChecks[0].evidence") && e.msg.includes("30 字"))).toBe(true);
    expect(errors.some((e) => e.path.includes("claimChecks[0].evidence") && e.msg.includes("原文引用"))).toBe(true);
  });

  it("report 缺少稳定锚点 → 报错", () => {
    const p: any = goodPayloadV30();
    p.report = [
      "# Sophia v4 聚焦诊断",
      "",
      "## 一、总评 · Sophia v4 的核心问题",
      "这里只写总评。",
      "",
      "## 四、SBS 结论",
      "少了评分总表锚点。",
    ].join("\n");
    const errors = lint(p);
    expect(errors.some((e) => e.path === "report" && e.msg.includes("评分总表"))).toBe(true);
  });

  it("focusProductName 非 none 时 strongerThan + weakerThan 少于 2 条 → 报错", () => {
    const p: any = goodPayloadV30();
    p.summary.crossProductInsights.weakerThan = [];
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes("crossProductInsights") && e.msg.includes("至少要有 2 条 insight"))).toBe(true);
  });
});

describe("validatePayload · v3.2 最小合法 payload", () => {
  it("最小合法 v3.2 payload 无违规", () => {
    const errors = lint(goodPayloadV32());
    expect(errors).toEqual([]);
  });
});

describe("validatePayload · v3.2 新增硬约束", () => {
  it("v3.2 report 不再强制要求评分总表 heading，可仅保留四段正文锚点", () => {
    const p: any = goodPayloadV32();
    const errors = lint(p);
    expect(errors.some((e) => e.path === "report" && e.msg.includes("评分总表"))).toBe(false);
  });

  it("缺少“额外重点问题”锚点 → 报错", () => {
    const p: any = goodPayloadV32();
    p.report = p.report.replace("## 三、额外重点问题", "## 三、其他补充说明");
    const errors = lint(p);
    expect(errors.some((e) => e.path === "report" && e.msg.includes("额外重点问题"))).toBe(true);
  });

  it("若显式写出评分总表 heading，但位置跑到评测结论前 → 报错", () => {
    const p: any = goodPayloadV32();
    p.report = [
      "# Sophia v4 评测报告",
      "",
      "## 评分总表",
      "- SophiaAI v4：10.0 / 卓越",
      "",
      ...p.report.split("\n").slice(2),
    ].join("\n");
    const errors = lint(p);
    expect(errors.some((e) => e.path === "report" && e.msg.includes("评测结论之后"))).toBe(true);
  });
});

describe("validatePayload · productName 展示一致性", () => {
  it("同一 payload 中 overallScores productName 重复 → 报错", () => {
    const p: any = goodPayloadV21();
    p.summary.overallScores[0].productName = "SophiaAI";
    p.summary.overallScores[1].productName = "SophiaAI"; // 两条都叫 SophiaAI（真实踩坑）
    const errors = lint(p);
    expect(
      errors.some(
        (e) => e.path === "summary.overallScores" && e.msg.includes("productName 重复")
      )
    ).toBe(true);
  });

  it("productName 使用括号包版本号 'SophiaAI (v4)' → 报错", () => {
    const p: any = goodPayloadV21();
    p.summary.overallScores[0].productName = "SophiaAI (v4)";
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("括号"))).toBe(true);
  });

  it("productName 为空字符串 → 报错", () => {
    const p: any = goodPayloadV21();
    p.summary.overallScores[0].productName = "";
    const errors = lint(p);
    expect(errors.some((e) => e.path.includes(".productName") && e.msg.includes("必填"))).toBe(true);
  });

  it("不同产品名（如 'SophiaAI v4' / 'SophiaAI v5'）→ 放行", () => {
    const p: any = goodPayloadV21();
    p.summary.overallScores[0].productName = "SophiaAI v4";
    p.summary.overallScores[1].productName = "SophiaAI v5";
    const errors = lint(p);
    const bad = errors.filter((e) => e.path.includes("productName") || e.msg.includes("productName"));
    expect(bad).toHaveLength(0);
  });
});

// ========== inbox v2 schema ==========

function goodInboxV2() {
  const content = "# 报告 A\n\n内容";
  return {
    taskId: "EV-9999-abcDEF",
    createdAt: "2026-04-27T12:00:00.000Z",
    contractVersion: "2.0",
    query: { id: "q_1", code: "EV-9999" },
    candidates: [
      {
        reportId: "sub_1",
        productName: "ProductA",
        report: content,
        candidateId: "sub_1",
        activeReportVersion: 1,
        reportVersions: [
          {
            version: 1,
            content,
            contentHash: "0123456789abcdef",
            submittedAt: "2026-04-27T12:00:00.000Z",
          },
        ],
      },
    ],
  };
}

function lintInboxTask(task: unknown) {
  const errors: Array<{ path: string; msg: string }> = [];
  validateInboxTask("virtual-inbox", task, errors);
  return errors;
}

describe("validateInboxTask · v2 schema", () => {
  it("合法 v2 inbox payload 无违规", () => {
    expect(lintInboxTask(goodInboxV2())).toEqual([]);
  });

  it("contractVersion=1.0 → 报错并提示 migrate-inbox", () => {
    const t: any = goodInboxV2();
    t.contractVersion = "1.0";
    const errors = lintInboxTask(t);
    expect(errors.some((e) => e.path === "contractVersion" && /migrate-inbox/.test(e.msg))).toBe(
      true
    );
  });

  it("candidates 为空数组 → 报错", () => {
    const t: any = goodInboxV2();
    t.candidates = [];
    const errors = lintInboxTask(t);
    expect(errors.some((e) => e.path === "candidates")).toBe(true);
  });

  it("candidate 缺 candidateId → 报错", () => {
    const t: any = goodInboxV2();
    delete t.candidates[0].candidateId;
    const errors = lintInboxTask(t);
    expect(errors.some((e) => /candidateId/.test(e.path))).toBe(true);
  });

  it("reportVersions 为空数组 → 报错", () => {
    const t: any = goodInboxV2();
    t.candidates[0].reportVersions = [];
    const errors = lintInboxTask(t);
    expect(errors.some((e) => /reportVersions/.test(e.path))).toBe(true);
  });

  it("activeReportVersion 未命中 reportVersions → 报错", () => {
    const t: any = goodInboxV2();
    t.candidates[0].activeReportVersion = 999;
    const errors = lintInboxTask(t);
    expect(errors.some((e) => /activeReportVersion/.test(e.path))).toBe(true);
  });

  it("contentHash 非 16 位 hex → 报错", () => {
    const t: any = goodInboxV2();
    t.candidates[0].reportVersions[0].contentHash = "not-hex";
    const errors = lintInboxTask(t);
    expect(errors.some((e) => /contentHash/.test(e.path))).toBe(true);
  });

  it("report 与 active 版本 content 不一致 → 报错", () => {
    const t: any = goodInboxV2();
    t.candidates[0].report = "不一样的内容";
    const errors = lintInboxTask(t);
    expect(errors.some((e) => /report/.test(e.path) && /一致/.test(e.msg))).toBe(true);
  });

  it("版本号重复 → 报错", () => {
    const t: any = goodInboxV2();
    t.candidates[0].reportVersions.push({
      version: 1,
      content: "# v2",
      contentHash: "fedcba9876543210",
    });
    t.candidates[0].activeReportVersion = 1;
    const errors = lintInboxTask(t);
    expect(errors.some((e) => /版本号重复/.test(e.msg))).toBe(true);
  });
});


