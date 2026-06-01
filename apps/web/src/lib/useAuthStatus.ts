/**
 * useAuthStatus —— 检测管理员是否已登录（Tick 24 v1.5.1.0 引入）。
 *
 * 实现：调 `/admin/auth/me` 查会话状态。
 * - 200 → `loggedIn: true`，含 username / userId
 * - 401 → `loggedIn: false`
 * - 网络错误 → 视为未登录（保守）
 *
 * 用 TanStack Query 缓存 30 秒，避免 Sidebar 每次重渲都查。
 */
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface AuthStatus {
  loggedIn: boolean;
  userId?: string;
  username?: string;
  /** Tick 55 v1.7.27.0：RBAC 角色 — admin 看全部, user 只看自己 VK + Playground + 自己日志 */
  role?: 'admin' | 'user';
}

export function useAuthStatus(): {
  data: AuthStatus;
  isLoading: boolean;
} {
  const q = useQuery({
    queryKey: ['admin', 'auth', 'me'],
    queryFn: async (): Promise<AuthStatus> => {
      try {
        const res = await api.get('/admin/auth/me');
        return {
          loggedIn: true,
          userId: res.data.userId,
          username: res.data.username,
          role: res.data.role,
        };
      } catch (err) {
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status === 401 || status === 403) {
          return { loggedIn: false };
        }
        return { loggedIn: false };
      }
    },
    staleTime: 30_000,
    retry: false,
  });
  return { data: q.data ?? { loggedIn: false }, isLoading: q.isLoading };
}
