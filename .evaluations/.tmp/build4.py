#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stage4: rebuild SBS(28 pairs by product), update cpi, swap report, write v5.json"""
import json, itertools

CL="MPNGPNirRi"
RID={"v10":"swFVPOtaPS","v5":"XdVfWC8VqR","kkv4":"Ol4nvvbaew","Claude":CL,
     "Kimi":"QiQY4vEfP3","Manus":"ayDsLMvn6z","Miro":"dJZdiw8UyF","Gemini":"y2CMWWnpnH"}
PN={"v10":"SophiaAI v10","v5":"SophiaAI v5","kkv4":"SophiaAI kkv4","Claude":"Claude opus4.7",
    "Kimi":"Kimi","Manus":"Manus","Miro":"MiroThink","Gemini":"Gemini"}
ORDER=["v10","v5","kkv4","Claude","Kimi","Manus","Miro","Gemini"]
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

def margin(ka,kb):
    """determine margin from score diff and tier band diff. returns (winner,margin,drivers,reason-bits)"""
    sa,sb=ov(ka),ov(kb)
    diff=abs(sa-sb)
    # count dims with tier-band gap
    band={"S":5,"A":4,"B":3,"C":2,"D":1}
    gaps={di:band[TIER[ka][di]]-band[TIER[kb][di]] for di in W}
    one=sum(1 for v in gaps.values() if abs(v)==1)
    multi2=sum(1 for v in gaps.values() if abs(v)>=2)
    multidim_ge2 = multi2>=1 and (one+multi2)>=2
    multidim_1 = (one>=2) and multi2==0
    # margin table (RUBRIC §六)
    def band_of(diff,kind):
        # kind: 'm2'(>=2档多维), 'm1'(1档多维), 'single'(个别1档)
        if diff>=1.5: return {'m2':'overwhelming','m1':'clear','single':'clear'}[kind]
        if diff>=0.8: return {'m2':'clear','m1':'clear','single':'slight'}[kind]
        if diff>=0.3: return {'m2':'clear','m1':'slight','single':'slight'}[kind]
        return {'m2':'slight','m1':'slight','single':'tie'}[kind]
    if multidim_ge2: kind='m2'
    elif multidim_1: kind='m1'
    else: kind='single'
    if diff<1e-9 and one==0 and multi2==0:
        return ("draw","tie",["R4","R5"],sa,sb,gaps)
    m=band_of(diff,kind)
    winner="A" if sa>sb else "B" if sb>sa else "draw"
    if winner=="draw":
        m="tie"
    elif m=="tie":
        # tie margin only allowed when winner=draw; non-draw min margin = slight
        m="slight"
    drivers=[di for di in W if abs(gaps[di])>=1]
    if not drivers: drivers=["R4","R5"]
    return (winner,m,drivers,sa,sb,gaps)

d=json.load(open(".evaluations/.tmp/_v5_stage3.json")); s=d["summary"]

pairs=[]
for a,b in itertools.combinations(ORDER,2):
    ridA,ridB=RID[a],RID[b]
    w,m,drv,sa,sb,gaps=margin(a,b)
    # build keyReason
    hi = a if sa>=sb else b
    lo = b if sa>=sb else a
    drv_str="/".join(drv[:3])
    if w=="draw":
        reason=f"{PN[a]}({ov(a)}) ≈ {PN[b]}({ov(b)}),五维档位完全一致(均A档为主),难分高下;{drv_str}等维度互有千秋。Claude信噪比高但R4完备性弱,Manus口径诚实但定量偏估算,恰好互补。"
    else:
        hi = a if sa>=sb else b
        lo = b if sa>=sb else a
        reason=f"{PN[hi]}({ov(hi)}) ＞ {PN[lo]}({ov(lo)}),主要由{drv_str}拉开;"
        if 'Gemini' in (a,b):
            reason+="Gemini因scope错位(母市场冒充细分)+MPP49%错被R1/R5拖累。"
        elif 'Kimi' in (a,b) and hi!='Kimi':
            reason+="Kimi因v3.7信噪比闸门R5封C(篇幅大但难核源多)。"
        elif hi=='v10':
            reason+="v10在R3/R5双S(证伪共识+去泡沫)确立领先。"
        elif hi=='Claude':
            reason+="Claude以最高信噪比补偿R4完备性短板。"
        else:
            reason+="差距集中在事实纪律与决策价值。"
    pairs.append({"reportIdA":ridA,"reportIdB":ridB,"winner":w,"margin":m,"dimensionDriver":drv,"keyReason":reason})

s["sbs"]={"pairs":pairs}
print("SBS pairs:",len(pairs),"expected C(8,2)=28")
from collections import Counter
print("margins:",Counter(p['margin'] for p in pairs))
print("winners:",Counter(p['winner'] for p in pairs))

# ===== crossProductInsights: focus v10, add Claude into comparisons =====
cpi=s["crossProductInsights"]
cpi["focusProductName"]="SophiaAI v10"
# Add a strongerThan vs Claude (R4 completeness/supply-chain depth) and a weakerThan vs Claude (R5 信噪比)
cpi["strongerThan"].append({
 "dimension":"R4","vsProducts":["Claude opus4.7"],
 "gapSummary":"在决策完备性上v10覆盖供应链(铌)、海外专利诉讼、车规认证三大风险维度,Claude因篇幅取舍全部未展开。",
 "evidenceQuotes":[
   {"product":"SophiaAI v10","quote":"中国对巴西铌进口依赖超95%，供应中断概率25-30%，替代矿源（加拿大、澳大利亚）建设周期需10年以上。一旦发生短期中断，产业面临停摆风险。Proterial（原日立金属）在美日的专利诉讼动向……美国337调查起诉概率15-20%，日本海关扣押概率30-35%。"},
   {"product":"Claude opus4.7","quote":"资本 + 时间壁垒：从材料配方 → 量产合格 → 客户认证 → 大规模出货，行业新进入者需 5–8 年。单 GWh 级粉末产线投资 3–5 亿元。"}],
 "claimRefs":["cl_3"]})
cpi["weakerThan"].append({
 "dimension":"R5","vsProducts":["Claude opus4.7"],
 "gapSummary":"决策信噪比上Claude用5247字逼近v10的决策价值,v10虽S档但篇幅是其4倍以上;v3.7信噪比闸门下『凝练』本身是v10可借鉴的能力。",
 "evidenceQuotes":[
   {"product":"SophiaAI v10","quote":"整体定性：非晶纳米晶是高频高功率场景的最优解，但并非唯一选项，更不是强制要求 — 它与铁氧体、铁硅铝在不同频段和成本区间共存，AI服务器电源的渗透率预测缺乏产业链证据。"},
   {"product":"Claude opus4.7","quote":"非晶纳米晶粉末 ≠ 唯一方案，但它是『AI 电源 + 800V 车 + 高效光伏』三大高频高功率密度场景的关键卡位材料……真正的壁垒在『配方-雾化-包覆-退火』四联工艺 know-how 与头部客户绑定，而非单点技术突破。"}],
 "claimRefs":["cl_3"]})
print("cpi stronger:",len(cpi["strongerThan"]),"weaker:",len(cpi["weakerThan"]))

# ===== swap report =====
d["report"]=open(".evaluations/.tmp/EV-0012-report.md").read()

json.dump(d,open(".evaluations/outbox/EV-0012/v5.json","w"),ensure_ascii=False,indent=2)
print("WROTE v5.json")
