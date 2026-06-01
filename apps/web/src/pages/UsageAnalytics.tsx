/**
 * 历史用量分析页（组 5 Tick 2 v1.12.0.0）。
 *
 * 区别于 Dashboard 实时趋势：本页读 usage_daily 长期预聚合，明细被 retention
 * 清理后历史统计仍保留。按日趋势 + per-VK Top-N 排行 + 日期范围 + CSV/JSON 导出。
 */
import { useMemo, useState, type ReactNode } from 'react';
import { BarChart3, Download, RefreshCw, TrendingUp } from 'lucide-react';
import { PageHeader } from './_PageHeader';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/data/DataTable';
import { GlassCard } from '@/components/bits/GlassCard';
import { RequestsChart } from '@/components/charts/RequestsChart';
import { useUsageDaily, useUsagePerVk, type UsageVkRow } from '@/lib/usage-analytics-hooks';
import { toast } from 'sonner';

const RANGES = [
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' },
  { days: 90, label: '90 天' },
];

export function UsageAnalyticsPage() {
  const [days, setDays] = useState(30);
  const daily = useUsageDaily(days);
  const perVk = useUsagePerVk(days, 20);

  const chartData = useMemo(
    () =>
      (daily.data?.data ?? []).map((d) => ({
        t: d.day.slice(5),
        success: d.successes,
        failed: d.failures,
      })),
    [daily.data],
  );

  const totals = useMemo(() => {
    const rows = daily.data?.data ?? [];
    return rows.reduce(
      (acc, r) => ({
        requests: acc.requests + r.requests,
        successes: acc.successes + r.successes,
        failures: acc.failures + r.failures,
        tokens: acc.tokens + Number(r.totalTokens),
      }),
      { requests: 0, successes: 0, failures: 0, tokens: 0 },
    );
  }, [daily.data]);

  const exportData = (format: 'csv' | 'json') => {
    // 后端 /admin/usage/export 带 Content-Disposition 触发下载；同源请求自动携带会话 cookie。
    const a = document.createElement('a');
    a.href = `/admin/usage/export?format=${format}&days=${days}`;
    a.download = `freellm-usage-${days}d.${format}`;
    a.click();
    toast.success(`导出 ${format.toUpperCase()}（最近 ${days} 天）`);
  };

  const columns: Column<UsageVkRow>[] = [
    {
      id: 'label',
      header: '虚拟密钥',
      cell: (r) => (
        <span className="font-mono text-[11px] text-[var(--color-body-strong)]">{r.label}</span>
      ),
      width: '1.6fr',
    },
    {
      id: 'requests',
      header: '请求',
      cell: (r) => <span className="tabular">{r.requests}</span>,
      align: 'right',
      sortable: true,
      sortKey: (r) => r.requests,
      width: '0.6fr',
    },
    {
      id: 'success',
      header: '成功',
      cell: (r) => <span className="tabular text-[var(--color-success)]">{r.successes}</span>,
      align: 'right',
      width: '0.5fr',
    },
    {
      id: 'fail',
      header: '失败',
      cell: (r) => <span className="tabular text-[var(--color-error)]">{r.failures}</span>,
      align: 'right',
      width: '0.5fr',
    },
    {
      id: 'tokens',
      header: 'Tokens',
      cell: (r) => <span className="tabular">{Number(r.totalTokens).toLocaleString()}</span>,
      align: 'right',
      sortable: true,
      sortKey: (r) => Number(r.totalTokens),
      width: '0.8fr',
    },
    {
      id: 'latency',
      header: '均延迟',
      cell: (r) => <span className="tabular">{r.avgLatencyMs != null ? `${r.avgLatencyMs}ms` : '—'}</span>,
      align: 'right',
      width: '0.6fr',
    },
  ];

  const chartEmpty = !daily.isLoading && chartData.length === 0;

  return (
    <div>
      <PageHeader
        eyebrow="分析"
        title="历史用量分析"
        description="usage_daily 长期预聚合：按日趋势 + 虚拟密钥排行。明细被 retention 清理后历史仍保留。"
        status={daily.isFetching ? '加载中' : '历史'}
        statusTone={daily.isFetching ? 'warning' : 'info'}
        actions={
          <div className="flex items-center gap-2">
            {RANGES.map((r) => (
              <Button
                key={r.days}
                size="sm"
                variant={days === r.days ? 'subtle' : 'ghost'}
                onClick={() => setDays(r.days)}
              >
                {r.label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void daily.refetch();
                void perVk.refetch();
              }}
            >
              <RefreshCw className="size-3.5" />
            </Button>
            <Button size="sm" variant="subtle" onClick={() => exportData('csv')}>
              <Download className="size-3.5" /> CSV
            </Button>
            <Button size="sm" variant="ghost" onClick={() => exportData('json')}>
              JSON
            </Button>
          </div>
        }
      />

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatBlock label="总请求" value={totals.requests.toLocaleString()} icon={<BarChart3 className="size-4" />} />
          <StatBlock label="成功" value={totals.successes.toLocaleString()} tone="success" />
          <StatBlock label="失败" value={totals.failures.toLocaleString()} tone="error" />
          <StatBlock label="总 Tokens" value={totals.tokens.toLocaleString()} icon={<TrendingUp className="size-4" />} />
        </div>

        <GlassCard className="p-5">
          <div className="mb-3 text-sm font-medium text-[var(--color-ink)]">
            请求成功 / 失败趋势（最近 {days} 天）
          </div>
          {chartEmpty ? (
            <div className="flex h-40 items-center justify-center text-sm text-[var(--color-muted)]">
              暂无用量数据（usage_daily 聚合后显示）
            </div>
          ) : (
            <RequestsChart data={chartData} />
          )}
        </GlassCard>

        <GlassCard className="p-5">
          <div className="mb-3 text-sm font-medium text-[var(--color-ink)]">虚拟密钥用量排行 Top 20</div>
          <DataTable
            columns={columns}
            rows={perVk.data?.data ?? []}
            rowKey={(r) => r.virtualKeyId ?? r.label}
            loading={perVk.isLoading}
            empty={
              <div className="flex flex-col items-center gap-3">
                <BarChart3 className="size-6 text-[var(--color-muted)]" />
                <div>暂无 per-VK 用量数据。</div>
              </div>
            }
          />
        </GlassCard>
      </div>
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
  tone?: 'success' | 'error';
  icon?: ReactNode;
}) {
  const color =
    tone === 'success'
      ? 'text-[var(--color-success)]'
      : tone === 'error'
        ? 'text-[var(--color-error)]'
        : 'text-[var(--color-ink)]';
  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--color-muted)]">{label}</span>
        {icon && <span className="text-[var(--color-primary)]">{icon}</span>}
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular ${color}`}>{value}</div>
    </GlassCard>
  );
}
