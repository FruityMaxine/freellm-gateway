/**
 * 路由策略编辑器 hooks（组 6 Tick 5 v1.19.0.0）。
 *   useRoutingPolicyEditor —— GET 聚合：当前策略 + 默认权重 + top3 样本模型 9 维（实时预览用）
 *   useSaveRoutingPolicy   —— PUT upsert 策略（保存 weights/mode）
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export type PolicyWeights = Record<string, number>;

export interface SampleModel {
  upstreamId: string;
  scores: Record<string, number>;
}

export interface RoutingPolicyEditorData {
  policy: { name: string; mode: string; weights: PolicyWeights } | null;
  defaultWeights: PolicyWeights;
  weightKeys: string[];
  modes: string[];
  sampleModels: SampleModel[];
}

export function useRoutingPolicyEditor() {
  return useQuery({
    queryKey: ['routing-policy-editor'],
    queryFn: async (): Promise<RoutingPolicyEditorData> => {
      const { data } = await api.get('/admin/routing-policy-editor');
      return data;
    },
  });
}

export function useSaveRoutingPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; mode: string; weights: PolicyWeights }) => {
      const { data } = await api.put(`/admin/routing-policy/${encodeURIComponent(body.name)}`, {
        mode: body.mode,
        weights: body.weights,
        isDefault: true,
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routing-policy-editor'] }),
  });
}
