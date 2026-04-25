/**
 * Vite 开发中间件：评测任务文件通道（仅 dev 生效）
 *
 * 新架构（2026-04，契约 v1；本文件 2026-04-25 做了模块化重构）：
 *   网站 = 收件箱 + 展示台
 *   - 网站把"待评测任务"写到 .evaluations/inbox/{taskId}.json
 *   - 用户在 WorkBuddy 对话框让 LLM 读 inbox + EVALUATION_CONTRACT.md 做评测
 *   - LLM 把产物写到 .evaluations/outbox/{taskId}/v{n}.json（多版本保留）
 *   - 网站从 outbox 读结果并渲染
 *
 * 本文件只做两件事：
 *   1. 启动期初始化（reconcile + bake freshness + 预加载 codeRegistry）
 *   2. HTTP 路由 dispatch：把 method + url 派发给 bus/handlers/*.ts 里的具体 handler
 *
 * 所有业务逻辑都在 `vite-plugins/bus/` 子目录里，主文件 ≤ 250 行。
 * 加新端点的路径：在对应 handler 文件里加函数，然后在本文件 dispatch 表里注册。
 *
 * 端点总览：
 *   GET    /_bus/health                    ──► handlers/misc.ts · handleHealth
 *   GET    /_bus/bake-freshness            ──► handlers/misc.ts · handleBakeFreshness
 *   GET    /_bus/registry                  ──► handlers/misc.ts · handleGetRegistry
 *   POST   /_bus/register-code             ──► handlers/misc.ts · handleRegisterCode
 *
 *   GET    /_bus/standard                  ──► handlers/docs.ts · handleGetStandard
 *   GET    /_bus/contract                  ──► handlers/docs.ts · handleGetContract
 *   GET    /_bus/products                  ──► handlers/docs.ts · handleGetProducts
 *
 *   POST   /_bus/runtime-snapshot          ──► handlers/runtime.ts · handlePostRuntimeSnapshot
 *   GET    /_bus/runtime-snapshot          ──► handlers/runtime.ts · handleGetRuntimeSnapshot
 *
 *   POST   /_bus/publish                   ──► handlers/publish.ts · handlePublish
 *   GET    /_bus/publish-log               ──► handlers/publishLog.ts · handleGetPublishLog
 *
 *   POST   /_bus/inbox                     ──► handlers/inbox.ts · handlePostInbox
 *   GET    /_bus/inbox                     ──► handlers/inbox.ts · handleListInbox
 *   GET    /_bus/inbox/:taskId             ──► handlers/inbox.ts · handleGetInboxTask
 *   DELETE /_bus/inbox/:taskId             ──► handlers/inbox.ts · handleDeleteInboxTask
 *
 *   GET    /_bus/outbox                    ──► handlers/outbox.ts · handleListOutbox
 *   GET    /_bus/outbox/:taskId            ──► handlers/outbox.ts · handleGetOutboxTask
 *   GET    /_bus/outbox/:taskId/v/:n       ──► handlers/outbox.ts · handleGetOutboxVersion
 *   DELETE /_bus/outbox/:taskId            ──► handlers/outbox.ts · handleDeleteOutboxTask
 */

import type { Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import { CodeRegistry } from "./codeRegistry";
import { send } from "./bus/helpers";
import { getPublishLogFile, makeAppendPublishLog } from "./bus/publishLog";
import { runStartup } from "./bus/startup";
import type { BusContext, BusReq, BusRes } from "./bus/types";

// handlers
import {
  handleHealth,
  handleBakeFreshness,
  handleGetRegistry,
  handleRegisterCode,
} from "./bus/handlers/misc";
import {
  handleGetStandard,
  handleGetContract,
  handleGetProducts,
} from "./bus/handlers/docs";
import {
  handlePostRuntimeSnapshot,
  handleGetRuntimeSnapshot,
} from "./bus/handlers/runtime";
import { handlePublish } from "./bus/handlers/publish";
import { handleGetPublishLog } from "./bus/handlers/publishLog";
import {
  handlePostInbox,
  handleListInbox,
  handleGetInboxTask,
  handleDeleteInboxTask,
} from "./bus/handlers/inbox";
import {
  handleListOutbox,
  handleGetOutboxTask,
  handleGetOutboxVersion,
  handleDeleteOutboxTask,
} from "./bus/handlers/outbox";

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

      // 启动期：code registry + reconcile + freshness
      const codeRegistry = new CodeRegistry(busRoot);
      runStartup(busRoot, codeRegistry);

      // 预加载 publish-log 文件路径 + appender
      const publishLogFile = getPublishLogFile(busRoot);
      const appendPublishLog = makeAppendPublishLog(busRoot, publishLogFile);

      const ctx: BusContext = {
        root,
        baseDir,
        busRoot,
        inboxDir,
        outboxDir,
        codeRegistry,
        appendPublishLog,
        publishLogFile,
      };

      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? "";
        if (!rawUrl.startsWith("/_bus/")) return next();
        // 剥掉 query string（前端 busFetch 对 GET 加了 ?_=Date.now() 做 cache-busting）
        // 否则下面所有 === 严格相等匹配都会失效，全掉进最后的 404
        const qIdx = rawUrl.indexOf("?");
        const url = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl;

        try {
          await dispatch(req as BusReq, res as BusRes, url, ctx);
        } catch (err) {
          send(res as BusRes, 500, { error: (err as Error).message });
        }
      });
    },
  };
}

