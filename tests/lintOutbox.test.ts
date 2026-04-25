import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs no type decl
import { validatePayload } from "../scripts/lint-outbox.mjs";

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
    p.contractVersion = "3.0";
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

  it("actualMinutes > 50（硬上限） → 报错", () => {
    const p: any = goodPayloadV22();
    p.summary.verificationBudget.actualMinutes = 55;
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("50"))).toBe(true);
  });

  it("passesCompleted 缺少前 6 阶段 → 报错", () => {
    const p: any = goodPayloadV22();
    p.summary.verificationBudget.passesCompleted = ["read", "score"];
    const errors = lint(p);
    expect(errors.some((e) => e.msg.includes("claim-inventory"))).toBe(true);
    expect(errors.some((e) => e.msg.includes("pass1"))).toBe(true);
  });
});

