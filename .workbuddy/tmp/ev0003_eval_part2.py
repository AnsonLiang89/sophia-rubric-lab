#!/usr/bin/env python3
"""EV-0003-cWQMJx evaluation builder - Part 2: Scoring & Summary"""
import json

BASE = "/Users/anson_liang/WorkBuddy/20260419144025/sophia-rubric-lab/.evaluations"
TMP = "/Users/anson_liang/WorkBuddy/20260419144025/sophia-rubric-lab/.workbuddy/tmp"

# Load claims from part1
with open(f"{TMP}/ev0003_claims.json") as f:
    claims_data = json.load(f)

MANUS = "sLfcXcMjxo"
MIRO = "bDgPS6OPUf"
SOPHIA4 = "re9wstntq1"
SOPHIA5 = "W9JyedQ7hW"

# ============================================================
# R1 Subscores
# ============================================================
r1_subscores = {
    "R1a": {"score": 8, "tier": "A", "weight": 0.28, "comment": "全局核验命中率约90%；承重数字（富祥药业/纳微科技/艾力斯等）大部分能对齐一手源"},
    "R1b": {"score": 8, "tier": "A", "weight": 0.12, "comment": "SophiaAI v4将恒瑞92.13%增速误当占比，存在语义性数字错误；其他报告内部逻辑基本自洽"}
}