/**
 * 路由 dispatch：按 method + url 匹配到具体 handler。
 *
 * 策略：
 *   1. 先走精确匹配（method + url 严格相等）
 *   2. 再走正则匹配（outbox/:taskId/v/:n 等动态路由）
 *   3. 都没命中 → 404
 *
 * handler 内部负责：参数校验 / 业务逻辑 / 响应写回。
 * 本函数只做"找到对的 handler"和"最后的 404 兜底"两件事。
 */
async function dispatch(
  req: BusReq,
  res: BusRes,
  url: string,
  ctx: BusContext
): Promise<void> {
  const method = req.method;

  // ========== GET ==========
  if (method === "GET") {
    // 精确匹配
    if (url === "/_bus/health") return handleHealth(res, ctx);
    if (url === "/_bus/bake-freshness") return handleBakeFreshness(res);
    if (url === "/_bus/registry") return handleGetRegistry(res, ctx);
    if (url === "/_bus/standard") return handleGetStandard(res, ctx);
    if (url === "/_bus/contract") return handleGetContract(res, ctx);
    if (url === "/_bus/products") return handleGetProducts(res, ctx);
    if (url === "/_bus/runtime-snapshot") return handleGetRuntimeSnapshot(res, ctx);
    if (url === "/_bus/publish-log") return handleGetPublishLog(res, ctx);
    if (url === "/_bus/inbox") return handleListInbox(res, ctx);
    if (url === "/_bus/outbox") return handleListOutbox(res, ctx);

    // 动态路由：outbox 版本 > outbox 任务 > inbox 任务
    const outboxVerMatch = url.match(/^\/_bus\/outbox\/([\w.-]+)\/v\/(\d+)$/);
    if (outboxVerMatch) {
      return handleGetOutboxVersion(
        res,
        ctx,
        outboxVerMatch[1],
        Number(outboxVerMatch[2])
      );
    }
    const outboxGetMatch = url.match(/^\/_bus\/outbox\/([\w.-]+)$/);
    if (outboxGetMatch) {
      return handleGetOutboxTask(res, ctx, outboxGetMatch[1]);
    }
    const inboxGetMatch = url.match(/^\/_bus\/inbox\/([\w.-]+)$/);
    if (inboxGetMatch) {
      return handleGetInboxTask(res, ctx, inboxGetMatch[1]);
    }
  }

  // ========== POST ==========
  if (method === "POST") {
    if (url === "/_bus/register-code") return handleRegisterCode(req, res, ctx);
    if (url === "/_bus/runtime-snapshot") return handlePostRuntimeSnapshot(req, res, ctx);
    if (url === "/_bus/publish") return handlePublish(req, res, ctx);
    if (url === "/_bus/inbox") return handlePostInbox(req, res, ctx);
  }

  // ========== DELETE ==========
  if (method === "DELETE") {
    const outboxDelMatch = url.match(/^\/_bus\/outbox\/([\w.-]+)$/);
    if (outboxDelMatch) {
      return handleDeleteOutboxTask(res, ctx, outboxDelMatch[1]);
    }
    const inboxDelMatch = url.match(/^\/_bus\/inbox\/([\w.-]+)$/);
    if (inboxDelMatch) {
      return handleDeleteInboxTask(res, ctx, inboxDelMatch[1]);
    }
  }

  // 都没命中 → 404
  send(res, 404, { error: "not found" });
}
