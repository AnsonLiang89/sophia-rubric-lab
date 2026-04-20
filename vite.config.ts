import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { evaluationBusPlugin } from "./vite-plugins/evaluationBus";

/**
 * Vite 配置
 *
 * - `base` 通过 env `VITE_PUBLIC_BASE` 注入。GitHub Pages（Project Page 形态）
 *   下 URL 是 `https://<user>.github.io/<repo>/`，所以 prod build 必须把 base
 *   设成 `/<repo>/`；dev 走默认 `/`。
 * - `evaluationBusPlugin` 只挂 dev server。Prod build 下不需要 `/_bus/*` 中间件，
 *   也避免把 Node-only 代码打进前端 bundle（插件本身只在 `configureServer` 阶段
 *   用 fs/path，不会进产物，但还是按使用意图显式只在 dev 挂载）。
 */
export default defineConfig(({ command }) => {
  const isDev = command === "serve";
  return {
    base: process.env.VITE_PUBLIC_BASE || "/",
    plugins: [react(), ...(isDev ? [evaluationBusPlugin()] : [])],
    server: {
      host: true,
      port: 5173,
    },
  };
});
