import { describe, it, expect } from "vitest";
import { buildInboxTask, buildSummonPrompt } from "../src/lib/contract";

describe("buildSummonPrompt", () => {
  it("应内置强约束读顺序与自检清单锚点", () => {
    const prompt = buildSummonPrompt("EV-0002", 5);
    expect(prompt).toContain("读顺序（强约束，不得跳步）");
    expect(prompt).toContain(".evaluations/RUBRIC_STANDARD.md");
    expect(prompt).toContain("占位骨架 + 分段 replace");
    expect(prompt).toContain("交付前自检（全部满足才算完成）");
    expect(prompt).toContain("v5.json");
  });

  it("nextVersion 缺省时回退 v1", () => {
    const prompt = buildSummonPrompt("EV-0002");
    expect(prompt).toContain(".evaluations/outbox/EV-0002/v1.json");
  });
});

describe("buildInboxTask", () => {
  it("应构造 inbox schema v2.1 并默认 nextVersion=1", () => {
    const task = buildInboxTask({
      query: {
        id: "q1",
        code: "EV-0002",
        title: "test query",
        typeId: "industry-research",
        createdAt: "2026-04-28T00:00:00.000Z",
        updatedAt: "2026-04-28T00:00:00.000Z",
      },
      products: [
        {
          id: "p1",
          name: "SophiaAI",
          version: "v5",
          createdAt: "2026-04-28T00:00:00.000Z",
        },
      ],
      submissions: [
        {
          id: "s1",
          queryId: "q1",
          productId: "p1",
          submittedAt: "2026-04-28T00:00:00.000Z",
          contentFormat: "markdown",
          content: "# report",
          createdAt: "2026-04-28T00:00:00.000Z",
        },
      ],
    });

    expect(task.inboxSchemaVersion).toBe("2.1");
    expect(task.nextVersion).toBe(1);
    expect(task.candidates[0].activeReportVersion).toBe(1);
    expect(task.candidates[0].reportVersions?.[0]?.version).toBe(1);
  });
});
