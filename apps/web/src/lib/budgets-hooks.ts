/**
 * 成本预算 hooks（组 7 Tick 5 v1.23.0.0）。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface BudgetRow {
  id: string;
  name: string;
  scope: string;
  targetId: string | null;
  limitUsd: number;
  period: string;
  enabled: boolean;
  createdAt: string;
  // 实时聚合
  spent: number;
  limit: number;
  pct: number;
  remaining: number;
}

export function useBudgets() {
  return useQuery({
    queryKey: ['budgets'],
    queryFn: async (): Promise<{ budgets: BudgetRow[] }> => {
      const { data } = await api.get('/admin/budgets');
      return data;
    },
  });
}

export function useCreateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      name: string;
      scope: string;
      targetId?: string;
      limitUsd: number;
      period: string;
    }) => {
      const { data } = await api.post('/admin/budgets', body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useUpdateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { data } = await api.patch(`/admin/budgets/${id}`, patch);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useDeleteBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete(`/admin/budgets/${id}`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}
