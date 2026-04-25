/**
 * bus/handlers/publish.ts
 *
 * 一键发布：POST /_bus/publish
 *
 * 职责：把"本地改的评测数据"稳定地推到公网。按顺序串行跑：
 *   Step 0. Preflight 一致性预检（硬错误拒绝发布；软警告自动对齐）
 *   Step 1. 写 _runtime-snapshot.json
 *   Step 2. build:public 拆成四步跑（seed:dump / bake:public / tsc -b / vite build）
 *   Step 3. git add -A
 *   Step 4. git commit -m "publish: <iso>"（nothing-to-commit 不算失败）
 *   Step 5. git push origin HEAD → 触发 GitHub Actions
 *
 * 任一步失败立即停止，返回 200 + ok:false + failedStep + steps 给前端展示进度条。
 * Publish log 在 git add 之前就"乐观写"一条成功记录——这样本次 log 条目会被
 * git add 一起带进 commit。后续步骤失败时会再追加一条失败记录（append-only 可接受）。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { send, readBody, respondBodyError, parseQueryCode } from "../helpers";
import type {
  BusContext,
  BusReq,
  BusRes,
  PublishLogEntry,
  StepResult,
} from "../types";

interface PreflightResult {
  errors: string[];
  warnings: string[];
  correctedQueries: unknown[];
}

/** 运行 preflight：输入 raw snapshot，输出 errors/warnings/corrected 三元组 */
function preflight(
  ctx: BusContext,
  raw: { queries: unknown[]; submissions: unknown[] }
): PreflightResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const queries = raw.queries as Array<Record<string, unknown>>;
  const submissions = raw.submissions as Array<Record<string, unknown>>;

  // 1. 检查 id 存在且不重复
  const queryIdSet = new Set<string>();
  for (const q of queries) {
    const id = q.id;
    if (typeof id !== "string" || !id) {
      errors.push(`query 缺失 id：${JSON.stringify(q).slice(0, 100)}`);
    } else if (queryIdSet.has(id)) {
      errors.push(`query.id 重复：${id}`);
    } else {
      queryIdSet.add(id);
    }
  }

  // 2. 检查 submission.queryId 引用完整性
  for (const s of submissions) {
    const qid = s.queryId;
    if (typeof qid !== "string" || !queryIdSet.has(qid)) {
      errors.push(
        `submission ${String(s.id)} 的 queryId=${String(qid)} 在 queries 里找不到（孤儿报告）`
      );
    }
  }

  // 3. 用注册簿对齐 code
  const regMap = ctx.codeRegistry.exportMap();
  const correctedQueries = queries.map((q) => {
    const id = q.id as string;
    if (!id) return q;
    const authoritative = regMap[id];
    if (!authoritative) return q;
    if (q.code !== authoritative) {
      warnings.push(
        `query ${id} 的 code 从 ${String(q.code)} 自动对齐到 ${authoritative}（注册簿权威值）`
      );
      return { ...q, code: authoritative };
    }
    return q;
  });

  // 4. code 唯一性
  const codeMap = new Map<string, string>();
  for (const q of correctedQueries) {
    const code = (q as Record<string, unknown>).code;
    const id = (q as Record<string, unknown>).id as string;
    if (typeof code !== "string" || !code) continue;
    const existing = codeMap.get(code);
    if (existing && existing !== id) {
      errors.push(
        `code 冲突：${code} 同时被 query ${existing} 和 ${id} 使用（对齐注册簿后仍冲突）`
      );
    }
    codeMap.set(code, id);
  }

  // 5. 孤儿 outbox 检测（软警告，不阻塞发布）
  try {
    if (fs.existsSync(ctx.outboxDir)) {
      const codesInSnapshot = new Set<string>();
      for (const q of correctedQueries) {
        const c = (q as Record<string, unknown>).code;
        if (typeof c === "string" && c) codesInSnapshot.add(c);
      }
      const orphanByCode = new Map<string, string[]>();
      for (const entry of fs.readdirSync(ctx.outboxDir)) {
        const full = path.join(ctx.outboxDir, entry);
        if (!fs.statSync(full).isDirectory()) continue;
        const code = parseQueryCode(entry);
        if (!code) continue;
        if (codesInSnapshot.has(code)) continue;
        const list = orphanByCode.get(code) ?? [];
        list.push(entry);
        orphanByCode.set(code, list);
      }
      for (const [code, taskIds] of orphanByCode) {
        const preview = taskIds.slice(0, 3).join(", ");
        const more =
          taskIds.length > 3 ? `（等 ${taskIds.length} 个）` : "";
        warnings.push(
          `孤儿 outbox：queryCode=${code} 在 snapshot.queries 里找不到，但磁盘上 .evaluations/outbox/ 仍有 ${taskIds.length} 个 task 目录（${preview}${more}）。发布后对外版 bake 会 fail，请先清理这些目录或补回对应 query。`
        );
      }
    }
  } catch (err) {
    warnings.push(
      `孤儿 outbox 扫描失败（忽略，不影响发布）：${String((err as Error)?.message ?? err)}`
    );
  }

  return { errors, warnings, correctedQueries };
}

