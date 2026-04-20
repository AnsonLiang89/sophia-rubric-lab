# Sophia's Rubric Lab · 部署指南

本项目使用**双模式部署**：

- **管理员版**（本地 `npm run dev`）：完整读写权限，通过 Vite dev server 的 `/_bus/*` 中间件读写 `.evaluations/` 目录。
- **对外只读版**（GitHub Pages）：静态快照，所有 `/_bus/*` 请求被改写为 `/data/*.json` 静态文件请求，所有编辑入口在 UI 层隐藏。

两种模式**同一份代码**。区分逻辑位于 `src/lib/dataSource.ts`：`IS_READONLY = import.meta.env.PROD`。

---

## 目录速查

```
sophia-rubric-lab/
├─ .evaluations/
│  ├─ RUBRIC_STANDARD.md        ← 面向用户的评测标准
│  ├─ EVALUATION_CONTRACT.md    ← 面向 LLM 的工作协议
│  ├─ PRODUCTS.json             ← 评测主体清单（只读展示）
│  ├─ _seed-snapshot.json       ← 入 git；由 `npm run seed:dump` 生成
│  ├─ _runtime-snapshot.json    ← 不入 git；由管理员从浏览器导出
│  ├─ inbox/                    ← 不入 git
│  └─ outbox/                   ← 入 git（对外要展示这些评测产物）
├─ public/
│  ├─ 404.html                  ← GitHub Pages SPA 路由兼容
│  └─ favicon.svg
├─ scripts/
│  ├─ dump-seed.mjs             ← 把 src/seed.ts 物化成 JSON
│  └─ bake-public-data.mjs      ← 把所有数据烘焙成 public/data/*.json
├─ .github/workflows/deploy.yml ← 自动部署到 Pages
└─ vite.config.ts               ← base 通过 VITE_PUBLIC_BASE 注入
```

---

## 首次部署流程（Step by Step）

### 1. 在 GitHub 新建仓库

- 登录 `AnsonLiang89`，新建**公开仓库** `sophia-rubric-lab`。
- **不要**勾选 "Add a README"、"Add .gitignore"（仓库保持空，避免 merge 冲突）。

### 2. 在本地初始化 git 并关联远端

```bash
cd /Users/anson_liang/WorkBuddy/20260419144025/sophia-rubric-lab
git init
git branch -M main
git remote add origin https://github.com/AnsonLiang89/sophia-rubric-lab.git
```

### 3. 导出管理员本地最新 snapshot（重要）

你的 EV-0001/EV-0002/EV-0003 评测题目和原始报告都存在浏览器 localStorage 里。必须先把它们导出为 `_runtime-snapshot.json`，否则 bake 会因"dangling reportId"失败。

操作：
1. 先跑一次 `npm run dev` 打开本地管理员版。
2. 浏览器右上角导航栏点「快照」按钮（只在 dev 模式可见）。
3. 它会 `POST /_bus/runtime-snapshot`，在 `.evaluations/` 下写入 `_runtime-snapshot.json`。

> 注：`_runtime-snapshot.json` 被 `.gitignore` 忽略。**但在这个项目里，为了让 CI 能烘焙出完整数据，我们需要强制把它加进版本库。**

### 4. 把 runtime snapshot 纳入版本库（对外部署专用）

打开项目根的 `.gitignore`，**注释掉**以下两行：

```diff
- .evaluations/_runtime-snapshot.json
+ # .evaluations/_runtime-snapshot.json  # 对外部署需要该文件进入 CI
```

然后：
```bash
git add .evaluations/_runtime-snapshot.json
```

> 权衡：这会暴露你本地的所有 submissions 原文到公网仓库。如果你不想公开原始报告正文，换方案是在 CI 手动上传一份 "发布用 snapshot"（可做脱敏）。默认策略是"原样发布"，因为你的初衷是"让别人看到评测"——看评测就必须能看到被评的原文。

### 5. 本地自测 build

```bash
npm run build:public
npm run preview
# → http://127.0.0.1:4173/sophia-rubric-lab/
```

打开浏览器检查：

