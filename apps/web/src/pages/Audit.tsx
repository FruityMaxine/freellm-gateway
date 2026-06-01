/**
 * 管理员操作审计页（Tick 29 v1.7.1.0）。
 *
 * 列出 admin_audit_logs 全部写操作记录（POST/PATCH/DELETE）+ 登录/登出事件。
 * 支持按 username / action / resourceType / 时间区间筛选。
 * 点击行展开 requestBody（已 redact 敏感字段）+ clientIp + UA。
 */
import { useMemo, useState } from 'react';
import { Download, Filter, RefreshCw, Shield } from 'lucide-react';
import { PageHeader } from './_PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GlassCard } from '@/components/bits/GlassCard';
import {
  useAudit,
  useAuditFacets,
  useAuditStats,
  type AdminAuditLogRow,
  type AuditStatsDimension,
} from '@/lib/useAudit';
import { timeAgo, formatDuration } from '@/lib/utils';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type StatusFilter = 'all' | '2xx' | '4xx' | '5xx';

const ACTION_TONE: Record<string, 'success' | 'warning' | 'danger' | 'primary' | 'muted'> = {
  login: 'primary',
  logout: 'muted',
  create: 'success',
  update: 'warning',
  delete: 'danger',
  refresh: 'primary',
};

type AuditTab = 'list' | 'stats';

