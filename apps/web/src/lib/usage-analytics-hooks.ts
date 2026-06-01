/**
 * 历史用量分析 hooks（组 5 Tick 2 v1.12.0.0）。
 * 读 usage_daily 预聚合：按日趋势 + per-VK 排行。
 */
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface UsageDailyRow {
  day: string;
  requests: number;
  successes: number;
  failures: number;
  totalTokens: string;
}

export interface UsageVkRow {
  virtualKeyId: string | null;
  label: string;
  requests: number;
  successes: number;
  failures: number;
  totalTokens: string;
  avgLatencyMs: number | null;
}

export function useUsageDaily(days: number) {
  return useQuery({
    queryKey: ['usage-daily', days],
    queryFn: async () => {
      const { data } = await api.get('/admin/usage/daily', { params: { days } });
      return data as { data: UsageDailyRow[]; total: number };
    },
  });
}

export function useUsagePerVk(days: number, limit = 20) {
  return useQuery({
    queryKey: ['usage-per-vk', days, limit],
    queryFn: async () => {
      const { data } = await api.get('/admin/usage/per-vk', { params: { days, limit } });
      return data as { data: UsageVkRow[]; total: number };
    },
  });
}
