// ============================================================
// tests/dataSource.test.ts
//
// 覆盖 dataSource.ts 里两个纯函数——它们决定了对外版（GitHub Pages）
// 能否看到数据、能否误触写端点。任何一处漏洞都会直接把整个对外版打爆：
//   - toStaticUrl：bus 端点 → 静态 JSON 文件的映射，漏一个就白屏
//   - isWriteEndpoint：只读模式的"守门员"，放行一个写方法就能让用户
//     在 GitHub Pages 上触发"editing a static site"级别的 404/500 风暴
//
// 这两个函数已经是纯函数（toStaticUrl 吃 prefix 参数；isWriteEndpoint 吃
// method + path），无需 mock import.meta.env，直接参数化即可。
// ============================================================

import { describe, it, expect } from "vitest";
import { toStaticUrl, isWriteEndpoint } from "../src/lib/dataSource";

// dev 场景前缀（STATIC_PREFIX 是空字符串，等同"当前域根"）
const DEV_PREFIX = "";
// prod 场景前缀（BASE_URL=/sophia-rubric-lab/ → 去尾斜杠 + /data）
const PROD_PREFIX = "/sophia-rubric-lab/data";

describe("toStaticUrl — 契约文档三件套", () => {
  it("standard 走 standard.json", () => {
    expect(toStaticUrl("/_bus/standard", DEV_PREFIX)).toBe("/standard.json");
    expect(toStaticUrl("/_bus/standard", PROD_PREFIX)).toBe(
      "/sophia-rubric-lab/data/standard.json"
    );
  });

  it("contract 走 contract.json", () => {
    expect(toStaticUrl("/_bus/contract", PROD_PREFIX)).toBe(
      "/sophia-rubric-lab/data/contract.json"
    );
  });

  it("products 走 products.json", () => {
    expect(toStaticUrl("/_bus/products", PROD_PREFIX)).toBe(
      "/sophia-rubric-lab/data/products.json"
    );
  });
});

describe("toStaticUrl — outbox 三种形态", () => {
  it("outbox 列表映射到 /outbox/index.json（不是 list.json）", () => {
    expect(toStaticUrl("/_bus/outbox", PROD_PREFIX)).toBe(
      "/sophia-rubric-lab/data/outbox/index.json"
    );
  });

  it("outbox bundle：/_bus/outbox/:taskId → /outbox/:taskId/bundle.json", () => {
    expect(toStaticUrl("/_bus/outbox/EV-0002-N3e5zP", PROD_PREFIX)).toBe(
      "/sophia-rubric-lab/data/outbox/EV-0002-N3e5zP/bundle.json"
    );
  });

  it("outbox 具体版本：/_bus/outbox/:taskId/v/:n → /outbox/:taskId/v{n}.json", () => {
    expect(toStaticUrl("/_bus/outbox/EV-0005-LlSiEs/v/3", PROD_PREFIX)).toBe(
      "/sophia-rubric-lab/data/outbox/EV-0005-LlSiEs/v3.json"
    );
  });

  it("版本号是多位数（v10、v42）时仍正确", () => {
    expect(toStaticUrl("/_bus/outbox/EV-0001-seedAB/v/42", DEV_PREFIX)).toBe(
      "/outbox/EV-0001-seedAB/v42.json"
    );
  });

  it("taskId 里带连字符不影响匹配", () => {
    expect(toStaticUrl("/_bus/outbox/EV-0003-abcDE1", DEV_PREFIX)).toBe(
      "/outbox/EV-0003-abcDE1/bundle.json"
    );
  });
});

describe("toStaticUrl — 辅助端点", () => {
  it("health 映射到 health.json", () => {
    expect(toStaticUrl("/_bus/health", PROD_PREFIX)).toBe(
      "/sophia-rubric-lab/data/health.json"
    );
  });

  it("publish-log 映射到 publish-log.json", () => {
    expect(toStaticUrl("/_bus/publish-log", PROD_PREFIX)).toBe(
      "/sophia-rubric-lab/data/publish-log.json"
    );
  });
});

