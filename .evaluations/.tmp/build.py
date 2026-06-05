#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json, itertools

BASE=".evaluations/outbox/EV-0012/v4.json"
OUT=".evaluations/outbox/EV-0012/v5.json"
REPORT=".evaluations/.tmp/EV-0012-report.md"
CL="MPNGPNirRi"
RID={"v10":"swFVPOtaPS","v5":"XdVfWC8VqR","kkv4":"Ol4nvvbaew","Claude":CL,
     "Kimi":"QiQY4vEfP3","Manus":"ayDsLMvn6z","Miro":"dJZdiw8UyF","Gemini":"y2CMWWnpnH"}
PN={"v10":"SophiaAI v10","v5":"SophiaAI v5","kkv4":"SophiaAI kkv4","Claude":"Claude opus4.7",
    "Kimi":"Kimi","Manus":"Manus","Miro":"MiroThink","Gemini":"Gemini"}
ORDER=["v10","v5","kkv4","Claude","Kimi","Manus","Miro","Gemini"]
ALL=[RID[k] for k in ORDER]
NAME={RID[k]:PN[k] for k in ORDER}
K_OF={RID[k]:k for k in ORDER}
T2S={"S":10,"A":8,"B":6,"C":4,"D":2}
W={"R1":0.40,"R2":0.15,"R3":0.20,"R4":0.10,"R5":0.15}
TIER={
 "v10":{"R1":"A","R2":"A","R3":"S","R4":"A","R5":"S"},
 "v5":{"R1":"B","R2":"A","R3":"A","R4":"A","R5":"A"},
 "kkv4":{"R1":"A","R2":"A","R3":"A","R4":"A","R5":"A"},
 "Claude":{"R1":"A","R2":"A","R3":"A","R4":"B","R5":"A"},
 "Kimi":{"R1":"B","R2":"A","R3":"A","R4":"A","R5":"C"},
 "Manus":{"R1":"A","R2":"A","R3":"A","R4":"B","R5":"A"},
 "Miro":{"R1":"B","R2":"B","R3":"B","R4":"B","R5":"B"},
 "Gemini":{"R1":"C","R2":"B","R3":"B","R4":"B","R5":"C"},
}
def ov(k):
    t=TIER[k];return round(sum(T2S[t[di]]*W[di] for di in W),4)
def vd(x):
    return "卓越" if x>=8.5 else "优秀" if x>=7.0 else "合格" if x>=5.5 else "待改进" if x>=4.0 else "不合格"

d=json.load(open(BASE)); s=d["summary"]
d["version"]=5; d["contractVersion"]="3.7"
d["evaluator"]="Sophia (Claude-Opus via WorkBuddy)"
d["evaluatedAt"]="2026-06-04T21:45:00.000Z"

# ===== overallScores =====
CLAUDE_OV={"reportId":CL,"productName":"Claude opus4.7","score":ov("Claude"),"verdict":vd(ov("Claude")),"vetoTriggered":False,
 "comment":"本轮新引入黑马:5247字最短却信噪比最高,8子问题全部正面回答,贡献『海外带材强粉末弱、国内粉末/粉芯环节反超』独家结构判断;唯一瑕疵是『美磁(MPS/Magnetics合资)』把芯片厂MPS与粉芯厂Magnetics混为一家(R1内扣,非承重不veto);完备性因篇幅取舍偏弱(供应链/法律风险未展开)。"}
