/**
 * 管理员告警中心页（Tick 40 v1.7.12.0）。
 *
 * 聚合 Tick 31/34/37/39 四大告警源（ErrorEvent 表）：
 *   - balance_low (Provider 余额预警)
 *   - vk_usage_alert (VK 用量预警)
 *   - model_change (模型自动黑名单)
 *   - provider_outage / auth_failure / 429_storm 等路由层失败事件
 *
 * 提供：分类筛选 + 严重度筛选 + 已解决/未解决切换 + 解决按钮 + 统计卡。
 */
import { useState } from 'react';
import { AlertCircle, Bell, CheckCircle2, Filter, Plus, Power, RefreshCw, Trash2, Zap } from 'lucide-react';
import { PageHeader } from './_PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GlassCard } from '@/components/bits/GlassCard';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useAlerts,
  useAlertsStats,
  useResolveAlert,
  useAlertRules,
  useCreateAlertRule,
  useUpdateAlertRule,
  useDeleteAlertRule,
  useEvaluateAlertRules,
  type AlertRow,
  type AlertRuleRow,
} from '@/lib/useAlerts';
import { timeAgo } from '@/lib/utils';
import { toast } from 'sonner';

type ResolvedFilter = 'all' | 'unresolved' | 'resolved';

const KIND_LABEL: Record<string, string> = {
  balance_low: '余额预警',
  vk_usage_alert: 'VK 用量',
  model_change: '模型变更',
  provider_outage: '上游故障',
  auth_failure: '鉴权失败',
  '429_storm': '限流风暴',
  content_filter: '内容过滤',
  unknown: '未知',
};

const SEVERITY_TONE: Record<string, 'info' | 'warning' | 'danger' | 'muted'> = {
  info: 'info',
  warn: 'warning',
  error: 'danger',
  critical: 'danger',
};

