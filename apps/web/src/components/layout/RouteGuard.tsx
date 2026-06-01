/**
 * Route Guard（Tick 58 v1.7.30.0 引入）。
 *
 * 51 个 tick + Tick 55 RBAC 后端做了 admin-only, 但前端 SPA 路由没拦 —
 * test (role=user) 直接访问 /dashboard 能进页壳子, 里面 API 全 403,
 * 显示空数据/卡死。
 *
 * 本文件提供 <RequireAdmin> wrapper: role!=='admin' 渲染 403 提示页 +
 * 跳回首页。
 */
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuthStatus } from '@/lib/useAuthStatus';
import { GlassCard } from '@/components/bits/GlassCard';
import { Button } from '@/components/ui/button';

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { data: auth, isLoading } = useAuthStatus();
  const loc = useLocation();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-16 text-center text-[var(--color-muted)]">
        正在校验权限…
      </div>
    );
  }

  if (!auth.loggedIn) {
    return <Navigate to={`/signin?redirect=${encodeURIComponent(loc.pathname)}`} replace />;
  }

  if (auth.role !== 'admin') {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <GlassCard className="border-[var(--color-warning)]/40 bg-[var(--color-warning)]/5 p-8 text-center">
          <ShieldAlert className="mx-auto mb-3 size-10 text-[var(--color-warning)]" />
          <div className="text-lg font-semibold text-[var(--color-ink)]">需要管理员权限</div>
          <div className="mt-2 text-sm text-[var(--color-muted)]">
            当前账号 <span className="font-mono text-[var(--color-body)]">{auth.username}</span> 是普通用户 (role=user),
            <br />
            访问 <span className="font-mono text-[var(--color-body)]">{loc.pathname}</span> 需要 admin 角色。
          </div>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="primary" size="sm" onClick={() => (window.location.href = '/playground')}>
              去 Playground
            </Button>
            <Button variant="ghost" size="sm" onClick={() => (window.location.href = '/virtual-keys')}>
              看我的密钥
            </Button>
          </div>
        </GlassCard>
      </div>
    );
  }

  return <>{children}</>;
}

export function RequireLogin({ children }: { children: React.ReactNode }) {
  const { data: auth, isLoading } = useAuthStatus();
  const loc = useLocation();
  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-16 text-center text-[var(--color-muted)]">
        正在校验权限…
      </div>
    );
  }
  if (!auth.loggedIn) {
    return <Navigate to={`/signin?redirect=${encodeURIComponent(loc.pathname)}`} replace />;
  }
  return <>{children}</>;
}
