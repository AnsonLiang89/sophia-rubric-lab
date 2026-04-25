import { describe, it, expect } from "vitest";
import { scoreColor, scoreBg, formatDate, clone } from "../src/lib/score";

describe("scoreColor · 分数着色阈值", () => {
  it(">= 8 → moss（卓越/优秀色）", () => {
    expect(scoreColor(10)).toBe("text-moss");
    expect(scoreColor(8)).toBe("text-moss");
    expect(scoreColor(8.5)).toBe("text-moss");
  });

  it(">= 6.5 && < 8 → amber-dark（合格到良色）", () => {
    expect(scoreColor(7.5)).toBe("text-amber-dark");
    expect(scoreColor(6.9)).toBe("text-amber-dark"); // veto 封顶线
    expect(scoreColor(6.5)).toBe("text-amber-dark");
  });

  it(">= 5 && < 6.5 → ochre（合格下限色）", () => {
    expect(scoreColor(5.5)).toBe("text-ochre");
    expect(scoreColor(5)).toBe("text-ochre");
    expect(scoreColor(6.4)).toBe("text-ochre");
  });

  it("< 5 → clay（待改进/不合格色）", () => {
    expect(scoreColor(4.9)).toBe("text-clay");
    expect(scoreColor(0)).toBe("text-clay");
    expect(scoreColor(3)).toBe("text-clay");
  });

  it("边界值处理（严格 >=）", () => {
    // 刚好 8.0 算 moss（不是 amber）
    expect(scoreColor(8.0)).toBe("text-moss");
    // 刚好 6.5 算 amber-dark（不是 ochre）
    expect(scoreColor(6.5)).toBe("text-amber-dark");
    // 刚好 5.0 算 ochre（不是 clay）
    expect(scoreColor(5.0)).toBe("text-ochre");
  });
});

describe("scoreBg · 分数背景配色", () => {
  it("阈值与 scoreColor 对齐", () => {
    expect(scoreBg(10)).toContain("bg-moss");
    expect(scoreBg(7)).toContain("bg-amber");
    expect(scoreBg(5)).toContain("bg-paper-200");
    expect(scoreBg(3)).toContain("bg-clay");
  });
});

describe("formatDate", () => {
  it("只返回日期（withTime=false 默认）", () => {
    const iso = "2026-04-24T08:27:15.438Z";
    const out = formatDate(iso);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("withTime=true 返回日期+时分", () => {
    const iso = "2026-04-24T08:27:15.438Z";
    const out = formatDate(iso, true);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe("clone · 深拷贝", () => {
  it("嵌套对象深拷贝互不影响", () => {
    const a = { x: 1, nested: { y: 2, arr: [1, 2, 3] } };
    const b = clone(a);
    b.nested.y = 999;
    b.nested.arr.push(4);
    expect(a.nested.y).toBe(2);
    expect(a.nested.arr).toEqual([1, 2, 3]);
  });

  it("数组深拷贝", () => {
    const a = [{ k: 1 }, { k: 2 }];
    const b = clone(a);
    b[0].k = 99;
    expect(a[0].k).toBe(1);
  });
});
