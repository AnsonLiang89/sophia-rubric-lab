import { defineConfig } from "vitest/config";

/**
 * Vitest 配置（独立于 vite.config.ts）
 *
 * 只在 tests/ 目录下跑测试。被测代码主要是纯函数（lib/score, lib/sortProducts,
 * scripts/lint-outbox），所以环境默认 node，无需 jsdom/happy-dom。
 *
 * 不引入 React 插件——React 组件测试不在本轮 scope；等有 UI 回归测试需求
 * 再引入 @testing-library/react + happy-dom。
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx,mjs}"],
    environment: "node",
    globals: false,
  },
});
