/**
 * 管理员告警中心 TanStack 钩子（Tick 40 v1.7.12.0）。
 *
 * 与 `/admin/alerts*` 端点交互：聚合 Tick 31/34/37/39 四大告警源（ErrorEvent 表）。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface AlertRow {
  id: string;
  kind: string;
  severity: string;
  providerId: string | null;
  providerSlug: string | null;
  modelId: string | null;
  message: string;
  detailsJson: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AlertsListFilter {
  kind?: string;
  severity?: 'info' | 'warn' | 'error' | 'critical';
  resolved?: 'true' | 'false';
  limit?: number;
  offset?: number;
}

export interface AlertsStats {
  totalUnresolved: number;
  byKind: Array<{ kind: string; unresolved: number; total: number }>;
  bySeverity: Array<{ severity: string; unresolved: number; total: number }>;
  generatedAt: string;
}

export function useAlerts(filter: AlertsListFilter = {}) {
  return useQuery({
    queryKey: ['admin', 'alerts', filter],
    queryFn: async (): Promise<{ data: AlertRow[]; total: number }> => {
      const res = await api.get('/admin/alerts', { params: filter });
      return res.data;
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useAlertsStats() {
  return useQuery({
    queryKey: ['admin', 'alerts', 'stats'],
    queryFn: async (): Promise<AlertsStats> => {
      const res = await api.get('/admin/alerts/stats');
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useResolveAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<AlertRow> => {
      const res = await api.post(`/admin/alerts/${id}/resolve`);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'alerts'] });
    },
  });
}

// 组 6 Tick 2 v1.16.0.0：告警规则引擎 hooks。
export interface AlertRuleRow {
  id: string;
  name: string;
  metric: string;
  operator: string;
  threshold: number;
  severity: string;
  enabled: boolean;
  notifyWebhook: boolean;
  lastTriggeredAt: string | null;
  lastValue: number | null;
  createdAt: string;
}

export interface AlertRuleInput {
  name: string;
  metric: string;
  operator: string;
  threshold: number;
  severity?: string;
  enabled?: boolean;
  notifyWebhook?: boolean;
}

export function useAlertRules() {
  return useQuery({
    queryKey: ['admin', 'alert-rules'],
    queryFn: async (): Promise<{
      data: AlertRuleRow[];
      total: number;
      metrics: string[];
      operators: string[];
    }> => {
      const res = await api.get('/admin/alert-rules');
      return res.data;
    },
    staleTime: 15_000,
  });
}

export function useCreateAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AlertRuleInput) => {
      const res = await api.post('/admin/alert-rules', input);
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'alert-rules'] }),
  });
}

export function useUpdateAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; patch: Partial<AlertRuleInput> }) => {
      const res = await api.patch(`/admin/alert-rules/${args.id}`, args.patch);
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'alert-rules'] }),
  });
}

export function useDeleteAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/admin/alert-rules/${id}`);
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'alert-rules'] }),
  });
}

export function useEvaluateAlertRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await api.post('/admin/alert-rules/evaluate');
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'alert-rules'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'alerts'] });
    },
  });
}
