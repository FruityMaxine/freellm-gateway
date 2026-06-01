/**
 * Provider 运营中心 hooks（组 6 Tick 3 v1.17.0.0）。
 * 余额耗尽排序 + byDay 趋势 + SLA uptime，30s 自动刷新。
 */
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface ProviderOpsRow {
  slug: string;
  name: string;
  balanceRemaining: number | null;
  burnRateUsdPerDay: number | null;
  estimatedDaysRemaining: number | null;
  sla24h: number;
  sla7d: number;
  error24h: number;
  requests: number;
}

export interface ProviderOpsTrendPoint {
  day: string;
  requests: number;
  errors: number;
}

export interface ProviderOpsSnapshot {
  providers: ProviderOpsRow[];
  trend: ProviderOpsTrendPoint[];
  windowDays: number;
  generatedAt: string;
}

export function useProviderOps(days: number) {
  return useQuery({
    queryKey: ['provider-ops', days],
    queryFn: async () => {
      const { data } = await api.get('/admin/provider-ops', { params: { days } });
      return data as ProviderOpsSnapshot;
    },
    refetchInterval: 30_000,
  });
}
