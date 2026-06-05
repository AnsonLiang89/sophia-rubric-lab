#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stage3: factMatrix+queryMatrix+claims+feedback+SBS+cpi+report. Operates on _v5_stage2.json -> v5.json"""
import json, itertools

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
 "v10":{"R1":"A","R2":"A","R3":"S","R4":"A","R5":"S"},"v5":{"R1":"B","R2":"A","R3":"A","R4":"A","R5":"A"},
 "kkv4":{"R1":"A","R2":"A","R3":"A","R4":"A","R5":"A"},"Claude":{"R1":"A","R2":"A","R3":"A","R4":"B","R5":"A"},
 "Kimi":{"R1":"B","R2":"A","R3":"A","R4":"A","R5":"C"},"Manus":{"R1":"A","R2":"A","R3":"A","R4":"B","R5":"A"},
 "Miro":{"R1":"B","R2":"B","R3":"B","R4":"B","R5":"B"},"Gemini":{"R1":"C","R2":"B","R3":"B","R4":"B","R5":"C"},
}
def ov(k):
    t=TIER[k];return round(sum(T2S[t[di]]*W[di] for di in W),4)

d=json.load(open(".evaluations/.tmp/_v5_stage2.json")); s=d["summary"]

# ===== factCoverageMatrix: add Claude perReport for T1-T8 =====
s["factCoverageMatrix"]["scannedAt"]="2026-06-04T21:30:00.000Z"
CL_FACT={
 "T1":{"present":True,"sampleQuote":"「全球金属软磁粉芯：2025 年约 USD 12–15 亿，2030 望破 25 亿，CAGR 8–12%」","claimIdsSampled":["cl_1"]},
 "T2":{"present":True,"sampleQuote":"「铂科芯片电感 2024 年 +275%」「Finemet 日立基础专利已过期」","claimIdsSampled":["cl_4"]},
 "T3":{"present":True,"sampleQuote":"「单 GWh 级粉末产线投资 3–5 亿元」「高端气雾化炉单台 2000 万–1 亿元」","claimIdsSampled":["cl_1"]},
 "T4":{"present":True,"sampleQuote":"「Magnetics、CSC、Micrometals 美国/韩国 老牌粉芯（MPP/Sendust 主力，非晶弱）」「美磁（MPS/Magnetics 合资）」","claimIdsSampled":["cl_2"]},
 "T5":{"present":True,"sampleQuote":"「GaN/SiC 提升频率 → 利好纳米晶/铁氧体；但 Bs 仍受限于材料本征」","claimIdsSampled":["cl_3"]},
 "T6":{"present":False,"reason":"Claude报告信源仅在文末列机构名(中电协/智研/云路年报/Emergen等),正文未逐条标注URL或公告编号,信源可追溯性弱,无精确可核source claim可抽。"},
 "T7":{"present":True,"sampleQuote":"「全球金属软磁粉芯：2025 年约 USD 12–15 亿……非晶纳米晶 C 型铁芯+粉末：2025 全球 ~180 亿元（口径含带材制品）」","claimIdsSampled":["cl_3"]},
 "T8":{"present":True,"sampleQuote":"「粉末市场远小于带材市场，但增速更高、毛利更厚」(粉末vs带材口径自洽)","claimIdsSampled":["cl_3"]},
}
for t in s["factCoverageMatrix"]["types"]:
    tid=t["typeId"]; e=CL_FACT[tid]; pr={"reportId":CL}; pr.update(e)
    t["perReport"].append(pr)
print("factMatrix T1 perReport:",len(s["factCoverageMatrix"]["types"][0]["perReport"]))

# ===== queryCoverageMatrix: add Claude to each subQ; also adjust Gemini Q2 to missing if not =====
CL_QCOV={"Q1":("full",""),"Q2":("full","USD12-15亿全球粉芯口径偏粗但明确;并点破粉末市场远小于带材"),
 "Q3":("full",""),"Q4":("full",""),"Q5":("full",""),"Q6":("full",""),"Q7":("full",""),"Q8":("full","")}
# map subId -> question text already; just append Claude perReport. Also ensure Gemini Q2 missing.
for sq in s["queryCoverageMatrix"]["subQuestions"]:
    qid=sq["subId"]
    cov,note=CL_QCOV.get(qid,("full",""))
    sq["perReport"].append({"reportId":CL,"coverage":cov,"note":note})
    # Gemini Q2 -> missing (scope错位)
    if qid=="Q2":
        for pr in sq["perReport"]:
            if pr["reportId"]==RID["Gemini"]:
                pr["coverage"]="missing"; pr["note"]="用『2024年中国金属软磁粉芯61亿/16.6万吨』母市场冒充非晶纳米晶粉末市场,未声明口径,属答非所问"
print("queryMatrix Q1 perReport:",len(s["queryCoverageMatrix"]["subQuestions"][0]["perReport"]))

