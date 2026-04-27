#!/usr/bin/env python3
"""EV-0003-cWQMJx evaluation builder - Part 5: Final assembly"""
import json, os
from datetime import datetime, timezone

TMP = "/Users/anson_liang/WorkBuddy/20260419144025/sophia-rubric-lab/.workbuddy/tmp"
OUTBOX = "/Users/anson_liang/WorkBuddy/20260419144025/sophia-rubric-lab/.evaluations/outbox/EV-0003-cWQMJx"

# Load all parts
with open(f"{TMP}/ev0003_claims.json") as f:
    claims = json.load(f)
with open(f"{TMP}/ev0003_scoring.json") as f:
    scoring = json.load(f)
with open(f"{TMP}/ev0003_rest.json") as f:
    rest = json.load(f)
with open(f"{TMP}/ev0003_report.txt") as f:
    report = f.read()

# Assemble
payload = {
    "taskId": "EV-0003-cWQMJx",
    "version": 1,
    "evaluator": "Sophia (AI via WorkBuddy)",
    "evaluatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
    "contractVersion": "3.2",
    "summary": {
        "overallScores": scoring["overallScores"],
        "rubric": scoring["rubric"],
        "extraDimensions": [],
        "sbs": rest["sbs"],
        "perReportFeedback": rest["perReportFeedback"],
        "claimInventory": claims["claimInventory"],
        "claimChecks": claims["claimChecks"],
        "dimensionChecklists": rest["dimensionChecklists"],
        "verificationBudget": rest["verificationBudget"],
        "crossProductInsights": rest["crossProductInsights"],
    },
    "report": report,
}

# Write
os.makedirs(OUTBOX, exist_ok=True)
outpath = f"{OUTBOX}/v1.json"
with open(outpath, "w") as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)

print(f"Written to {outpath}")
print(f"File size: {os.path.getsize(outpath)} bytes")

# Verify JSON is valid
with open(outpath) as f:
    json.load(f)
print("JSON validation: OK")

# Quick structural checks
print(f"\nStructural checks:")
print(f"  contractVersion: {payload['contractVersion']}")
print(f"  overallScores: {len(payload['summary']['overallScores'])} entries")
print(f"  rubric: {len(payload['summary']['rubric'])} dimensions")
print(f"  sbs pairs: {len(payload['summary']['sbs']['pairs'])}")
print(f"  perReportFeedback: {len(payload['summary']['perReportFeedback'])} entries")
print(f"  claimInventory: {len(payload['summary']['claimInventory'])} claims")
print(f"  claimChecks: {len(payload['summary']['claimChecks'])} checks")
print(f"  report length: {len(payload['report'])} chars")

# Verify all report IDs covered
all_ids = {"sLfcXcMjxo", "bDgPS6OPUf", "re9wstntq1", "W9JyedQ7hW"}
for dim in payload["summary"]["rubric"]:
    covered = {s["reportId"] for s in dim["scores"]}
    if covered != all_ids:
        print(f"  WARNING: {dim['dimensionId']} missing reportIds: {all_ids - covered}")
    else:
        print(f"  {dim['dimensionId']}: all 4 reportIds covered OK")

# Verify score calculations
for o in payload["summary"]["overallScores"]:
    calc = 0
    for dim in payload["summary"]["rubric"]:
        for s in dim["scores"]:
            if s["reportId"] == o["reportId"]:
                calc += s["score"] * dim["weight"]
    calc = round(calc, 1)
    if o["vetoTriggered"] and calc > 6.9:
        calc = 6.9
    match = "OK" if abs(calc - o["score"]) < 0.01 else f"MISMATCH (calc={calc})"
    print(f"  {o['productName']}: score={o['score']}, calc={calc}, {match}")
