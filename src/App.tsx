import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import Layout from "./components/Layout";
import { useLab } from "./store";
import { storage } from "./storage";
import { SEED_SNAPSHOT } from "./seed";
import { IS_READONLY } from "./lib/dataSource";
import { contractBus } from "./lib/contract";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const QueriesPage = lazy(() => import("./pages/QueriesPage"));
const ProductsPage = lazy(() => import("./pages/ProductsPage"));
const ReportPage = lazy(() => import("./pages/ReportPage"));
const StandardPage = lazy(() => import("./pages/StandardPage"));
const ContractPage = lazy(() => import("./pages/ContractPage"));

function RouteFallback() {
  return <div className="text-ink-500 animate-pulse">页面加载中...</div>;
}

/**
 * 一次性 productId 迁移：旧 seed 把 submissions 挂到 `prod-sophia` / `prod-miro`，
 * 产品清单搬到 PRODUCTS.json 之后 id 改成 `sophia-v4` / `mirothink`。
 * 这里做幂等映射，确保老用户浏览器打开时 cohort 不会因为找不到 product 被过滤掉。
 */
const LEGACY_PRODUCT_ID_MAP: Record<string, string> = {
  "prod-sophia": "sophia-v4",
  "prod-miro": "mirothink",
};

/**
 * 迁移版本号：每次"破坏性"或"幂等清理"型迁移执行成功后，把最新版本号写到
 * localStorage；下次启动若版本号已对齐就直接跳过，不用每次都重扫一次库。
 *
 * 版本号规则：改一次迁移规则（增/删映射），就 +1，并在注释里说明。
 *  - 1: `prod-sophia → sophia-v4`、`prod-miro → mirothink` 的 id 迁移（2026-04-20）
 *  - 2: 按后端 `_code-registry.json` 对齐 localStorage 里 query.code（2026-04-20）
 *       编号注册簿架构上线后，后端会统一重新分配 code；浏览器 localStorage 里
 *       的老 code 必须同步修正，否则详情页会用错 code 去 outbox 查报告。
 */
const CURRENT_MIGRATION_VERSION = 2;
const MIGRATION_STORAGE_KEY = "sophia-rubric-lab:migration-version";

function readMigrationVersion(): number {
  try {
    const v = localStorage.getItem(MIGRATION_STORAGE_KEY);
    if (!v) return 0;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeMigrationVersion(v: number) {
  try {
    localStorage.setItem(MIGRATION_STORAGE_KEY, String(v));
  } catch {
    /* ignore */
  }
}

async function migrateLegacyProductIds(): Promise<boolean> {
  const snap = await storage.exportAll();
  let dirty = false;

  const newSubs = (snap.submissions ?? []).map((s) => {
    const mapped = LEGACY_PRODUCT_ID_MAP[s.productId];
    if (mapped) {
      dirty = true;
      return { ...s, productId: mapped };
    }
    return s;
  });

  // 顺手把 products 里残留的老 id 清掉（新数据由 PRODUCTS.json 提供）
  const newProducts = (snap.products ?? []).filter(
    (p) => !Object.keys(LEGACY_PRODUCT_ID_MAP).includes(p.id)
  );
  if (newProducts.length !== (snap.products?.length ?? 0)) dirty = true;

  if (dirty) {
    await storage.importAll(
      {
        ...snap,
        products: newProducts,
        submissions: newSubs,
      },
      "replace"
    );
  }
  return dirty;
}

/**
 * Migration v2：按后端 `_code-registry.json` 对齐 localStorage 里 query.code。
 *
 * 背景：编号注册簿架构上线后，后端 reconcile 会把所有 query 的 code 统一重新分配
 * （例如首付款的 code 从 EV-0001 → EV-0002）。但浏览器 localStorage 里缓存的 code
 * 还是旧值，导致 QueriesPage / DashboardPage / ReportPage 在用 `q.code` 去
 * `outbox.byQueryCode.get(...)` 查报告时查到错位数据。
 *
 * 本 migration 做的事：调用 GET /_bus/registry 拿 queryId→code 映射，把 localStorage
 * 里每条 query 的 code 对齐到权威值。在 reconcile 范围外的老 query（registry 里没有）
 * 保持原样不动。
 */
async function migrateQueryCodesFromRegistry(): Promise<boolean> {
  const reg = await contractBus.getRegistry().catch(() => null);
  // 拿不到注册簿（离线 / bus 挂了）就不做任何事，保持原 code 不动
  if (!reg || !reg.map) return false;

  const snap = await storage.exportAll();
  let dirty = false;
  const newQueries = (snap.queries ?? []).map((q) => {
    const authoritative = reg.map[q.id];
    if (authoritative && authoritative !== q.code) {
      dirty = true;
      return { ...q, code: authoritative };
    }
    return q;
  });

  if (dirty) {
    await storage.importAll(
      {
        ...snap,
        queries: newQueries,
      },
      "replace"
    );
  }
  return dirty;
}

export default function App() {
  const { refresh, loaded } = useLab();
  const [seedChecked, setSeedChecked] = useState(false);

  useEffect(() => {
    const init = async () => {
      // 只读公开版（prod）：数据全来自 /data/public-bundle.json，
      // 不 touch localStorage，也不跑 seed/迁移——直接 refresh 拉数据。
      // 这里 storage 实际是 PublicBundleAdapter（见 storage.ts 末尾的自动分派）。
      if (IS_READONLY) {
        await refresh();
        setSeedChecked(true);
        return;
      }

      // 管理员版（dev）：首次打开时，如果库为空，植入 seed
      const snap = await storage.exportAll();
      const empty =
        !snap.products.length &&
        !snap.queries.length &&
        !snap.submissions.length;
      if (empty) {
        await storage.importAll(SEED_SNAPSHOT, "replace");
        // seed 本身已是最新 schema，直接对齐迁移版本
        writeMigrationVersion(CURRENT_MIGRATION_VERSION);
      } else {
        // 非首启：仅当本地迁移版本落后时才跑一次幂等迁移
        const storedVer = readMigrationVersion();
        if (storedVer < 1) {
          await migrateLegacyProductIds();
        }
        if (storedVer < 2) {
          await migrateQueryCodesFromRegistry();
        }
        if (storedVer < CURRENT_MIGRATION_VERSION) {
          writeMigrationVersion(CURRENT_MIGRATION_VERSION);
        }
      }
      // 每次启动都再对齐一次 registry（幂等）：即便用户在另一个 tab 创建了新
      // query、或 reconcile 又跑过，本 tab 也能拿到最新 code；无变更则 no-op。
      await migrateQueryCodesFromRegistry().catch(() => undefined);
      await refresh();
      setSeedChecked(true);
    };
    init();
  }, [refresh]);

  if (!loaded || !seedChecked) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-ink-500 animate-pulse">Loading Sophia's Rubric Lab...</div>
      </div>
    );
  }

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="queries" element={<QueriesPage />} />
            {/* 评测详情 = 评测报告，统一入口 */}
            <Route path="queries/:id" element={<ReportPage />} />
            {/* 旧链接兼容 */}
            <Route path="report/:queryId" element={<LegacyReportRedirect />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="standard" element={<StandardPage />} />
            <Route path="contract" element={<ContractPage />} />
            {/* 旧 /rubric 链接兼容 */}
            <Route path="rubric" element={<Navigate to="/standard" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

/** 旧 /report/:queryId → /queries/:id 跳转兼容 */
function LegacyReportRedirect() {
  const { queryId } = useParams();
  return <Navigate to={`/queries/${queryId}`} replace />;
}