# ===== claimInventory + claimChecks: add 4 Claude claims (incl >=1 logic) =====
CL_INV=[
 {"claimId":"cl_1","reportId":CL,"type":"number","claim":"全球金属软磁粉芯2025约USD12-15亿,2030望破25亿,CAGR8-12%","supportWeight":"high","locationHint":"二.2市场规模"},
 {"claimId":"cl_2","reportId":CL,"type":"fact","claim":"AI芯片电感全球能量产仅3家:铂科、Vishay、美磁(MPS/Magnetics合资)","supportWeight":"high","locationHint":"三.3国产化率"},
 {"claimId":"cl_3","reportId":CL,"type":"logic","claim":"海外带材强粉末弱、国内在粉末/粉芯环节反超→国产替代突破口在粉末/粉芯","supportWeight":"high","locationHint":"三玩家格局+七结论"},
 {"claimId":"cl_4","reportId":CL,"type":"fact","claim":"Finemet(Fe-Cu-Nb-Si-B)日立基础专利已过期,但HitPerm/Nanoperm衍生体系仍有专利墙","supportWeight":"medium","locationHint":"六.1材料壁垒"},
]
s["claimInventory"].extend(CL_INV)
CL_CHK=[
 {"claimId":"cl_1","pass1Question":"T1:全球金属软磁粉芯USD12-15亿是否与其他口径一致?","status":"verified-correct",
  "evidence":"报告『全球金属软磁粉芯2025约USD12-15亿』与Kimi引『2024全球金属磁粉芯8.06亿美元』、Manus引『2025全球软磁粉芯24.94万吨』量级相容(美元口径12-15亿对应高端粉芯),方向正确,属母市场口径且Claude已注明粉末小于带材。","checkedBy":"pass2-external-search"},
 {"claimId":"cl_2","pass1Question":"T4:『美磁(MPS/Magnetics合资)』主体是否准确?","status":"refuted",
  "evidence":"报告「全球能量产仅 3 家——铂科、Vishay、美磁（MPS/Magnetics 合资）」:外部核验MPS=Monolithic Power Systems(美国芯片电源IC厂),Magnetics=美国粉芯厂(Spang旗下),两者并非合资同一实体,中文『美磁』通常指Magnetics。属主体小混淆,但AI芯片电感仅3家量产并非Claude核心承重锚点,R1内扣不veto。","checkedBy":"pass2-external-search"},
 {"claimId":"cl_3","pass1Question":"T5/逻辑:『海外带材强粉末弱、国内粉末环节反超』因果链是否成立?","status":"verified-correct",
  "evidence":"报告『国内已诞生云路(带材+粉末)、铂科(粉芯+电感)双龙头』『真正壁垒在配方-雾化-包覆-退火四联工艺』:与Kimi(铂科粉芯全球前四/英伟达独供)、v5(铂科粉末龙头)交叉印证,海外Proterial/VAC以带材磁芯为主、粉芯由美磁/昌星主导且非晶弱,推理链『海外粉末弱→国产突破口在粉末』自洽。","checkedBy":"pass3-logic"},
 {"claimId":"cl_4","pass1Question":"T4:Finemet基础专利是否已过期?","status":"verified-correct",
  "evidence":"报告『Finemet(Fe-Cu-Nb-Si-B)日立基础专利已过期,但HitPerm/Nanoperm衍生体系仍有专利墙』:与Sophia v5『US4,881,989(1988)已过期』、Yoshizawa1988成分一致,1988申请专利已自然到期属实,衍生体系专利墙判断合理。","checkedBy":"pass2-external-search"},
]
s["claimChecks"].extend(CL_CHK)
print("claimInventory:",len(s["claimInventory"]),"claimChecks:",len(s["claimChecks"]))

# ===== perReportFeedback: add Claude =====
s["perReportFeedback"].append({"reportId":CL,
 "strengths":["R5:信噪比本轮最高,5247字讲清8子问题全部要点;并行方案10行矩阵(铁粉/铁硅/Sendust/MPP/HighFlux/非晶/纳米晶/铁氧体/羰基铁/C型芯)是全场最全的对比表",
   "R3:贡献『海外带材强粉末弱、国内粉末/粉芯环节反超』独家结构判断,把国产替代突破口精准定位到粉末/粉芯环节,对择股有直接指向"],
 "weaknesses":["R1:『美磁(MPS/Magnetics合资)』把芯片厂MPS(Monolithic Power Systems)与粉芯厂Magnetics混为一家,主体小混淆",
   "R4:完备性偏弱,供应链铌风险、海外专利诉讼、车规AEC认证三个决策维度因篇幅取舍未展开"],
 "improvements":["在保持信息密度优势的同时,补一段『供应链(铌)+海外专利/认证风险』以补齐决策完备性",
   "核对MPS/Magnetics等专名归属,避免主体混淆"]})
print("perReportFeedback:",len(s["perReportFeedback"]))

json.dump(d,open(".evaluations/.tmp/_v5_stage3.json","w"),ensure_ascii=False)
print("stage3 saved")
