/**
 * 路由失败模式聚合分析 hooks（组 8 Tick 2 v1.24.0.0）。
 */
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface ErrorKindStat {
  errorKind: string;
  isSuccess: boolean;
  count: number;
  pct: number;
  avgDurationMs: number | null;
}
export interface ModelFailureRate {
  upstreamModel: string;
  total: number;
  failed: number;
  failureRate: number;
}
export interface SlowAttempt {
  requestId: string;
  upstreamModel: string | null;
  durationMs: number | null;
  firstTokenMs: number | null;
  status: number | null;
  errorKind: string | null;
}
export interface FailureChain {
  requestId: string;
  attempts: number;
}
export interface RouteFailureData {
  windowDays: number;
  totalAttempts: number;
  successRate: number;
  cooldownCount: number;
  errorKinds: ErrorKindStat[];
  modelFailureRates: ModelFailureRate[];
  slowest: SlowAttempt[];
  multiAttemptChains: FailureChain[];
}

export function useRouteFailureAnalysis(days: number) {
  return useQuery({
    queryKey: ['route-failure-analysis', days],
    queryFn: async (): Promise<RouteFailureData> => {
      const { data } = await api.get('/admin/route-failure-analysis', { params: { days } });
      return data;
    },
  });
}
