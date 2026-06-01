/**
 * 路由健康看板 hooks（组 5 Tick 3 v1.13.0.0）。
 * 三源聚合快照：cooldowns 倒计时 + top 模型 9 维 + provider 健康时间线，10s 自动刷新。
 */
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { ModelScoreDimensions } from '@/components/charts/ModelScoreRadar';

export interface RouteHealthCooldown {
  id: string;
  scope: 'model' | 'provider';
  label: string;
  reason: string;
  attempts: number;
  backoffMs: number;
  expiresAt: string;
  halfOpen: boolean;
  remainingMs: number;
}

export interface RouteHealthModel {
  modelId: string;
  upstreamId: string;
  providerSlug: string;
  composite: number;
  scores: ModelScoreDimensions;
}

export interface RouteHealthProvider {
  slug: string;
  name: string;
  lastHealthAt: string | null;
  checks: Array<{ ok: boolean; latencyMs: number | null; takenAt: string }>;
}

export interface RouteHealthSnapshot {
  cooldowns: RouteHealthCooldown[];
  topModels: RouteHealthModel[];
  providers: RouteHealthProvider[];
  generatedAt: string;
}

export function useRouteHealth() {
  return useQuery({
    queryKey: ['route-health'],
    queryFn: async () => {
      const { data } = await api.get('/admin/route-health');
      return data as RouteHealthSnapshot;
    },
    refetchInterval: 10_000,
  });
}
