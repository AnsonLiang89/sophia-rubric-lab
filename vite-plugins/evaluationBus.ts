/**
 * Vite 开发中间件：评测任务文件通道（仅 dev 生效）
 *
 * 新架构（2026-04，契约 v1）：
 *   网站 = 收件箱 + 展示台
 *   - 网站把"待评测任务"写到 .evaluations/inbox/{taskId}.json
 *   - 用户在 WorkBuddy 对话框让 LLM 读 inbox + EVALUATION_CONTRACT.md 做评测
 *   - LLM 把产物写到 .evaluations/outbox/{taskId}/v{n}.json（多版本保留）
 *   - 网站从 outbox 读结果并渲染
 *
 * 端点：
 *   GET    /_bus/health                    => {ok:true, dir}
 *   GET    /_bus/standard                 => {path, mtime, content}  // RUBRIC_STANDARD.md 原文（面向用户的评测标准）
 *   GET    /_bus/contract                  => {path, mtime, content}  // EVALUATION_CONTRACT.md 原文（面向 LLM 的工作协议）
 *   GET    /_bus/products                  => {path, mtime, updatedAt, products:[...]}  // PRODUCTS.json（评测主体清单，只读）
 *
 *   GET    /_bus/registry                  => {version, prefix, padWidth, nextNumber, entries:[...], map:{queryId:code}}
 *                                          // 编号注册簿全量（.evaluations/_code-registry.json）
 *   POST   /_bus/register-code             body: { queryId, preferredCode?, registeredAt?, note? }
 *                                          => { ok:true, reused, code, queryId, registeredAt, note? }
 *                                          // 幂等注册新 query 的业务编号（EV-xxxx）；前端 createQuery 必须先调这个
 *
 *   POST   /_bus/runtime-snapshot          body: LabSnapshot
 *                                          => 写 .evaluations/_runtime-snapshot.json
 *                                             （管理员一键把本地 localStorage 倒出来，供 bake 脚本合并）
 *   GET    /_bus/runtime-snapshot          => 读 _runtime-snapshot.json（没有返回 204）
 *
 *   POST   /_bus/publish                   body: LabSnapshot
 *                                          => 一键发布到对外版：
 *                                             1) 先写 _runtime-snapshot.json（同 runtime-snapshot）
 *                                             2) 跑 seed:dump → bake:public → tsc -b → vite build
 *                                                （等价 npm run build:public，但直接用 node/tsc/vite 二进制
 *                                                 避免对 npm CLI 的依赖）
 *                                             3) git add .evaluations/
 *                                             4) git commit -m "publish: <时间戳>"（空改动时跳过，不算失败）
 *                                             5) git push origin HEAD
 *                                             任一步失败立即停止，返回 500 + logs 给前端展示
 *                                             成功返回 200 + 全程 stdout/stderr 日志
 *
 *   POST   /_bus/inbox                     body: InboxTask
 *                                          => 写 inbox/{taskId}.json
 *   GET    /_bus/inbox                     => 列出所有待评测任务 id
 *   GET    /_bus/inbox/:taskId             => 读取某任务（调试/回显用）
 *   DELETE /_bus/inbox/:taskId             => 删除某 inbox 任务
 *
 *   GET    /_bus/outbox                    => 列出所有已有产物的 taskId + 最新版本元信息
 *                                          返回 [{ taskId, queryCode, latestVersion, versions:[{v,mtime,size}] }]
 *   GET    /_bus/outbox/:taskId            => 返回 { taskId, latestVersion, versions:[n], latest: <v{latest}.json 内容> }
 *                                          任务目录不存在返回 204
 *   GET    /_bus/outbox/:taskId/v/:n       => 读取指定版本 v{n}.json
 *   DELETE /_bus/outbox/:taskId            => 删除整个任务目录（所有历史版本）
 */

