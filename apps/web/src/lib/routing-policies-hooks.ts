/**
 * 多路由策略管理 hooks（组 7 Tick 2 v1.20.0.0）。
 *   useRoutingPolicies      —— GET 列表（复用 /admin/routing-policies findMany）
 *   useCreateRoutingPolicy  —— POST 创建命名策略
 *   useActivateRoutingPolicy —— POST 激活切换（后端事务保单 active）
 *   useDeleteRoutingPolicy  —— DELETE 删除（后端保证不出 0 active）
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface RoutingPolicyRow {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  mode: string;
  weightsJson: string;
  paramsJson: string | null;
  enabled: boolean;
}

export function useRoutingPolicies() {
  return useQuery({
    queryKey: ['routing-policies'],
    queryFn: async (): Promise<RoutingPolicyRow[]> => {
      const { data } = await api.get('/admin/routing-policies');
      return data;
    },
  });
}

export function useCreateRoutingPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      name: string;
      description?: string;
      mode: string;
      activate?: boolean;
    }) => {
      const { data } = await api.post('/admin/routing-policies', body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routing-policies'] }),
  });
}

export function useActivateRoutingPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data } = await api.post(`/admin/routing-policy/${encodeURIComponent(name)}/activate`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routing-policies'] }),
  });
}

export function useDeleteRoutingPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data } = await api.delete(`/admin/routing-policy/${encodeURIComponent(name)}`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routing-policies'] }),
  });
}
