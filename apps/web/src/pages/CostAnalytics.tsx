/**
 * 成本分析页（组 5 Tick 5 v1.15.0.0，组 5 收官）。
 *
 * VK spend 排行 + 模型成本 Top-N + 成本趋势图 + 时间范围/维度切换。
 * free 模型成本为 $0；付费回退（FREELLM_ALLOW_PAID_FALLBACK）时按 pricing 计费。
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Boxes, Coins, DollarSign, KeyRound, RefreshCw } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader } from './_PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/data/DataTable';
import { GlassCard } from '@/components/bits/GlassCard';
import { useCostAnalytics, type VkSpendRow, type ModelCostRow } from '@/lib/cost-analytics-hooks';

const SCOPES = [
  { k: 'day', label: '今日' },
  { k: 'week', label: '7 天' },
  { k: 'month', label: '30 天' },
] as const;

const fmtUsd = (n: number) => `$${n.toFixed(4)}`;

export function CostAnalyticsPage() {
  const [scope, setScope] = useState<'day' | 'week' | 'month'>('month');
  const [dim, setDim] = useState<'vk' | 'model'>('vk');
  const { data, isLoading, isFetching, refetch } = useCostAnalytics(scope);

  const lb = data?.vkLeaderboard;
  const trend = useMemo(
    () => (data?.costTrend ?? []).map((d) => ({ t: d.day.slice(5), cost: d.costUsd })),
    [data],
  );

  const vkCols: Column<VkSpendRow>[] = [
    {
      id: 'label',
      header: '虚拟密钥',
      cell: (r) => <span className="font-mono text-[11px] text-[var(--color-body-strong)]">{r.label}</span>,
      width: '1.4fr',
    },
    {
      id: 'env',
      header: '环境',
      cell: (r) => <Badge tone={r.environment === 'live' ? 'primary' : 'muted'}>{r.environment}</Badge>,
      width: '0.5fr',
    },
    {
      id: 'cost',
      header: '成本',
      cell: (r) => <span className="tabular">{fmtUsd(r.costUsd)}</span>,
      align: 'right',
      sortable: true,
      sortKey: (r) => r.costUsd,
      width: '0.7fr',
    },
    { id: 'req', header: '请求', cell: (r) => <span className="tabular">{r.totalRequests}</span>, align: 'right', width: '0.5fr' },
    {
      id: 'success',
      header: '成功率',
      cell: (r) => <span className="tabular">{(r.successRate * 100).toFixed(0)}%</span>,
      align: 'right',
      width: '0.6fr',
    },
    {
      id: 'share',
      header: '占比',
      cell: (r) => <span className="tabular">{(r.shareOfTotal * 100).toFixed(1)}%</span>,
      align: 'right',
      width: '0.5fr',
    },
  ];

  const modelCols: Column<ModelCostRow>[] = [
    {
      id: 'model',
      header: '模型',
      cell: (r) => <span className="font-mono text-[11px] text-[var(--color-body-strong)]">{r.upstreamModel}</span>,
      width: '1.8fr',
    },
    {
      id: 'provider',
      header: '上游',
      cell: (r) => <span className="text-[11px] text-[var(--color-muted)]">{r.upstreamProvider}</span>,
      width: '0.7fr',
    },
    {
      id: 'cost',
      header: '成本',
      cell: (r) => <span className="tabular">{fmtUsd(r.costUsd)}</span>,
      align: 'right',
      sortable: true,
      sortKey: (r) => r.costUsd,
      width: '0.7fr',
    },
    { id: 'req', header: '请求', cell: (r) => <span className="tabular">{r.requests}</span>, align: 'right', width: '0.5fr' },
    {
      id: 'tokens',
      header: 'Tokens',
      cell: (r) => <span className="tabular">{Number(r.totalTokens).toLocaleString()}</span>,
      align: 'right',
      sortable: true,
      sortKey: (r) => Number(r.totalTokens),
      width: '0.7fr',
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="财务"
        title="成本分析"
        description="VK spend 排行 + 模型成本 Top-N + 成本趋势。free 模型成本为 $0，付费回退时按 pricing 计费。"
        status={isFetching ? '刷新中' : '实时'}
        statusTone={isFetching ? 'warning' : 'success'}
        actions={
          <div className="flex items-center gap-2">
            {SCOPES.map((s) => (
              <Button key={s.k} size="sm" variant={scope === s.k ? 'subtle' : 'ghost'} onClick={() => setScope(s.k)}>
                {s.label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => void refetch()}>
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        }
      />
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatBlock label="窗口总成本" value={fmtUsd(lb?.windowCostUsd ?? 0)} icon={<DollarSign className="size-4" />} />
          <StatBlock label="Top 展示成本" value={fmtUsd(lb?.shownCostUsd ?? 0)} icon={<Coins className="size-4" />} />
          <StatBlock label="活跃 VK" value={String(lb?.totalVkCount ?? 0)} icon={<KeyRound className="size-4" />} />
          <StatBlock label="计费模型" value={String(data?.modelCosts.length ?? 0)} icon={<Boxes className="size-4" />} />
        </div>

        <GlassCard className="p-5">
          <div className="mb-3 text-sm font-medium text-[var(--color-ink)]">成本趋势（最近 {data?.windowDays ?? 30} 天）</div>
          {trend.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-[var(--color-muted)]">
              暂无成本数据（free 模型成本为 $0）
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trend} margin={{ top: 0, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-hairline)" />
                <XAxis dataKey="t" tick={{ fontSize: 11, fill: 'var(--color-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-muted)' }} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface-card)',
                    border: '1px solid var(--color-hairline)',
                    fontSize: 12,
                  }}
                  formatter={(v: number) => fmtUsd(v)}
                />
                <Area type="monotone" dataKey="cost" stroke="var(--color-primary)" fill="url(#costGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </GlassCard>

        <GlassCard className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Button size="sm" variant={dim === 'vk' ? 'subtle' : 'ghost'} onClick={() => setDim('vk')}>
              VK spend 排行
            </Button>
            <Button size="sm" variant={dim === 'model' ? 'subtle' : 'ghost'} onClick={() => setDim('model')}>
              模型成本 Top-N
            </Button>
          </div>
          {dim === 'vk' ? (
            <DataTable
              columns={vkCols}
              rows={lb?.rows ?? []}
              rowKey={(r) => r.virtualKeyId}
              loading={isLoading}
              empty={<EmptyState />}
            />
          ) : (
            <DataTable
              columns={modelCols}
              rows={data?.modelCosts ?? []}
              rowKey={(r) => r.upstreamModel}
              loading={isLoading}
              empty={<EmptyState />}
            />
          )}
        </GlassCard>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <Coins className="size-6 text-[var(--color-muted)]" />
      <div>暂无成本数据。</div>
    </div>
  );
}

function StatBlock({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--color-muted)]">{label}</span>
        {icon && <span className="text-[var(--color-primary)]">{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular text-[var(--color-ink)]">{value}</div>
    </GlassCard>
  );
}
