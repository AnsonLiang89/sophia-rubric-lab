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
 *                                             3) git add -A（数据 + 代码一并暂存；.gitignore 自动剔除 public/data/、dist、node_modules）
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
// @ts-expect-error — .mjs 没有类型声明但运行时可直接 import
import { checkBakeFreshness } from "../scripts/check-bake-freshness.mjs";

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

      // 启动期：对外版新鲜度检查（非阻塞，仅打印警告）
      //
      // 为什么需要这一行？——历史教训：编辑完 .evaluations/*.md 或加新 outbox 后
      // 如果忘了跑 `npm run bake:public` 或点"一键发布"，对外版（GitHub Pages）
      // 会悄悄陈旧，管理员完全无感。这里在 dev server 启动瞬间打出提醒，
      // 配合 /_bus/bake-freshness 端点 + 管理员 UI 页脚红点，形成三道保险。
      //
      // 非阻塞：即使检查报错也不能挡住 dev server 启动。
      try {
        const freshness = checkBakeFreshness();
        if (!freshness.fresh) {
          // eslint-disable-next-line no-console
          console.warn(
            `\x1b[33m[bake-freshness]\x1b[0m ⚠ 对外版产物落后于源文件（${freshness.stale.length} 项过期）。`
          );
          for (const s of freshness.stale.slice(0, 5)) {
            // eslint-disable-next-line no-console
            console.warn(`  · ${s.detail}`);
          }
          if (freshness.stale.length > 5) {
            // eslint-disable-next-line no-console
            console.warn(`  ……还有 ${freshness.stale.length - 5} 项未列出，访问 /_bus/bake-freshness 查看完整列表`);
          }
          // eslint-disable-next-line no-console
          console.warn(
            `\x1b[33m[bake-freshness]\x1b[0m 修复：\`npm run bake:public\` 或在管理员页点「一键发布」。`
          );
        } else {
          // eslint-disable-next-line no-console
          console.log(`\x1b[32m[bake-freshness]\x1b[0m ✓ 对外版产物与源文件同步。`);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(
          "[bake-freshness] startup check failed (non-fatal):",
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

      // ------------------------------------------------------------
      // Publish Log：一键发布的审计日志，append-only
      //
      // 每次 POST /_bus/publish 不论成功/失败，都在 `.evaluations/_publish-log.json`
      // 末尾追加一条。前端管理员版和对外版都可以读这份日志，展示"上次更新时间"
      // 并对比两端一致性。
      //
      // 文件格式：
      // {
      //   version: 1,
      //   entries: [
      //     { publishedAt: ISO, ok: true,  commit: "...", stats: {...} },
      //     { publishedAt: ISO, ok: false, failedStep: "bake:public", error: "..." },
      //     ...
      //   ]
      // }
      //
      // 保留上限：200 条（老条目丢弃，够回溯近期几十次发布）。
      // ------------------------------------------------------------
      interface PublishLogEntry {
        publishedAt: string;
        ok: boolean;
        commit?: string;
        failedStep?: string;
        error?: string;
        stats?: Record<string, number>;
      }
      const PUBLISH_LOG_FILE = path.join(busRoot, "_publish-log.json");
      const PUBLISH_LOG_MAX = 200;
      const appendPublishLog = (entry: PublishLogEntry) => {
        try {
          fs.mkdirSync(busRoot, { recursive: true });
          let doc: { version: number; entries: PublishLogEntry[] } = {
            version: 1,
            entries: [],
          };
          if (fs.existsSync(PUBLISH_LOG_FILE)) {
            try {
              const raw = fs.readFileSync(PUBLISH_LOG_FILE, "utf8");
              const parsed = JSON.parse(raw);
              if (parsed && Array.isArray(parsed.entries)) {
                doc = {
                  version: parsed.version === 1 ? 1 : 1,
                  entries: parsed.entries as PublishLogEntry[],
                };
              }
            } catch {
              // 坏文件：覆盖重建，不让历史坏数据阻塞新发布
            }
          }
          doc.entries.push(entry);
          if (doc.entries.length > PUBLISH_LOG_MAX) {
            doc.entries = doc.entries.slice(-PUBLISH_LOG_MAX);
          }
          // Atomic write
          const tmp = `${PUBLISH_LOG_FILE}.tmp`;
          fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
          fs.renameSync(tmp, PUBLISH_LOG_FILE);
        } catch {
          // 日志写失败不应该阻塞发布流程本身
        }
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

          // ---------- GET /bake-freshness （对外版产物是否落后于源文件） ----------
          //
          // 管理员 UI 调这个端点判断"要不要提示管理员重新发布"。
          // 返回结构：
          //   {
          //     fresh: boolean,            // false = 至少有一项过期
          //     bakePresent: boolean,      // public/data 目录是否存在
          //     stale: [{id, kind, detail}],
          //     items: [...]               // 全量检查项（含 fresh=true 的）
          //     checkedAt: ISO timestamp
          //   }
          //
          // 设计动机：.evaluations/*.md / outbox/*.json 改完之后，如果管理员忘了跑
          // `npm run bake:public` 或点"一键发布"，对外版会悄悄陈旧（标准/契约 tab
          // 内容旧、新评测看不到）。这个端点让前端页脚可以显示红点强提醒。
          //
          // 对外版（prod）没有这个端点，`toStaticUrl` 把它映射到 bake 产物是不合适的
          // ——freshness 检查本身就是 dev-only 概念。前端调用时 prod 下应直接跳过。
          if (req.method === "GET" && url === "/_bus/bake-freshness") {
            try {
              const result = checkBakeFreshness();
              return send(res, 200, result);
            } catch (e) {
              return send(res, 500, {
                error: "freshness check failed",
                detail: String((e as Error)?.message ?? e),
              });
            }
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
          //   3. git add -A（把 .evaluations/ 数据改动 + src/ 等代码改动一并暂存）
          //      —— public/data/、dist、node_modules 等在 .gitignore 里自动排除
          //      —— 过去只 add .evaluations/ 会导致代码修复永远推不上去（CI 拿到的是 HEAD 代码），已修正
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

            // ===== Step 0：Preflight 一致性预检 + 自动对齐 =====
            //
            // 目的：在写 runtime-snapshot 和推送到对外版之前，做一次"数据健康体检"。
            // - 硬错误（preflightErrors）：直接拒绝发布，让用户先修 localStorage
            // - 软警告（preflightWarnings）：自动纠正，但告诉用户发生了什么
            //
            // 当前五条规则（从"致命"到"可自愈"）：
            //   1. 所有 query.id 必须存在且非空（硬错误）
            //   2. 所有 submission.queryId 必须能在 queries 里找到（硬错误，否则孤儿）
            //   3. 所有 query.code 必须与 _code-registry.json 里的权威 code 一致（软警告：自动覆盖）
            //   4. 所有 code 在 snapshot 内必须唯一（硬错误，除非 3 已覆盖掉冲突）
            //   5. `.evaluations/outbox/` 里所有 task 的 queryCode 前缀必须在 snapshot.queries 中有对应（软警告：后续 bake 会 fail）
            //
            // 注意：规则 1–4 针对"用户上传的 snapshot"；规则 5 是对磁盘上 outbox 的交叉检查。
            interface PreflightResult {
              errors: string[];
              warnings: string[];
              correctedQueries: unknown[];
            }
            const preflight = (raw2: {
              queries: unknown[];
              submissions: unknown[];
            }): PreflightResult => {
              const errors: string[] = [];
              const warnings: string[] = [];

              const queries = raw2.queries as Array<Record<string, unknown>>;
              const submissions = raw2.submissions as Array<Record<string, unknown>>;

              // 1. 检查 id 存在
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
              const regMap = codeRegistry.exportMap();
              const correctedQueries = queries.map((q) => {
                const id = q.id as string;
                if (!id) return q; // 已在 1 里报错
                const authoritative = regMap[id];
                if (!authoritative) return q; // 注册簿里没登记
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
              //    扫描 .evaluations/outbox/，把每个 task 的 queryCode 前缀解出来，
              //    对比 snapshot.queries.code。若磁盘上有但 snapshot 里没有，就是孤儿——
              //    通常源于"管理员本地删除 query 但 outbox 目录没清"。
              //    这里只 warn 不 error：
              //      - bake 脚本的 P0-1 校验会再挡一道（真会 fail publish）
              //      - 管理员看到 warning 后可以主动清理，或强推（已知代价）
              try {
                if (fs.existsSync(outboxDir)) {
                  const codesInSnapshot = new Set<string>();
                  for (const q of correctedQueries) {
                    const c = (q as Record<string, unknown>).code;
                    if (typeof c === "string" && c) codesInSnapshot.add(c);
                  }
                  const orphanByCode = new Map<string, string[]>();
                  for (const entry of fs.readdirSync(outboxDir)) {
                    const full = path.join(outboxDir, entry);
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
                    const more = taskIds.length > 3 ? `（等 ${taskIds.length} 个）` : "";
                    warnings.push(
                      `孤儿 outbox：queryCode=${code} 在 snapshot.queries 里找不到，但磁盘上 .evaluations/outbox/ 仍有 ${taskIds.length} 个 task 目录（${preview}${more}）。发布后对外版 bake 会 fail，请先清理这些目录或补回对应 query。`
                    );
                  }
                }
              } catch (err) {
                // 孤儿扫描本身失败不应阻塞 publish，只记 warn
                warnings.push(`孤儿 outbox 扫描失败（忽略，不影响发布）：${String((err as Error)?.message ?? err)}`);
              }

              return { errors, warnings, correctedQueries };
            };

            const preflightResult = preflight({
              queries: parsed.queries as unknown[],
              submissions: parsed.submissions as unknown[],
            });

            if (preflightResult.errors.length > 0) {
              appendPublishLog({
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

            // 对齐后的 queries 写回 parsed，后续都用这份
            parsed.queries = preflightResult.correctedQueries;

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
              appendPublishLog({
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
              appendPublishLog({
                publishedAt: new Date().toISOString(),
                ok: false,
                failedStep: "seed:dump",
                error: (seedDumpStep.stderr || seedDumpStep.stdout || "").slice(0, 500),
              });
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
              appendPublishLog({
                publishedAt: new Date().toISOString(),
                ok: false,
                failedStep: "bake:public",
                error: (bakeStep.stderr || bakeStep.stdout || "").slice(0, 500),
              });
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
              appendPublishLog({
                publishedAt: new Date().toISOString(),
                ok: false,
                failedStep: "tsc -b",
                error: (tscStep.stderr || tscStep.stdout || "").slice(0, 500),
              });
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
              appendPublishLog({
                publishedAt: new Date().toISOString(),
                ok: false,
                failedStep: "vite build",
                error: (viteBuildStep.stderr || viteBuildStep.stdout || "").slice(0, 500),
              });
              return send(res, 200, {
                ok: false,
                failedStep: "vite build",
                steps,
              });
            }

            // ===== Step 3：git add =====
            // 注意：public/data/ 已在 .gitignore 中，CI 构建时会重新烘焙，
            // 因此这里不 add。只 add 真正需要进仓库的 .evaluations/ 即可。
            //
            // 乐观写 publish log：在 git add 之前就记录"本次尝试时间"。
            // 这样本次发布的日志条目会被 git add 一起带走 → push 后对外版能拿到最新时间戳。
            // 后续 add/commit/push 失败时，log 还在本地，下次发布会一并推上去（append-only 可接受）。
            const publishedAt = new Date().toISOString();
            const commitMsg = `publish: ${publishedAt}`;
            appendPublishLog({
              publishedAt,
              ok: true,
              commit: commitMsg,
              stats: {
                queries: (snapshotPayload.queries as unknown[]).length,
                submissions: (snapshotPayload.submissions as unknown[]).length,
              },
            });

            const addStep = await runStep("git add", "git", [
              "add",
              "-A",
            ]);
            steps.push(addStep);
            if (!addStep.ok) {
              appendPublishLog({
                publishedAt: new Date().toISOString(),
                ok: false,
                failedStep: "git add",
                error: (addStep.stderr || addStep.stdout || "").slice(0, 500),
              });
              return send(res, 200, {
                ok: false,
                failedStep: "git add",
                steps,
              });
            }

            // ===== Step 4：git commit（允许 nothing to commit） =====
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
              appendPublishLog({
                publishedAt: new Date().toISOString(),
                ok: false,
                failedStep: "git commit",
                error: (commitStep.stderr || commitStep.stdout || "").slice(0, 500),
              });
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
              appendPublishLog({
                publishedAt: new Date().toISOString(),
                ok: false,
                failedStep: "git push",
                error: (pushStep.stderr || pushStep.stdout || "").slice(0, 500),
              });
              return send(res, 200, {
                ok: false,
                failedStep: "git push",
                steps,
              });
            }

            // ===== 成功：publish log 已在 git add 之前写过了（乐观提前写，保证本次进 commit） =====

            return send(res, 200, {
              ok: true,
              commitMessage: commitMsg,
              publicUrl: "https://ansonliang89.github.io/sophia-rubric-lab/",
              preflightWarnings: preflightResult.warnings,
              steps,
            });
          }

          // ---------- GET /publish-log ----------
          // 返回发布历史（append-only），最新在数组末尾。
          // 管理员版 & 对外版都可调用（只读）；对外版通过 bake 脚本拷贝到 public/data/publish-log.json。
          if (req.method === "GET" && url === "/_bus/publish-log") {
            if (!fs.existsSync(PUBLISH_LOG_FILE)) {
              return send(res, 200, { version: 1, entries: [] });
            }
            try {
              const raw = fs.readFileSync(PUBLISH_LOG_FILE, "utf8");
              const parsed = JSON.parse(raw);
              if (!parsed || !Array.isArray(parsed.entries)) {
                return send(res, 200, { version: 1, entries: [] });
              }
              return send(res, 200, {
                version: parsed.version === 1 ? 1 : 1,
                entries: parsed.entries,
              });
            } catch {
              return send(res, 200, { version: 1, entries: [] });
            }
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
                const queryCode = parseQueryCode(taskId);
                // 冗余写 queryId（从注册簿反查），给前端 outboxAgg 做稳定回链
                const queryId = queryCode
                  ? codeRegistry.lookupByCode(queryCode)?.queryId ?? null
                  : null;
                return {
                  taskId,
                  queryCode,
                  queryId,
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
            // 冗余注入 queryId（不覆盖已有 queryId）
            if (typeof j === "object" && !(j as { queryId?: string }).queryId) {
              const code = parseQueryCode(taskId);
              const qId = code
                ? codeRegistry.lookupByCode(code)?.queryId ?? null
                : null;
              if (qId) (j as { queryId?: string }).queryId = qId;
            }
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
            const code = parseQueryCode(taskId);
            const queryId = code
              ? codeRegistry.lookupByCode(code)?.queryId ?? null
              : null;
            // payload 层也注入（不覆盖已有）
            if (
              latestContent &&
              typeof latestContent === "object" &&
              !(latestContent as { queryId?: string }).queryId &&
              queryId
            ) {
              (latestContent as { queryId?: string }).queryId = queryId;
            }
            return send(res, 200, {
              taskId,
              queryId,
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
