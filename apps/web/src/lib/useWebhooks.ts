/**
 * Webhook 订阅管理 TanStack 钩子（Tick 27 v1.6.2.0）。
 *
 * 与 `/admin/webhooks` CRUD + `/admin/webhooks/sign-test` + `/admin/webhooks/verify`
 * 端点交互。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface WebhookSubscriptionRow {
  id: string;
  url: string;
  secretPreview: string;
  eventTopics: string[];
  enabled: boolean;
  description: string | null;
  createdAt: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  totalDeliveries: number;
  totalFailures: number;
}

export interface CreateWebhookInput {
  url: string;
  secret: string;
  eventTopics?: string[];
  enabled?: boolean;
  description?: string | null;
}

export interface UpdateWebhookInput {
  url?: string;
  secret?: string;
  eventTopics?: string[];
  enabled?: boolean;
  description?: string | null;
}

export function useWebhooks() {
  return useQuery({
    queryKey: ['admin', 'webhooks'],
    queryFn: async (): Promise<{ data: WebhookSubscriptionRow[] }> => {
      const res = await api.get('/admin/webhooks');
      return res.data;
    },
    staleTime: 15_000,
  });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateWebhookInput) => {
      const res = await api.post('/admin/webhooks', input);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'webhooks'] });
    },
  });
}

export function useUpdateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; patch: UpdateWebhookInput }) => {
      const res = await api.patch(`/admin/webhooks/${args.id}`, args.patch);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'webhooks'] });
    },
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/admin/webhooks/${id}`);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'webhooks'] });
    },
  });
}

export interface SignTestResult {
  signatureHeader: string;
  deliveryId: string;
  timestamp: number;
  curlSnippet: string;
}

export interface VerifyResult {
  valid: boolean;
  reason: 'malformed' | 'expired' | 'signature_mismatch' | null;
}

export function useSignTest() {
  return useMutation({
    mutationFn: async (input: { secret: string; payload: string }): Promise<SignTestResult> => {
      const res = await api.post('/admin/webhooks/sign-test', input);
      return res.data;
    },
  });
}

export function useVerifyWebhook() {
  return useMutation({
    mutationFn: async (input: {
      secret: string;
      payload: string;
      signatureHeader: string;
      toleranceSeconds?: number;
    }): Promise<VerifyResult> => {
      const res = await api.post('/admin/webhooks/verify', input);
      return res.data;
    },
  });
}

// 组 5 Tick 4 v1.14.0.0：投递历史明细 + 失败重试。
export interface WebhookDeliveryRow {
  id: string;
  topic: string;
  ok: boolean;
  httpStatus: number | null;
  attempts: number;
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}

export function useWebhookDeliveries(subscriptionId: string | null) {
  return useQuery({
    queryKey: ['webhook-deliveries', subscriptionId],
    queryFn: async (): Promise<{ data: WebhookDeliveryRow[]; total: number }> => {
      const res = await api.get(`/admin/webhooks/${subscriptionId}/deliveries`);
      return res.data;
    },
    enabled: !!subscriptionId,
    staleTime: 10_000,
  });
}

export function useRetryDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (deliveryId: string) => {
      const res = await api.post(`/admin/webhooks/deliveries/${deliveryId}/retry`);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['webhook-deliveries'] });
    },
  });
}
