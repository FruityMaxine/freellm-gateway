/**
 * Playground 历史会话 TanStack 钩子（Tick 36 v1.7.8.0）。
 *
 * 与 `/public/playground/sessions/*` 公开端点交互。
 * `ownerId` 从 localStorage 取，首次访问时生成持久化的 cuid（见 `useOrCreateOwnerId`）。
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface PlaygroundMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  meta?: { upstreamModel?: string; durationMs?: number };
}

export interface PlaygroundSessionRow {
  id: string;
  name: string;
  demoVkPrefix: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
}

export interface PlaygroundSessionFull extends PlaygroundSessionRow {
  messages: PlaygroundMessage[];
}

const OWNER_ID_STORAGE_KEY = 'freellm:playground:ownerId';

/**
 * 首次访问 → 生成持久化 ownerId（cuid 风格）；返回稳定 ID。
 */
export function useOrCreateOwnerId(): string {
  const [ownerId, setOwnerId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    const existing = window.localStorage.getItem(OWNER_ID_STORAGE_KEY);
    if (existing && existing.length >= 8) return existing;
    const fresh = generateOwnerId();
    window.localStorage.setItem(OWNER_ID_STORAGE_KEY, fresh);
    return fresh;
  });

  useEffect(() => {
    if (!ownerId && typeof window !== 'undefined') {
      const fresh = generateOwnerId();
      window.localStorage.setItem(OWNER_ID_STORAGE_KEY, fresh);
      setOwnerId(fresh);
    }
  }, [ownerId]);

  return ownerId;
}

function generateOwnerId(): string {
  // 轻量 cuid 风格：'pg' + 时间戳 base36 + 12 个随机 hex
  const ts = Date.now().toString(36);
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `pg${ts}${rand}`;
}

export function usePlaygroundSessions(ownerId: string) {
  return useQuery({
    queryKey: ['playground', 'sessions', ownerId],
    enabled: !!ownerId,
    queryFn: async (): Promise<{ data: PlaygroundSessionRow[]; total: number }> => {
      const res = await api.get('/public/playground/sessions', { params: { owner: ownerId } });
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function usePlaygroundSession(id: string | null, ownerId: string) {
  return useQuery({
    queryKey: ['playground', 'sessions', ownerId, id],
    enabled: !!id && !!ownerId,
    queryFn: async (): Promise<{ session: PlaygroundSessionFull }> => {
      const res = await api.get(`/public/playground/sessions/${id}`, {
        params: { owner: ownerId },
      });
      return res.data;
    },
    staleTime: 10_000,
  });
}

export function useCreatePlaygroundSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      ownerId: string;
      name?: string;
      messages?: PlaygroundMessage[];
      demoVkPrefix?: string;
    }): Promise<{ ok: true; session: PlaygroundSessionFull }> => {
      const res = await api.post('/public/playground/sessions', input);
      return res.data;
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['playground', 'sessions', vars.ownerId] });
    },
  });
}

export function useUpdatePlaygroundSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      ownerId: string;
      name?: string;
      messages?: PlaygroundMessage[];
      demoVkPrefix?: string;
    }): Promise<{ ok: true; session: PlaygroundSessionFull }> => {
      const { id, ownerId, ...body } = args;
      const res = await api.patch(`/public/playground/sessions/${id}`, body, {
        params: { owner: ownerId },
      });
      return res.data;
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['playground', 'sessions', vars.ownerId] });
      void qc.invalidateQueries({ queryKey: ['playground', 'sessions', vars.ownerId, vars.id] });
    },
  });
}

export function useDeletePlaygroundSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; ownerId: string }) => {
      const res = await api.delete(`/public/playground/sessions/${args.id}`, {
        params: { owner: args.ownerId },
      });
      return res.data;
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['playground', 'sessions', vars.ownerId] });
    },
  });
}
