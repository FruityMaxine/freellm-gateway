/**
 * 路由失败模式聚合分析页（组 8 Tick 2 v1.24.0.0）。
 *
 * 区别于 Logs（单请求路由尝试瀑布）与 RouteHealth（熔断+评分）：本页对全部 RouteAttempt
 * **跨请求聚合** —— errorKind 占比饼图 + 各上游失败率排行 + cooldown 触发 + 慢响应 top + 失败链 top。
 */
import { useMemo, useState, type ReactNode } from 'react';
import { ShieldAlert, Zap, Activity, Snowflake } from 'lucide-react';
import { Pie, PieChart, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { PageHeader } from './_PageHeader';
import { GlassCard } from '@/components/bits/GlassCard';
import { Badge } from '@/components/ui/badge';
import { useRouteFailureAnalysis, type RouteFailureData } from '@/lib/route-failure-hooks';

const WINDOWS = [
  { days: 1, label: '今日' },
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' },
] as const;

const KIND_LABELS: Record<string, string> = {
  success: '成功',
  auth_failure: '鉴权失败',
  network_error: '网络错误',
  rate_limited: '限流',
  bad_request: '错误请求',
  forbidden: '禁止',
  cooldown_active: '熔断中',
  provider_unavailable: '上游不可用',
  timeout: '超时',
  invalid_response: '响应无效',
  all_attempts_failed: '全部失败',
  no_route_available: '无可用路由',
};

const KIND_COLORS: Record<string, string> = {
  success: '#22c55e',
  auth_failure: '#ef4444',
  network_error: '#f59e0b',
  rate_limited: '#eab308',
  bad_request: '#fb7185',
  forbidden: '#f43f5e',
  cooldown_active: '#64748b',
};
const FALLBACK_COLORS = ['#a3e635', '#38bdf8', '#fbbf24', '#f472b6', '#c084fc', '#2dd4bf'];

const kindLabel = (k: string) => KIND_LABELS[k] ?? k;
const kindColor = (k: string, i: number) => KIND_COLORS[k] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];
const shortId = (u: string | null) => (u ? (u.split('/').pop() ?? u) : '—');

