/**
 * TanStack Query + axios glue for Routing Lab / Virtual Keys / Logs.
 * Kept in a single file because the surface is small and the three pages
 * frequently invalidate each other (e.g. running a test produces a log row).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface TestChatRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  routingMode?:
    | 'auto-best-free'
    | 'round-robin-free'
    | 'weighted-free'
    | 'openrouter-free-router'
    | 'prefer-model-fallback'
    | 'provider-specific'
    | 'paid-allowed';
}

export interface AttemptReport {
  ordinal: number;
  modelId: string;
  providerSlug: string;
  upstreamModel: string;
  durationMs: number;
  firstTokenMs?: number;
  ok: boolean;
  status: number | null;
  errorKind?: string;
  errorMessage?: string;
  cooldownTriggered: boolean;
  rationale: string;
  score: number;
}

export interface TestChatResponse {
  ok: boolean;
  requestId: string;
  attempts: AttemptReport[];
  upstreamProvider?: string;
  upstreamModel?: string;
  response?: unknown;
  error?: { kind: string; message: string };
}

export function useTestChat() {
  return useMutation({
    mutationFn: async (input: TestChatRequest): Promise<TestChatResponse> => {
      const res = await api.post('/admin/test-chat', input);
      return res.data;
    },
  });
}

export interface VirtualKeyRow {
  id: string;
  label: string;
  environment: 'live' | 'test';
  prefix: string;
  enabled: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  totalRequests: number;
  totalTokens: string;
  permissions: {
    allowedModels?: string[];
    deniedModels?: string[];
    allowedProviders?: string[];
    maxRequestsPerMinute: number | null;
    maxRequestsPerDay: number | null;
    maxTokensPerDay: number | null;
    // Tick 56 v1.7.28.0：3 个新字段
    maxCostUsdPerDay?: number | null;
    allowPaidModels: boolean;
    allowStreaming: boolean;
    reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
    allowReasoning?: boolean;
  };
  createdAt: string;
  revokedAt: string | null;
  /** Tick 19 v1.3.0.0：归属项目（null 表示未分配）。 */
  projectId?: string | null;
}

export interface CreateKeyInput {
  label: string;
  environment: 'live' | 'test';
  permissions: VirtualKeyRow['permissions'];
  expiresAt?: string;
  notes?: string;
  tags?: string[];
  projectId?: string;
}

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  billingEmail: string | null;
  createdAt: string;
  projects?: ProjectRow[];
}

export interface ProjectRow {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  createdAt: string;
}

