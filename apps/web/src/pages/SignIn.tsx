/**
 * 管理员登录页面（Tick 52 v1.7.24.0 引入）。
 *
 * 51 个 tick 一直缺这个页面：后端 `/admin/auth/login` 早就在了，但没有
 * UI 让用户填账号密码 — 部署后用户无法登录管理后台。
 *
 * 登录成功 → 主动 invalidate `useAuthStatus`，Sidebar 切到 ADMIN_NAV，
 * 然后 redirect 到 query `?redirect=...` 或 `/dashboard`。
 */
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogIn } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GlassCard } from '@/components/bits/GlassCard';
import { toast } from 'sonner';

export function SignInPage() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') ?? '/dashboard';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      toast.error('请输入用户名与密码');
      return;
    }
    setPending(true);
    try {
      await api.post('/admin/auth/login', { username: username.trim(), password });
      await qc.invalidateQueries({ queryKey: ['admin', 'auth', 'me'] });
      toast.success('登录成功');
      nav(redirect, { replace: true });
    } catch (err) {
      const status = (err as { response?: { status?: number; data?: { error?: { message?: string } } } })
        .response?.status;
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
          ?.message ?? (err as Error).message;
      if (status === 423) {
        toast.error(`账号锁定: ${message}`);
      } else if (status === 401) {
        toast.error('用户名或密码错误');
      } else {
        toast.error(`登录失败: ${message}`);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center px-6 py-16">
      <GlassCard className="w-full p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/30">
            <KeyRound className="size-6" />
          </span>
          <div>
            <div className="text-xl font-semibold text-[var(--color-ink)]">管理员登录</div>
            <div className="mt-1 text-xs text-[var(--color-muted)]">
              登录后才能管理模型 / 虚拟密钥 / 日志 / 设置
            </div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
              用户名
            </label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
              placeholder="admin"
              autoFocus
              autoComplete="username"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
              密码
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>
          <Button type="submit" variant="primary" size="md" className="w-full" disabled={pending}>
            <LogIn className="size-4" />
            {pending ? '正在登录…' : '登录'}
          </Button>
        </form>

        <div className="mt-6 border-t border-[var(--color-hairline)] pt-4 text-center text-[11px] text-[var(--color-muted)]">
          <Link to="/" className="hover:text-[var(--color-primary)]">
            ← 返回首页
          </Link>
          <span className="mx-2">·</span>
          <Link to="/playground" className="hover:text-[var(--color-primary)]">
            访客可用 Playground
          </Link>
        </div>
      </GlassCard>
    </div>
  );
}
