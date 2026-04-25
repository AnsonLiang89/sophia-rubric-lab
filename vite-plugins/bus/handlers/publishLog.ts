/**
 * bus/handlers/publishLog.ts
 *
 * GET /_bus/publish-log — 返回发布历史（append-only），最新在数组末尾
 *
 * 管理员版 & 对外版都可调用（只读）；对外版通过 bake 脚本把这份日志
 * 拷贝到 public/data/publish-log.json，两端看到的是相同历史（除了管理员
 * 刚发起但还没 push 的最后一条）。
 */
import fs from "node:fs";
import { send } from "../helpers";
import type { BusContext, BusRes } from "../types";

export function handleGetPublishLog(res: BusRes, ctx: BusContext): void {
  if (!fs.existsSync(ctx.publishLogFile)) {
    return send(res, 200, { version: 1, entries: [] });
  }
  try {
    const raw = fs.readFileSync(ctx.publishLogFile, "utf8");
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