export function useOrganizationsWithProjects() {
  return useQuery({
    queryKey: ['admin', 'organizations', { include: 'projects' }],
    queryFn: async (): Promise<{ data: OrganizationRow[] }> => {
      const res = await api.get('/admin/organizations', { params: { include: 'projects' } });
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useProjects() {
  return useQuery({
    queryKey: ['admin', 'projects'],
    queryFn: async (): Promise<{ data: ProjectRow[] }> => {
      const res = await api.get('/admin/projects');
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useVirtualKeys() {
  return useQuery({
    queryKey: ['admin', 'virtual-keys'],
    queryFn: async (): Promise<{ data: VirtualKeyRow[]; total: number }> => {
      const res = await api.get('/admin/virtual-keys');
      return res.data;
    },
  });
}

// Tick 33 v1.7.5.0：单 VK 成本统计 + 所有 VK 成本
export interface VirtualKeyCostTopModel {
  upstreamProvider: string;
  upstreamModel: string;
  costUsd: number;
  requests: number;
}

export interface VirtualKeyCostPayload {
  virtualKeyId: string;
  windowDays: number;
  totalCostUsd: number;
  totalRequests: number;
  successfulRequests: number;
  billableRequests: number;
  topModels: VirtualKeyCostTopModel[];
  generatedAt: string;
}

export function useVirtualKeyCost(id: string | null, days: 7 | 30 = 7) {
  return useQuery({
    queryKey: ['admin', 'virtual-keys', id, 'cost', days],
    enabled: !!id,
    queryFn: async (): Promise<VirtualKeyCostPayload> => {
      const res = await api.get(`/admin/virtual-keys/${id}/cost`, { params: { days } });
      return res.data;
    },
    staleTime: 30_000,
  });
}

// Tick 38 v1.7.10.0：VK 月度报告
export interface MonthlyReportDailyBucket {
  day: number;
  requests: number;
  successful: number;
  failed: number;
  totalTokens: number;
  costUsd: number;
  avgLatencyMs: number;
}

export interface MonthlyReportTopModel {
  upstreamProvider: string;
  upstreamModel: string;
  requests: number;
  costUsd: number;
  totalTokens: number;
}

export interface MonthlyReportErrorBreakdown {
  errorKind: string;
  count: number;
}

export interface VirtualKeyMonthlyReport {
  virtualKeyId: string;
  year: number;
  month: number;
  windowStart: string;
  windowEnd: string;
  daysInMonth: number;
  totals: {
    requests: number;
    successful: number;
    failed: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
  };
  dailyBreakdown: MonthlyReportDailyBucket[];
  topModels: MonthlyReportTopModel[];
  errorBreakdown: MonthlyReportErrorBreakdown[];
  generatedAt: string;
}

// Tick 39 v1.7.11.0：VK 用量预警
export interface VkUsageSnapshot {
  virtualKeyId: string;
  label: string;
  enabled: boolean;
  requestsToday: number;
  tokensToday: number;
  maxRequestsPerDay: number | null;
  maxTokensPerDay: number | null;
  requestUsagePct: number | null;
  tokenUsagePct: number | null;
  approachingLimit: boolean;
}

export interface VkUsageAlertRow {
  virtualKeyId: string | null;
  message: string;
  detailsJson: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface VkUsageAlertCheckReport {
  scanned: number;
  alertedVks: Array<{
    virtualKeyId: string;
    label: string;
    metric: 'requests' | 'tokens';
    consumed: number;
    limit: number;
    usagePct: number;
    threshold: number;
    triggeredAt: string;
  }>;
  generatedAt: string;
}

export function useVkUsageSnapshot(id: string | null) {
  return useQuery({
    queryKey: ['admin', 'virtual-keys', id, 'usage'],
    enabled: !!id,
    queryFn: async (): Promise<VkUsageSnapshot> => {
      const res = await api.get(`/admin/virtual-keys/${id}/usage`);
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useVkUsageAlerts() {
  return useQuery({
    queryKey: ['admin', 'virtual-keys', 'alerts'],
    queryFn: async (): Promise<{ data: VkUsageAlertRow[]; total: number }> => {
      const res = await api.get('/admin/virtual-keys/alerts/recent');
      return res.data;
    },
    staleTime: 60_000,
  });
}

// Tick 41 v1.7.13.0：VK 用量周报
export interface VkWeeklyReportTopVk {
  virtualKeyId: string;
  label: string;
  requests: number;
  totalTokens: number;
  costUsd: number;
}

export interface VkWeeklyReport {
  windowStart: string;
  windowEnd: string;
  totals: {
    requests: number;
    successful: number;
    failed: number;
    totalTokens: number;
    costUsd: number;
    activeVks: number;
    alertedVks: number;
  };
  topVks: VkWeeklyReportTopVk[];
  alertedVkSummary: Array<{ virtualKeyId: string; count: number }>;
  generatedAt: string;
}

export function useVkWeeklyReportPreview() {
  return useQuery({
    queryKey: ['admin', 'virtual-keys', 'weekly-report'],
    queryFn: async (): Promise<{ report: VkWeeklyReport; lastSentAt: string | null }> => {
      const res = await api.get('/admin/virtual-keys/weekly-report');
      return res.data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useForceSendWeeklyReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ ok: true; report: VkWeeklyReport }> => {
      const res = await api.post('/admin/virtual-keys/weekly-report/send');
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'virtual-keys', 'weekly-report'] });
    },
  });
}

export function useTriggerVkUsageCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<VkUsageAlertCheckReport> => {
      const res = await api.post('/admin/virtual-keys/alerts/check');
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'virtual-keys', 'alerts'] });
    },
  });
}

export function useVirtualKeyMonthlyReport(id: string | null, month: string | null) {
  return useQuery({
    queryKey: ['admin', 'virtual-keys', id, 'report', month],
    enabled: !!id && !!month,
    queryFn: async (): Promise<VirtualKeyMonthlyReport> => {
      const res = await api.get(`/admin/virtual-keys/${id}/report`, { params: { month } });
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useVirtualKeysCosts(days = 7) {
  return useQuery({
    queryKey: ['admin', 'virtual-keys', 'costs', days],
    queryFn: async (): Promise<{
      data: Array<{ virtualKeyId: string; costUsd: number; requests: number }>;
      windowDays: number;
    }> => {
      const res = await api.get('/admin/virtual-keys/costs', { params: { days } });
      return res.data;
    },
    staleTime: 30_000,
  });
}

// Tick 51 v1.7.23.0：VK Spend 排行榜
export type VkSpendScope = 'day' | 'week' | 'month';

export interface VkSpendLeaderboardRow {
  virtualKeyId: string;
  label: string;
  prefix: string;
  environment: string;
  enabled: boolean;
  costUsd: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgCostPerReqUsd: number;
  successRate: number;
  shareOfTotal: number;
}

export interface VkSpendLeaderboardPayload {
  scope: VkSpendScope;
  windowDays: number;
  limit: number;
  totalVkCount: number;
  windowCostUsd: number;
  shownCostUsd: number;
  remainderCostUsd: number;
  remainderVkCount: number;
  rows: VkSpendLeaderboardRow[];
  generatedAt: string;
}

export function useVkSpendLeaderboard(scope: VkSpendScope = 'month', limit = 10) {
  return useQuery({
    queryKey: ['admin', 'virtual-keys', 'spend-leaderboard', scope, limit],
    queryFn: async (): Promise<VkSpendLeaderboardPayload> => {
      const res = await api.get('/admin/virtual-keys/spend-leaderboard', { params: { scope, limit } });
      return res.data;
    },
    staleTime: 5_000,
    refetchInterval: 30_000,
  });
}

export function useCreateKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      body: CreateKeyInput,
    ): Promise<{ ok: true; key: { id: string; prefix: string; secret: string; label: string; environment: 'live' | 'test'; createdAt: string } }> => {
      const res = await api.post('/admin/virtual-keys', body);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'virtual-keys'] });
    },
  });
}

export function useRotateKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/admin/virtual-keys/${id}/rotate`);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'virtual-keys'] });
    },
  });
}

export function useRevokeKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/admin/virtual-keys/${id}`);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'virtual-keys'] });
    },
  });
}