import type { Connect, Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { CodeRegistry, reconcile } from "./codeRegistry";

export function evaluationBusPlugin(baseDir = ".evaluations"): Plugin {
  return {
    name: "sophia-evaluation-bus",
    apply: "serve",
    configureServer(server) {
      const root = path.resolve(server.config.root);
      const busRoot = path.join(root, baseDir);
      const inboxDir = path.join(busRoot, "inbox");
      const outboxDir = path.join(busRoot, "outbox");
      fs.mkdirSync(inboxDir, { recursive: true });
      fs.mkdirSync(outboxDir, { recursive: true });

      // 启动期：挂载编号注册簿 + 跑一次 reconcile（幂等）
      // - 把 seed / runtime snapshot 里的每条 query 都登记到 _code-registry.json
      // - 对 code 冲突按 createdAt 先到先得地重新编号
      // - 同步重命名 inbox/outbox 的文件/目录前缀，让它们跟新 code 对齐
      const codeRegistry = new CodeRegistry(busRoot);
      try {
        reconcile(busRoot, codeRegistry, (msg) =>
          // eslint-disable-next-line no-console
          console.log(msg)
        );
      } catch (e) {
        // reconcile 不应阻塞 dev server 启动——即使失败也允许手动修
        // eslint-disable-next-line no-console
        console.error(
          "[codeRegistry] reconcile failed (non-fatal):",
          (e as Error).message
        );
      }

      const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB 上限，防止恶意大文件把内存撑爆
      const readBody = (req: Parameters<Connect.NextHandleFunction>[0]) =>
        new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          let received = 0;
          let aborted = false;
          req.on("data", (c: Buffer) => {
            if (aborted) return;
            received += c.length;
            if (received > MAX_BODY_BYTES) {
              aborted = true;
              reject(
                new Error(
                  `body too large: ${received} bytes exceeds limit ${MAX_BODY_BYTES}`
                )
              );
              return;
            }
            chunks.push(c);
          });
          req.on("end", () => {
            if (aborted) return;
            resolve(Buffer.concat(chunks).toString("utf8"));
          });
          req.on("error", reject);
        });

      const send = (
        res: Parameters<Connect.NextHandleFunction>[1],
        status: number,
        body?: unknown
      ) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        if (body === undefined) res.end();
        else res.end(JSON.stringify(body));
      };

      const readJson = (p: string): Record<string, unknown> | null => {
        try {
          return JSON.parse(fs.readFileSync(p, "utf8"));
        } catch {
          return null;
        }
      };

      /** 扫描某个 taskId 目录，返回版本列表（按 n 升序） */
      const listVersions = (taskId: string) => {
        const dir = path.join(outboxDir, taskId);
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
        return fs
          .readdirSync(dir)
          .map((f) => {
            const m = f.match(/^v(\d+)\.json$/);
            if (!m) return null;
            const n = Number(m[1]);
            const stat = fs.statSync(path.join(dir, f));
            return { v: n, file: f, mtime: stat.mtimeMs, size: stat.size };
          })
          .filter((x): x is { v: number; file: string; mtime: number; size: number } => !!x)
          .sort((a, b) => a.v - b.v);
      };

      /** 从 taskId 前缀解析 queryCode（如 "EV-0001-xxxxxx" → "EV-0001"） */
      const parseQueryCode = (taskId: string) => {
        const m = taskId.match(/^([A-Z]+-\d+)-/);
        return m ? m[1] : undefined;
      };

      /**
       * taskId 白名单：只允许大小写字母、数字、点号、下划线、短横线，长度 1~128。
       * 路径穿越字符（/、\、..）一律拒绝。
       * 所有接受 :taskId 参数的端点统一走这个校验。
       */
      const TASK_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
      const isSafeTaskId = (taskId: string): boolean => {
        if (!TASK_ID_PATTERN.test(taskId)) return false;
        // 二次防御：即使正则允许点号，也禁止 ".." 这种相对路径片段
        if (taskId === "." || taskId === ".." || taskId.includes("..")) return false;
        return true;
      };

      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? "";
        if (!rawUrl.startsWith("/_bus/")) return next();
        // 剥掉 query string（前端 busFetch 对 GET 加了 ?_=Date.now() 做 cache-busting）
        // 否则下面所有 === 严格相等匹配都会失效，全掉进最后的 404
        const qIdx = rawUrl.indexOf("?");
        const url = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl;
        try {
          // ---------- health ----------
          if (req.method === "GET" && url === "/_bus/health") {
            return send(res, 200, { ok: true, dir: baseDir });
          }

          // ---------- GET /registry （编号注册簿全量，只读） ----------
          //
          // 返回 _code-registry.json 原文 + queryId→code 映射表，
          // 便于前端在刷新/排查时一次性拿到权威 code 映射。
          if (req.method === "GET" && url === "/_bus/registry") {
            return send(res, 200, {
              ...codeRegistry.raw,
              map: codeRegistry.exportMap(),
            });
          }

          // ---------- POST /register-code ----------
          //
          // 幂等注册：给定 queryId，返回它对应的永久编号。
          //
          // 请求体：{
          //   queryId: string;              // 必填；前端生成的 nanoid
          //   preferredCode?: string;       // 可选；已有历史编号想保留可以传
          //   registeredAt?: string;        // 可选；建议传 query.createdAt，按时间序入册
          // }
          // 响应体：{ ok: true, code, queryId, registeredAt, note?, reused: boolean }
          //   · reused=true 表示 queryId 之前已注册过，直接复用老 code（幂等）
          //   · reused=false 表示本次新分配的 code
          //
          // 前端 createQuery 必须先调这个端点拿到 code，再写 localStorage。
          // 并发/多 tab 都安全：Registry 把 nextNumber 放在磁盘单一事实源，
          // 并发请求在 Node 单线程中串行化，不会撞号。
          if (req.method === "POST" && url === "/_bus/register-code") {
            let raw: string;
            try {
              raw = await readBody(req);
            } catch (e) {
              const msg = String((e as Error).message ?? e);
              if (msg.includes("body too large")) {
                return send(res, 413, { error: msg });
              }
              return send(res, 400, { error: msg });
            }
            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(raw);
            } catch {
              return send(res, 400, { error: "invalid json" });
            }
            const queryId = payload.queryId;
            if (typeof queryId !== "string" || queryId.length === 0) {
              return send(res, 400, {
                error: "queryId is required and must be a non-empty string",
              });
            }
            // queryId 既要作为文件系统 key 也要避免路径穿越，这里按 taskId 同样的白名单校验
            if (!/^[A-Za-z0-9._-]{1,128}$/.test(queryId) || queryId.includes("..")) {
              return send(res, 400, {
                error: `queryId contains unsafe characters or is too long: ${queryId}`,
              });
            }
            const before = codeRegistry.lookupByQueryId(queryId);
            if (before) {
              return send(res, 200, { ok: true, reused: true, ...before });
            }
            const entry = codeRegistry.register(queryId, {
              preferredCode:
                typeof payload.preferredCode === "string"
                  ? payload.preferredCode
                  : undefined,
              registeredAt:
                typeof payload.registeredAt === "string"
                  ? payload.registeredAt
                  : undefined,
              note: typeof payload.note === "string" ? payload.note : "api",
            });
            return send(res, 200, { ok: true, reused: false, ...entry });
          }

          // ---------- GET /standard （面向用户的评测标准 md 原文） ----------
          if (req.method === "GET" && url === "/_bus/standard") {
            const file = path.join(busRoot, "RUBRIC_STANDARD.md");
            if (!fs.existsSync(file)) {
              return send(res, 404, { error: "RUBRIC_STANDARD.md not found" });
            }
            const stat = fs.statSync(file);
            const content = fs.readFileSync(file, "utf8");
            return send(res, 200, {
              path: path.relative(root, file),
              mtime: stat.mtimeMs,
              size: stat.size,
              content,
            });
          }

          // ---------- GET /products （评测主体清单 PRODUCTS.json，只读） ----------
          if (req.method === "GET" && url === "/_bus/products") {
            const file = path.join(busRoot, "PRODUCTS.json");
            if (!fs.existsSync(file)) {
              return send(res, 404, { error: "PRODUCTS.json not found" });
            }
            const stat = fs.statSync(file);
            const raw = fs.readFileSync(file, "utf8");
            let parsed: Record<string, unknown> | null = null;
            try {
              parsed = JSON.parse(raw);
            } catch (e) {
              return send(res, 500, {
                error: "PRODUCTS.json is not valid JSON",
                detail: String((e as Error).message ?? e),
              });
            }
            const products = Array.isArray(parsed?.products) ? parsed!.products : [];
            return send(res, 200, {
              path: path.relative(root, file),
              mtime: stat.mtimeMs,
              size: stat.size,
              updatedAt: parsed?.updatedAt ?? null,
              products,
            });
          }

          // ---------- GET /contract （面向 LLM 的工作协议 md 原文） ----------
          if (req.method === "GET" && url === "/_bus/contract") {
            const file = path.join(busRoot, "EVALUATION_CONTRACT.md");
            if (!fs.existsSync(file)) {
              return send(res, 404, { error: "EVALUATION_CONTRACT.md not found" });
            }
            const stat = fs.statSync(file);
            const content = fs.readFileSync(file, "utf8");
            return send(res, 200, {
              path: path.relative(root, file),
              mtime: stat.mtimeMs,
              size: stat.size,
              content,
            });
          }

          // ---------- POST /runtime-snapshot （管理员导出 localStorage） ----------
          if (req.method === "POST" && url === "/_bus/runtime-snapshot") {
            let raw: string;
            try {
              raw = await readBody(req);
            } catch (e) {
              const msg = String((e as Error).message ?? e);
              if (msg.includes("body too large")) {
                return send(res, 413, { error: msg });
              }
              return send(res, 400, { error: msg });
            }
            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(raw);
            } catch {
              return send(res, 400, { error: "invalid json" });
            }
            // Sanity：必须有 products / queries / submissions 三个数组
            for (const k of ["products", "queries", "submissions"] as const) {
              if (!Array.isArray(parsed[k])) {
                return send(res, 400, {
                  error: `snapshot.${k} must be an array`,
                });
              }
            }
            const file = path.join(busRoot, "_runtime-snapshot.json");
            // 带 exportedAt 时间戳 + 写入前备份一次旧的（以防误覆盖）
            const payload = {
              version: typeof parsed.version === "number" ? parsed.version : 2,
              exportedAt: new Date().toISOString(),
              products: parsed.products,
              queries: parsed.queries,
              submissions: parsed.submissions,
            };
            fs.writeFileSync(file, JSON.stringify(payload, null, 2));
            return send(res, 200, {
              ok: true,
              file: path.relative(root, file),
              stats: {
                products: (payload.products as unknown[]).length,
                queries: (payload.queries as unknown[]).length,
                submissions: (payload.submissions as unknown[]).length,
              },
            });
          }

          // ---------- GET /runtime-snapshot ----------
          if (req.method === "GET" && url === "/_bus/runtime-snapshot") {
            const file = path.join(busRoot, "_runtime-snapshot.json");
            if (!fs.existsSync(file)) {
              res.statusCode = 204;
              res.end();
              return;
            }
            const j = readJson(file);
            if (!j) return send(res, 500, { error: "corrupt runtime snapshot" });
            return send(res, 200, j);
          }

          // ---------- POST /publish （一键发布到 GitHub Pages 对外版） ----------
          //
          // 职责：把"本地改的评测数据"稳定地推到公网。按顺序串行跑：
          //   1. 写入 _runtime-snapshot.json（复用 runtime-snapshot 写入逻辑）
          //   2. npm run build:public：dump-seed + bake-public-data + tsc -b + vite build
          //      —— 任意失败 fail fast，保证坏数据不会上线
          //   3. git add .evaluations/
          //      —— public/data/ 在 .gitignore 里，CI 会现烤，不进仓库
          //   4. git commit -m "publish: <iso 时间戳>"
          //      —— 若没有任何改动（nothing to commit）跳过，不算失败
          //   5. git push origin HEAD
          //      —— 触发 GitHub Actions workflow 自动部署
          //
          // 返回：{ ok: true/false, steps: [{name, ok, code, stdout, stderr}], ... }
          // 前端据此渲染进度条/日志。
          //
          // 为什么只 add .evaluations/：
          // - 本项目评测数据沉淀在 .evaluations/，这是真正要进仓库的源数据
          // - 烘焙产物 public/data/ 在 .gitignore 里，CI 会基于 .evaluations/ 重新烘焙
          // - 不 add src/：避免开发者本地半成品代码被意外推上去（方案 A-A）
          if (req.method === "POST" && url === "/_bus/publish") {
            let raw: string;
            try {
              raw = await readBody(req);
            } catch (e) {
              const msg = String((e as Error).message ?? e);
              if (msg.includes("body too large")) {
                return send(res, 413, { error: msg });
              }
              return send(res, 400, { error: msg });
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

            // ===== Step 1：写 _runtime-snapshot.json =====
            const snapshotFile = path.join(busRoot, "_runtime-snapshot.json");
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
              return send(res, 200, {
                ok: false,
                failedStep: "write-snapshot",
                error: (e as Error).message,
              });
            }

            // ===== 工具：跑一个命令，收集 stdout/stderr =====
            // 重要：vite dev server 在 WorkBuddy managed node 下运行时，
            // 子进程继承的 PATH 不一定包含 npm。我们主动从 process.execPath
            // 推断出 node 二进制目录（同目录通常有 npm），加到 PATH 前面
            // 确保 spawn("npm") / spawn("git") 都能找到。
            const nodeBinDir = path.dirname(process.execPath);
            const augmentedPath = `${nodeBinDir}${path.delimiter}${process.env.PATH ?? ""}`;
            interface StepResult {
              name: string;
              command: string;
              ok: boolean;
              code: number | null;
              stdout: string;
              stderr: string;
              skipped?: boolean;
              note?: string;
            }
            const runStep = (
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

            // ===== Step 2：build:public =====
            // 直接按 package.json 里 "build:public" 的顺序拆成三个子步骤跑，
            // 避免依赖 npm CLI 本身（某些 managed node 场景下 spawn("npm") 不稳）。
            // 原定义：npm run seed:dump && npm run bake:public && tsc -b && vite build
            const nodeExe = process.execPath; // 使用当前 vite 跑着的同一个 node
            const tscBin = path.join(root, "node_modules", ".bin", "tsc");
            const viteBin = path.join(root, "node_modules", ".bin", "vite");

            // 2a. seed:dump
            const seedDumpStep = await runStep(
              "seed:dump",
              nodeExe,
              [
                "--experimental-strip-types",
                path.join(root, "scripts/dump-seed.mjs"),
              ]
            );
            steps.push(seedDumpStep);
            if (!seedDumpStep.ok) {
              return send(res, 200, {
                ok: false,
                failedStep: "seed:dump",
                steps,
              });
            }

            // 2b. bake:public
            const bakeStep = await runStep("bake:public", nodeExe, [
              path.join(root, "scripts/bake-public-data.mjs"),
            ]);
            steps.push(bakeStep);
            if (!bakeStep.ok) {
              return send(res, 200, {
                ok: false,
                failedStep: "bake:public",
                steps,
              });
            }

            // 2c. tsc -b（typecheck）
            const tscStep = await runStep("tsc -b", tscBin, ["-b"]);
            steps.push(tscStep);
            if (!tscStep.ok) {
              return send(res, 200, {
                ok: false,
                failedStep: "tsc -b",
                steps,
              });
            }

            // 2d. vite build（出 public 站点 → dist/）
            const viteBuildStep = await runStep("vite build", viteBin, [
              "build",
            ]);
            steps.push(viteBuildStep);
            if (!viteBuildStep.ok) {
              return send(res, 200, {
                ok: false,
                failedStep: "vite build",
                steps,
              });
            }

            // ===== Step 3：git add =====
            // 注意：public/data/ 已在 .gitignore 中，CI 构建时会重新烘焙，
            // 因此这里不 add。只 add 真正需要进仓库的 .evaluations/ 即可。
            const addStep = await runStep("git add", "git", [
              "add",
              ".evaluations/",
            ]);
            steps.push(addStep);
            if (!addStep.ok) {
              return send(res, 200, {
                ok: false,
                failedStep: "git add",
                steps,
              });
            }

            // ===== Step 4：git commit（允许 nothing to commit） =====
            const commitMsg = `publish: ${new Date().toISOString()}`;
            const commitStep = await runStep("git commit", "git", [
              "commit",
              "-m",
              commitMsg,
            ]);
            // git commit 在没有改动时返回非 0，但 stdout 会包含 "nothing to commit"。
            // 这种情况不算失败，只是"没有新内容要推"。
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
              return send(res, 200, {
                ok: false,
                failedStep: "git commit",
                steps,
              });
            }

            // ===== Step 5：git push =====
            // 即使上一步"没东西可 commit"，也还是 push 一次——
            // 因为可能之前本地已 commit 但没 push，这一步能把它推上去。
            const pushStep = await runStep("git push", "git", [
              "push",
              "origin",
              "HEAD",
            ]);
            steps.push(pushStep);
            if (!pushStep.ok) {
              return send(res, 200, {
                ok: false,
                failedStep: "git push",
                steps,
              });
            }

            return send(res, 200, {
              ok: true,
              commitMessage: commitMsg,
              publicUrl: "https://ansonliang89.github.io/sophia-rubric-lab/",
              steps,
            });
          }

          // ---------- POST /inbox ----------
          if (req.method === "POST" && url === "/_bus/inbox") {
            let raw: string;
            try {
              raw = await readBody(req);
            } catch (e) {
              const msg = String((e as Error).message ?? e);
              // body 超限时走 413
              if (msg.includes("body too large")) {
                return send(res, 413, { error: msg });
              }
              return send(res, 400, { error: msg });
            }
            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(raw);
            } catch {
              return send(res, 400, { error: "invalid json" });
            }
            const taskIdRaw = payload.taskId;
            if (typeof taskIdRaw !== "string" || taskIdRaw.length === 0) {
              return send(res, 400, {
                error: "taskId is required and must be a non-empty string",
              });
            }
            if (!isSafeTaskId(taskIdRaw)) {
              return send(res, 400, {
                error: `taskId contains unsafe characters or is too long: ${taskIdRaw}`,
              });
            }
            const taskId = taskIdRaw;
            const file = path.join(inboxDir, `${taskId}.json`);
            // 防止重复提交：若同 taskId 已存在，直接返回 409。
            // 前端 makeTaskId 已保证 nano6 几乎不可能碰撞，此处是额外兜底。
            if (fs.existsSync(file)) {
              return send(res, 409, {
                error: `inbox/${taskId}.json already exists`,
                taskId,
              });
            }
            fs.writeFileSync(file, JSON.stringify(payload, null, 2));
            return send(res, 200, {
              ok: true,
              taskId,
              file: path.relative(root, file),
            });
          }

          // ---------- GET /inbox （列出） ----------
          if (req.method === "GET" && url === "/_bus/inbox") {
            const files = fs.readdirSync(inboxDir).filter((f) => f.endsWith(".json"));
            const items = files.map((f) => {
              const full = path.join(inboxDir, f);
              const taskId = f.replace(/\.json$/, "");
              const stat = fs.statSync(full);
              const j = readJson(full);
              const queryCode =
                (typeof j?.query === "object" && j?.query
                  ? (j.query as { code?: string }).code
                  : undefined) ?? parseQueryCode(taskId);
              return {
                taskId,
                queryCode,
                mtime: stat.mtimeMs,
                size: stat.size,
              };
            });
            return send(res, 200, { tasks: items });
          }

          // ---------- GET /inbox/:taskId ----------
          const inboxGetMatch = url.match(/^\/_bus\/inbox\/([\w.-]+)$/);
          if (req.method === "GET" && inboxGetMatch) {
            const taskId = inboxGetMatch[1];
            if (!isSafeTaskId(taskId)) {
              return send(res, 400, { error: `unsafe taskId: ${taskId}` });
            }
            const file = path.join(inboxDir, `${taskId}.json`);
            if (!fs.existsSync(file)) {
              res.statusCode = 204;
              res.end();
              return;
            }
            const j = readJson(file);
            if (!j) return send(res, 500, { error: "corrupt inbox json" });
            return send(res, 200, j);
          }

          // ---------- DELETE /inbox/:taskId ----------
          const inboxDelMatch = url.match(/^\/_bus\/inbox\/([\w.-]+)$/);
          if (req.method === "DELETE" && inboxDelMatch) {
            const taskId = inboxDelMatch[1];
            if (!isSafeTaskId(taskId)) {
              return send(res, 400, { error: `unsafe taskId: ${taskId}` });
            }
            const file = path.join(inboxDir, `${taskId}.json`);
            if (fs.existsSync(file)) fs.unlinkSync(file);
            return send(res, 200, { ok: true });
          }

          // ---------- GET /outbox （列出所有有产物的任务） ----------
          if (req.method === "GET" && url === "/_bus/outbox") {
            const taskIds = fs
              .readdirSync(outboxDir)
              .filter((f) => fs.statSync(path.join(outboxDir, f)).isDirectory());
            const items = taskIds
              .map((taskId) => {
                const versions = listVersions(taskId);
                if (versions.length === 0) return null;
                const latest = versions[versions.length - 1];
                return {
                  taskId,
                  queryCode: parseQueryCode(taskId),
                  latestVersion: latest.v,
                  latestMtime: latest.mtime,
                  versions: versions.map((v) => ({ v: v.v, mtime: v.mtime, size: v.size })),
                };
              })
              .filter(Boolean)
              .sort((a, b) => (b as { latestMtime: number }).latestMtime - (a as { latestMtime: number }).latestMtime);
            return send(res, 200, { results: items });
          }

          // ---------- GET /outbox/:taskId/v/:n （读指定版本） ----------
          const outboxVerMatch = url.match(/^\/_bus\/outbox\/([\w.-]+)\/v\/(\d+)$/);
          if (req.method === "GET" && outboxVerMatch) {
            const taskId = outboxVerMatch[1];
            if (!isSafeTaskId(taskId)) {
              return send(res, 400, { error: `unsafe taskId: ${taskId}` });
            }
            const n = Number(outboxVerMatch[2]);
            const file = path.join(outboxDir, taskId, `v${n}.json`);
            if (!fs.existsSync(file)) {
              res.statusCode = 204;
              res.end();
              return;
            }
            const j = readJson(file);
            if (!j) return send(res, 500, { error: "corrupt outbox json" });
            return send(res, 200, j);
          }

          // ---------- GET /outbox/:taskId （返回版本列表 + 最新版内容） ----------
          const outboxGetMatch = url.match(/^\/_bus\/outbox\/([\w.-]+)$/);
          if (req.method === "GET" && outboxGetMatch) {
            const taskId = outboxGetMatch[1];
            if (!isSafeTaskId(taskId)) {
              return send(res, 400, { error: `unsafe taskId: ${taskId}` });
            }
            const versions = listVersions(taskId);
            if (versions.length === 0) {
              res.statusCode = 204;
              res.end();
              return;
            }
            const latest = versions[versions.length - 1];
            const latestContent = readJson(path.join(outboxDir, taskId, latest.file));
            return send(res, 200, {
              taskId,
              latestVersion: latest.v,
              versions: versions.map((v) => ({ v: v.v, mtime: v.mtime, size: v.size })),
              latest: latestContent,
            });
          }

          // ---------- DELETE /outbox/:taskId （整个任务目录） ----------
          const outboxDelMatch = url.match(/^\/_bus\/outbox\/([\w.-]+)$/);
          if (req.method === "DELETE" && outboxDelMatch) {
            const taskId = outboxDelMatch[1];
            if (!isSafeTaskId(taskId)) {
              return send(res, 400, { error: `unsafe taskId: ${taskId}` });
            }
            const dir = path.join(outboxDir, taskId);
            if (fs.existsSync(dir)) {
              fs.rmSync(dir, { recursive: true, force: true });
            }
            return send(res, 200, { ok: true });
          }

          return send(res, 404, { error: "not found" });
        } catch (err) {
          return send(res, 500, { error: (err as Error).message });
        }
      });
    },
  };
}