# ============================================================
# Rubric scores
# ============================================================
rubric = [
    {
        "dimensionId": "R1", "name": "准确性", "weight": 0.40,
        "subscores": r1_subscores,
        "scores": [
            {"reportId": MANUS, "score": 8, "tier": "A", "comment": "5条承重claim中4条verified-correct，1条inconclusive（诺诚健华商业化收入缺一手源）；核验命中率80%（4/5），内部逻辑完全自洽，无算术错", "confidence": "high", "issueTags": []},
            {"reportId": MIRO, "score": 8, "tier": "A", "comment": "5条承重claim中3条verified-correct，2条inconclusive（翰森制药688197代码存疑、康方生物数据缺一手确认）；核验命中率60%但inconclusive非refuted，内部逻辑链完整；引用20条一手源、信源密度最高", "confidence": "medium", "issueTags": ["一手源不足"]},
            {"reportId": SOPHIA4, "score": 4, "tier": "C", "comment": "claim c12 refuted：报告写「恒瑞医药创新药营收占比92%」，但92.13%实际是'创新药中非肿瘤产品收入同比增长率'，恒瑞实际创新药占总营收比例约61.69%（恒瑞2026Q1公告）。将增长率当成占比属V1量级性质的语义错误，承重段数字含义完全偏差。此外claim c11海思科'2.89亿美元里程碑付款'缺一手源支持", "confidence": "high", "issueTags": ["数字量级错", "事实错误"]},
            {"reportId": SOPHIA5, "score": 2, "tier": "D", "comment": "三处承重claim被refuted：(1) claim c16 恒瑞'创新药收入占比92.13%'实为增速非占比(V1)；(2) claim c17 强生'EPS同比增9.6%、营收超380亿美元'实际营收约240.6亿(V1量级错)、EPS实际同比下降约2.5%(方向完全相反)；(3) claim c18 一品红标注'A股SZ002082'但002082是万邦德，一品红正确代码300723(V2主体错)。三处均为承重数据，严重影响决策可靠性", "confidence": "high", "issueTags": ["数字量级错", "事实错误", "编造源"]}
        ]
    },
    {
        "dimensionId": "R2", "name": "相关性", "weight": 0.15,
        "scores": [
            {"reportId": MANUS, "score": 8, "tier": "A", "comment": "按预增幅度三梯队分类，直接回应query核心诉求；锚点（2026Q1/创新药/预增）全命中；未深挖潜在诉求（如投资决策场景）", "confidence": "high", "issueTags": []},
            {"reportId": MIRO, "score": 10, "tier": "S", "comment": "不仅覆盖已确认预增企业，还主动挖掘'潜在预增'和'未来催化剂时间表'；锚点全命中；主动识别投资决策的潜在诉求（估值合理性、信息差分析）", "confidence": "high", "issueTags": []},
            {"reportId": SOPHIA4, "score": 8, "tier": "A", "comment": "9家企业全覆盖+数据密度高（含EPS/PE等）；alpha/beta分类直接回应分析诉求；锚点全命中；未对潜在诉求做显式挖掘", "confidence": "high", "issueTags": []},
            {"reportId": SOPHIA5, "score": 10, "tier": "S", "comment": "覆盖面最广（15家+4海外），What/Why/So What三层结构直接对准决策者诉求；主动纳入海外龙头对标是独特视角；锚点全命中且主动扩展了'全球创新药'维度", "confidence": "high", "issueTags": []}
        ]
    },
    {
        "dimensionId": "R3", "name": "论证深度", "weight": 0.20,
        "scores": [
            {"reportId": MANUS, "score": 6, "tier": "B", "comment": "按梯队分类是一阶组织，各企业分析基本停留在'是什么'层面（列数据+简述驱动力），缺少二阶追问和非共识观点；无跨企业横向对比分析", "confidence": "high", "issueTags": ["结论空泛"]},
            {"reportId": MIRO, "score": 8, "tier": "A", "comment": "富祥药业VC价格分析追到二阶（价格→产能→可持续性）；海思科BD模式有因果链；趋势洞察段有非共识信号（'高基数消化后2026全年增速回归常态化'）；信息差分析段有独特视角", "confidence": "high", "issueTags": []},
            {"reportId": SOPHIA4, "score": 8, "tier": "A", "comment": "alpha/beta驱动力分类是非共识框架；6大深层洞察有二阶甚至三阶追问（如BD收入占比→出海变现→行业趋势）；量化预测（分位回报率、成功概率）有模型思维；对立视角（beta型CDMO的不确定性）有呈现", "confidence": "high", "issueTags": []},
            {"reportId": SOPHIA5, "score": 10, "tier": "S", "comment": "What/Why/So What三层结构是教科书级分析框架；每个驱动力都追到Why层（如医保→集采→量价）和So What层（投资含义）；5条深层洞察有跨维度串联能力；海外龙头纳入对标是独特非共识视角；61条引用佐证密度极高", "confidence": "high", "issueTags": []}
        ]
    },
    {
        "dimensionId": "R4", "name": "完备性", "weight": 0.10,
        "scores": [
            {"reportId": MANUS, "score": 6, "tier": "B", "comment": "覆盖三梯队企业+未确认预增企业，维度基本齐全；但缺少估值维度、缺少投资建议维度、缺少风险提示维度", "confidence": "high", "issueTags": ["维度缺漏"]},
            {"reportId": MIRO, "score": 10, "tier": "S", "comment": "企业覆盖最全（含潜在预增和未出公告企业）；维度齐全（预增数据/驱动分析/趋势洞察/信息差/估值合理性/引用来源）；结构清晰支撑论证；有投资决策闭环", "confidence": "high", "issueTags": []},
            {"reportId": SOPHIA4, "score": 10, "tier": "S", "comment": "维度覆盖极全（基本面/驱动分类/深层洞察/量化预测/风险分级/时间窗口）；结构化表格+叙述结合；定量深度到位（PE/EPS/成功概率/分位回报率）", "confidence": "high", "issueTags": []},
            {"reportId": SOPHIA5, "score": 8, "tier": "A", "comment": "覆盖面最广（15+4海外=19家），What/Why/So What结构完整；缺少估值定量分析和具体投资建议；引用61条信源最多；结构支撑论证良好", "confidence": "high", "issueTags": ["定量缺失"]}
        ]
    },
    {
        "dimensionId": "R5", "name": "决策价值", "weight": 0.15,
        "scores": [
            {"reportId": MANUS, "score": 6, "tier": "B", "comment": "三梯队分类对筛选有帮助；但缺少可操作take-away（如具体买入建议/风险提示/时间窗口），信息增量有限——基本是公告数据汇编", "confidence": "high", "issueTags": ["缺乏可操作建议", "信息零增量"]},
            {"reportId": MIRO, "score": 8, "tier": "A", "comment": "信息差分析段直接指向投资决策（估值合理性/催化剂时间表）；有具体可操作建议（关注4/25康方生物、跟踪CDMO订单）；主动标注caveat（高基数风险、预增≠全年确定性）", "confidence": "high", "issueTags": []},
            {"reportId": SOPHIA4, "score": 10, "tier": "S", "comment": "风险分级表（高/中/低确定性）直接可操作；分位回报率预测有量化支撑；时间窗口建议（4/21-4/30关注哪些公告）极具体；三档投资策略（>100%/10%-100%/<10%预增幅度）直接帮决策", "confidence": "high", "issueTags": []},
            {"reportId": SOPHIA5, "score": 8, "tier": "A", "comment": "5条So What洞察有启发性（政策红利周期/BD出海窗口/化学原料药周期等）；海外对标是独特信息增量；但缺少具体可执行投资建议，caveat较少", "confidence": "high", "issueTags": ["缺乏可操作建议"]}
        ]
    },
]

