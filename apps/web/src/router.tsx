import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { RequireAdmin, RequireLogin } from './components/layout/RouteGuard';

// Tick 16 v1.0.1.0：路由级 lazy load。每个 admin page 独立 chunk；
// Dashboard 引用的 recharts (~421 KB) 只在用户真正进 /dashboard 时才下载，
// 初次进入 / 与 Landing 体验 TTI 显著降低。
const LandingPage = lazy(() => import('./pages/Landing/LandingPage').then((m) => ({ default: m.LandingPage })));
const DashboardStub = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.DashboardStub })));
const ModelsStub = lazy(() => import('./pages/Models').then((m) => ({ default: m.ModelsStub })));
const RoutingLabStub = lazy(() => import('./pages/RoutingLab').then((m) => ({ default: m.RoutingLabStub })));
const VirtualKeysStub = lazy(() => import('./pages/VirtualKeys').then((m) => ({ default: m.VirtualKeysStub })));
const ProvidersStub = lazy(() => import('./pages/Providers').then((m) => ({ default: m.ProvidersStub })));
const OrganizationsPage = lazy(() => import('./pages/Organizations').then((m) => ({ default: m.OrganizationsPage })));
const LogsStub = lazy(() => import('./pages/Logs').then((m) => ({ default: m.LogsStub })));
const SettingsStub = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsStub })));
const PlaygroundPage = lazy(() => import('./pages/Playground').then((m) => ({ default: m.PlaygroundPage })));
const WebhooksPage = lazy(() => import('./pages/Webhooks').then((m) => ({ default: m.WebhooksPage })));
const AuditPage = lazy(() => import('./pages/Audit').then((m) => ({ default: m.AuditPage })));
const AlertsPage = lazy(() => import('./pages/Alerts').then((m) => ({ default: m.AlertsPage })));
const NotifyChannelsPage = lazy(() => import('./pages/NotifyChannels').then((m) => ({ default: m.NotifyChannelsPage })));
const UsageAnalyticsPage = lazy(() => import('./pages/UsageAnalytics').then((m) => ({ default: m.UsageAnalyticsPage })));
const RouteHealthPage = lazy(() => import('./pages/RouteHealth').then((m) => ({ default: m.RouteHealthPage })));
const RouteFailureAnalysisPage = lazy(() => import('./pages/RouteFailureAnalysis').then((m) => ({ default: m.RouteFailureAnalysisPage })));
const CostAnalyticsPage = lazy(() => import('./pages/CostAnalytics').then((m) => ({ default: m.CostAnalyticsPage })));
const ProviderOpsPage = lazy(() => import('./pages/ProviderOps').then((m) => ({ default: m.ProviderOpsPage })));
const ModelComparePage = lazy(() => import('./pages/ModelCompare').then((m) => ({ default: m.ModelComparePage })));
const ModelCapabilityMatrixPage = lazy(() => import('./pages/ModelCapabilityMatrix').then((m) => ({ default: m.ModelCapabilityMatrixPage })));
const BatchTestPage = lazy(() => import('./pages/BatchTest').then((m) => ({ default: m.BatchTestPage })));
const ModelSnapshotHistoryPage = lazy(() => import('./pages/ModelSnapshotHistory').then((m) => ({ default: m.ModelSnapshotHistoryPage })));
const BudgetsPage = lazy(() => import('./pages/Budgets').then((m) => ({ default: m.BudgetsPage })));
const OrgCostBreakdownPage = lazy(() => import('./pages/OrgCostBreakdown').then((m) => ({ default: m.OrgCostBreakdownPage })));
const RoutingPolicyEditorPage = lazy(() => import('./pages/RoutingPolicyEditor').then((m) => ({ default: m.RoutingPolicyEditorPage })));
const RoutingPoliciesPage = lazy(() => import('./pages/RoutingPolicies').then((m) => ({ default: m.RoutingPoliciesPage })));
const SignInPage = lazy(() => import('./pages/SignIn').then((m) => ({ default: m.SignInPage })));
const AdminPanelPage = lazy(() => import('./pages/AdminPanel').then((m) => ({ default: m.AdminPanelPage })));
const NotFound = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.NotFound })));

function PageFallback() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-16 text-sm text-[var(--color-muted)]">
      正在加载页面…
    </div>
  );
}

