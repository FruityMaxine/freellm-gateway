/**
 * 成本分析 hooks（组 5 Tick 5 v1.15.0.0）。
 * 三源聚合：VK spend 排行 + 模型成本 Top-N + 成本趋势。
 */
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface VkSpendRow {
  virtualKeyId: string;
  label: string;
  prefix: string;
  environment: string;
  enabled: boolean;
  costUsd: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgCostPerReqUsd: number;
  successRate: number;
  shareOfTotal: number;
}

export interface ModelCostRow {
  upstreamModel: string;
  upstreamProvider: string;
  costUsd: number;
  requests: number;
  totalTokens: number;
}

export interface CostTrendRow {
  day: string;
  costUsd: number;
}

export interface CostAnalyticsPayload {
  scope: string;
  windowDays: number;
  vkLeaderboard: {
    windowCostUsd: number;
    shownCostUsd: number;
    totalVkCount: number;
    rows: VkSpendRow[];
  };
  modelCosts: ModelCostRow[];
  costTrend: CostTrendRow[];
  generatedAt: string;
}

export function useCostAnalytics(scope: 'day' | 'week' | 'month') {
  return useQuery({
    queryKey: ['cost-analytics', scope],
    queryFn: async () => {
      const { data } = await api.get('/admin/cost-analytics', { params: { scope } });
      return data as CostAnalyticsPayload;
    },
  });
}
