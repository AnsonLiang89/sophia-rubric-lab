/**
 * bus/helpers.ts
 *
 * 所有 handler 共享的纯工具函数：
 *   - readBody：读 POST body（带 2MB 上限，防恶意大文件）
 *   - send：统一响应（JSON + no-store）
 *   - readJson：容错读取 JSON 文件
 *   - listVersions：扫 outbox/{taskId}/ 目录解出版本号
 *   - parseQueryCode：从 taskId 前缀解出 queryCode（"EV-0001-xxxxxx" → "EV-0001"）
 *   - isSafeTaskId：taskId 路径穿越白名单校验
 *
 * 这些函数都不依赖 BusContext，是纯工具。所以单独一个文件，
 * handler 按需 import。
 */
import fs from "node:fs";
import path from "node:path";
import type { BusReq, BusRes } from "./types";

/** POST body 上限。2MB 够用（最大 outbox 产物 ~50KB 级别），
 *  超过属异常，直接 413 拒绝防止内存被撑爆。 */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export function readBody(req: BusReq): Promise<string> {
  return new Promise((resolve, reject) => {
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
}

/** 统一响应：JSON + no-store + 可选 body */
export function send(res: BusRes, status: number, body?: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (body === undefined) res.end();
  else res.end(JSON.stringify(body));
}

/** body 读取出错的统一转换：body too large → 413，其他 → 400 */
export function respondBodyError(res: BusRes, e: unknown): void {
  const msg = String((e as Error).message ?? e);
  if (msg.includes("body too large")) {
    send(res, 413, { error: msg });
  } else {
    send(res, 400, { error: msg });
  }
}

/** 安全读 JSON 文件，失败/坏文件返回 null */
export function readJson(p: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** 扫描某个 taskId 目录，返回版本列表（按 n 升序） */
export function listVersions(outboxDir: string, taskId: string) {
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
    .filter(
      (x): x is { v: number; file: string; mtime: number; size: number } => !!x
    )
    .sort((a, b) => a.v - b.v);
}

/** 从 taskId 前缀解析 queryCode（如 "EV-0001-xxxxxx" → "EV-0001"） */
export function parseQueryCode(taskId: string): string | undefined {
  const m = taskId.match(/^([A-Z]+-\d+)-/);
  return m ? m[1] : undefined;
}

/**
 * taskId 白名单：只允许大小写字母、数字、点号、下划线、短横线，长度 1~128。
 * 路径穿越字符（/、\、..）一律拒绝。所有接受 :taskId 参数的端点统一走这个校验。
 *
 * 对应 queryId 的合法校验也走同一个模式——两者都是文件系统 key。
 */
const TASK_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function isSafeTaskId(taskId: string): boolean {
  if (!TASK_ID_PATTERN.test(taskId)) return false;
  // 二次防御：即使正则允许点号，也禁止 ".." 这种相对路径片段
  if (taskId === "." || taskId === ".." || taskId.includes("..")) return false;
  return true;
}

/** queryId 合法校验——和 isSafeTaskId 规则相同，语义上是"文件系统 key 级"的安全串 */
export const isSafeQueryId = isSafeTaskId;
