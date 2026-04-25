/**
 * bus/publishLog.ts
 *
 * append-only 的发布审计日志。
 *
 * 每次 POST /_bus/publish（成功或失败）都在 `.evaluations/_publish-log.json`
 * 末尾追加一条。前端两端（管理员 / 对外版）都可以读这份日志，展示"上次更新时间"
 * 并对比两端一致性。
 *
 * 文件格式：
 * {
 *   version: 1,
 *   entries: [
 *     { publishedAt: ISO, ok: true,  commit: "...", stats: {...} },
 *     { publishedAt: ISO, ok: false, failedStep: "bake:public", error: "..." },
 *     ...
 *   ]
 * }
 *
 * 上限：200 条（老条目丢弃，回溯近期几十次发布够用）。
 */
import fs from "node:fs";
import path from "node:path";
import type { PublishLogEntry } from "./types";

export const PUBLISH_LOG_MAX = 200;

/** 生成绝对路径（给 plugin 启动期用一次） */
export function getPublishLogFile(busRoot: string): string {
  return path.join(busRoot, "_publish-log.json");
}

/** 追加一条日志。失败静默（日志写失败不应该阻塞发布流程本身）。 */
export function makeAppendPublishLog(
  busRoot: string,
  publishLogFile: string
): (entry: PublishLogEntry) => void {
  return (entry: PublishLogEntry) => {
    try {
      fs.mkdirSync(busRoot, { recursive: true });
      let doc: { version: number; entries: PublishLogEntry[] } = {
        version: 1,
        entries: [],
      };
      if (fs.existsSync(publishLogFile)) {
        try {
          const raw = fs.readFileSync(publishLogFile, "utf8");
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
      const tmp = `${publishLogFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
      fs.renameSync(tmp, publishLogFile);
    } catch {
      // 日志写失败不应该阻塞发布流程本身
    }
  };
}
