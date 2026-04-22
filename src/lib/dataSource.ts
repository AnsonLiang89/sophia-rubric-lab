// ============================================================
// dataSource.ts
//
// 数据源抽象层：让 contract.ts 的 HTTP 调用在 dev/prod 两种模式下
// 透明切换。
//
// 背景：评测工作流只发生在"管理员本地"（vite dev + WorkBuddy 对话框），
// 产物（.evaluations/outbox/*）发布到 GitHub Pages 后是静态资源。
// 同一份前端代码需要：
//   - dev  时调用  /_bus/*                 （evaluationBus 中间件）
//   - prod 时调用  ${BASE}/data/*.json     （vite build 产物 + bake 脚本产出）
//
// 这里承担三件事：
//   1) 模式识别（import.meta.env.PROD）
//   2) URL 映射（bus 端点 → 静态文件路径；bundle 自动降级）
//   3) 写操作守卫（prod 下一律拒绝）
//
// 只读产出契约见 bake-public-data.mjs 的注释，两者必须保持对齐。
// ============================================================

/**
 * 只读模式：由 Vite build 时的 env 决定。
 * 任何运行时代码都可以读它，来决定是否隐藏编辑按钮、禁用写接口。
 */
export const IS_READONLY = import.meta.env.PROD;

/**
 * 静态数据源的 URL 前缀。
 * - dev: ""（直接走 /_bus/xxx）
 * - prod: `${BASE_URL}data`（BASE_URL 由 vite.config 的 base 决定；GitHub Pages 需要带 repo 前缀）
 *
 * 两者都不带尾部斜杠。
 */
const STATIC_PREFIX = IS_READONLY
  ? `${import.meta.env.BASE_URL.replace(/\/$/, "")}/data`
  : "";

/** 写操作在只读模式下抛这个错，UI 层应该永远不会触发到——只是兜底。 */
export class ReadOnlyError extends Error {
  constructor(op: string) {
    super(`Write operation "${op}" is not allowed in read-only (public) mode.`);
    this.name = "ReadOnlyError";
  }
}

/**
 * bus 路径 → 静态文件路径的映射表。
 *
 * 设计约定：静态侧只覆盖"对外版需要展示"的 GET 端点；
 * inbox、写类端点在 prod 下不会被调用（UI 已隐藏；即使被调也会被
 * busFetch 在 writeGuard 阶段拦截）。
 */
function toStaticUrl(busPath: string): string | null {
  // 1) 元数据 / 标准文档
  if (busPath === "/_bus/standard") return `${STATIC_PREFIX}/standard.json`;
  if (busPath === "/_bus/contract") return `${STATIC_PREFIX}/contract.json`;
  if (busPath === "/_bus/products") return `${STATIC_PREFIX}/products.json`;

  // 2) outbox 列表
  if (busPath === "/_bus/outbox") return `${STATIC_PREFIX}/outbox/index.json`;

  // 3) outbox bundle：/_bus/outbox/:taskId  →  /data/outbox/:taskId/bundle.json
  {
    const m = busPath.match(/^\/_bus\/outbox\/([^/]+)$/);
    if (m) return `${STATIC_PREFIX}/outbox/${m[1]}/bundle.json`;
  }

  // 4) outbox 具体版本：/_bus/outbox/:taskId/v/:n  →  /data/outbox/:taskId/v{n}.json
  {
    const m = busPath.match(/^\/_bus\/outbox\/([^/]+)\/v\/(\d+)$/);
    if (m) return `${STATIC_PREFIX}/outbox/${m[1]}/v${m[2]}.json`;
  }

  // 5) health：prod 下返回一个固定 ok 快照
  if (busPath === "/_bus/health") return `${STATIC_PREFIX}/health.json`;

  // 6) publish-log：对外版也能拿到发布历史（只读副本）
  if (busPath === "/_bus/publish-log") return `${STATIC_PREFIX}/publish-log.json`;

  // 7) inbox 类路径在 prod 下不应被调用——返回 null，上层会走 null-as-empty 处理
  if (busPath.startsWith("/_bus/inbox")) return null;

  return null;
}

/** 写/删端点白名单：命中则在 prod 下直接拒绝。 */
function isWriteEndpoint(method: string, busPath: string): boolean {
  if (method === "POST" || method === "DELETE") return true;
  // 极端情况兜底（GET 不应该出现在这里）
  if (method === "PUT" || method === "PATCH") return true;
  return busPath.startsWith("/_bus/inbox/"); // inbox 类操作本质都是"写"
}

/**
 * 解析静态 bundle 响应：
 * - `/_bus/outbox/:taskId` 契约返回 `{ taskId, latestVersion, versions, latest }`
 * - 静态侧 bake 脚本直接输出同形状的 bundle.json，免去运行时组装
 * 直接透传即可。
 *
 * 这里留个适配函数占位，是为了未来 schema 演进时（比如静态侧改成
 * "只存 versions + 最新的指针"）有一处集中转换的位置。
 */
function adaptBundle<T>(payload: unknown): T {
  return payload as T;
}

export interface DataSource {
  /**
   * 读数据；失败/不存在返回 null。
   * 调用方负责把 BusError（网络/服务端）吞掉或上抛。
   */
  read: <T>(busPath: string) => Promise<T | null>;

  /** 写数据（仅 dev 可用）。method 由调用方指定。 */
  write: <T>(
    busPath: string,
    method: "POST" | "DELETE",
    body?: unknown
  ) => Promise<T | null>;
}

/**
 * 构造数据源。
 * - dev：直接把请求转发到 `/_bus/*`（错误照常广播，Banner 及时告警）
 * - prod：映射到静态文件，404/网络错误时归一化为 null（让上层空态兜底，
 *         且不触发错误 Banner——GitHub Pages 上某个 taskId 没有数据属于
 *         正常现象，不应该当成"数据源不可达"来吓用户）
 *
 * 注意：实际的 fetch + 错误广播仍在 contract.ts 的 rawBusFetch 里做，
 * 本文件只是"路由映射 + 守卫 + silent 策略"。这样错误归一化
 * （BusError / bus-error event）的行为维持一致，只是 prod 读路径静音。
 */
export function makeDataSource(
  rawFetch: <T>(
    method: "GET" | "POST" | "DELETE",
    url: string,
    body?: unknown,
    silentErrors?: boolean
  ) => Promise<T | null>
): DataSource {
  return {
    read: async <T>(busPath: string) => {
      if (IS_READONLY) {
        const staticUrl = toStaticUrl(busPath);
        if (!staticUrl) {
          // inbox 等 prod 下不可用的端点：返回 null，等同于"无数据"
          return null;
        }
        try {
          // silentErrors=true：静态 404 是常态，不广播全局错误
          const raw = await rawFetch<unknown>("GET", staticUrl, undefined, true);
          if (!raw) return null;
          // bundle 端点透传一下
          if (/\/_bus\/outbox\/[^/]+$/.test(busPath)) {
            return adaptBundle<T>(raw);
          }
          return raw as T;
        } catch {
          // 静态 404 / 离线 / JSON 解析错：降级为 null；UI 层的空态兜底
          return null;
        }
      }
      return rawFetch<T>("GET", busPath);
    },

    write: async <T>(
      busPath: string,
      method: "POST" | "DELETE",
      body?: unknown
    ) => {
      if (IS_READONLY || isWriteEndpoint(method, busPath)) {
        if (IS_READONLY) throw new ReadOnlyError(`${method} ${busPath}`);
      }
      return rawFetch<T>(method, busPath, body);
    },
  };
}
