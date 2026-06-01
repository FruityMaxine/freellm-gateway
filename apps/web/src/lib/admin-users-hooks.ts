/**
 * 管理员账号 + 会话管理 hooks（Tick 53 v1.7.25.0 引入）。
 *
 * 联动后端：apps/api/src/routes/admin/users.routes.ts
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface AdminUserRow {
  id: string;
  username: string;
  role: 'admin' | 'user';
  enabled: boolean;
  failedLogins: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  createdAt: string;
  updatedAt: string;
  locked: boolean;
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async (): Promise<{ data: AdminUserRow[]; total: number }> => {
      const res = await api.get('/admin/users');
      return res.data;
    },
    staleTime: 10_000,
  });
}

export function useCreateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      username: string;
      password: string;
      role?: 'admin' | 'user';
    }): Promise<{ ok: true; id: string }> => {
      const res = await api.post('/admin/users', body);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

export function usePatchAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      enabled?: boolean;
      unlock?: boolean;
      newPassword?: string;
      role?: 'admin' | 'user';
    }): Promise<{ ok: true } & Record<string, unknown>> => {
      const { id, ...body } = args;
      const res = await api.patch(`/admin/users/${id}`, body);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

export function useDeleteAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ ok: true }> => {
      const res = await api.delete(`/admin/users/${id}`);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'sessions'] });
    },
  });
}

export interface AdminSessionRow {
  id: string;
  userId: string;
  username: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export function useAdminSessions() {
  return useQuery({
    queryKey: ['admin', 'sessions'],
    queryFn: async (): Promise<{ data: AdminSessionRow[]; total: number }> => {
      const res = await api.get('/admin/sessions');
      return res.data;
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}

export function useRevokeAdminSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ ok: true }> => {
      const res = await api.post(`/admin/sessions/${id}/revoke`);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'sessions'] });
    },
  });
}