export function AuditPage() {
  const [tab, setTab] = useState<AuditTab>('list');
  const [username, setUsername] = useState('');
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [activeRow, setActiveRow] = useState<AdminAuditLogRow | null>(null);

  const { data: facets } = useAuditFacets();
  const { data, isFetching, refetch } = useAudit({
    ...(username ? { username } : {}),
    ...(action ? { action } : {}),
    ...(resourceType ? { resourceType } : {}),
    limit: 200,
  });

  const filteredRows = useMemo(() => {
    const rows = data?.data ?? [];
    return rows.filter((r) => {
      if (statusFilter !== 'all') {
        const s = r.status;
        if (statusFilter === '2xx' && (s < 200 || s >= 300)) return false;
        if (statusFilter === '4xx' && (s < 400 || s >= 500)) return false;
        if (statusFilter === '5xx' && (s < 500 || s >= 600)) return false;
      }
      return true;
    });
  }, [data, statusFilter]);

  const exportCsv = () => {
    const header =
      'time,username,action,resourceType,resourceId,method,path,status,clientIp,durationMs\n';
    const lines = filteredRows
      .map((r) =>
        [
          r.createdAt,
          r.username,
          r.action,
          r.resourceType,
          r.resourceId ?? '',
          r.method,
          r.path,
          r.status,
          r.clientIp ?? '',
          r.durationMs ?? '',
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      )
      .join('\n');
    const blob = new Blob([header + lines], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `freellm-audit-${new Date().toISOString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        eyebrow="审计"
        title="操作审计"
        description="管理员所有写操作（创建 / 改 / 删 / 登录 / 登出）的全链路审计，自动捕获 ≤4 KB 请求体并 redact 敏感字段。"
        status={isFetching ? '加载中' : '实时'}
        statusTone={isFetching ? 'warning' : 'success'}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} /> 刷新
            </Button>
            <Button
              variant="subtle"
              size="sm"
              onClick={exportCsv}
              disabled={!filteredRows.length}
            >
              <Download className="size-3.5" /> 导出 CSV
            </Button>
          </>
        }
      />

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-5">
        {/* Tick 43 v1.7.15.0：Tab 切换列表 / 统计图表 */}
        <div className="inline-flex rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] p-1 text-xs">
          {(['list', 'stats'] as AuditTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-[var(--radius-sm)] px-3 py-1.5 ${
                tab === t
                  ? 'bg-[var(--color-surface-card)] text-[var(--color-ink)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              {t === 'list' ? '事件列表' : '统计图表'}
            </button>
          ))}
        </div>

        {tab === 'stats' && <AuditStatsView />}
        {tab === 'list' && (
        <>
        <GlassCard className="p-4">
          <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--color-muted)]">
            <Filter className="size-3.5" /> 筛选
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Input
              placeholder="用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <select
              className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-2 text-sm text-[var(--color-ink)]"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              <option value="">所有动作</option>
              {(facets?.actions ?? []).map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-2 text-sm text-[var(--color-ink)]"
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value)}
            >
              <option value="">所有资源</option>
              {(facets?.resourceTypes ?? []).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <select
              className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-2 text-sm text-[var(--color-ink)]"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">所有状态</option>
              <option value="2xx">2xx 成功</option>
              <option value="4xx">4xx 客户端错误</option>
              <option value="5xx">5xx 服务端错误</option>
            </select>
          </div>
        </GlassCard>

        <GlassCard className="overflow-hidden">
          <div className="grid grid-cols-[0.9fr_0.8fr_0.6fr_0.8fr_1.4fr_0.5fr_0.5fr] gap-2 border-b border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/60 px-4 py-2 text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
            <div>时间</div>
            <div>用户</div>
            <div>动作</div>
            <div>资源</div>
            <div>路径</div>
            <div className="text-right">耗时</div>
            <div className="text-right">状态</div>
          </div>
          {filteredRows.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-[var(--color-muted)]">
              <Shield className="mx-auto mb-3 size-8 opacity-40" />
              {isFetching ? '正在加载审计 …' : '暂无符合条件的审计记录。'}
            </div>
          ) : (
            filteredRows.map((r) => (
              <button
                type="button"
                key={r.id}
                onClick={() => setActiveRow(r)}
                className="grid w-full grid-cols-[0.9fr_0.8fr_0.6fr_0.8fr_1.4fr_0.5fr_0.5fr] cursor-pointer items-center gap-2 border-b border-[var(--color-hairline)]/60 px-4 py-2 text-left text-xs transition-colors hover:bg-[var(--color-surface-soft)]/40"
              >
                <span className="tabular text-[11px] text-[var(--color-muted)]">
                  {timeAgo(r.createdAt)}
                </span>
                <span className="truncate font-mono text-[11px] text-[var(--color-body-strong)]">
                  {r.username}
                </span>
                <Badge tone={ACTION_TONE[r.action] ?? 'muted'}>{r.action}</Badge>
                <span className="truncate font-mono text-[11px] text-[var(--color-body-strong)]">
                  {r.resourceType}
                </span>
                <span className="truncate font-mono text-[10px] text-[var(--color-muted)]">
                  {r.method} {r.path}
                </span>
                <span className="text-right tabular">{formatDuration(r.durationMs ?? 0)}</span>
                <span
                  className={`text-right tabular ${
                    r.status >= 500
                      ? 'text-[var(--color-error)]'
                      : r.status >= 400
                        ? 'text-[var(--color-warning)]'
                        : 'text-[var(--color-success)]'
                  }`}
                >
                  {r.status}
                </span>
              </button>
            ))
          )}
        </GlassCard>

        {data && data.total > filteredRows.length && (
          <div className="text-center text-[11px] text-[var(--color-muted)]">
            已显示 {filteredRows.length} 条 / 总 {data.total} 条（如需更多请收紧筛选条件）。
          </div>
        )}
        </>
        )}
      </div>

      <Dialog open={!!activeRow} onOpenChange={(o) => !o && setActiveRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>审计详情</DialogTitle>
            <DialogDescription>
              {activeRow ? `${activeRow.method} ${activeRow.path} → ${activeRow.status}` : ''}
            </DialogDescription>
          </DialogHeader>
          {activeRow && (
            <div className="space-y-3 text-xs">
              {[
                ['用户', activeRow.username],
                ['动作', activeRow.action],
                ['资源类型', activeRow.resourceType],
                ['资源 ID', activeRow.resourceId ?? '—'],
                ['客户端 IP', activeRow.clientIp ?? '—'],
                ['User-Agent', activeRow.userAgent ?? '—'],
                ['请求 ID', activeRow.requestId ?? '—'],
                ['耗时', formatDuration(activeRow.durationMs ?? 0)],
                ['时间', new Date(activeRow.createdAt).toLocaleString()],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-start justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-2"
                >
                  <span className="uppercase tracking-wider text-[var(--color-muted)]">{k}</span>
                  <span className="break-all text-right font-mono text-[var(--color-ink)]">
                    {v}
                  </span>
                </div>
              ))}
              {activeRow.requestBody && (
                <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-2">
                  <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                    请求体（敏感字段已脱敏）
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-[var(--color-ink)]">
                    {tryPrettyJson(activeRow.requestBody)}
                  </pre>
                </div>
              )}
              {activeRow.errorMessage && (
                <div className="rounded-[var(--radius-md)] border border-[var(--color-error)]/40 bg-[var(--color-error)]/10 px-3 py-2 text-[var(--color-error)]">
                  {activeRow.errorMessage}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function tryPrettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/**
 * Tick 43 v1.7.15.0：审计统计视图（4 维度切换 + 2 图）。
 *
 * 维度：user (柱状) / resource (柱状) / action (柱状) / day (折线带失败率)
 * 通用 since=过去 7 天。
 */
function AuditStatsView() {
  const [dimension, setDimension] = useState<AuditStatsDimension>('user');
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  const { data, isLoading } = useAuditStats(dimension, { since, topN: 12 });

  return (
    <div className="space-y-4">
      <GlassCard className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium text-[var(--color-ink)]">
            按维度统计（近 7 天）
          </div>
          <div className="inline-flex rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] p-1 text-xs">
            {(['user', 'resource', 'action', 'day'] as AuditStatsDimension[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDimension(d)}
                className={`rounded-[var(--radius-sm)] px-2.5 py-1.5 ${
                  dimension === d
                    ? 'bg-[var(--color-surface-card)] text-[var(--color-ink)]'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {DIMENSION_LABEL[d]}
              </button>
            ))}
          </div>
        </div>

        <div className="text-[11px] text-[var(--color-muted)]">
          总事件：<span className="tabular text-[var(--color-ink)]">{data?.totalEvents ?? 0}</span>
          {data?.buckets.length ? (
            <span className="ml-3">
              桶数：<span className="tabular text-[var(--color-ink)]">{data.buckets.length}</span>
            </span>
          ) : null}
        </div>

        <div className="mt-4 h-[280px]">
          {isLoading ? (
            <div className="grid h-full place-items-center text-xs text-[var(--color-muted)]">
              正在加载图表 …
            </div>
          ) : !data || data.buckets.length === 0 ? (
            <div className="grid h-full place-items-center text-xs text-[var(--color-muted)]">
              暂无数据。
            </div>
          ) : dimension === 'day' ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data.buckets.map((b) => ({
                  label: b.key.slice(5),
                  total: b.total,
                  failureRate: Math.round(b.failureRate * 100),
                }))}
                margin={{ top: 8, right: 16, left: -16, bottom: 0 }}
              >
                <CartesianGrid stroke="var(--color-hairline)" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="var(--color-muted)" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="left" stroke="var(--color-muted)" tick={{ fontSize: 10 }} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="var(--color-warning)"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface-elevated)',
                    border: '1px solid var(--color-hairline-strong)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 12,
                  }}
                  formatter={(value: number, name: string) => {
                    if (name === 'failureRate') return [`${value}%`, '失败率'];
                    if (name === 'total') return [value, '事件数'];
                    return [value, name];
                  }}
                />
                <Bar yAxisId="left" dataKey="total" fill="var(--color-primary)" name="total" />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="failureRate"
                  stroke="var(--color-warning)"
                  strokeWidth={2}
                  dot={false}
                  name="failureRate"
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.buckets.map((b) => ({ label: truncate(b.key, 14), total: b.total, failed: b.failed }))}
                margin={{ top: 8, right: 16, left: -16, bottom: 24 }}
              >
                <CartesianGrid stroke="var(--color-hairline)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  stroke="var(--color-muted)"
                  tick={{ fontSize: 10 }}
                  angle={-25}
                  textAnchor="end"
                  height={50}
                />
                <YAxis stroke="var(--color-muted)" tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface-elevated)',
                    border: '1px solid var(--color-hairline-strong)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="total" fill="var(--color-primary)" name="总数" />
                <Bar dataKey="failed" fill="var(--color-error)" name="失败" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </GlassCard>

      {/* 数据表（与图等价） */}
      <GlassCard className="overflow-hidden">
        <div className="grid grid-cols-[1.5fr_0.5fr_0.5fr_0.5fr] gap-2 border-b border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/60 px-4 py-2 text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
          <div>{DIMENSION_LABEL[dimension]}</div>
          <div className="text-right">总数</div>
          <div className="text-right">失败</div>
          <div className="text-right">失败率</div>
        </div>
        {(data?.buckets ?? []).map((b) => (
          <div
            key={b.key}
            className="grid grid-cols-[1.5fr_0.5fr_0.5fr_0.5fr] items-center gap-2 border-b border-[var(--color-hairline)]/60 px-4 py-2 text-xs"
          >
            <span className="truncate font-mono text-[var(--color-body-strong)]">{b.key}</span>
            <span className="text-right tabular">{b.total}</span>
            <span className="text-right tabular text-[var(--color-error)]">{b.failed}</span>
            <span className="text-right tabular text-[var(--color-warning)]">
              {Math.round(b.failureRate * 100)}%
            </span>
          </div>
        ))}
        {data?.buckets.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-[var(--color-muted)]">暂无数据。</div>
        )}
      </GlassCard>
    </div>
  );
}

const DIMENSION_LABEL: Record<AuditStatsDimension, string> = {
  user: '按用户',
  resource: '按资源',
  action: '按动作',
  day: '按天',
};

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