export function RouteFailureAnalysisPage() {
  const [days, setDays] = useState(7);
  const { data, isLoading } = useRouteFailureAnalysis(days);

  const pieData = useMemo(
    () => (data?.errorKinds ?? []).map((k) => ({ name: kindLabel(k.errorKind), key: k.errorKind, value: k.count })),
    [data],
  );

  return (
    <div>
      <PageHeader
        eyebrow="路由"
        title="失败模式分析"
        description="对全部路由尝试跨请求聚合：errorKind 占比、各上游失败率排行、熔断触发、慢响应与多尝试失败链。区别于单请求日志瀑布。"
        status={isLoading ? '加载中' : `${data?.totalAttempts ?? 0} 尝试`}
        statusTone={isLoading ? 'warning' : 'success'}
        actions={
          <div className="flex gap-1">
            {WINDOWS.map((w) => (
              <button
                key={w.days}
                onClick={() => setDays(w.days)}
                className={
                  'rounded-[var(--radius-md)] px-2.5 py-1.5 text-xs transition-colors ' +
                  (days === w.days
                    ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]')
                }
              >
                {w.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="mx-auto max-w-[1300px] space-y-5 px-6 py-6">
        {/* KPI 卡 */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard icon={<Activity className="size-4" />} label="总尝试数" value={String(data?.totalAttempts ?? 0)} />
          <KpiCard icon={<Zap className="size-4" />} label="成功率" value={`${data?.successRate ?? 0}%`} tone="success" />
          <KpiCard icon={<Snowflake className="size-4" />} label="熔断触发" value={String(data?.cooldownCount ?? 0)} tone={data?.cooldownCount ? 'warning' : 'muted'} />
          <KpiCard icon={<ShieldAlert className="size-4" />} label="失败类型数" value={String((data?.errorKinds ?? []).filter((k) => !k.isSuccess).length)} tone="danger" />
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          {/* errorKind 占比饼图 */}
          <GlassCard className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-ink)]">尝试结果占比</h2>
            {pieData.length === 0 ? (
              <div className="py-12 text-center text-xs text-[var(--color-muted)]">暂无数据</div>
            ) : (
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={48}>
                      {pieData.map((d, i) => (
                        <Cell key={d.key} fill={kindColor(d.key, i)} stroke="transparent" />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: 'var(--color-surface-card)',
                        border: '1px solid var(--color-hairline-strong)',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            {/* errorKind 明细条 */}
            <div className="mt-3 space-y-1.5">
              {(data?.errorKinds ?? []).map((k, i) => (
                <div key={k.errorKind} className="flex items-center gap-2 text-xs">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: kindColor(k.errorKind, i) }} />
                  <span className="w-20 shrink-0 text-[var(--color-body)]">{kindLabel(k.errorKind)}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-soft)]">
                    <div className="h-full rounded-full" style={{ width: `${k.pct}%`, background: kindColor(k.errorKind, i) }} />
                  </div>
                  <span className="w-10 shrink-0 text-right tabular-nums text-[var(--color-muted)]">{k.count}</span>
                  <span className="w-12 shrink-0 text-right tabular-nums text-[var(--color-muted)]">{k.pct}%</span>
                </div>
              ))}
            </div>
          </GlassCard>

          {/* 模型失败率排行 */}
          <GlassCard className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-ink)]">上游失败率排行</h2>
            <div className="max-h-[440px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[var(--color-surface-card)] text-[var(--color-muted)]">
                  <tr className="border-b border-[var(--color-hairline-strong)]">
                    <th className="py-2 text-left font-medium">模型</th>
                    <th className="py-2 text-right font-medium">尝试</th>
                    <th className="py-2 text-right font-medium">失败</th>
                    <th className="py-2 text-right font-medium">失败率</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.modelFailureRates ?? []).length === 0 ? (
                    <tr><td colSpan={4} className="py-8 text-center text-[var(--color-muted)]">暂无数据</td></tr>
                  ) : (
                    (data?.modelFailureRates ?? []).map((m) => (
                      <tr key={m.upstreamModel} className="border-b border-[var(--color-hairline)]">
                        <td className="py-2 pr-2 text-[var(--color-ink)]" title={m.upstreamModel}>{shortId(m.upstreamModel)}</td>
                        <td className="py-2 text-right tabular-nums text-[var(--color-body)]">{m.total}</td>
                        <td className="py-2 text-right tabular-nums text-[var(--color-body)]">{m.failed}</td>
                        <td className="py-2 text-right">
                          <Badge tone={m.failureRate >= 50 ? 'danger' : m.failureRate > 0 ? 'warning' : 'success'}>
                            {m.failureRate}%
                          </Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* 慢响应 top */}
          <GlassCard className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-ink)]">慢响应 Top 10</h2>
            <div className="space-y-1.5">
              {(data?.slowest ?? []).length === 0 ? (
                <div className="py-6 text-center text-xs text-[var(--color-muted)]">暂无数据</div>
              ) : (
                (data?.slowest ?? []).map((s, i) => (
                  <div key={`${s.requestId}-${i}`} className="flex items-center gap-2 text-xs">
                    <span className="w-5 shrink-0 text-right tabular-nums text-[var(--color-muted)]">{i + 1}</span>
                    <span className="flex-1 truncate text-[var(--color-body)]" title={s.upstreamModel ?? ''}>{shortId(s.upstreamModel)}</span>
                    {s.errorKind && <Badge tone="danger">{kindLabel(s.errorKind)}</Badge>}
                    <span className="shrink-0 tabular-nums text-[var(--color-primary)]">{s.durationMs}ms</span>
                  </div>
                ))
              )}
            </div>
          </GlassCard>

          {/* 多尝试失败链 top */}
          <GlassCard className="p-5">
            <h2 className="mb-1 text-sm font-semibold text-[var(--color-ink)]">多尝试失败链 Top 10</h2>
            <p className="mb-3 text-[11px] text-[var(--color-muted)]">发生过 fallback（尝试数 &gt; 1）的请求，尝试越多说明路由波折越大。</p>
            <div className="space-y-1.5">
              {(data?.multiAttemptChains ?? []).length === 0 ? (
                <div className="py-6 text-center text-xs text-[var(--color-muted)]">窗口内无多尝试请求（均单次命中）</div>
              ) : (
                (data?.multiAttemptChains ?? []).map((c) => (
                  <div key={c.requestId} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate font-mono text-[10px] text-[var(--color-body)]">{c.requestId}</span>
                    <Badge tone="warning">{c.attempts} 次尝试</Badge>
                  </div>
                ))
              )}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'muted';
}) {
  const color =
    tone === 'success'
      ? 'var(--color-success)'
      : tone === 'warning'
        ? 'var(--color-warning)'
        : tone === 'danger'
          ? 'var(--color-error)'
          : 'var(--color-primary)';
  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted)]" style={{ color }}>
        {icon}
        <span className="text-[var(--color-muted)]">{label}</span>
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--color-ink)]">{value}</div>
    </GlassCard>
  );
}
