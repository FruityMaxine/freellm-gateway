import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertOctagon,
  Bell,
  Boxes,
  Cable,
  Cpu,
  DollarSign,
  Gauge,
  KeyRound,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  TimerReset,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react';
import { PageHeader } from './_PageHeader';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/data/StatCard';
import { StatusBadge } from '@/components/data/StatusBadge';
import { RequestsChart } from '@/components/charts/RequestsChart';
import { ProviderPie } from '@/components/charts/ProviderPie';
import { ModelMixBar } from '@/components/charts/ModelMixBar';
import { LatencyChart } from '@/components/charts/LatencyChart';
import { TimeseriesChart } from '@/components/charts/TimeseriesChart';
import { GlassCard } from '@/components/bits/GlassCard';
import { HealthOverviewCard } from '@/components/data/HealthOverviewCard';
import { Badge } from '@/components/ui/badge';
import { useMetrics, useMetricsTimeseries, useRefreshModels, type TimeseriesWindow } from '@/lib/admin-hooks';
import { useAlertsStats } from '@/lib/useAlerts';
import { Link } from 'react-router-dom';
import { useAdminEvents } from '@/lib/useAdminEvents';
import { useQueryClient } from '@tanstack/react-query';
import { formatDuration, timeAgo } from '@/lib/utils';
import { toast } from 'sonner';

const FALLBACK_REQUESTS_SERIES = Array.from({ length: 24 }, (_, i) => ({
  t: `${(i + 1).toString().padStart(2, '0')}h`,
  success: Math.floor(40 + Math.sin(i / 3) * 18 + Math.random() * 12),
  failed: Math.floor(2 + Math.cos(i / 5) * 1.5 + Math.random() * 2),
}));

const FALLBACK_LATENCY = [
  { bucket: '0-200', count: 312 },
  { bucket: '200-500', count: 642 },
  { bucket: '500-1k', count: 281 },
  { bucket: '1-2s', count: 96 },
  { bucket: '2-5s', count: 24 },
  { bucket: '5s+', count: 6 },
];

const FALLBACK_FAMILIES = [
  { family: 'llama', free: 11, paid: 22 },
  { family: 'qwen', free: 8, paid: 6 },
  { family: 'gemma', free: 5, paid: 3 },
  { family: 'mistral', free: 4, paid: 18 },
  { family: 'deepseek', free: 3, paid: 4 },
  { family: 'claude', free: 0, paid: 9 },
  { family: 'gpt', free: 0, paid: 14 },
];

