/**
 * 模型对比 hooks（组 6 Tick 4 v1.18.0.0）。
 */
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { ModelScoreDimensions } from '@/components/charts/ModelScoreRadar';

export interface ModelCompareRow {
  id: string;
  upstreamId: string;
  providerSlug: string;
  contextLength: number;
  isFree: boolean;
  composite: number | null;
  scores: ModelScoreDimensions | null;
}

export function useModelCompare(ids: string[]) {
  return useQuery({
    queryKey: ['model-compare', ids],
    queryFn: async (): Promise<{ data: ModelCompareRow[] }> => {
      const { data } = await api.get('/admin/model-compare', { params: { ids: ids.join(',') } });
      return data;
    },
    enabled: ids.length >= 1,
  });
}
