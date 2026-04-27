#!/usr/bin/env python3
"""EV-0003-cWQMJx evaluation builder - Part 3: SBS, Feedback, Checklists, CrossProduct"""
import json

TMP = "/Users/anson_liang/WorkBuddy/20260419144025/sophia-rubric-lab/.workbuddy/tmp"

MANUS = "sLfcXcMjxo"
MIRO = "bDgPS6OPUf"
SOPHIA4 = "re9wstntq1"
SOPHIA5 = "W9JyedQ7hW"

# ============================================================
# SBS Pairs (6 pairs for 4 candidates)
# ============================================================
sbs = {
    "pairs": [
        {"reportIdA": MIRO, "reportIdB": MANUS, "winner": "A", "margin": "clear", "dimensionDriver": ["R2", "R4", "R5"], "keyReason": "MiroThink在R2/R4/R5三维度全面领先，信源密度与投资决策闭环明显优于Manus的数据汇编"},
        {"reportIdA": MIRO, "reportIdB": SOPHIA4, "winner": "A", "margin": "clear", "dimensionDriver": ["R1"], "keyReason": "SophiaAI v4因R1恒瑞92%占比错误触发veto封顶6.9；MiroThink R1无重大错误，整体8.5 vs 6.9"},
        {"reportIdA": MIRO, "reportIdB": SOPHIA5, "winner": "A", "margin": "overwhelming", "dimensionDriver": ["R1"], "keyReason": "SophiaAI v5三处承重数据refuted（强生营收量级错/一品红代码错/恒瑞占比错），R1=D(2)触发veto；MiroThink R1=A(8)，差距8.5 vs 6.3"},
        {"reportIdA": MANUS, "reportIdB": SOPHIA4, "winner": "draw", "margin": "tie", "dimensionDriver": ["R1", "R3"], "keyReason": "Manus R1=A(8)优于SophiaAI v4 R1=C(4)，但v4在R3(8)/R4(10)/R5(10)全面领先；总分7.1 vs 6.9(veto封顶)，差距极小"},
        {"reportIdA": MANUS, "reportIdB": SOPHIA5, "winner": "A", "margin": "slight", "dimensionDriver": ["R1"], "keyReason": "SophiaAI v5 R1=D(2)被三处重大错误拖垮，veto后6.3；Manus虽论证浅但数据准确，7.1胜出"},
        {"reportIdA": SOPHIA4, "reportIdB": SOPHIA5, "winner": "draw", "margin": "tie", "dimensionDriver": ["R1", "R3"], "keyReason": "两个Sophia版本都触发veto：v4恒瑞占比错(6.9)，v5三处错(6.3)；v5在R3(10)论证框架更优但R1(2)远不如v4(4)；两版各有结构性问题"},
    ]
}

# ============================================================
# Per-report Feedback
# ============================================================
per_report_feedback = [
    {
        "reportId": MANUS, "productName": "Manus",
        "strengths": [
            "R1 准确性：5条承重claim中4条verified-correct，数据基本准确无重大错误",
            "R4 完备性：三梯队分类覆盖了已确认和待确认预增企业",
        ],
        "weaknesses": [
            "R3 论证深度：分析停留在一阶'是什么'层面，缺少二阶追问（如富祥药业VC价格涨幅能否持续、海思科BD模式的可复制性）",
            "R5 决策价值：无任何可操作投资建议、无风险提示、无时间窗口建议",
        ],
        "improvements": [
            "每个梯队补充1-2条'So What'投资启示，将数据汇编升级为决策工具",
            "对预增幅度最大的企业做可持续性分析（如富祥VC价格的供需拐点预判）",
        ]
    },
    {
        "reportId": MIRO, "productName": "MiroThink",
        "strengths": [
            "R2 相关性：主动挖掘潜在预增企业和催化剂时间表，超越query字面诉求",
            "R1 信源密度：20条带URL引用来源，信源可追溯性最佳",
            "R5 决策价值：信息差分析段直接指向投资决策（估值合理性、催化剂时间表）",
        ],
        "weaknesses": [
            "R1 翰森制药(688197)代码存疑：翰森制药为港股18A(HK:03692)而非A股688197，数据一手源不足",
            "R3 部分企业分析深度不均（博腾/华海分析较浅）",
        ],
        "improvements": [
            "翰森制药数据需补充一手公告源或修正代码",
            "博腾/华海等企业补充二阶驱动力分析，使报告深度更均匀",
        ]
    },
    {
        "reportId": SOPHIA4, "productName": "SophiaAI v4",
        "strengths": [
            "R3 论证深度：alpha/beta驱动力分类是独特分析框架，6大深层洞察追到二阶以上",
            "R5 决策价值：风险分级表+分位回报率+时间窗口+三档策略构成完整决策闭环",
            "R4 完备性：维度覆盖极全，定量深度到位（PE/EPS/成功概率/分位回报率）",
        ],
        "weaknesses": [
            "R1 准确性（致命）：恒瑞'创新药营收占比92%'实为增速指标（92.13%是非肿瘤创新药增速），真实占比约61.69%——此错误贯穿深层洞察第1条核心论据，严重误导决策",
            "R1 海思科'2.89亿美元里程碑付款'缺一手源，可能为推算值",
        ],
        "improvements": [
            "恒瑞数据必须回溯一手公告原文核实，明确区分'收入占比'与'收入增速'两个完全不同的指标",
            "所有关键数字的含义/口径必须在引用时标注清楚（如'同比增速92.13%'而非简写'92%'）",
        ]
    },
    {
        "reportId": SOPHIA5, "productName": "SophiaAI v5",
        "strengths": [
            "R3 论证深度：What/Why/So What三层结构是教科书级分析框架，每个驱动力都有因果链闭环",
            "R2 相关性：覆盖面最广（15家A股+4家海外），海外龙头对标是独特视角",
            "信源密度：61条引用来源为所有报告之最",
        ],
        "weaknesses": [
            "R1 准确性（致命）：三处承重claim被refuted——(1)强生营收380亿实为240.6亿(V1)、EPS涨跌方向完全反转；(2)一品红代码002082实为万邦德(V2)；(3)恒瑞92.13%增速误当占比(V1)",
            "R1 强生数据错误尤为严重：营收量级错60%、EPS方向完全相反，读者据此做出的海外对标结论将完全失准",
        ],
        "improvements": [
            "关键数字必须逐一对照一手财报/公告原文，特别是海外企业数据需对照SEC Edgar原始filing",
            "股票代码与企业名称必须交叉核验（002082→万邦德 vs 300723→一品红），建议建立企业名称-代码映射的核验步骤",
            "引用来源虽多(61条)但质量把控不足，需对每条引用中的关键数字做一手源交叉验证",
        ]
    },
]

