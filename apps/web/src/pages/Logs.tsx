import { useMemo, useState } from 'react';
import { CheckCircle2, Copy, Download, Filter, RefreshCw, ScrollText, Search, XCircle } from 'lucide-react';
import { PageHeader } from './_PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable, type Column } from '@/components/data/DataTable';
import { GlassCard } from '@/components/bits/GlassCard';
import { useLogDetail, useLogs, type LogRow } from '@/lib/lab-keys-logs-hooks';
import { useErrorRateTimeseries, type TimeseriesWindow } from '@/lib/admin-hooks';
import { ErrorRateChart } from '@/components/charts/ErrorRateChart';
import { RouteAttemptWaterfall } from '@/components/data/RouteAttemptWaterfall';
import { formatDuration, timeAgo } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type StatusFilter = 'all' | '2xx' | '4xx' | '5xx';

export function LogsStub() {
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [errorKind, setErrorKind] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [activeReqId, setActiveReqId] = useState<string | null>(null);

  // Tick 25 v1.6.0.0：搜索词同时下发到后端 `?q` 做全文搜索 + 前端二次状态过滤。
  const { data, isLoading, refetch, isFetching } = useLogs({
    ...(provider ? { upstreamProvider: provider } : {}),
    ...(model ? { upstreamModel: model } : {}),
    ...(errorKind ? { errorKind } : {}),
    ...(search.trim() ? { q: search.trim() } : {}),
    limit: 200,
  });

  const detail = useLogDetail(activeReqId);

  const filteredRows = useMemo(() => {
    const rows = data?.data ?? [];
    return rows.filter((r) => {
      if (statusFilter !== 'all') {
        const s = r.status ?? 0;
        if (statusFilter === '2xx' && (s < 200 || s >= 300)) return false;
        if (statusFilter === '4xx' && (s < 400 || s >= 500)) return false;
        if (statusFilter === '5xx' && (s < 500 || s >= 600)) return false;
      }
      return true;
    });
  }, [data, statusFilter]);

  const exportCsv = () => {
    const header = 'requestId,upstreamProvider,upstreamModel,status,errorKind,attempts,durationMs,startedAt\n';
    const lines = filteredRows
      .map((r) => [r.requestId, r.upstreamProvider ?? '', r.upstreamModel ?? '', r.status ?? '', r.errorKind ?? '', r.attempts, r.durationMs ?? '', r.startedAt].join(','))
      .join('\n');
    const blob = new Blob([header + lines], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `freellm-logs-${new Date().toISOString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: Column<LogRow>[] = [
    { id: 'time', header: '时间', cell: (r) => <span className="tabular text-[11px] text-[var(--color-muted)]">{timeAgo(r.startedAt)}</span>, sortable: true, sortKey: (r) => r.startedAt, width: '0.7fr' },
    { id: 'requestId', header: '请求 ID', cell: (r) => <span className="font-mono text-[11px] text-[var(--color-body-strong)]">{r.requestId}</span>, width: '1.1fr' },
    { id: 'upstream', header: '上游', cell: (r) => (
        <div className="flex flex-col">
          <span className="truncate font-mono text-[11px] text-[var(--color-body-strong)]">{r.upstreamModel ?? '—'}</span>
          <span className="truncate text-[10px] text-[var(--color-muted)]">{r.upstreamProvider ?? '—'}</span>
        </div>
      ), width: '1.6fr' },
    { id: 'streaming', header: '流式', cell: (r) => <Badge tone={r.streaming ? 'primary' : 'muted'}>{r.streaming ? 'SSE' : '同步'}</Badge>, width: '0.5fr' },
    { id: 'attempts', header: '尝试', cell: (r) => <span className="tabular">{r.attempts}</span>, align: 'right', width: '0.4fr' },
    { id: 'duration', header: '耗时', cell: (r) => <span className="tabular">{formatDuration(r.durationMs)}</span>, align: 'right', sortable: true, sortKey: (r) => r.durationMs ?? 0, width: '0.5fr' },
    { id: 'status', header: '状态', cell: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          {r.status && r.status < 400 ? <CheckCircle2 className="size-3 text-[var(--color-success)]" /> : <XCircle className="size-3 text-[var(--color-error)]" />}
          <span className="tabular">{r.status ?? '—'}</span>
          {r.errorKind && <Badge tone="danger">{r.errorKind}</Badge>}
        </div>
      ), align: 'right', sortable: true, sortKey: (r) => r.status ?? 0, width: '0.9fr' },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="审计"
        title="审计日志"
        description="按请求的审计链路 + 路由尝试瀑布图，每 10 秒自动刷新。"
        status={isFetching ? '加载中' : '实时'}
        statusTone={isFetching ? 'warning' : 'success'}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} /> 重新拉取
            </Button>
            <Button variant="subtle" size="sm" onClick={exportCsv} disabled={!filteredRows.length}>
              <Download className="size-3.5" /> 导出 CSV
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted)]" />
            <Input value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder="请求 ID / 模型 / 上游 / 错误类型" className="pl-9" />
          </div>
          <Input value={provider} onChange={(e) => setProvider(e.currentTarget.value)} placeholder="上游标识" className="w-32" />
          <Input value={model} onChange={(e) => setModel(e.currentTarget.value)} placeholder="模型 ID" className="w-40" />
          <Input value={errorKind} onChange={(e) => setErrorKind(e.currentTarget.value)} placeholder="错误类型" className="w-36" />
          <div className="inline-flex rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] p-1 text-xs">
            {(['all', '2xx', '4xx', '5xx'] as StatusFilter[]).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)} className={cn('rounded-[var(--radius-sm)] px-2.5 py-1.5', statusFilter === s ? 'bg-[var(--color-surface-card)] text-[var(--color-ink)]' : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]')}>{s === 'all' ? '全部' : s}</button>
            ))}
          </div>
          <div className="ml-auto inline-flex items-center gap-2 text-xs text-[var(--color-muted)]"><Filter className="size-3.5" /> {filteredRows.length} / {data?.total ?? 0}</div>
        </div>
      </PageHeader>

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        {/* Tick 49 v1.7.21.0：错误率趋势图 */}
        <ErrorRateTrendCard />
        <DataTable columns={columns} rows={filteredRows} rowKey={(r) => r.requestId} onRowClick={(r) => setActiveReqId(r.requestId)} loading={isLoading} empty={<div className="flex flex-col items-center gap-3"><ScrollText className="size-6 text-[var(--color-muted)]" /><div>当前筛选条件下没有匹配的请求。</div></div>} />
      </div>

      <Dialog open={!!activeReqId} onOpenChange={(o) => !o && setActiveReqId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle><span className="font-mono">{activeReqId}</span></DialogTitle>
            <DialogDescription>逐次尝试时间轴 · 评分依据 · 冷却触发详情。</DialogDescription>
          </DialogHeader>
          {detail.isLoading ? (
            <div className="py-8 text-center text-[var(--color-muted)]">加载中…</div>
          ) : detail.data ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  ['上游', detail.data.upstreamProvider ?? '—'],
                  ['模型', detail.data.upstreamModel ?? '—'],
                  ['状态码', String(detail.data.status ?? '—')],
                  ['流式', detail.data.streaming ? 'SSE' : '同步'],
                  ['尝试', String(detail.data.attempts)],
                  ['耗时', formatDuration(detail.data.durationMs)],
                  ['Token', String(detail.data.totalTokens)],
                  ['Prompt 摘要', detail.data.promptDigest ?? '—'],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-2">
                    <span className="uppercase tracking-wider text-[var(--color-muted)]">{k}</span>
                    <span className="font-mono text-[var(--color-ink)]">{v}</span>
                  </div>
                ))}
              </div>

              <div className="mt-2 flex items-center justify-between text-xs uppercase tracking-wider text-[var(--color-muted)]">
                <span>路由尝试瀑布图（{detail.data.attemptsList?.length ?? 0}）</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const curl = renderReplayCurl(detail.data);
                    void navigator.clipboard.writeText(curl);
                    toast.success('cURL 已复制（替换 Authorization 后即可复跑）');
                  }}
                >
                  <Copy className="size-3.5" /> 复制 cURL
                </Button>
              </div>
              <GlassCard className="p-3">
                <RouteAttemptWaterfall
                  attempts={detail.data.attemptsList ?? []}
                  requestStartedAt={detail.data.startedAt}
                  requestDurationMs={detail.data.durationMs}
                />
              </GlassCard>

              {/* Tick 42 v1.7.14.0：失败原因摘要 */}
              {(() => {
                const failed = (detail.data.attemptsList ?? []).filter(
                  (a) => a.errorMessage || a.errorKind,
                );
                if (failed.length === 0) return null;
                return (
                  <GlassCard className="border-[var(--color-error)]/30 bg-[var(--color-error)]/5 p-3">
                    <div className="mb-2 text-xs uppercase tracking-wider text-[var(--color-error)]">
                      失败明细（{failed.length}）
                    </div>
                    <div className="space-y-2 text-[11px]">
                      {failed.map((a) => (
                        <div
                          key={a.ordinal}
                          className="rounded-[var(--radius-sm)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/60 px-3 py-2"
                        >
                          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                            <span>
                              #{a.ordinal} · {a.upstreamModel ?? '—'}
                            </span>
                            <span>{a.errorKind ?? 'unknown'}</span>
                          </div>
                          <div className="mt-1 break-all text-[var(--color-ink)]">
                            {a.errorMessage ?? '(无错误消息)'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </GlassCard>
                );
              })()}
            </div>
          ) : (
            <div className="py-8 text-center text-[var(--color-error)]">请求详情加载失败。</div>
          )}
        </DialogContent>
      </Dialog>

      <StatusSummary rows={filteredRows} />
    </div>
  );
}

function StatusSummary({ rows }: { rows: LogRow[] }) {
  const sums = useMemo(() => {
    let ok = 0; let bad = 0; let pending = 0;
    for (const r of rows) {
      if (r.status == null) pending += 1;
      else if (r.status < 400) ok += 1;
      else bad += 1;
    }
    return { ok, bad, pending };
  }, [rows]);
  return (
    <div className="mx-auto max-w-7xl px-6 pb-10">
      <GlassCard className="p-4 flex items-center gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5 text-[var(--color-success)]"><CheckCircle2 className="size-3.5" /> {sums.ok} 成功</span>
        <span className="inline-flex items-center gap-1.5 text-[var(--color-error)]"><XCircle className="size-3.5" /> {sums.bad} 失败</span>
        <span className="text-[var(--color-muted)]">待定：{sums.pending}</span>
      </GlassCard>
    </div>
  );
}

/**
 * Tick 42 v1.7.14.0：把 RequestLog detail 渲染成可一键复跑的 cURL。
 * 替换 Authorization 即可在本地重放（demo / 排查）。
 */
function renderReplayCurl(detail: { upstreamModel: string | null; streaming: boolean }): string {
  const model = detail.upstreamModel ?? 'free/auto';
  return `curl http://localhost:3001/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_FREELLM_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [{"role":"user","content":"replay test"}],
    "stream": ${detail.streaming}
  }'`;
}

// =============================================================================
// Tick 49 v1.7.21.0：错误率趋势卡片（顶部嵌入 Logs 页）
// =============================================================================
function ErrorRateTrendCard() {
  const [window, setWindow] = useState<TimeseriesWindow>('24h');
  const { data, isLoading } = useErrorRateTimeseries(window);
  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-[var(--color-hairline)] pb-3">
        <div className="min-w-0">
          <div className="font-semibold text-[var(--color-ink)]">错误率趋势</div>
          <div className="text-[11px] text-[var(--color-muted)]">
            按 HTTP status 分桶（2xx/4xx/5xx/null），右轴失败请求数、左轴错误率
          </div>
        </div>
        <div className="inline-flex rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] p-1 text-xs">
          {(['1h', '24h', '7d'] as TimeseriesWindow[]).map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={cn(
                'rounded-[var(--radius-sm)] px-2.5 py-1.5',
                window === w
                  ? 'bg-[var(--color-surface-card)] text-[var(--color-ink)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]',
              )}
            >
              {w}
            </button>
          ))}
        </div>
      </div>
      {data ? (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryStat label="总请求" value={data.summary.total.toLocaleString()} />
          <SummaryStat
            label="错误率"
            value={`${(data.summary.errorRate * 100).toFixed(2)}%`}
            tone={data.summary.errorRate > 0.05 ? 'warning' : 'normal'}
          />
          <SummaryStat label="4xx" value={data.summary.status4xx.toLocaleString()} />
          <SummaryStat
            label="5xx"
            value={data.summary.status5xx.toLocaleString()}
            tone={data.summary.status5xx > 0 ? 'error' : 'normal'}
          />
        </div>
      ) : null}
      <div className="h-72">
        {isLoading || !data ? (
          <div className="grid h-full place-items-center text-[var(--color-muted)]">加载中…</div>
        ) : (
          <ErrorRateChart data={data.buckets} window={window} />
        )}
      </div>
    </GlassCard>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'normal' | 'warning' | 'error';
}) {
  const colorClass =
    tone === 'error'
      ? 'text-[var(--color-error)]'
      : tone === 'warning'
        ? 'text-[var(--color-warning)]'
        : 'text-[var(--color-ink)]';
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{label}</div>
      <div className={cn('text-lg font-semibold', colorClass)}>{value}</div>
    </div>
  );
}
