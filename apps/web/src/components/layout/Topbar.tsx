import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronsLeftRight, LogIn, LogOut, Moon, Search, Sun, SunMoon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useTheme } from './ThemeProvider';
import { useAuthStatus } from '@/lib/useAuthStatus';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export function Topbar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { mode, setMode } = useTheme();
  const ThemeIcon = mode === 'dark' ? Moon : mode === 'light' ? Sun : SunMoon;
  const cycle = () => setMode(mode === 'dark' ? 'light' : mode === 'light' ? 'auto' : 'dark');
  const { data: auth } = useAuthStatus();
  const qc = useQueryClient();
  const nav = useNavigate();

  async function onLogout() {
    try {
      await api.post('/admin/auth/logout');
    } catch {
      /* 即使失败也走前端退出 */
    }
    await qc.invalidateQueries({ queryKey: ['admin', 'auth', 'me'] });
    toast.success('已退出登录');
    nav('/');
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-hairline)] bg-[var(--color-canvas)]/85 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4 md:px-6">
        <Button
          variant="ghost"
          size="icon"
          aria-label="切换侧边栏"
          onClick={onToggleSidebar}
          className="md:inline-flex"
        >
          <ChevronsLeftRight className="size-4" />
        </Button>
        <Link to="/" className="font-mono text-xs tracking-wider text-[var(--color-muted)] hover:text-[var(--color-primary)]">
          freellm/admin
        </Link>
        <Badge tone="primary">生产环境</Badge>

        <div className="relative ml-auto hidden md:block w-[320px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted)]" />
          <Input
            placeholder="搜索模型 / 密钥 / 日志…   ⌘K"
            className="pl-9 bg-transparent border-[var(--color-hairline)] hover:border-[var(--color-hairline-strong)]"
          />
        </div>

        <Button variant="ghost" size="icon" aria-label="主题" onClick={cycle} title={`主题: ${mode}`}>
          <ThemeIcon className="size-4" />
        </Button>

        {/* Tick 52 v1.7.24.0：顶部登录/退出按钮 — 51 tick 缺这入口导致用户找不到登录 */}
        {auth.loggedIn ? (
          <Button variant="ghost" size="sm" onClick={onLogout} title={`已登录: ${auth.username ?? 'admin'}`}>
            <LogOut className="size-3.5" /> 退出
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={() => nav('/signin')} title="管理员登录">
            <LogIn className="size-3.5" /> 登录
          </Button>
        )}
      </div>
    </header>
  );
}