export interface LogRow {
  id: string;
  requestId: string;
  virtualKeyId: string | null;
  upstreamProvider: string | null;
  upstreamModel: string | null;
  modelAlias: string | null;
  routingMode: string | null;
  streaming: boolean;
  status: number | null;
  errorKind: string | null;
  attempts: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptDigest: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  firstTokenMs: number | null;
  clientIp: string | null;
}

// Tick 42 v1.7.14.0：RouteAttempt 完整字段（瀑布图用）
export interface RouteAttemptRow {
  ordinal: number;
  upstreamModel: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  firstTokenMs: number | null;
  status: number | null;
  errorKind: string | null;
  errorMessage: string | null;
  bytesIn: number;
  bytesOut: number;
  cooldownTriggered: boolean;
  notes: string | null;
  providerSlug: string | null;
  providerName: string | null;
  modelDisplayName: string | null;
}

export interface LogDetail extends LogRow {
  attemptsList: RouteAttemptRow[];
}

export function useLogs(filters: {
  virtualKeyId?: string;
  upstreamProvider?: string;
  upstreamModel?: string;
  status?: number;
  errorKind?: string;
  limit?: number;
  // Tick 25 v1.6.0.0：全文搜索关键字（跨 requestId / model / provider / errorKind / IP / UA / digest）
  q?: string;
}) {
  return useQuery({
    queryKey: ['admin', 'logs', filters],
    queryFn: async (): Promise<{ data: LogRow[]; total: number; limit: number }> => {
      const res = await api.get('/admin/logs', { params: filters });
      return res.data;
    },
    refetchInterval: 10_000,
  });
}

export function useLogDetail(requestId: string | null) {
  return useQuery({
    queryKey: ['admin', 'logs', requestId],
    enabled: !!requestId,
    queryFn: async (): Promise<LogDetail> => {
      const res = await api.get(`/admin/logs/${requestId}`);
      return res.data;
    },
  });
}
