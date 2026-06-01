/**
 * 模型能力矩阵 hooks（组 7 Tick 3 v1.21.0.0）。
 */
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface CapabilityMatrixRow {
  id: string;
  upstreamId: string;
  family: string | null;
  providerSlug: string;
  contextLength: number;
  isFree: boolean;
  promptPrice: number | null;
  completionPrice: number | null;
  capabilities: Record<string, boolean>;
}

export interface CapabilityStat {
  supported: number;
  total: number;
  pct: number;
}

export interface CapabilityMatrixData {
  models: CapabilityMatrixRow[];
  stats: Record<string, CapabilityStat>;
  capKeys: string[];
  total: number;
}

export function useCapabilityMatrix() {
  return useQuery({
    queryKey: ['model-capability-matrix'],
    queryFn: async (): Promise<CapabilityMatrixData> => {
      const { data } = await api.get('/admin/model-capability-matrix');
      return data;
    },
  });
}