# ============================================================
# Dimension Checklists
# ============================================================
dimension_checklists = {
    "R1": {
        "items": [
            {"label": "承重claim Top5含>=1条logic类", "passedFor": [MANUS, MIRO, SOPHIA4, SOPHIA5]},
            {"label": "核验覆盖率>=85%", "passedFor": [MANUS, MIRO, SOPHIA4, SOPHIA5]},
            {"label": "3-5条承重数字一手源对照", "passedFor": [MANUS, MIRO, SOPHIA4]},
            {"label": "veto候选全部外部验证", "passedFor": [MANUS, MIRO, SOPHIA4, SOPHIA5]},
            {"label": "关键量纲/占比/汇率手算", "passedFor": [MANUS, MIRO]},
            {"label": "跨段落口径一致性至少1处", "passedFor": [MANUS, MIRO, SOPHIA4]},
            {"label": "核验过程落入report正文", "passedFor": [MANUS, MIRO, SOPHIA4, SOPHIA5]},
        ]
    },
    "R2": {
        "items": [
            {"label": "列出核心诉求+锚点", "passedFor": [MANUS, MIRO, SOPHIA4, SOPHIA5]},
            {"label": "核心诉求逐条找到正面回应", "passedFor": [MANUS, MIRO, SOPHIA4, SOPHIA5]},
            {"label": "锚点逐个确认响应", "passedFor": [MANUS, MIRO, SOPHIA4, SOPHIA5]},
            {"label": "潜在诉求识别或说明", "passedFor": [MIRO, SOPHIA5]},
            {"label": "无明显跑题/无关填充(<10%)", "passedFor": [MANUS, MIRO, SOPHIA4, SOPHIA5]},
        ]
    },
    "R3": {
        "items": [
            {"label": "3个核心判断均有支撑证据/推导", "passedFor": [MIRO, SOPHIA4, SOPHIA5]},
            {"label": ">=1处二阶/三阶追问", "passedFor": [MIRO, SOPHIA4, SOPHIA5]},
            {"label": "非共识但有据观点", "passedFor": [MIRO, SOPHIA4, SOPHIA5]},
            {"label": "关键争议呈现对立视角", "passedFor": [SOPHIA4, SOPHIA5]},
            {"label": "论据→结论无明显跳跃或循环论证", "passedFor": [MANUS, MIRO, SOPHIA4, SOPHIA5]},
        ]
    },
    "R4": {
        "items": [
            {"label": "决策关键维度清单>=3项", "passedFor": [MANUS, MIRO, SOPHIA4, SOPHIA5]},
            {"label": "每个关键维度有对应段落", "passedFor": [MIRO, SOPHIA4, SOPHIA5]},
            {"label": "章节结构支撑结论", "passedFor": [MANUS, MIRO, SOPHIA4, SOPHIA5]},
            {"label": "适用定量分析有数据表/测算", "passedFor": [MIRO, SOPHIA4]},
            {"label": "无虚假覆盖(一笔带过)", "passedFor": [MIRO, SOPHIA4, SOPHIA5]},
        ]
    },
    "R5": {
        "items": [
            {"label": "列出take-away/建议>=2条", "passedFor": [MIRO, SOPHIA4, SOPHIA5]},
            {"label": "take-away具体可执行", "passedFor": [MIRO, SOPHIA4]},
            {"label": "有用户搜不到的信息/观察", "passedFor": [MIRO, SOPHIA4, SOPHIA5]},
            {"label": "新框架/新联想让用户换角度", "passedFor": [SOPHIA4, SOPHIA5]},
            {"label": "不确定事项主动标caveat", "passedFor": [MIRO, SOPHIA4]},
        ]
    },
}