# ============================================================
# Overall Scores calculation
# ============================================================
def calc_overall(scores_by_dim, report_id, veto=False, veto_reason=None):
    total = 0
    for dim in rubric:
        for s in dim["scores"]:
            if s["reportId"] == report_id:
                total += s["score"] * dim["weight"]
                break
    if veto and total > 6.9:
        total = 6.9
    return round(total, 1)

def get_verdict(score):
    if score >= 8.5: return "卓越"
    if score >= 7.0: return "优秀"
    if score >= 5.5: return "合格"
    if score >= 4.0: return "待改进"
    return "不合格"

manus_score = calc_overall(rubric, MANUS)
miro_score = calc_overall(rubric, MIRO)
s4_score = calc_overall(rubric, SOPHIA4)
s5_raw = calc_overall(rubric, SOPHIA5, veto=False)
s5_score = min(s5_raw, 6.9)  # veto cap

overall_scores = [
    {"reportId": MANUS, "productName": "Manus", "score": manus_score, "verdict": get_verdict(manus_score), "vetoTriggered": False},
    {"reportId": MIRO, "productName": "MiroThink", "score": miro_score, "verdict": get_verdict(miro_score), "vetoTriggered": False},
    {"reportId": SOPHIA4, "productName": "SophiaAI v4", "score": s4_score, "verdict": get_verdict(min(s4_score, 6.9)), "vetoTriggered": True, "vetoReason": "claim c12（V1 语义性量级错）：报告写恒瑞'创新药营收占比92%'，实际92.13%是创新药中非肿瘤产品增长率，真实创新药占比约61.69%"},
    {"reportId": SOPHIA5, "productName": "SophiaAI v5", "score": s5_score, "verdict": get_verdict(s5_score), "vetoTriggered": True, "vetoReason": "claim c17（V1 量级错）：强生营收写380亿实际240.6亿、EPS涨跌方向反转；claim c18（V2 主体错）：一品红代码写002082实为万邦德（正确300723）；claim c16（V1 语义错）：恒瑞92.13%增速误当占比"},
]

# Fix SophiaAI v4 score cap
if s4_score > 6.9:
    overall_scores[2]["score"] = 6.9

print("Overall scores:")
for o in overall_scores:
    print(f"  {o['productName']}: {o['score']} ({o['verdict']}) veto={o['vetoTriggered']}")

# Save
output = {
    "rubric": rubric,
    "overallScores": overall_scores,
}
with open(f"{TMP}/ev0003_scoring.json", "w") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)
print("\nScoring saved.")