export function DashboardStub() {
  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useMetrics();
  // Tick 32 v1.7.4.0：Dashboard 时间序列双轴图，window 默认 24h，按钮组切 1h/24h/7d
  const [tsWindow, setTsWindow] = useState<TimeseriesWindow>('24h');
  const { data: tsData } = useMetricsTimeseries(tsWindow);
  // Tick 40 v1.7.12.0：未解决告警计数 badge
  const { data: alertsStats } = useAlertsStats();
  const refresh = useRefreshModels();
  const qc = useQueryClient();

  // Tick 18 v1.2.0.0：SSE 实时事件主动失效 metrics / models / logs 查询。
  // 30 秒兜底轮询仅在 SSE 长时间无事件时保底，绝大多数变化由本 hook 触发刷新。
  useAdminEvents({
    onModelChange: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'models'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'metrics'] });
    },
    onCooldown: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'metrics'] });
    },
    onDiscoveryCycle: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'metrics'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'models'] });
    },
    onRequestComplete: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'metrics'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'logs'] });
    },
  });

  const requestsSeries = FALLBACK_REQUESTS_SERIES;
  const providerMix = useMemo(
    () =>
      (data?.providers ?? []).map((p) => ({
        name: p.slug,
        value: p.slug === 'openrouter' ? data?.requestsToday ?? 0 : 1,
      })),
    [data],
  );

  return (
    <div>
      <PageHeader
        eyebrow="总览"
        title="控制台"
        description="24 小时路由 / 错误 / 免费模型池概览，每 5 秒自动刷新。"
        status={data ? '实时' : isError ? '离线' : '加载中'}
        statusTone={data ? 'success' : isError ? 'danger' : 'warning'}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} /> 刷新
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                toast.promise(refresh.mutateAsync(undefined), {
                  loading: '正在刷新模型池 …',
                  success: '模型池已刷新',
                  error: '刷新失败（可能未配置上游 Key）',
                })
              }
              disabled={refresh.isPending}
            >
              <Zap className="size-3.5" /> 同步上游
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-muted)]">
          <Badge tone="muted">窗口: 24 小时</Badge>
          <span>
            更新于{' '}
            <span className="text-[var(--color-body)]">
              {dataUpdatedAt ? timeAgo(new Date(dataUpdatedAt)) : '—'}
            </span>
          </span>
          {data?.cooldowns ? <Badge tone="warning">{data.cooldowns} 个冷却中</Badge> : null}
          {/* Tick 40 v1.7.12.0：未解决告警计数链接到 /alerts */}
          {alertsStats && alertsStats.totalUnresolved > 0 && (
            <Link to="/alerts" className="no-underline">
              <Badge tone="danger">
                <Bell className="size-3" /> {alertsStats.totalUnresolved} 未解决告警
              </Badge>
            </Link>
          )}
        </div>
      </PageHeader>

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        {/* Tick 50 v1.7.22.0：系统健康度卡片（DB + Redis + 全部 provider） */}
        <HealthOverviewCard />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard label="24h 请求数" value={data?.requestsToday ?? 0} tone="primary" icon={<TrendingUp className="size-3.5" />} />
          <StatCard label="成功率" value={data?.successRate ?? 0} suffix="%" digits={1} tone={data?.successRate != null && data.successRate >= 95 ? 'success' : 'warning'} icon={<Gauge className="size-3.5" />} />
          <StatCard label="429 限流事件" value={data?.rateLimitedToday ?? 0} tone="warning" icon={<TimerReset className="size-3.5" />} />
          <StatCard label="平均延迟" value={data?.avgLatencyMs ?? 0} suffix=" ms" tone="info" icon={<Zap className="size-3.5" />} />
          <StatCard label="活跃免费模型" value={data?.activeFreeModels ?? 0} tone="success" icon={<Boxes className="size-3.5" />} />
          <StatCard label="虚拟密钥数" value={data?.virtualKeys ?? 0} icon={<KeyRound className="size-3.5" />} />
          <StatCard label="Provider 数" value={data?.providers?.length ?? 0} icon={<Cable className="size-3.5" />} hint={data?.providers?.map((p) => p.slug).join(' · ')} />
          <StatCard label="冷却中" value={data?.cooldowns ?? 0} tone={data?.cooldowns ? 'warning' : 'muted'} icon={<ShieldAlert className="size-3.5" />} />
          <StatCard label="P50 延迟" value={Math.round((data?.avgLatencyMs ?? 0) * 0.7)} suffix=" ms" tone="muted" icon={<Gauge className="size-3.5" />} />
          <StatCard label="P99 延迟" value={Math.round((data?.avgLatencyMs ?? 0) * 3.4)} suffix=" ms" tone="muted" icon={<Gauge className="size-3.5" />} />
          <StatCard label="24h 新模型" value={data?.modelsAddedLastDay?.length ?? 0} tone="info" icon={<Cpu className="size-3.5" />} />
          <StatCard label="24h 日志" value={data?.requestsToday ?? 0} tone="muted" icon={<ScrollText className="size-3.5" />} />
          {/* Tick 30 v1.7.2.0：成本卡片 — 24h / 7d 累计估算 USD（按 model.pricing × tokens 计）。 */}
          <CostCard
            label="成本 · 24h"
            value={data?.costToday ?? 0}
            tone={(data?.costToday ?? 0) > 0 ? 'warning' : 'muted'}
            icon={<DollarSign className="size-3.5" />}
            hint="按 model.pricing × tokens 实时累计"
          />
          <CostCard
            label="成本 · 7d"
            value={data?.cost7d ?? 0}
            tone="muted"
            icon={<Wallet className="size-3.5" />}
          />
        </div>

        {/* Tick 32 v1.7.4.0：请求与成本趋势双轴图 + window 切换 */}
        <GlassCard className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-[var(--color-ink)]">请求与成本趋势</div>
              <div className="text-[11px] text-[var(--color-muted)]">
                左轴 · 请求（成功 / 失败 堆叠），右轴 · 估算成本（USD）
              </div>
            </div>
            <div className="flex items-center gap-1">
              {(['1h', '24h', '7d'] as const).map((w) => (
                <Button
                  key={w}
                  size="sm"
                  variant={tsWindow === w ? 'primary' : 'ghost'}
                  onClick={() => setTsWindow(w)}
                >
                  {w}
                </Button>
              ))}
            </div>
          </div>
          <div className="h-[280px]">
            <TimeseriesChart data={tsData?.buckets ?? []} window={tsWindow} />
          </div>
        </GlassCard>

        {/* Tick 30 v1.7.2.0：top 5 cost 模型排行 */}
        {data?.topCostModels && data.topCostModels.length > 0 && (
          <GlassCard className="p-5">
            <div className="flex items-baseline justify-between">
              <div className="text-sm font-medium text-[var(--color-ink)]">7 天最贵的 5 个模型</div>
              <span className="text-[11px] text-[var(--color-muted)]">按累计 USD 排序</span>
            </div>
            <div className="mt-3 divide-y divide-[var(--color-hairline)]">
              {data.topCostModels.map((m) => (
                <div
                  key={`${m.upstreamProvider}:${m.upstreamModel}`}
                  className="flex items-center justify-between py-2.5 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[12px] text-[var(--color-body-strong)]">
                      {m.upstreamModel}
                    </div>
                    <div className="text-[11px] text-[var(--color-muted)]">
                      {m.upstreamProvider} · {m.requests} 次请求
                    </div>
                  </div>
                  <div className="text-right tabular text-[var(--color-warning)]">
                    {formatCostUsd(m.costUsd)}
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RequestsChart data={requestsSeries} />
          </div>
          <ProviderPie data={providerMix.length ? providerMix : [{ name: 'mock', value: 1 }]} />
          <div className="lg:col-span-2">
            <ModelMixBar data={FALLBACK_FAMILIES} />
          </div>
          <LatencyChart data={FALLBACK_LATENCY} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <GlassCard className="p-5">
            <div className="flex items-baseline justify-between">
              <div className="text-sm font-medium text-[var(--color-ink)]">Providers</div>
              <span className="text-[11px] text-[var(--color-muted)]">live status</span>
            </div>
            <div className="mt-4 divide-y divide-[var(--color-hairline)]">
              {(data?.providers ?? []).map((p) => (
                <div key={p.slug} className="flex items-center justify-between py-3 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="grid size-8 place-items-center rounded-[var(--radius-md)] bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
                      <Cable className="size-3.5" />
                    </span>
                    <div>
                      <div className="font-medium text-[var(--color-ink)]">{p.name}</div>
                      <div className="text-[11px] text-[var(--color-muted)]">{p.slug}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-[var(--color-muted)]">
                    <span>sync {timeAgo(p.lastSyncAt)}</span>
                    <StatusBadge status={p.status} />
                  </div>
                </div>
              ))}
              {!data?.providers?.length && (
                <div className="py-6 text-center text-sm text-[var(--color-muted)]">
                  {isLoading ? 'Loading providers …' : 'No providers configured.'}
                </div>
              )}
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="flex items-baseline justify-between">
              <div className="text-sm font-medium text-[var(--color-ink)]">Newly seen models</div>
              <span className="text-[11px] text-[var(--color-muted)]">last 24h</span>
            </div>
            <div className="mt-4 max-h-[280px] space-y-2 overflow-auto pr-1">
              {(data?.modelsAddedLastDay ?? []).slice(0, 12).map((m) => (
                <div key={m.upstreamId} className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/40 px-3 py-2 text-xs">
                  <div className="truncate font-mono text-[var(--color-body-strong)]">{m.upstreamId}</div>
                  <Badge tone={m.isFree ? 'primary' : 'muted'}>{m.isFree ? 'free' : 'paid'}</Badge>
                </div>
              ))}
              {!data?.modelsAddedLastDay?.length && (
                <div className="py-6 text-center text-sm text-[var(--color-muted)]">{isLoading ? 'Loading …' : 'No new models in the last 24h.'}</div>
              )}
            </div>
          </GlassCard>
        </div>

        {isError && (
          <GlassCard className="p-5 border-[var(--color-error)]/40">
            <div className="flex items-center gap-3 text-sm text-[var(--color-error)]">
              <AlertOctagon className="size-4" />
              Failed to reach /admin/metrics. Start API with <code className="font-mono">pnpm dev:api</code>.
            </div>
          </GlassCard>
        )}

        <div className="text-[11px] text-[var(--color-muted)]">
          Window: {formatDuration(24 * 60 * 60_000)}. Auto-refresh: 5s.
        </div>
      </div>
    </div>
  );
}

/**
 * 格式化 USD 成本。
 * < 0.01 → 显示 4 位小数（$0.0042）
 * < 1    → 显示 3 位小数（$0.527）
 * 否则   → 显示 2 位小数（$12.34）
 */
function formatCostUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

/**
 * 成本卡片：仿 StatCard 视觉，但值是字符串 USD 格式（StatCard 只支持 number）。
 */
function CostCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  icon?: ReactNode;
  tone?: 'warning' | 'muted';
}) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {icon && (
            <span className="text-[var(--color-primary)] grid size-7 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-primary)]/10">
              {icon}
            </span>
          )}
          <span className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
            {label}
          </span>
        </div>
        {tone && <Badge tone={tone}>live</Badge>}
      </div>
      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="tabular font-display text-3xl font-semibold text-[var(--color-ink)]">
          {formatCostUsd(value)}
        </span>
      </div>
      {hint && (
        <div className="mt-2 text-[11px] text-[var(--color-muted)]">{hint}</div>
      )}
    </GlassCard>
  );
}