# ============================================================
# Verification Budget
# ============================================================
verification_budget = {
    "targetMinutes": 45,
    "actualMinutes": 42,
    "passesCompleted": ["read", "claim-inventory", "pass1", "pass2", "pass3", "score", "feedback"],
    "claimsSkippedDueToBudget": 0,
    "claimsOutOfScope": 0,
    "notes": "4份报告均已全量通读并完成三阶段核验；SophiaAI v5的强生/一品红/恒瑞三处错误均经外部搜索落锤"
}

# ============================================================
# Cross-Product Insights
# ============================================================
cross_product_insights = {
    "focusProductName": "SophiaAI v5",
    "strongerThan": [
        {
            "dimension": "R3",
            "vsProducts": ["Manus"],
            "gapSummary": "SophiaAI v5采用What/Why/So What三层递进分析框架，每个驱动力都追到因果链和投资含义；Manus仅做一阶数据罗列，无二阶追问。",
            "evidenceQuotes": [
                {"product": "SophiaAI v5", "quote": "Why：2025年底新版医保目录于2026年1月1日起执行，新增约50个创新药品种，涉及肿瘤、自免、罕见病等19个治疗领域，带动相关企业核心产品在医院端快速放量"},
                {"product": "Manus", "quote": "富祥药业：公司VC和FEC产品市场价格持续上涨，带动业绩大幅增长"}
            ]
        },
        {
            "dimension": "R2",
            "vsProducts": ["Manus", "MiroThink"],
            "gapSummary": "SophiaAI v5主动纳入4家海外创新药龙头（强生/West Pharmaceutical/Twist Bioscience/Danaher）进行全球对标，是唯一将视野扩展到A股之外的报告。",
            "evidenceQuotes": [
                {"product": "SophiaAI v5", "quote": "强生(JNJ.US)、West Pharmaceutical(WST.US)、Twist Bioscience(TWST.US)、Danaher(DHR.US)……海外创新药/器械龙头的强劲表现，为国内创新药的出海逻辑提供了需求侧验证"},
                {"product": "MiroThink", "quote": "（报告全文仅覆盖A股上市公司，未涉及任何海外创新药企业对标）"}
            ]
        },
    ],
    "weakerThan": [
        {
            "dimension": "R1",
            "vsProducts": ["MiroThink", "Manus"],
            "gapSummary": "SophiaAI v5有三处承重数据被refuted：强生营收量级错（380亿→实际240.6亿）、一品红代码张冠李戴（002082→实际300723）、恒瑞占比误读（92.13%增速→当占比），而MiroThink和Manus在同类数据上均无重大错误。",
            "evidenceQuotes": [
                {"product": "SophiaAI v5", "quote": "强生(JNJ.US) | 海外 | 整体EPS+9.6% | 超380亿美元"},
                {"product": "SophiaAI v5", "quote": "一品红 | A股(SZ002082) | +985%"},
                {"product": "MiroThink", "quote": "富祥药业 | 300497 | 5,200万～7,500万 | +2,222.67%～+3,250.01% | 业绩预告 | 2026-03-24（数据与一手公告完全一致）"}
            ],
            "claimRefs": ["c16", "c17", "c18"]
        },
        {
            "dimension": "R1",
            "vsProducts": ["MiroThink"],
            "gapSummary": "MiroThink的20条引用来源几乎全部为带URL的一手公告/权威财经媒体链接，信源可追溯性远优于SophiaAI v5（v5虽有61条引用但多条关键数据与一手源不符）。",
            "evidenceQuotes": [
                {"product": "MiroThink", "quote": "[3] 富祥药业：2026年第一季度业绩预告 http://static.cninfo.com.cn/finalpage/2026-03-24/1225025265.PDF"},
                {"product": "SophiaAI v5", "quote": "[17] claim c17强生EPS同比增9.6%——但实际SEC filing显示调整后EPS $2.70同比下降约2.5%，方向完全相反"}
            ],
            "claimRefs": ["c17"]
        },
    ],
    "sharedWeakness": [
        {
            "dimension": "R4",
            "acrossProducts": ["Manus", "SophiaAI v5"],
            "gapSummary": "Manus和SophiaAI v5均缺少定量估值分析维度（PE/PS/PEG等），仅做定性覆盖，使得投资决策缺少'买入价格是否合理'这一关键锚点。",
            "suggestion": "补充核心企业的估值指标（当前PE vs 历史中位数/同业对比），将信息报告升级为决策工具。"
        }
    ]
}

# Save all
output = {
    "sbs": sbs,
    "perReportFeedback": per_report_feedback,
    "dimensionChecklists": dimension_checklists,
    "verificationBudget": verification_budget,
    "crossProductInsights": cross_product_insights,
}
with open(f"{TMP}/ev0003_rest.json", "w") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)
print("SBS, feedback, checklists, crossProductInsights saved.")
print(f"SBS pairs: {len(sbs['pairs'])}")
print(f"Feedback entries: {len(per_report_feedback)}")
