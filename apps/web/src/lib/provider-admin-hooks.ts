/**
 * Provider 增删改 hooks（Tick 54 v1.7.26.0 引入）。
 *
 * 对接 apps/api/src/routes/admin/providers.routes.ts 新增的 POST/PATCH/DELETE 端点。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface AdminProviderRow {
  id: string;
  slug: string;
  kind: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  priority: number;
  rpmLimit: number | null;
  dailyLimit: number | null;
  timeoutMs: number;
  compatibleMode: string;
  status: string;
  hasApiKey: boolean;
  keyDigest: string | null;
  notes: string | null;
  registered: boolean;
  createdAt: string;
  updatedAt: string;
}

export function useAdminProviders() {
  return useQuery({
    queryKey: ['admin', 'providers', 'crud'],
    queryFn: async (): Promise<{ data: AdminProviderRow[]; total: number }> => {
      const res = await api.get('/admin/providers');
      return res.data;
    },
    staleTime: 10_000,
  });
}

export interface CreateProviderInput {
  slug: string;
  kind: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  enabled?: boolean;
  priority?: number;
  rpmLimit?: number | null;
  dailyLimit?: number | null;
  timeoutMs?: number;
  compatibleMode?: 'openai' | 'anthropic' | 'google';
  notes?: string | null;
}

export function useCreateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateProviderInput): Promise<{ ok: true; id: string; slug: string }> => {
      const res = await api.post('/admin/providers', body);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'providers'] });
    },
  });
}

export function useUpdateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { slug: string; patch: Partial<CreateProviderInput> }) => {
      const { slug, patch } = args;
      const res = await api.patch(`/admin/providers/${slug}`, patch);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'providers'] });
    },
  });
}

export function useDeleteProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slug: string) => {
      const res = await api.delete(`/admin/providers/${slug}`);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'providers'] });
    },
  });
}

export function useRotateProviderKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { slug: string; apiKey: string; label?: string }) => {
      const { slug, ...body } = args;
      const res = await api.post(`/admin/providers/${slug}/key`, body);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'providers'] });
    },
  });
}

// 模型用量
export interface ModelUsagePayload {
  modelId: string;
  upstreamId: string;
  provider: string;
  windowDays: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  avgLatencyMs: number | null;
  totalCostUsd: number;
  generatedAt: string;
}

export function useModelUsage(modelId: string | null, days = 7) {
  return useQuery({
    queryKey: ['admin', 'models', modelId, 'usage', days],
    enabled: !!modelId,
    queryFn: async (): Promise<ModelUsagePayload> => {
      const res = await api.get(`/admin/models/${modelId}/usage`, { params: { days } });
      return res.data;
    },
    staleTime: 30_000,
  });
}
