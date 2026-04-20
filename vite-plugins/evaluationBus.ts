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
 *   POST   /_bus/runtime-snapshot          body: LabSnapshot
 *                                          => 写 .evaluations/_runtime-snapshot.json
 *                                             （管理员一键把本地 localStorage 倒出来，供 bake 脚本合并）
 *   GET    /_bus/runtime-snapshot          => 读 _runtime-snapshot.json（没有返回 204）
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