describe("toStaticUrl — inbox / 未匹配 → null", () => {
  it("inbox 列表返回 null（prod 下 UI 已隐藏）", () => {
    expect(toStaticUrl("/_bus/inbox", PROD_PREFIX)).toBeNull();
  });

  it("inbox 子路径全部返回 null", () => {
    expect(toStaticUrl("/_bus/inbox/EV-0002-abc", PROD_PREFIX)).toBeNull();
    expect(toStaticUrl("/_bus/inbox/EV-0002-abc/extra", PROD_PREFIX)).toBeNull();
  });

  it("registry、bake-freshness 等 dev-only 端点返回 null", () => {
    expect(toStaticUrl("/_bus/registry", PROD_PREFIX)).toBeNull();
    expect(toStaticUrl("/_bus/bake-freshness", PROD_PREFIX)).toBeNull();
    expect(toStaticUrl("/_bus/runtime-snapshot", PROD_PREFIX)).toBeNull();
    expect(toStaticUrl("/_bus/publish", PROD_PREFIX)).toBeNull();
  });

  it("完全不认识的路径返回 null", () => {
    expect(toStaticUrl("/_bus/unknown", PROD_PREFIX)).toBeNull();
    expect(toStaticUrl("/random/path", PROD_PREFIX)).toBeNull();
    expect(toStaticUrl("", PROD_PREFIX)).toBeNull();
  });

  it("outbox 路径变体（trailing slash / 多余段）不匹配", () => {
    // /_bus/outbox/xxx/ 比正则多一个斜杠，应当不匹配
    expect(toStaticUrl("/_bus/outbox/EV-0001/", PROD_PREFIX)).toBeNull();
    // /_bus/outbox/xxx/v 缺数字，应当不匹配
    expect(toStaticUrl("/_bus/outbox/EV-0001/v", PROD_PREFIX)).toBeNull();
    // /_bus/outbox/xxx/v/abc 非数字版本号，应当不匹配
    expect(toStaticUrl("/_bus/outbox/EV-0001/v/abc", PROD_PREFIX)).toBeNull();
  });
});

describe("isWriteEndpoint — HTTP 方法", () => {
  it("POST 永远是写", () => {
    expect(isWriteEndpoint("POST", "/_bus/publish")).toBe(true);
    expect(isWriteEndpoint("POST", "/_bus/outbox")).toBe(true);
    expect(isWriteEndpoint("POST", "/_bus/health")).toBe(true);
  });

  it("DELETE 永远是写", () => {
    expect(isWriteEndpoint("DELETE", "/_bus/outbox/EV-0001")).toBe(true);
    expect(isWriteEndpoint("DELETE", "/_bus/inbox/EV-0001")).toBe(true);
  });

  it("PUT / PATCH 也视为写（兜底）", () => {
    expect(isWriteEndpoint("PUT", "/_bus/contract")).toBe(true);
    expect(isWriteEndpoint("PATCH", "/_bus/standard")).toBe(true);
  });

  it("GET 非 inbox 路径：非写（可在 prod 放行）", () => {
    expect(isWriteEndpoint("GET", "/_bus/standard")).toBe(false);
    expect(isWriteEndpoint("GET", "/_bus/contract")).toBe(false);
    expect(isWriteEndpoint("GET", "/_bus/outbox")).toBe(false);
    expect(isWriteEndpoint("GET", "/_bus/outbox/EV-0001")).toBe(false);
    expect(isWriteEndpoint("GET", "/_bus/outbox/EV-0001/v/1")).toBe(false);
    expect(isWriteEndpoint("GET", "/_bus/health")).toBe(false);
    expect(isWriteEndpoint("GET", "/_bus/publish-log")).toBe(false);
  });
});

describe("isWriteEndpoint — inbox GET 的特殊性", () => {
  it("GET /_bus/inbox/* 被视为写操作（prod 必须拦截）", () => {
    // inbox 的子路径即便是 GET 也会被 bus 处理成"消费 inbox 的任务消息"，
    // 属于事实上的"写"，所以在 prod 下不能放行
    expect(isWriteEndpoint("GET", "/_bus/inbox/EV-0001")).toBe(true);
    expect(isWriteEndpoint("GET", "/_bus/inbox/EV-0002-abc")).toBe(true);
  });

  it("GET /_bus/inbox（根列表，无尾斜杠）：非写", () => {
    // 注意：isWriteEndpoint 的 inbox 判定使用 `startsWith("/_bus/inbox/")`
    //（带尾斜杠），所以根列表 GET 被视为只读——对外版也不会暴露此路径
    //（toStaticUrl 会返回 null），但 method 层判定保持一致
    expect(isWriteEndpoint("GET", "/_bus/inbox")).toBe(false);
  });

  it("HEAD / OPTIONS 被视为只读（不影响业务语义）", () => {
    // 这两个方法当前未走进写分支——文档化该行为，防止未来无意改动
    expect(isWriteEndpoint("HEAD", "/_bus/standard")).toBe(false);
    expect(isWriteEndpoint("OPTIONS", "/_bus/standard")).toBe(false);
  });
});
