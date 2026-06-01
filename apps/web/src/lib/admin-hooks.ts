/**
 * TanStack Query hooks for admin endpoints. Each hook also takes a refresh
 * interval so the Dashboard can dial frequency from the UI.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface MetricsResponse {
  generatedAt: string;
  window: string;
  requestsToday: number;
  successRate: number | null;
  rateLimitedToday: number;
  avgLatencyMs: number;
  activeFreeModels: number;
  providers: Array<{ slug: string; name: string; status: string; lastSyncAt: string | null }>;
  cooldowns: number;
  virtualKeys: number;
  modelsAddedLastDay: Array<{ upstreamId: string; isFree: boolean; firstSeenAt: string }>;
  // Tick 30 v1.7.2.0：累计估算成本（USD）+ top 5 模型 cost 排行。
  costToday: number;
  cost7d: number;
  topCostModels: Array<{ upstreamModel: string; upstreamProvider: string; costUsd: number; requests: number }>;
}

export interface ModelRow {
  id: string;
  providerSlug: string;
  providerName: string;
  upstreamId: string;
  displayName: string;
  family: string | null;
  contextLength: number;
  isFree: boolean;
  status: string;
  weightAdj: number;
  blacklisted: boolean;
  whitelisted: boolean;
  firstSeenAt: string;
  lastSeenAt: string | null;
  composite: number | null;
  // Tick 34 v1.7.6.0：识别自动黑名单标记
  manualOverride: 'force_enabled' | 'force_disabled' | null;
  notes: string | null;
  autoBlacklisted: boolean;
}

export interface ProviderRow {
  id: string;
  slug: string;
  kind: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  priority: number;
  status: string;
  errorCount24h: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  lastSyncAt: string | null;
  notes: string | null;
}

// Tick 18 v1.2.0.0：5s 轮询提到 30s 作为兜底；首选数据更新通道是 /admin/events SSE 推送 +
// `useAdminEvents` hook 主动失效（订阅 model:* / discovery:cycle / request:complete）。
export function useMetrics(intervalMs = 30_000) {
  return useQuery({
    queryKey: ['admin', 'metrics'],
    queryFn: async (): Promise<MetricsResponse> => {
      const res = await api.get('/admin/metrics');
      return res.data;
    },
    refetchInterval: intervalMs,
  });
}

export function useModels(params?: {
  providerSlug?: string;
  status?: string;
  free?: 'true' | 'false';
  search?: string;
}) {
  return useQuery({
    queryKey: ['admin', 'models', params],
    queryFn: async (): Promise<{ data: ModelRow[]; total: number }> => {
      const res = await api.get('/admin/models', { params });
      return res.data;
    },
    // 模型列表变化慢（discovery 30 分钟 / scorer 周期），10 秒 staleTime 显著减少 re-fetch。
    staleTime: 10_000,
  });
}

// Tick 44 v1.7.16.0：模型详情完整类型
export interface ModelScoreDetail {
  availabilityScore: number;
  latencyScore: number;
  rateLimitScore: number;
  qualityScore: number;
  contextScore: number;
  capabilityScore: number;
  freshnessScore: number;
  costScore: number;
  stabilityScore: number;
  firstTokenLatencyMs: number | null;
  avgLatencyMs: number | null;
  successCount24h: number;
  failureCount24h: number;
  rateLimit24h: number;
  composite: number;
  updatedAt: string;
}

export interface ModelErrorEventRow {
  id: string;
  kind: string;
  severity: string;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ModelSnapshotRow {
  id: string;
  takenAt: string;
  isFree: boolean;
  pricingJson: string | null;
  capabilitiesJson: string | null;
}

export interface ModelDetailResponse {
  id: string;
  upstreamId: string;
  displayName: string;
  isFree: boolean;
  status: string;
  manualOverride: 'force_enabled' | 'force_disabled' | null;
  blacklisted: boolean;
  whitelisted: boolean;
  weightAdj: number;
  notes: string | null;
  provider: { id: string; slug: string; name: string };
  scores: ModelScoreDetail | null;
  snapshots: ModelSnapshotRow[];
  errorEvents: ModelErrorEventRow[];
}

export function useModelDetail(id: string | null) {
  return useQuery({
    queryKey: ['admin', 'models', id],
    enabled: !!id,
    queryFn: async (): Promise<ModelDetailResponse> => {
      const res = await api.get(`/admin/models/${id}`);
      return res.data;
    },
    staleTime: 15_000,
  });
}

export function useProviders() {
  return useQuery({
    queryKey: ['admin', 'providers'],
    queryFn: async (): Promise<{ providers: ProviderRow[] }> => {
      // 后端 /admin/metrics 已经带 provider 基础字段；专门的 /admin/providers 端点留 Tick 10。
      const res = await api.get('/admin/metrics');
      const providers = (res.data.providers ?? []).map((p: { slug: string; name: string; status: string; lastSyncAt: string | null }) => ({
        id: p.slug,
        slug: p.slug,
        kind: p.slug,
        name: p.name,
        baseUrl: '',
        enabled: true,
        priority: 100,
        status: p.status,
        errorCount24h: 0,
        lastSuccessAt: p.lastSyncAt,
        lastErrorAt: null,
        lastErrorMessage: null,
        lastSyncAt: p.lastSyncAt,
        notes: null,
      })) as ProviderRow[];
      return { providers };
    },
    staleTime: 8_000,
  });
}

// Tick 28 v1.7.0.0：上游 provider 配额预测
export interface ProviderForecast {
  providerSlug: string;
  balanceRemaining: number | null;
  balanceRaw: unknown;
  burnRateTokensPerDay: number;
  burnRateUsdPerDay: number | null;
  estimatedDaysRemaining: number | null;
  alertThresholdDays: number;
  alerted: boolean;
  generatedAt: string;
}

export function useProviderForecast(slug: string | null) {
  return useQuery({
    queryKey: ['admin', 'providers', slug, 'forecast'],
    enabled: !!slug,
    queryFn: async (): Promise<ProviderForecast> => {
      const res = await api.get(`/admin/providers/${slug}/forecast`);
      return res.data;
    },
    staleTime: 5 * 60_000, // 与后端缓存 TTL 对齐
    refetchOnWindowFocus: false,
  });
}

// Tick 31 v1.7.3.0：上游 provider 健康检查
export interface ProviderHealthRow {
  slug: string;
  name: string;
  status: string;
  lastHealthAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  errorCount24h: number;
}

export interface ProviderHealthCheckResult {
  providerSlug: string;
  ok: boolean;
  status: string;
  latencyMs: number | null;
  message: string | null;
  errorKind: string | null;
  takenAt: string;
}

export interface ProviderHealthHistoryRow {
  ok: boolean;
  latencyMs: number | null;
  errorKind: string | null;
  errorMessage: string | null;
  takenAt: string;
}

export function useProvidersHealth() {
  return useQuery({
    queryKey: ['admin', 'providers', 'health'],
    queryFn: async (): Promise<{ data: ProviderHealthRow[] }> => {
      const res = await api.get('/admin/providers/health');
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useProviderHealthHistory(slug: string | null) {
  return useQuery({
    queryKey: ['admin', 'providers', slug, 'health', 'history'],
    enabled: !!slug,
    queryFn: async (): Promise<{ data: ProviderHealthHistoryRow[]; total: number }> => {
      const res = await api.get(`/admin/providers/${slug}/health/history`);
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useTriggerProviderHealth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slug: string): Promise<ProviderHealthCheckResult> => {
      const res = await api.post(`/admin/providers/${slug}/health`);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'providers'] });
    },
  });
}

// Tick 37 v1.7.9.0：Provider 余额周期检查 + 告警历史
export interface BalanceCheckResult {
  total: number;
  alerted: number;
  forecasts: Array<{
    providerSlug: string;
    balanceRemaining: number | null;
    estimatedDaysRemaining: number | null;
    alerted: boolean;
  }>;
  generatedAt: string;
}

export interface BalanceAlertRow {
  providerId: string | null;
  providerSlug: string | null;
  message: string;
  detailsJson: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export function useTriggerBalanceCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<BalanceCheckResult> => {
      const res = await api.post('/admin/providers/balance/check');
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'providers', 'balance'] });
    },
  });
}

export function useBalanceAlerts() {
  return useQuery({
    queryKey: ['admin', 'providers', 'balance', 'alerts'],
    queryFn: async (): Promise<{ data: BalanceAlertRow[]; total: number }> => {
      const res = await api.get('/admin/providers/balance/alerts');
      return res.data;
    },
    staleTime: 60_000,
  });
}

// Tick 32 v1.7.4.0：Dashboard 时间序列
export type TimeseriesWindow = '1h' | '24h' | '7d';

export interface TimeseriesBucket {
  t: string;
  requests: number;
  success: number;
  failed: number;
  costUsd: number;
}

export interface TimeseriesPayload {
  window: TimeseriesWindow;
  bucketMs: number;
  buckets: TimeseriesBucket[];
}

// Tick 34 v1.7.6.0：模型自动黑名单
export interface AutoBlacklistResult {
  modelId: string;
  upstreamId: string;
  reason: 'low_success_rate' | 'consecutive_failures';
  successRate: number | null;
  sampleSize: number;
  consecutiveFailures: number;
}

export interface AutoBlacklistReport {
  evaluated: number;
  blacklisted: AutoBlacklistResult[];
  skippedWhitelisted: number;
  skippedForceEnabled: number;
  skippedAlreadyDisabled: number;
  generatedAt: string;
}

export function useEvaluateAutoBlacklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<AutoBlacklistReport> => {
      const res = await api.post('/admin/models/auto-blacklist/evaluate');
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'models'] });
    },
  });
}

export interface AutoBlacklistRecentRow {
  modelId: string;
  upstreamId: string;
  reason: string;
  createdAt: string;
  detailsJson: string | null;
}

// Tick 35 v1.7.7.0：模型批量管理 + import/export
export type BulkAction = 'blacklist' | 'whitelist' | 'enable' | 'disable' | 'reset';

export interface BulkModelsResult {
  ok: true;
  action: BulkAction;
  requested: number;
  modified: number;
}

export function useBulkPatchModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      ids: string[];
      action: BulkAction;
      notes?: string;
    }): Promise<BulkModelsResult> => {
      const res = await api.post('/admin/models/bulk', args);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'models'] });
    },
  });
}

export interface ExportedModelEntry {
  providerSlug: string;
  upstreamId: string;
  blacklisted: boolean;
  whitelisted: boolean;
  manualOverride: 'force_enabled' | 'force_disabled' | null;
  notes: string | null;
  weightAdj: number;
}

export function useExportModels() {
  return useMutation({
    mutationFn: async (): Promise<{
      exportedAt: string;
      total: number;
      models: ExportedModelEntry[];
    }> => {
      const res = await api.get('/admin/models/export');
      return res.data;
    },
  });
}

export function useImportModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      models: ExportedModelEntry[],
    ): Promise<{ ok: true; requested: number; modified: number; skipped: number }> => {
      const res = await api.post('/admin/models/import', { models });
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'models'] });
    },
  });
}

export function useRecentAutoBlacklisted() {
  return useQuery({
    queryKey: ['admin', 'models', 'auto-blacklist', 'recent'],
    queryFn: async (): Promise<{ data: AutoBlacklistRecentRow[]; total: number }> => {
      const res = await api.get('/admin/models/auto-blacklist/recent');
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useMetricsTimeseries(window: TimeseriesWindow = '24h') {
  return useQuery({
    queryKey: ['admin', 'metrics', 'timeseries', window],
    queryFn: async (): Promise<TimeseriesPayload> => {
      const res = await api.get('/admin/metrics/timeseries', { params: { window } });
      return res.data;
    },
    staleTime: 5_000,
    placeholderData: (prev) => prev,
  });
}

// Tick 49 v1.7.21.0：错误率时间序列
export interface ErrorRateBucket {
  t: string;
  total: number;
  status2xx: number;
  status4xx: number;
  status5xx: number;
  statusNull: number;
  errorRate: number;
  clientErrorRate: number;
  serverErrorRate: number;
}

export interface ErrorRatePayload {
  window: TimeseriesWindow;
  bucketMs: number;
  buckets: ErrorRateBucket[];
  summary: {
    total: number;
    status2xx: number;
    status4xx: number;
    status5xx: number;
    statusNull: number;
    errorRate: number;
    clientErrorRate: number;
    serverErrorRate: number;
  };
}

export function useErrorRateTimeseries(window: TimeseriesWindow = '24h') {
  return useQuery({
    queryKey: ['admin', 'metrics', 'error-rate-timeseries', window],
    queryFn: async (): Promise<ErrorRatePayload> => {
      const res = await api.get('/admin/metrics/error-rate-timeseries', { params: { window } });
      return res.data;
    },
    staleTime: 5_000,
    placeholderData: (prev) => prev,
  });
}

export function useRefreshModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (providerSlug?: string) => {
      const res = await api.post('/admin/models/refresh', providerSlug ? { providerSlug } : {});
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'models'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'metrics'] });
    },
  });
}

export function usePatchModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      manualOverride?: 'force_enabled' | 'force_disabled' | null;
      weightAdj?: number;
      blacklisted?: boolean;
      whitelisted?: boolean;
      notes?: string;
    }) => {
      const { id, ...body } = args;
      const res = await api.patch(`/admin/models/${id}`, body);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'models'] });
    },
  });
}

// Tick 50 v1.7.22.0：/admin/system/health 全链路自检
export type SystemHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface SystemHealthDb {
  status: SystemHealthStatus;
  pingMs: number | null;
  requests24h: number | null;
  errorMessage?: string;
}

export interface SystemHealthRedis {
  status: SystemHealthStatus;
  configured: boolean;
  pingMs: number | null;
  errorMessage?: string;
}

export interface SystemHealthProviderRow {
  slug: string;
  name: string;
  registered: boolean;
  status: SystemHealthStatus;
  dbStatus: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  errorCount24h: number;
  unresolvedAlerts: number;
}

export interface SystemHealthReport {
  overall: SystemHealthStatus;
  generatedAt: string;
  db: SystemHealthDb;
  redis: SystemHealthRedis;
  providers: SystemHealthProviderRow[];
}

export function useSystemHealth() {
  return useQuery({
    queryKey: ['admin', 'system', 'health'],
    queryFn: async (): Promise<SystemHealthReport> => {
      const res = await api.get('/admin/system/health');
      return res.data;
    },
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}
