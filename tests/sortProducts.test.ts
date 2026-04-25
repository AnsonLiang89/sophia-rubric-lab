import { describe, it, expect } from "vitest";
import {
  isSophia,
  sortProducts,
  displayProductName,
  pickPrimaryProduct,
} from "../src/lib/sortProducts";
import type { AIProduct } from "../src/types";

function p(
  id: string,
  name: string,
  version?: string,
  extra?: Partial<AIProduct> & { order?: number }
): AIProduct {
  return {
    id,
    name,
    version: version ?? "",
    ...(extra ?? {}),
  } as AIProduct;
}

describe("isSophia", () => {
  it("识别 SophiaAI 系列各种大小写", () => {
    expect(isSophia({ name: "SophiaAI" })).toBe(true);
    expect(isSophia({ name: "Sophia" })).toBe(true);
    expect(isSophia({ name: "sophia" })).toBe(true);
    expect(isSophia({ name: "SophiaAI-beta" })).toBe(true);
    expect(isSophia({ name: "  SophiaAI  " })).toBe(true); // 前后空格容忍
  });

  it("不识别其他产品名", () => {
    expect(isSophia({ name: "MiroThink" })).toBe(false);
    expect(isSophia({ name: "Gemini" })).toBe(false);
    expect(isSophia({ name: "ChatGPT" })).toBe(false);
    expect(isSophia({ name: "" })).toBe(false);
  });
});

describe("sortProducts - Sophia 优先", () => {
  it("SophiaAI 永远排第一", () => {
    const list = [
      p("a", "MiroThink"),
      p("b", "SophiaAI", "v4"),
      p("c", "Gemini"),
    ];
    const sorted = sortProducts(list);
    expect(sorted[0].name).toBe("SophiaAI");
  });

  it("多个 Sophia 版本按版本降序（v5 > v4 > v3）", () => {
    const list = [
      p("a", "SophiaAI", "v3"),
      p("b", "SophiaAI", "v5"),
      p("c", "SophiaAI", "v4"),
    ];
    const sorted = sortProducts(list);
    expect(sorted.map((x) => x.version)).toEqual(["v5", "v4", "v3"]);
  });

  it("支持 v5.1 这种子版本号的比较", () => {
    const list = [
      p("a", "SophiaAI", "v5"),
      p("b", "SophiaAI", "v5.2"),
      p("c", "SophiaAI", "v5.1"),
    ];
    const sorted = sortProducts(list);
    expect(sorted.map((x) => x.version)).toEqual(["v5.2", "v5.1", "v5"]);
  });

  it("非 Sophia 按 order 升序 + 名字字母序", () => {
    const list = [
      p("a", "Gemini", "", { order: 3 }),
      p("b", "MiroThink", "", { order: 1 }),
      p("c", "Claude", "", { order: 2 }),
    ];
    const sorted = sortProducts(list);
    expect(sorted.map((x) => x.name)).toEqual(["MiroThink", "Claude", "Gemini"]);
  });

  it("order 缺失视为 999，排在最后", () => {
    const list = [
      p("a", "NoOrder"),
      p("b", "MiroThink", "", { order: 1 }),
    ];
    const sorted = sortProducts(list);
    expect(sorted[0].name).toBe("MiroThink");
    expect(sorted[1].name).toBe("NoOrder");
  });

  it("Sophia + 其他混排：Sophia 绝对优先，其他按 order", () => {
    const list = [
      p("a", "Gemini", "", { order: 1 }),
      p("b", "SophiaAI", "v4"),
      p("c", "MiroThink", "", { order: 3 }),
      p("d", "SophiaAI", "v5"),
    ];
    const sorted = sortProducts(list);
    expect(sorted.map((x) => `${x.name}${x.version ? " " + x.version : ""}`)).toEqual([
      "SophiaAI v5",
      "SophiaAI v4",
      "Gemini",
      "MiroThink",
    ]);
  });

  it("orderHint 覆盖产品自身的 order", () => {
    const list = [
      p("a", "Gemini", "", { order: 1 }),
      p("b", "MiroThink", "", { order: 3 }),
    ];
    const hint = new Map([
      ["a", 99], // Gemini 被 hint 降为最后
      ["b", 0], // MiroThink 被提前
    ]);
    const sorted = sortProducts(list, hint);
    expect(sorted.map((x) => x.name)).toEqual(["MiroThink", "Gemini"]);
  });

  it("不修改入参（返回新数组）", () => {
    const list = [p("a", "Gemini"), p("b", "SophiaAI", "v4")];
    const before = list.map((x) => x.id);
    sortProducts(list);
    expect(list.map((x) => x.id)).toEqual(before);
  });
});

describe("displayProductName", () => {
  it("有 version 时返回 name + version", () => {
    expect(displayProductName({ name: "SophiaAI", version: "v5" })).toBe("SophiaAI v5");
  });

  it("version 为空字符串时只返回 name", () => {
    expect(displayProductName({ name: "Gemini", version: "" })).toBe("Gemini");
  });

  it("version 为 '—' 时只返回 name（历史兼容）", () => {
    expect(displayProductName({ name: "Manus", version: "—" })).toBe("Manus");
  });
});

describe("pickPrimaryProduct", () => {
  it("优先选 Sophia 最新版", () => {
    const list = [
      p("a", "Gemini"),
      p("b", "SophiaAI", "v4"),
      p("c", "SophiaAI", "v5"),
    ];
    const primary = pickPrimaryProduct(list);
    expect(primary?.version).toBe("v5");
  });

  it("无 Sophia 时兜底返回第一个", () => {
    const list = [p("a", "Gemini"), p("b", "MiroThink")];
    expect(pickPrimaryProduct(list)?.name).toBe("Gemini");
  });

  it("空数组返回 undefined", () => {
    expect(pickPrimaryProduct([])).toBeUndefined();
  });
});
