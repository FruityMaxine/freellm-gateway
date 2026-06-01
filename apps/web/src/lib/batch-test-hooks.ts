/**
 * 批量模型测试台 hooks（组 7 Tick 4 v1.22.0.0）。
 */
import { useMutation } from '@tanstack/react-query';
import { api } from './api';

export interface BatchTestResult {
  modelId: string;
  upstreamId: string;
  providerSlug?: string;
  success: boolean;
  responseText?: string;
  error?: string;
  latencyMs: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
}

export function useBatchTest() {
  return useMutation({
    mutationFn: async (payload: {
      modelIds: string[];
      prompt: string;
    }): Promise<{ results: BatchTestResult[] }> => {
      const { data } = await api.post('/admin/batch-test', payload);
      return data;
    },
  });
}