// 组 6 Tick 2 v1.16.0.0：告警规则引擎面板（规则 CRUD + 立即评估）。
function AlertRulesPanel() {
  const { data } = useAlertRules();
  const createMut = useCreateAlertRule();
  const updateMut = useUpdateAlertRule();
  const deleteMut = useDeleteAlertRule();
  const evalMut = useEvaluateAlertRules();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    metric: 'error_count_24h',
    operator: 'gt',
    threshold: 5,
    severity: 'warn',
    notifyWebhook: true,
  });
  const metrics = data?.metrics ?? [];
  const operators = data?.operators ?? [];
  const rules = data?.data ?? [];
  const inputCls =
    'rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-2 py-1.5 text-xs text-[var(--color-ink)]';

  const onCreate = async () => {
    if (!form.name.trim()) {
      toast.error('规则名必填');
      return;
    }
    try {
      await createMut.mutateAsync({ ...form, threshold: Number(form.threshold) });
      toast.success('规则已创建');
      setShowForm(false);
      setForm({ name: '', metric: metrics[0] ?? 'error_count_24h', operator: 'gt', threshold: 5, severity: 'warn', notifyWebhook: true });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const onEval = async () => {
    try {
      const r = await evalMut.mutateAsync();
      toast.success(`评估完成：${r.result.evaluated} 规则，${r.result.triggered} 命中`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const onToggle = (r: AlertRuleRow) => void updateMut.mutateAsync({ id: r.id, patch: { enabled: !r.enabled } });
  const onDelete = (id: string) => {
    if (confirm('删除此规则？')) void deleteMut.mutateAsync(id).then(() => toast.success('已删除'));
  };

  return (
    <GlassCard className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-ink)]">
          <AlertCircle className="size-4 text-[var(--color-primary)]" /> 告警规则引擎
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onEval} disabled={evalMut.isPending}>
            <Zap className="size-3.5" /> 立即评估
          </Button>
          <Button size="sm" variant="primary" onClick={() => setShowForm((s) => !s)}>
            <Plus className="size-3.5" /> {showForm ? '收起' : '新建规则'}
          </Button>
        </div>
      </div>
      {showForm && (
        <div className="mb-3 grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/50 p-3 md:grid-cols-6">
          <input className={inputCls} placeholder="规则名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className={inputCls} value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })}>
            {metrics.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select className={inputCls} value={form.operator} onChange={(e) => setForm({ ...form, operator: e.target.value })}>
            {operators.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <input className={inputCls} type="number" placeholder="阈值" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })} />
          <select className={inputCls} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
            {['info', 'warn', 'error', 'critical'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <Button size="sm" variant="primary" onClick={onCreate} disabled={createMut.isPending}>
            创建
          </Button>
        </div>
      )}
      <div className="space-y-1.5">
        {rules.length === 0 ? (
          <div className="text-xs text-[var(--color-muted)]">
            暂无规则。新建后 cron 每 5 分钟评估，命中写告警 + 触发 webhook。
          </div>
        ) : (
          rules.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 text-[11px]">
              <Badge tone={SEVERITY_TONE[r.severity] ?? 'muted'}>{r.severity}</Badge>
              <span className="font-mono text-[var(--color-body-strong)]">{r.name}</span>
              <span className="text-[var(--color-muted)]">{r.metric} {r.operator} {r.threshold}</span>
              {r.lastValue != null && <span className="tabular text-[var(--color-muted)]">当前={r.lastValue}</span>}
              {r.notifyWebhook && <Badge tone="info">webhook</Badge>}
              {!r.enabled && <Badge tone="muted">已禁用</Badge>}
              {r.lastTriggeredAt && <span className="text-[var(--color-warning)]">命中 {timeAgo(r.lastTriggeredAt)}</span>}
              <div className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => onToggle(r)}>
                  <Power className="size-3" /> {r.enabled ? '禁用' : '启用'}
                </Button>
                <Button size="sm" variant="danger" onClick={() => onDelete(r.id)}>
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </GlassCard>
  );
}

export function AlertsPage() {
  const [kind, setKind] = useState('');
  const [severity, setSeverity] = useState<'' | 'info' | 'warn' | 'error' | 'critical'>('');
  const [resolved, setResolved] = useState<ResolvedFilter>('unresolved');
  const [activeRow, setActiveRow] = useState<AlertRow | null>(null);

  const { data: statsData } = useAlertsStats();
  const { data, refetch, isFetching } = useAlerts({
    ...(kind ? { kind } : {}),
    ...(severity ? { severity } : {}),
    ...(resolved === 'unresolved' ? { resolved: 'false' as const } : {}),
    ...(resolved === 'resolved' ? { resolved: 'true' as const } : {}),
    limit: 200,
  });
  const resolveAlert = useResolveAlert();

  const rows = data?.data ?? [];

  const onResolve = (row: AlertRow) => {
    toast.promise(resolveAlert.mutateAsync(row.id), {
      loading: '正在标记解决 …',
      success: '已标记为已解决',
      error: '标记失败',
    });
  };

  return (
    <div>
      <PageHeader
        eyebrow="运维"
        title="告警中心"
        description="聚合上游健康、模型自动黑名单、Provider 余额、VK 用量等告警源。"
        status={isFetching ? '加载中' : '实时'}
        statusTone={isFetching ? 'warning' : 'success'}
        actions={
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} /> 刷新
          </Button>
        }
      />

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-5">
        {/* 统计卡 */}
        <div className="grid gap-3 md:grid-cols-3">
          <GlassCard className="p-4">
            <div className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">未解决告警</div>
            <div className="mt-2 flex items-baseline gap-2">
              <Bell className="size-5 text-[var(--color-warning)]" />
              <span className="tabular text-3xl font-semibold text-[var(--color-warning)]">
                {statsData?.totalUnresolved ?? 0}
              </span>
            </div>
          </GlassCard>
          <GlassCard className="p-4">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-[var(--color-muted)]">按类别 (未解决/全部)</div>
            <div className="flex flex-wrap gap-1.5">
              {(statsData?.byKind ?? []).slice(0, 8).map((k) => (
                <Badge key={k.kind} tone={k.unresolved > 0 ? 'warning' : 'muted'}>
                  {KIND_LABEL[k.kind] ?? k.kind}: {k.unresolved}/{k.total}
                </Badge>
              ))}
              {(!statsData || statsData.byKind.length === 0) && (
                <span className="text-xs text-[var(--color-muted)]">暂无告警记录</span>
              )}
            </div>
          </GlassCard>
          <GlassCard className="p-4">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-[var(--color-muted)]">按严重度 (未解决/全部)</div>
            <div className="flex flex-wrap gap-1.5">
              {(statsData?.bySeverity ?? []).map((s) => (
                <Badge key={s.severity} tone={SEVERITY_TONE[s.severity] ?? 'muted'}>
                  {s.severity}: {s.unresolved}/{s.total}
                </Badge>
              ))}
            </div>
          </GlassCard>
        </div>

        <AlertRulesPanel />

        {/* 筛选 */}
        <GlassCard className="p-4">
          <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--color-muted)]">
            <Filter className="size-3.5" /> 筛选
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <select
              className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-2 text-sm text-[var(--color-ink)]"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="">所有类别</option>
              {(statsData?.byKind ?? []).map((k) => (
                <option key={k.kind} value={k.kind}>
                  {KIND_LABEL[k.kind] ?? k.kind} ({k.total})
                </option>
              ))}
            </select>
            <select
              className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-2 text-sm text-[var(--color-ink)]"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as typeof severity)}
            >
              <option value="">所有严重度</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
              <option value="critical">critical</option>
            </select>
            <select
              className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-2 text-sm text-[var(--color-ink)]"
              value={resolved}
              onChange={(e) => setResolved(e.target.value as ResolvedFilter)}
            >
              <option value="unresolved">未解决</option>
              <option value="resolved">已解决</option>
              <option value="all">全部</option>
            </select>
          </div>
        </GlassCard>

        {/* 列表 */}
        <GlassCard className="overflow-hidden">
          <div className="grid grid-cols-[0.8fr_0.6fr_0.6fr_2.2fr_0.6fr_0.6fr] gap-2 border-b border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/60 px-4 py-2 text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
            <div>时间</div>
            <div>类别</div>
            <div>严重度</div>
            <div>消息</div>
            <div className="text-right">状态</div>
            <div className="text-right">操作</div>
          </div>
          {rows.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-[var(--color-muted)]">
              <CheckCircle2 className="mx-auto mb-3 size-8 text-[var(--color-success)]/40" />
              {isFetching ? '正在加载告警 …' : '当前筛选条件下没有告警 — 一切正常。'}
            </div>
          ) : (
            rows.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[0.8fr_0.6fr_0.6fr_2.2fr_0.6fr_0.6fr] items-center gap-2 border-b border-[var(--color-hairline)]/60 px-4 py-2 text-xs hover:bg-[var(--color-surface-soft)]/40"
              >
                <span className="tabular text-[11px] text-[var(--color-muted)]">
                  {timeAgo(r.createdAt)}
                </span>
                <Badge tone="muted">{KIND_LABEL[r.kind] ?? r.kind}</Badge>
                <Badge tone={SEVERITY_TONE[r.severity] ?? 'muted'}>{r.severity}</Badge>
                <button
                  type="button"
                  onClick={() => setActiveRow(r)}
                  className="truncate text-left text-[var(--color-ink)] hover:text-[var(--color-primary)]"
                >
                  {r.message}
                </button>
                <span className="text-right">
                  {r.resolvedAt ? (
                    <Badge tone="success">已解决</Badge>
                  ) : (
                    <Badge tone="warning">未解决</Badge>
                  )}
                </span>
                <span className="text-right">
                  {!r.resolvedAt && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onResolve(r)}
                      disabled={resolveAlert.isPending}
                    >
                      标记解决
                    </Button>
                  )}
                </span>
              </div>
            ))
          )}
        </GlassCard>

        {data && data.total > rows.length && (
          <div className="text-center text-[11px] text-[var(--color-muted)]">
            已显示 {rows.length} 条 / 总 {data.total} 条
          </div>
        )}
      </div>

      <Dialog open={!!activeRow} onOpenChange={(o) => !o && setActiveRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <span className="inline-flex items-center gap-2">
                <AlertCircle className="size-4 text-[var(--color-warning)]" />
                {activeRow ? KIND_LABEL[activeRow.kind] ?? activeRow.kind : ''}
              </span>
            </DialogTitle>
            <DialogDescription>
              {activeRow ? new Date(activeRow.createdAt).toLocaleString() : ''}
            </DialogDescription>
          </DialogHeader>
          {activeRow && (
            <div className="space-y-3 text-xs">
              <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-2">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                  消息
                </div>
                <div className="text-[var(--color-ink)]">{activeRow.message}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <KvCell k="ID" v={activeRow.id} />
                <KvCell k="严重度" v={activeRow.severity} />
                <KvCell k="上游" v={activeRow.providerSlug ?? '—'} />
                <KvCell k="状态" v={activeRow.resolvedAt ? '已解决' : '未解决'} />
              </div>
              {activeRow.detailsJson && (
                <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-2">
                  <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                    详情
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-[var(--color-ink)]">
                    {tryPrettyJson(activeRow.detailsJson)}
                  </pre>
                </div>
              )}
              {!activeRow.resolvedAt && (
                <div className="flex justify-end">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      onResolve(activeRow);
                      setActiveRow(null);
                    }}
                  >
                    标记解决
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KvCell({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-2">
      <span className="uppercase tracking-wider text-[var(--color-muted)]">{k}</span>
      <span className="break-all text-right font-mono text-[var(--color-ink)]">{v}</span>
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
