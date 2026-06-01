/**
 * 组织/项目成本分摊 hooks（组 8 Tick 4 v1.26.0.0）。
 */
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface OrgProjectCost {
  projectId: string;
  name: string;
  cost: number;
  tokens: number;
  requests: number;
}
export interface OrgCost {
  organizationId: string;
  name: string;
  cost: number;
  tokens: number;
  requests: number;
  pct: number;
  projects: OrgProjectCost[];
}
export interface OrgCostData {
  windowDays: number;
  totalCost: number;
  organizations: OrgCost[];
}

export function useOrgCost(days: number) {
  return useQuery({
    queryKey: ['org-cost', days],
    queryFn: async (): Promise<OrgCostData> => {
      const { data } = await api.get('/admin/org-cost-breakdown', { params: { days } });
      return data;
    },
  });
}
