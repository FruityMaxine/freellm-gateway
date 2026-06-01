/**
 * Provider 运营中心（组 6 Tick 3 v1.17.0.0）。
 *
 * 与「上游服务」页（Providers.tsx）的区别：那里是逐 provider 实时快照（卡片/Dialog 内
 * forecast/健康/24h错误）；本页是**全 provider 运营视角 + 历史趋势**——余额耗尽优先级
 * 排序 + byDay 请求/错误趋势图 + SLA 在线率，这些是 Providers.tsx 完全没有的新数据流。
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertCircle, RefreshCw, ServerCog, TrendingDown } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader } from './_PageHeader';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/data/DataTable';
import { GlassCard } from '@/components/bits/GlassCard';
import { useProviderOps, type ProviderOpsRow } from '@/lib/provider-ops-hooks';

const RANGES = [
  { d: 7, label: '7 天' },
  { d: 30, label: '30 天' },
];

export function ProviderOpsPage() {
  const [days, setDays] = useState(7);
  const { data, isLoading, isFetching, refetch } = useProviderOps(days);
  const providers = data?.providers ?? [];
  const trend = (data?.trend ?? []).map((t) => ({ t: t.day.slice(5), requests: t.requests, errors: t.errors }));

  const avgSla = providers.length
    ? Math.round((providers.reduce((a, p) => a + p.sla7d, 0) / providers.length) * 100) / 100
    : 100;
  const totalReq = providers.reduce((a, p) => a + p.requests, 0);
  const totalErr = providers.reduce((a, p) => a + p.error24h, 0);

  const cols: Column<ProviderOpsRow>[] = [
    {
      id: 'name',
      header: '上游',
      cell: (r) => <span className="font-mono text-[11px] text-[var(--color-body-strong)]">{r.name}</span>,
      width: '1fr',
    },
    {
      id: 'days',
      header: '剩余天数',
      cell: (r) => (
        <span
          className={`tabular ${r.estimatedDaysRemaining != null && r.estimatedDaysRemaining < 3 ? 'text-[var(--color-error)]' : 'text-[var(--color-ink)]'}`}
        >
          {r.estimatedDaysRemaining != null ? `${r.estimatedDaysRemaining}d` : '—'}
        </span>
      ),
      align: 'right',
      sortable: true,
      sortKey: (r) => r.estimatedDaysRemaining ?? 9999,
      width: '0.7fr',
    },
    {
      id: 'balance',
      header: '余额',
      cell: (r) => <span className="tabular">{r.balanceRemaining != null ? r.balanceRemaining.toFixed(2) : '—'}</span>,
      align: 'right',
      width: '0.6fr',
    },
    {
      id: 'sla24',
      header: 'SLA 24h',
      cell: (r) => (
        <span className={`tabular ${r.sla24h < 99 ? 'text-[var(--color-warning)]' : 'text-[var(--color-success)]'}`}>
          {r.sla24h}%
        </span>
      ),
      align: 'right',
      width: '0.6fr',
    },
    { id: 'sla7', header: 'SLA 7d', cell: (r) => <span className="tabular">{r.sla7d}%</span>, align: 'right', width: '0.6fr' },
    {
      id: 'err',
      header: '24h错误',
      cell: (r) => <span className="tabular text-[var(--color-error)]">{r.error24h}</span>,
      align: 'right',
      width: '0.5fr',
    },
    { id: 'req', header: '请求', cell: (r) => <span className="tabular">{r.requests}</span>, align: 'right', width: '0.5fr' },
    {
      id: 'act',
      header: '',
      cell: () => (
        <Link to="/alerts" className="text-[10px] text-[var(--color-primary)] hover:underline">
          创建告警规则
        </Link>
      ),
      width: '0.7fr',
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="运营"
        title="Provider 运营中心"
        description="全 provider 运营视角 + 历史趋势（区别于上游服务页的逐 provider 实时快照）：余额耗尽优先级排序 + 请求/错误趋势 + SLA 在线率。"
        status={isFetching ? '刷新中' : '实时'}
        statusTone={isFetching ? 'warning' : 'success'}
        actions={
          <div className="flex items-center gap-2">
            {RANGES.map((r) => (
              <Button key={r.d} size="sm" variant={days === r.d ? 'subtle' : 'ghost'} onClick={() => setDays(r.d)}>
                {r.label}
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
          <StatBlock label="上游数" value={String(providers.length)} icon={<ServerCog className="size-4" />} />
          <StatBlock label="平均 SLA 7d" value={`${avgSla}%`} icon={<Activity className="size-4" />} />
          <StatBlock label={`总请求 (${days}d)`} value={totalReq.toLocaleString()} />
          <StatBlock label="24h 错误" value={String(totalErr)} tone="error" icon={<AlertCircle className="size-4" />} />
        </div>

        <GlassCard className="p-5">
          <div className="mb-3 text-sm font-medium text-[var(--color-ink)]">请求 / 错误趋势（最近 {days} 天）</div>
          {trend.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trend} margin={{ top: 0, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="reqG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="errG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-error)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="var(--color-error)" stopOpacity={0} />
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
                />
                <Area type="monotone" dataKey="requests" stroke="var(--color-primary)" fill="url(#reqG)" name="请求" />
                <Area type="monotone" dataKey="errors" stroke="var(--color-error)" fill="url(#errG)" name="错误" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </GlassCard>

        <GlassCard className="p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--color-ink)]">
            <TrendingDown className="size-4 text-[var(--color-warning)]" /> 余额耗尽优先级（剩余天数升序）
          </div>
          <DataTable columns={cols} rows={providers} rowKey={(r) => r.slug} loading={isLoading} empty={<Empty />} />
        </GlassCard>
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-[var(--color-muted)]">
      暂无 provider 运营数据。
    </div>
  );
}

function StatBlock({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone?: 'error';
  icon?: ReactNode;
}) {
  const c = tone === 'error' ? 'text-[var(--color-error)]' : 'text-[var(--color-ink)]';
  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--color-muted)]">{label}</span>
        {icon && <span className="text-[var(--color-primary)]">{icon}</span>}
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular ${c}`}>{value}</div>
    </GlassCard>
  );
}