nos=[]
for o in s["overallScores"]:
    k=K_OF[o["reportId"]]; o["score"]=ov(k); o["verdict"]=vd(ov(k)); o["vetoTriggered"]=False
    if o["reportId"]==RID["Kimi"]:
        o["deltaReason"]="v5较v4:R5由B(6)降至C(4),总分6.9→6.6。差异来源=评测视角变化(v3.7信噪比闸门首次实战):5.5万字+海量自媒体源+多口径数字不收敛+caveat稀缺,按新规『篇幅长但有效决策信息密度低,R5封B上限』叠加『长报告caveat稀缺诚实度再降一档』。非新事实错误。"
    elif o["reportId"]==RID["Gemini"]:
        o["deltaReason"]="v5较v4:R4由A(8)降至B(6)、R5由B(6)降至C(4),总分5.4→4.9(均为待改进档,未跨档)。差异来源=本轮重新核验落锤两处承重问题(61亿母市场冒充细分=scope错位/答非所问;MPP占49%事实+逻辑双错)使完备性与决策价值被错误数据拖累。属新证据支撑的下调。"
    elif o.get("deltaReason") is not None:
        # unchanged vs v4 (Δ=0): clear stale v4 deltaReason to avoid misleading history note
        o.pop("deltaReason",None)
    nos.append(o)
nos.append(CLAUDE_OV)
s["overallScores"]=nos

# ===== rubric: add Claude entry to each dim; fix Kimi/Gemini tiers =====
CLAUDE_COMMENT={
 "R1":"事实方向准、判断硬;唯一主体小瑕疵『美磁(MPS/Magnetics合资)』混淆芯片厂与粉芯厂,非承重R1内扣。",
 "R2":"8子问题全部正面回答,无跑题;市场容量虽偏粗(USD12-15亿全球粉芯)但口径清楚。",
 "R3":"凝练判断力强:四联工艺know-how+客户绑定才是真壁垒,与v10『一致性非专利』互证;非共识有据。",
 "R4":"完备性偏弱:供应链铌风险/专利诉讼/车规认证三个决策维度因篇幅取舍未展开。",
 "R5":"信噪比本轮最高,5247字讲清全部要点,决策指向清晰(国产替代突破口在粉末/粉芯环节)。",
}
CLAUDE_TAGS={"R1":[],"R2":[],"R3":[],"R4":["维度缺漏"],"R5":[]}
for r in s["rubric"]:
    dim=r["dimensionId"]
    # fix Kimi/Gemini
    for x in r["scores"]:
        kk=K_OF[x["reportId"]]; t=TIER[kk][dim]
        x["tier"]=t; x["score"]=T2S[t]
    # ensure C/D comments carry ≥15-char quoted snippet (lint hard rule)
    for x in r["scores"]:
        if x["tier"] in ("C","D"):
            kk=K_OF[x["reportId"]]
            if kk=="Gemini" and dim=="R5":
                x["comment"]="技术展望有价值但决策可操作性弱,且承重数据失真:「镍铁/坡莫合金（MPP）……占全球金属粉芯总需求的 49% 以上，多用于军工和航天」,小众高端材料占近半与用途自相矛盾,推高读者甄别成本。"
            elif kk=="Gemini" and dim=="R1":
                x["comment"]="两处承重落锤:「2024年，中国金属软磁粉芯的市场规模已达 61 亿元人民币，总需求量高达 16.6 万吨」用母市场冒充非晶纳米晶粉末细分(scope错位);MPP占49%事实+逻辑双错。"
            elif kk=="Kimi" and dim=="R5":
                x["comment"]="v3.7信噪比闸门首次实战:5.5万字海量数据但caveat稀缺,多口径不收敛,如「2023年全球非晶纳米晶软磁材料市场规模为6.39亿美元」与正文另两处8.97亿/57.5亿口径并列未取舍,有效决策信息被稀释。"
            elif not __import__("re").search(r"「[^」]{15,}」|\"[^\"]{15,}\"", x.get("comment","")):
                # generic guard: keep but ensure has quote -- leave as-is (other C/D should already)
                pass
    # add Claude
    cl_t=TIER["Claude"][dim]
    s_entry={"reportId":CL,"tier":cl_t,"score":T2S[cl_t],"confidence":"high","comment":CLAUDE_COMMENT[dim],"issueTags":CLAUDE_TAGS[dim]}
    r["scores"].append(s_entry)
    # R1 subscores already keyed to v10 focus; keep
print("rubric updated; R1 scores:",len(s["rubric"][0]["scores"]))

json.dump(d,open(".evaluations/.tmp/_v5_stage2.json","w"),ensure_ascii=False)
print("stage2 saved")
