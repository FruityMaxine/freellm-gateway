/**
 * 管理员操作审计 TanStack 钩子（Tick 29 v1.7.1.0）。
 *
 * 与 `/admin/audit` + `/admin/audit/facets` 端点交互。
 * 列表 30 秒 staleTime；facets（已知 action / resourceType 枚举）2 分钟。
 */
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface AdminAuditLogRow {
  id: string;
  userId: string | null;
  username: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  method: string;
  path: string;
  status: number;
  requestBody: string | null;
  clientIp: string | null;
  userAgent: string | null;
  requestId: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface AuditFilter {
  userId?: string;
  username?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export function useAudit(filter: AuditFilter = {}) {
  return useQuery({
    queryKey: ['admin', 'audit', filter],
    queryFn: async (): Promise<{ data: AdminAuditLogRow[]; total: number }> => {
      const res = await api.get('/admin/audit', { params: filter });
      return res.data;
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useAuditFacets() {
  return useQuery({
    queryKey: ['admin', 'audit', 'facets'],
    queryFn: async (): Promise<{ actions: string[]; resourceTypes: string[] }> => {
      const res = await api.get('/admin/audit/facets');
      return res.data;
    },
    staleTime: 2 * 60_000,
    refetchOnWindowFocus: false,
  });
}

// Tick 43 v1.7.15.0：审计反向聚合统计
export type AuditStatsDimension = 'user' | 'resource' | 'action' | 'day';

export interface AuditStatsBucket {
  key: string;
  total: number;
  failed: number;
  failureRate: number;
}

export interface AuditStatsResult {
  dimension: AuditStatsDimension;
  windowStart: string;
  windowEnd: string;
  buckets: AuditStatsBucket[];
  totalEvents: number;
  generatedAt: string;
}

export function useAuditStats(
  dimension: AuditStatsDimension,
  opts: { since?: string; until?: string; topN?: number } = {},
) {
  return useQuery({
    queryKey: ['admin', 'audit', 'stats', dimension, opts],
    queryFn: async (): Promise<AuditStatsResult> => {
      const res = await api.get('/admin/audit/stats', {
        params: { dimension, ...opts },
      });
      return res.data;
    },
    staleTime: 60_000,
  });
}