/** 跑一个命令，收集 stdout/stderr/exitCode */
function makeRunStep(root: string, augmentedPath: string) {
  return (
    name: string,
    cmd: string,
    args: string[]
  ): Promise<StepResult> =>
    new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd: root,
        shell: false,
        env: { ...process.env, PATH: augmentedPath },
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (c) => {
        out += c.toString();
      });
      child.stderr.on("data", (c) => {
        err += c.toString();
      });
      child.on("close", (code) => {
        resolve({
          name,
          command: `${cmd} ${args.join(" ")}`.trim(),
          ok: code === 0,
          code,
          stdout: out,
          stderr: err,
        });
      });
      child.on("error", (e) => {
        resolve({
          name,
          command: `${cmd} ${args.join(" ")}`.trim(),
          ok: false,
          code: null,
          stdout: out,
          stderr: err + "\n[spawn error] " + (e as Error).message,
        });
      });
    });
}

/** POST /_bus/publish — 一键发布到 GitHub Pages 对外版 */
export async function handlePublish(
  req: BusReq,
  res: BusRes,
  ctx: BusContext
): Promise<void> {
  let raw: string;
  try {
    raw = await readBody(req);
  } catch (e) {
    return respondBodyError(res, e);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return send(res, 400, { error: "invalid json" });
  }
  for (const k of ["products", "queries", "submissions"] as const) {
    if (!Array.isArray(parsed[k])) {
      return send(res, 400, {
        error: `snapshot.${k} must be an array`,
      });
    }
  }

  // ===== Step 0: Preflight =====
  const preflightResult = preflight(ctx, {
    queries: parsed.queries as unknown[],
    submissions: parsed.submissions as unknown[],
  });
  if (preflightResult.errors.length > 0) {
    ctx.appendPublishLog({
      publishedAt: new Date().toISOString(),
      ok: false,
      failedStep: "preflight",
      error: preflightResult.errors.slice(0, 5).join(" | "),
    });
    return send(res, 200, {
      ok: false,
      failedStep: "preflight",
      preflightErrors: preflightResult.errors,
      preflightWarnings: preflightResult.warnings,
      steps: [
        {
          name: "preflight",
          command: "internal preflight check",
          ok: false,
          code: null,
          stdout: `errors:\n  - ${preflightResult.errors.join("\n  - ")}`,
          stderr:
            preflightResult.warnings.length > 0
              ? `warnings:\n  - ${preflightResult.warnings.join("\n  - ")}`
              : "",
        },
      ],
    });
  }
  parsed.queries = preflightResult.correctedQueries;

  // ===== Step 1: 写 _runtime-snapshot.json =====
  const snapshotFile = path.join(ctx.busRoot, "_runtime-snapshot.json");
  const snapshotPayload = {
    version: typeof parsed.version === "number" ? parsed.version : 2,
    exportedAt: new Date().toISOString(),
    products: parsed.products,
    queries: parsed.queries,
    submissions: parsed.submissions,
  };
  try {
    fs.writeFileSync(snapshotFile, JSON.stringify(snapshotPayload, null, 2));
  } catch (e) {
    ctx.appendPublishLog({
      publishedAt: new Date().toISOString(),
      ok: false,
      failedStep: "write-snapshot",
      error: (e as Error).message,
      stats: {
        queries: (snapshotPayload.queries as unknown[]).length,
        submissions: (snapshotPayload.submissions as unknown[]).length,
      },
    });
    return send(res, 200, {
      ok: false,
      failedStep: "write-snapshot",
      error: (e as Error).message,
    });
  }

  // ===== 工具：跑一个命令 =====
  // vite dev server 在 WorkBuddy managed node 下运行时，子进程继承的 PATH
  // 不一定包含 npm。主动从 process.execPath 推出 node bin 目录加到 PATH 前面，
  // 确保 spawn("npm") / spawn("git") 都能找到。
  const nodeBinDir = path.dirname(process.execPath);
  const augmentedPath = `${nodeBinDir}${path.delimiter}${process.env.PATH ?? ""}`;
  const runStep = makeRunStep(ctx.root, augmentedPath);

  const steps: StepResult[] = [
    {
      name: "write-snapshot",
      command: `write .evaluations/_runtime-snapshot.json`,
      ok: true,
      code: 0,
      stdout:
        `products: ${(snapshotPayload.products as unknown[]).length}, ` +
        `queries: ${(snapshotPayload.queries as unknown[]).length}, ` +
        `submissions: ${(snapshotPayload.submissions as unknown[]).length}`,
      stderr: "",
    },
  ];

  const logAndReturn = (
    step: StepResult,
    failedStep: string
  ): PublishLogEntry => ({
    publishedAt: new Date().toISOString(),
    ok: false,
    failedStep,
    error: (step.stderr || step.stdout || "").slice(0, 500),
  });

  // ===== Step 2: build:public（拆四步跑）=====
  const nodeExe = process.execPath;
  const tscBin = path.join(ctx.root, "node_modules", ".bin", "tsc");
  const viteBin = path.join(ctx.root, "node_modules", ".bin", "vite");

  // 2a. seed:dump
  const seedDumpStep = await runStep("seed:dump", nodeExe, [
    "--experimental-strip-types",
    path.join(ctx.root, "scripts/dump-seed.mjs"),
  ]);
  steps.push(seedDumpStep);
  if (!seedDumpStep.ok) {
    ctx.appendPublishLog(logAndReturn(seedDumpStep, "seed:dump"));
    return send(res, 200, { ok: false, failedStep: "seed:dump", steps });
  }

  // 2b. bake:public
  const bakeStep = await runStep("bake:public", nodeExe, [
    path.join(ctx.root, "scripts/bake-public-data.mjs"),
  ]);
  steps.push(bakeStep);
  if (!bakeStep.ok) {
    ctx.appendPublishLog(logAndReturn(bakeStep, "bake:public"));
    return send(res, 200, { ok: false, failedStep: "bake:public", steps });
  }

  // 2c. tsc -b
  const tscStep = await runStep("tsc -b", tscBin, ["-b"]);
  steps.push(tscStep);
  if (!tscStep.ok) {
    ctx.appendPublishLog(logAndReturn(tscStep, "tsc -b"));
    return send(res, 200, { ok: false, failedStep: "tsc -b", steps });
  }

  // 2d. vite build
  const viteBuildStep = await runStep("vite build", viteBin, ["build"]);
  steps.push(viteBuildStep);
  if (!viteBuildStep.ok) {
    ctx.appendPublishLog(logAndReturn(viteBuildStep, "vite build"));
    return send(res, 200, { ok: false, failedStep: "vite build", steps });
  }

  // ===== Step 3: git add =====
  // 乐观写 publish log：在 git add 之前就记录"本次尝试时间"。
  // 这样本次发布的日志条目会被 git add 一起带走 → push 后对外版能拿到最新时间戳。
  const publishedAt = new Date().toISOString();
  const commitMsg = `publish: ${publishedAt}`;
  ctx.appendPublishLog({
    publishedAt,
    ok: true,
    commit: commitMsg,
    stats: {
      queries: (snapshotPayload.queries as unknown[]).length,
      submissions: (snapshotPayload.submissions as unknown[]).length,
    },
  });

  const addStep = await runStep("git add", "git", ["add", "-A"]);
  steps.push(addStep);
  if (!addStep.ok) {
    ctx.appendPublishLog(logAndReturn(addStep, "git add"));
    return send(res, 200, { ok: false, failedStep: "git add", steps });
  }

  // ===== Step 4: git commit（允许 nothing to commit）=====
  const commitStep = await runStep("git commit", "git", [
    "commit",
    "-m",
    commitMsg,
  ]);
  const nothingToCommit =
    !commitStep.ok &&
    /nothing to commit|no changes added to commit/i.test(
      commitStep.stdout + commitStep.stderr
    );
  if (nothingToCommit) {
    commitStep.ok = true;
    commitStep.skipped = true;
    commitStep.note = "nothing to commit (working tree clean)";
  }
  steps.push(commitStep);
  if (!commitStep.ok) {
    ctx.appendPublishLog(logAndReturn(commitStep, "git commit"));
    return send(res, 200, { ok: false, failedStep: "git commit", steps });
  }

  // ===== Step 5: git push =====
  const pushStep = await runStep("git push", "git", ["push", "origin", "HEAD"]);
  steps.push(pushStep);
  if (!pushStep.ok) {
    ctx.appendPublishLog(logAndReturn(pushStep, "git push"));
    return send(res, 200, { ok: false, failedStep: "git push", steps });
  }

  // ===== 成功 =====
  return send(res, 200, {
    ok: true,
    commitMessage: commitMsg,
    publicUrl: "https://ansonliang89.github.io/sophia-rubric-lab/",
    preflightWarnings: preflightResult.warnings,
    steps,
  });
}
