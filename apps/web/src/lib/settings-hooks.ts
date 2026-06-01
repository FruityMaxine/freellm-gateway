/**
 * Settings API hooks. The backend `settings` table is a key/value store —
 * we project it into a typed shape on the frontend.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export type SettingsBag = Record<string, unknown>;

export function useSettings() {
  return useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: async (): Promise<{ data: SettingsBag; total: number }> => {
      const res = await api.get('/admin/settings');
      return res.data;
    },
  });
}

export function usePatchSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: SettingsBag) => {
      const res = await api.patch('/admin/settings', patch);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
  });
}

// Tick 46 v1.7.18.0：数据保留策略
export interface RetentionPolicy {
  adminAuditRetentionDays: number;
  playgroundSessionRetentionDays: number;
  errorEventRetentionDays: number;
}

export interface PurgeReport {
  policy: RetentionPolicy;
  auditPurged: number;
  playgroundSessionsPurged: number;
  errorEventsPurged: number;
  generatedAt: string;
}

export function useRetentionPolicy() {
  return useQuery({
    queryKey: ['admin', 'settings', 'retention'],
    queryFn: async (): Promise<RetentionPolicy> => {
      const res = await api.get('/admin/settings/retention');
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useUpdateRetentionPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<RetentionPolicy>): Promise<RetentionPolicy> => {
      const res = await api.patch('/admin/settings/retention', patch);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'settings', 'retention'] });
    },
  });
}

export function useRunRetentionPurge() {
  return useMutation({
    mutationFn: async (): Promise<PurgeReport> => {
      const res = await api.post('/admin/settings/retention/purge');
      return res.data;
    },
  });
}

// Tick 47 v1.7.19.0：cron 调度状态
export interface CronJobStatus {
  name: string;
  everyMs: number;
  registeredAt: string;
  lastRunAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  lastErrorAt: string | null;
  successCount: number;
  failureCount: number;
  sinceLastRunMs: number | null;
  stale: boolean;
}

export function useCronStatus() {
  return useQuery({
    queryKey: ['admin', 'cron', 'status'],
    queryFn: async (): Promise<{ data: CronJobStatus[]; total: number; generatedAt: string }> => {
      const res = await api.get('/admin/cron/status');
      return res.data;
    },
    refetchInterval: 10_000,
  });
}

// Tick 48 v1.7.20.0：重试/退避策略
export interface RetryPolicy {
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  jitterRatio: number;
  retryOnStatusCodes: number[];
  retryOnErrorKinds: string[];
}

export interface BackoffPreview {
  attempt: number;
  baseMs: number;
  withJitterMinMs: number;
  withJitterMaxMs: number;
  sampleMs: number;
}

export function useRetryPolicy() {
  return useQuery({
    queryKey: ['admin', 'settings', 'retry-policy'],
    queryFn: async (): Promise<RetryPolicy> => {
      const res = await api.get('/admin/settings/retry-policy');
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useUpdateRetryPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<RetryPolicy>): Promise<RetryPolicy> => {
      const res = await api.patch('/admin/settings/retry-policy', patch);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'settings', 'retry-policy'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'settings', 'retry-policy', 'preview'] });
    },
  });
}

export function useRetryPolicyPreview(maxAttempts?: number) {
  return useQuery({
    queryKey: ['admin', 'settings', 'retry-policy', 'preview', maxAttempts ?? null],
    queryFn: async (): Promise<{ data: BackoffPreview[]; total: number }> => {
      const res = await api.get('/admin/settings/retry-policy/preview', {
        params: maxAttempts != null ? { maxAttempts } : undefined,
      });
      return res.data;
    },
    staleTime: 30_000,
  });
}
