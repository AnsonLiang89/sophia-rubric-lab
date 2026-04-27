#!/usr/bin/env python3
"""Generate EV-0002 v2.json (v3.2 contract) - Part 1: scaffold + overallScores"""
import json, os

OUT = "/Users/anson_liang/WorkBuddy/20260419144025/sophia-rubric-lab/.evaluations/outbox/EV-0002-N3e5zP/v2.json"

# --- Weight config (X1 activated at 0.10) ---
SHRINK = 0.90
W = {"R1": 0.40*SHRINK, "R2": 0.15*SHRINK, "R3": 0.20*SHRINK, "R4": 0.10*SHRINK, "R5": 0.15*SHRINK, "X1": 0.10}
# R1=0.36, R2=0.135, R3=0.18, R4=0.09, R5=0.135, X1=0.10

# --- Per-product scores: {product: {R1,R2,R3,R4,R5,X1}} ---
S = {
    "MiroThink":    {"R1":10,"R2":10,"R3":10,"R4":10,"R5":10,"X1":10},
    "Manus":        {"R1": 8,"R2": 8,"R3": 8,"R4": 8,"R5": 8,"X1": 8},
    "SophiaAI v4":  {"R1": 6,"R2": 8,"R3": 8,"R4": 8,"R5": 8,"X1": 8},
    "Gemini":       {"R1": 6,"R2": 8,"R3": 6,"R4": 6,"R5": 6,"X1": 6},
    "SophiaAI v5":  {"R1": 2,"R2": 6,"R3": 4,"R4": 4,"R5": 4,"X1": 4},
}

REPORT_IDS = {
    "MiroThink": "6q5vDnqkfk",
    "Manus": "Qm2DpyIJ-h",
    "SophiaAI v4": "F6BEti3wFm",
    "Gemini": "AhuI4bVzZS",
    "SophiaAI v5": "SgBQUeWuiQ",
}

TIER_MAP = {10:"S", 8:"A", 6:"B", 4:"C", 2:"D"}
def calc_overall(scores):
    return round(sum(scores[d]*W[d] for d in W), 2)

def verdict(score, veto):
    if veto: return "合格" if score >= 5.5 else ("待改进" if score >= 4.0 else "不合格")
    if score >= 8.5: return "卓越"
    if score >= 7.0: return "优秀"
    if score >= 5.5: return "合格"
    if score >= 4.0: return "待改进"
    return "不合格"

overall_scores = []
for prod in ["MiroThink","Manus","SophiaAI v4","Gemini","SophiaAI v5"]:
    sc = S[prod]
    raw = calc_overall(sc)
    veto = (prod == "SophiaAI v5")
    final = min(raw, 6.9) if veto else raw
    entry = {
        "reportId": REPORT_IDS[prod],
        "productName": prod,
        "score": final,
        "verdict": verdict(final, veto),
        "vetoTriggered": veto,
    }
    if veto:
        entry["vetoReason"] = (
            "R1 触发一票否决（3 项 V 级错误）：(1) claim c21 (V1)：将 2025 年 license-out 总额同时报为 678.27 亿与 1356.55 亿美元两个口径，"
            "并把后者扩展解释为'全 BD 交易总额'，无一手源支撑，属编造数据——医药魔方口径为 1356.55 亿/157 笔（全 BD），"
            "license-out 口径约 678 亿属子集，报告未做口径区分导致核心数字混淆；"
            "(2) claim c22 (V2)：把'康诺亚'误述为被吉利德 16.75 亿美元收购的主体，实际被收购方为 Ouro Medicines（康诺亚的 NewCo 合作公司），"
            "康诺亚仅作为股东分账约 2.5~3.2 亿美元，主体错误；"
            "(3) claim c23 (V2)：把百济神州 8.85 亿美元'特许权使用费购买'(royalty purchase) 列为 BD 首付款案例，"
            "性质根本错误——Royalty Pharma 的交易是一次性购买未来药品销售分成权，不是 license-out 首付款。"
        )
    overall_scores.append(entry)

# Save intermediate
os.makedirs(os.path.dirname(OUT) if os.path.dirname(OUT) else ".", exist_ok=True)
with open("/Users/anson_liang/WorkBuddy/20260419144025/sophia-rubric-lab/.workbuddy/tmp/ev0002_overall.json", "w") as f:
    json.dump(overall_scores, f, ensure_ascii=False, indent=2)

print("Overall scores generated:")
for e in overall_scores:
    print(f"  {e['productName']}: {e['score']} ({e['verdict']})")