- 导航栏出现 "· PUBLIC" 徽章
- Footer 显示 baked 时间
- 「新增评测」「+ 追加对比源」「🤖 召唤评测」「删除」按钮全部消失
- 点开任何一条评测，版本切换、R1~R5 评分表、markdown 正文都能正常渲染
- `/standard` 和 `/contract` 页面能读到 md 原文
- 刷新任何子页面（如 `/queries/q-bd-2026`）不会 404（404.html + 内嵌脚本协作）

### 6. 提交并推送

```bash
git add .
git commit -m "feat: initial public deploy setup"
git push -u origin main
```

### 7. GitHub 侧开启 Pages

- 仓库 Settings → Pages
- **Source**: "GitHub Actions"（不要选 "Deploy from a branch"）
- 保存后，GitHub Actions 会自动跑 `.github/workflows/deploy.yml`。第一次跑大约 1-2 分钟。
- 完成后打开 `https://ansonliang89.github.io/sophia-rubric-lab/` 即可访问。

---

## 日常更新流程

每次你新增评测、Sophia 跑出新产物后：

```bash
# 1. 在浏览器里 dev 模式完成评测
npm run dev
# ... 做评测，调 Sophia，产物落到 .evaluations/outbox/
# ... 在导航栏点「快照」按钮更新 _runtime-snapshot.json

# 2. 本地 sanity check
npm run build:public
npm run preview

# 3. 推送
git add .
git commit -m "evals: <short description>"
git push
```

Push 后 GitHub Actions 会自动重新部署，1-2 分钟后生效。

---

## npm scripts 一览

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 管理员本地开发（有 `/_bus/*`，可读写） |
| `npm run seed:dump` | 把 `src/seed.ts` 的 SEED_SNAPSHOT 物化成 `.evaluations/_seed-snapshot.json`（入 git） |
| `npm run bake:public` | 把 `.evaluations/` + seed + runtime snapshot 烘焙成 `public/data/*.json` |
| `npm run build:public` | `seed:dump + bake:public + vite build` 一条龙 |
| `npm run build` | 只跑 `tsc + vite build`（不含 bake；平时很少单独用） |
| `npm run preview` | 在 `http://127.0.0.1:4173/sophia-rubric-lab/` 预览 dist |
| `npm run cleanup-inbox` | 清理孤儿 inbox（已有 outbox 的任务） |

---

## 设计要点速记

- **数据源抽象**：`src/lib/dataSource.ts` 的 `makeDataSource` 在 dev 下走 `/_bus`，prod 下走 `/data` 静态文件；读失败静默降级（不弹 Banner）。
- **运行时写 action 降级**：`src/store.ts` 和 `src/storage.ts` 在 `IS_READONLY === true` 下把所有 write 变成 `console.warn` no-op。
- **UI 层守卫**：所有编辑按钮和 Modal 用 `{!IS_READONLY && ...}` 或 `IS_READONLY && "hidden"` 守卫，避免被绕过。
- **只读存储适配器**：`PublicBundleAdapter` 只认 `/data/public-bundle.json`，submission.content 懒加载 `/data/reports/{id}.md`（首屏 bundle 保持小）。
- **SPA 路由兼容**：`public/404.html` + `index.html` 内嵌脚本协作，把 GitHub Pages 的 404 重定向回 SPA。
- **base 路径注入**：Vite 通过 `VITE_PUBLIC_BASE` 环境变量决定 base；CI 设为 `/sophia-rubric-lab/`，本地 dev 下默认 `/`。

---

## 常见问题

**Q: Actions 构建失败 "dangling reportId"？**
A: 说明 `_runtime-snapshot.json` 缺失或过时。在浏览器 dev 模式下点一次「快照」按钮，再推 git。

**Q: 部署后打开子页面刷新 404？**
A: 确认 `public/404.html` 存在，且 `index.html` 里的内嵌脚本没被误删。GitHub Pages 必须走这个 redirect hack。

**Q: 想临时放宽 reportId 校验？**
A: 本地手动跑 `node scripts/bake-public-data.mjs --allow-orphan`（仅调试用，不要进 CI）。

**Q: 想切回方案 C（仓库不含 runtime snapshot，让 LLM 自动跑评测）？**
A: CI workflow 里加一步 "Run Sophia evaluation"，调 LLM 生成新 outbox 再 bake。目前 CI 只做静态烘焙，不跑评测。
