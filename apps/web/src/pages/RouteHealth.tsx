/**
 * 路由健康看板（组 5 Tick 3 v1.13.0.0）。
 *
 * 三源可视化：熔断 cooldown 实时倒计时 + 模型 9 维评分雷达（复用 ModelScoreRadar）
 * + 上游健康时间线。每 10 秒后端刷新，本地每秒 tick 让倒计时平滑递减。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Activity, RefreshCw, ShieldAlert, Timer, Zap } from 'lucide-react';
import { PageHeader } from './_PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/data/DataTable';
import { GlassCard } from '@/components/bits/GlassCard';
import { ModelScoreRadar } from '@/components/charts/ModelScoreRadar';
import { useRouteHealth, type RouteHealthCooldown } from '@/lib/route-health-hooks';

function fmtRemaining(ms: number): string {
  if (ms <= 0) return '已恢复';
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export function RouteHealthPage() {
  const { data, isLoading, isFetching, refetch } = useRouteHealth();
  const [selected, setSelected] = useState(0);
  const [, setTick] = useState(0);

  // 本地每秒 tick 触发重渲染，让 cooldown 倒计时平滑递减（后端 10s refetch 校准）。
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const cooldowns = data?.cooldowns ?? [];
  const topModels = data?.topModels ?? [];
  const providers = data?.providers ?? [];
  const radar = topModels[selected] ?? topModels[0];

  const cooldownCols: Column<RouteHealthCooldown>[] = [
    {
      id: 'label',
      header: '目标',
      cell: (r) => <span className="font-mono text-[11px] text-[var(--color-body-strong)]">{r.label}</span>,
      width: '1.8fr',
    },
    {
      id: 'scope',
      header: '范围',
      cell: (r) => <Badge tone={r.scope === 'provider' ? 'warning' : 'muted'}>{r.scope === 'provider' ? '上游' : '模型'}</Badge>,
      width: '0.5fr',
    },
    { id: 'reason', header: '原因', cell: (r) => <Badge tone="danger">{r.reason}</Badge>, width: '0.6fr' },
    {
      id: 'state',
      header: '状态',
      cell: (r) => <Badge tone={r.halfOpen ? 'info' : 'warning'}>{r.halfOpen ? '半开探测' : '熔断中'}</Badge>,
      width: '0.6fr',
    },
    { id: 'attempts', header: '次数', cell: (r) => <span className="tabular">{r.attempts}</span>, align: 'right', width: '0.4fr' },
    {
      id: 'remaining',
      header: '恢复倒计时',
      cell: (r) => {
        const rem = new Date(r.expiresAt).getTime() - Date.now();
        return (
          <span className={`tabular ${rem <= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'}`}>
            {fmtRemaining(rem)}
          </span>
        );
      },
      align: 'right',
      sortable: true,
      sortKey: (r) => r.remainingMs,
      width: '0.8fr',
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="可观测"
        title="路由健康看板"
        description="熔断 cooldown 实时倒计时 + 模型 9 维评分雷达 + 上游健康时间线，每 10 秒自动刷新。"
        status={isFetching ? '刷新中' : '实时'}
        statusTone={isFetching ? 'warning' : 'success'}
        actions={
          <Button size="sm" variant="ghost" onClick={() => void refetch()}>
            <RefreshCw className="size-3.5" />
          </Button>
        }
      />
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatBlock label="熔断中" value={String(cooldowns.filter((c) => !c.halfOpen).length)} tone="warning" icon={<ShieldAlert className="size-4" />} />
          <StatBlock label="半开探测" value={String(cooldowns.filter((c) => c.halfOpen).length)} tone="info" icon={<Timer className="size-4" />} />
          <StatBlock label="评分模型" value={String(topModels.length)} icon={<Zap className="size-4" />} />
          <StatBlock label="上游" value={String(providers.length)} icon={<Activity className="size-4" />} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <GlassCard className="p-5 lg:col-span-2">
            <div className="mb-3 text-sm font-medium text-[var(--color-ink)]">熔断 cooldown 实时倒计时</div>
            <DataTable
              columns={cooldownCols}
              rows={cooldowns}
              rowKey={(r) => r.id}
              loading={isLoading}
              empty={
                <div className="flex flex-col items-center gap-3">
                  <ShieldAlert className="size-6 text-[var(--color-success)]" />
                  <div>当前无熔断，路由全员健康。</div>
                </div>
              }
            />
          </GlassCard>
          <GlassCard className="p-5">
            <div className="mb-3 text-sm font-medium text-[var(--color-ink)]">模型 9 维评分</div>
            {radar ? (
              <>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {topModels.slice(0, 6).map((m, i) => (
                    <button
                      key={m.modelId}
                      onClick={() => setSelected(i)}
                      className={`rounded px-2 py-1 font-mono text-[10px] ${
                        i === selected
                          ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]'
                          : 'bg-[var(--color-surface-soft)] text-[var(--color-muted)]'
                      }`}
                    >
                      {m.upstreamId.split('/').pop()}
                    </button>
                  ))}
                </div>
                <ModelScoreRadar scores={radar.scores} composite={radar.composite} />
                <div className="mt-2 text-center text-[11px] text-[var(--color-muted)]">
                  {radar.providerSlug}/{radar.upstreamId} · composite {radar.composite.toFixed(3)}
                </div>
              </>
            ) : (
              <div className="flex h-40 items-center justify-center text-sm text-[var(--color-muted)]">暂无评分数据</div>
            )}
          </GlassCard>
        </div>

        <GlassCard className="p-5">
          <div className="mb-3 text-sm font-medium text-[var(--color-ink)]">上游健康时间线（最近 16 次探测）</div>
          <div className="space-y-3">
            {providers.length === 0 ? (
              <div className="text-sm text-[var(--color-muted)]">暂无上游。</div>
            ) : (
              providers.map((p) => (
                <div key={p.slug} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 truncate font-mono text-[11px] text-[var(--color-body-strong)]">{p.name}</div>
                  <div className="flex flex-1 gap-1">
                    {p.checks.length === 0 ? (
                      <span className="text-[11px] text-[var(--color-muted)]">无探测记录</span>
                    ) : (
                      p.checks.map((c, i) => (
                        <span
                          key={i}
                          title={`${c.ok ? 'OK' : 'FAIL'} · ${c.latencyMs ?? '—'}ms · ${new Date(c.takenAt).toLocaleTimeString()}`}
                          className={`h-5 flex-1 rounded-sm ${c.ok ? 'bg-[var(--color-success)]' : 'bg-[var(--color-error)]'}`}
                          style={{ maxWidth: 16 }}
                        />
                      ))
                    )}
                  </div>
                  <Badge tone={p.checks.at(-1)?.ok ? 'success' : p.checks.length ? 'danger' : 'muted'}>
                    {p.checks.at(-1)?.ok ? '健康' : p.checks.length ? '异常' : '未知'}
                  </Badge>
                </div>
              ))
            )}
          </div>
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
  tone?: 'warning' | 'info';
  icon?: ReactNode;
}) {
  const color =
    tone === 'warning'
      ? 'text-[var(--color-warning)]'
      : tone === 'info'
        ? 'text-[var(--color-info)]'
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
