/**
 * bus/types.ts
 *
 * 所有 handler 共享的类型定义。
 *
 * 设计：BusContext 把 handler 需要的"外部世界"（文件系统路径、注册簿、响应工具）
 * 全部打包在一起，每个 handler 只需要接收 `(req, res, ctx)` 三参数，
 * 不再需要通过闭包从 evaluationBus.ts 里捕获。
 *
 * 这样的好处：
 *   1. handler 可以独立测试（mock 一个 ctx 即可）
 *   2. 路由 dispatch 逻辑可以写得扁平——主文件只做 `url/method → handler` 映射
 *   3. 未来要加中间件（日志 / 鉴权）时，在 ctx 里追加字段即可，handler 不用改
 */
import type { Connect } from "vite";
import type { CodeRegistry } from "../codeRegistry";

export type BusReq = Parameters<Connect.NextHandleFunction>[0];
export type BusRes = Parameters<Connect.NextHandleFunction>[1];

/** handler 共享的上下文 */
export interface BusContext {
  /** 项目根绝对路径 */
  root: string;
  /** `.evaluations` 目录名（默认 ".evaluations"），仅用于 health 端点回显 */
  baseDir: string;
  /** 绝对路径 `${root}/${baseDir}` */
  busRoot: string;
  /** `${busRoot}/inbox` */
  inboxDir: string;
  /** `${busRoot}/outbox` */
  outboxDir: string;
  /** queryId ↔ code 注册簿（启动期 reconcile 过一次） */
  codeRegistry: CodeRegistry;
  /** publish-log 追加（已预加载文件路径） */
  appendPublishLog: (entry: PublishLogEntry) => void;
  /** publish-log 绝对路径 */
  publishLogFile: string;
}

export interface PublishLogEntry {
  publishedAt: string;
  ok: boolean;
  commit?: string;
  failedStep?: string;
  error?: string;
  stats?: Record<string, number>;
}

export interface StepResult {
  name: string;
  command: string;
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  skipped?: boolean;
  note?: string;
}