function withSuspense(node: ReactNode) {
  return <Suspense fallback={<PageFallback />}>{node}</Suspense>;
}

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      // Tick 58 v1.7.30.0：RBAC 路由 guard — admin-only 路由用 <RequireAdmin>,
      //   user 登录可见 (Playground/VirtualKeys/Logs) 用 <RequireLogin>(VirtualKeys/Logs)
      //   公开 (Landing/Playground/SignIn) 不加 guard
      { path: '/', element: withSuspense(<LandingPage />) },
      { path: '/landing', element: <Navigate to="/" replace /> },
      { path: '/playground', element: withSuspense(<PlaygroundPage />) },
      { path: '/signin', element: withSuspense(<SignInPage />) },
      { path: '/login', element: <Navigate to="/signin" replace /> },
      { path: '/auth/signin', element: <Navigate to="/signin" replace /> },

      // user + admin 都能访问 (服务端按 ownerId 过滤)
      { path: '/virtual-keys', element: <RequireLogin>{withSuspense(<VirtualKeysStub />)}</RequireLogin> },
      { path: '/logs', element: <RequireLogin>{withSuspense(<LogsStub />)}</RequireLogin> },

      // admin-only — user 访问会看到 "需要管理员权限" 提示页
      { path: '/dashboard', element: <RequireAdmin>{withSuspense(<DashboardStub />)}</RequireAdmin> },
      { path: '/usage-analytics', element: <RequireAdmin>{withSuspense(<UsageAnalyticsPage />)}</RequireAdmin> },
      { path: '/route-health', element: <RequireAdmin>{withSuspense(<RouteHealthPage />)}</RequireAdmin> },
      { path: '/route-failure-analysis', element: <RequireAdmin>{withSuspense(<RouteFailureAnalysisPage />)}</RequireAdmin> },
      { path: '/cost-analytics', element: <RequireAdmin>{withSuspense(<CostAnalyticsPage />)}</RequireAdmin> },
      { path: '/budgets', element: <RequireAdmin>{withSuspense(<BudgetsPage />)}</RequireAdmin> },
      { path: '/org-cost', element: <RequireAdmin>{withSuspense(<OrgCostBreakdownPage />)}</RequireAdmin> },
      { path: '/provider-ops', element: <RequireAdmin>{withSuspense(<ProviderOpsPage />)}</RequireAdmin> },
      { path: '/model-compare', element: <RequireAdmin>{withSuspense(<ModelComparePage />)}</RequireAdmin> },
      { path: '/model-capability-matrix', element: <RequireAdmin>{withSuspense(<ModelCapabilityMatrixPage />)}</RequireAdmin> },
      { path: '/batch-test', element: <RequireAdmin>{withSuspense(<BatchTestPage />)}</RequireAdmin> },
      { path: '/model-snapshot-history', element: <RequireAdmin>{withSuspense(<ModelSnapshotHistoryPage />)}</RequireAdmin> },
      { path: '/models', element: <RequireAdmin>{withSuspense(<ModelsStub />)}</RequireAdmin> },
      { path: '/routing-lab', element: <RequireAdmin>{withSuspense(<RoutingLabStub />)}</RequireAdmin> },
      { path: '/routing-policy-editor', element: <RequireAdmin>{withSuspense(<RoutingPolicyEditorPage />)}</RequireAdmin> },
      { path: '/routing-policies', element: <RequireAdmin>{withSuspense(<RoutingPoliciesPage />)}</RequireAdmin> },
      { path: '/providers', element: <RequireAdmin>{withSuspense(<ProvidersStub />)}</RequireAdmin> },
      { path: '/organizations', element: <RequireAdmin>{withSuspense(<OrganizationsPage />)}</RequireAdmin> },
      { path: '/webhooks', element: <RequireAdmin>{withSuspense(<WebhooksPage />)}</RequireAdmin> },
      { path: '/audit', element: <RequireAdmin>{withSuspense(<AuditPage />)}</RequireAdmin> },
      { path: '/alerts', element: <RequireAdmin>{withSuspense(<AlertsPage />)}</RequireAdmin> },
      { path: '/notify-channels', element: <RequireAdmin>{withSuspense(<NotifyChannelsPage />)}</RequireAdmin> },
      { path: '/settings', element: <RequireAdmin>{withSuspense(<SettingsStub />)}</RequireAdmin> },
      { path: '/admin-panel', element: <RequireAdmin>{withSuspense(<AdminPanelPage />)}</RequireAdmin> },

      { path: '*', element: withSuspense(<NotFound />) },
    ],
  },
]);
