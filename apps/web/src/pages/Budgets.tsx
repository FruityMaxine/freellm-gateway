/**
 * 成本预算管理页（组 7 Tick 5 v1.23.0.0）。
 *
 * 按 global/vk/model 范围设周期成本上限，实时聚合 RequestLog.estimatedCostUsd 显示已用进度，
 * 超 80% 警示色。预算使用率最高值接入 alert-rule（budget_max_usage_pct）触发告警 + webhook。
 */
import { useState } from 'react';
import { Wallet, Plus, Trash2, Power } from 'lucide-react';
import { PageHeader } from './_PageHeader';
import { GlassCard } from '@/components/bits/GlassCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  useBudgets,
  useCreateBudget,
  useUpdateBudget,
  useDeleteBudget,
  type BudgetRow,
} from '@/lib/budgets-hooks';
import { toast } from 'sonner';

const SCOPE_LABELS: Record<string, string> = { global: '全局', vk: '虚拟密钥', model: '模型' };
const PERIOD_LABELS: Record<string, string> = { day: '日', week: '周', month: '月' };
const SCOPES = ['global', 'vk', 'model'] as const;
const PERIODS = ['day', 'week', 'month'] as const;

const fmtUsd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;

export function BudgetsPage() {
  const { data, isLoading } = useBudgets();
  const createMut = useCreateBudget();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<string>('global');
  const [targetId, setTargetId] = useState('');
  const [limitUsd, setLimitUsd] = useState('10');
  const [period, setPeriod] = useState<string>('month');

  const budgets = data?.budgets ?? [];

  const onCreate = async () => {
    const n = name.trim();
    const lim = Number(limitUsd);
    if (!n) return toast.error('请填写预算名称');
    if (!Number.isFinite(lim) || lim <= 0) return toast.error('上限金额需为正数');
    if (scope !== 'global' && !targetId.trim()) return toast.error(`scope=${scope} 需填写目标 ID`);
    try {
      await createMut.mutateAsync({
        name: n,
        scope,
        targetId: scope === 'global' ? undefined : targetId.trim(),
        limitUsd: lim,
        period,
      });
      toast.success(`预算「${n}」已创建`);
      setName('');
      setTargetId('');
      setShowCreate(false);
    } catch (e) {
      toast.error((e as Error).message ?? '创建失败');
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="成本"
        title="成本预算"
        description="按全局 / 虚拟密钥 / 模型设周期成本上限，实时聚合已用额度，超阈接入告警中心 + Webhook 通知。"
        status={isLoading ? '加载中' : `${budgets.length} 预算`}
        statusTone={isLoading ? 'warning' : 'success'}
        actions={
          <Button variant="primary" size="sm" onClick={() => setShowCreate((s) => !s)}>
            <Plus className="size-3.5" /> {showCreate ? '收起' : '新建预算'}
          </Button>
        }
      />

      <div className="mx-auto max-w-4xl space-y-5 px-6 py-6">
        {showCreate && (
          <GlassCard className="space-y-4 p-5">
            <h2 className="text-sm font-semibold text-[var(--color-ink)]">新建预算</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-[var(--color-body)]">名称</label>
                <Input placeholder="如 月度总预算" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--color-body)]">上限 (USD)</label>
                <Input type="number" min="0" step="0.01" value={limitUsd} onChange={(e) => setLimitUsd(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--color-body)]">范围</label>
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
                >
                  {SCOPES.map((s) => (
                    <option key={s} value={s}>
                      {SCOPE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--color-body)]">周期</label>
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
                >
                  {PERIODS.map((p) => (
                    <option key={p} value={p}>
                      每{PERIOD_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>
              {scope !== 'global' && (
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-[var(--color-body)]">
                    目标 ID（{scope === 'vk' ? 'virtualKeyId' : 'upstreamModel'}）
                  </label>
                  <Input
                    placeholder={scope === 'vk' ? 'vk_xxx' : 'openrouter/...'}
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={onCreate} disabled={createMut.isPending}>
                <Plus className="size-3.5" /> {createMut.isPending ? '创建中…' : '创建'}
              </Button>
              <Button variant="subtle" size="sm" onClick={() => setShowCreate(false)}>
                取消
              </Button>
            </div>
          </GlassCard>
        )}

        {isLoading ? (
          <GlassCard className="p-8 text-center text-sm text-[var(--color-muted)]">正在加载预算 …</GlassCard>
        ) : budgets.length === 0 ? (
          <GlassCard className="p-8 text-center text-sm text-[var(--color-muted)]">
            尚无预算。点击右上「新建预算」设置第一个成本上限。
          </GlassCard>
        ) : (
          budgets.map((b) => <BudgetCard key={b.id} b={b} />)
        )}
      </div>
    </div>
  );
}

function BudgetCard({ b }: { b: BudgetRow }) {
  const updateMut = useUpdateBudget();
  const deleteMut = useDeleteBudget();

  const tone = b.pct >= 100 ? 'danger' : b.pct >= 80 ? 'warning' : 'primary';
  const barColor =
    b.pct >= 100
      ? 'var(--color-error)'
      : b.pct >= 80
        ? 'var(--color-warning)'
        : 'var(--color-primary)';

  const onToggle = async () => {
    try {
      await updateMut.mutateAsync({ id: b.id, patch: { enabled: !b.enabled } });
      toast.success(`已${b.enabled ? '停用' : '启用'}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onDelete = async () => {
    if (!confirm(`确定删除预算「${b.name}」？`)) return;
    try {
      await deleteMut.mutateAsync(b.id);
      toast.success('预算已删除');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <GlassCard className={'p-5 ' + (!b.enabled ? 'opacity-60' : '')}>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
            <Wallet className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-[var(--color-ink)]">{b.name}</h3>
              <Badge tone="muted">{SCOPE_LABELS[b.scope] ?? b.scope}</Badge>
              <Badge tone="muted">每{PERIOD_LABELS[b.period] ?? b.period}</Badge>
              {!b.enabled && <Badge tone="danger">已停用</Badge>}
            </div>
            {b.targetId && (
              <div className="mt-1 truncate text-[11px] text-[var(--color-muted)]" title={b.targetId}>
                {b.targetId}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={onToggle} disabled={updateMut.isPending}>
            <Power className="size-3.5" /> {b.enabled ? '停用' : '启用'}
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} disabled={deleteMut.isPending} title="删除">
            <Trash2 className="size-4 text-[var(--color-error)]" />
          </Button>
        </div>
      </div>

      {/* 进度条 */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between text-xs">
          <span className="tabular-nums text-[var(--color-body)]">
            {fmtUsd(b.spent)} / {fmtUsd(b.limit)}
          </span>
          <Badge tone={tone}>{b.pct.toFixed(1)}%</Badge>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-soft)]">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${Math.min(100, b.pct)}%`, background: barColor }}
          />
        </div>
        <div className="text-right text-[10px] tabular-nums text-[var(--color-muted)]">
          剩余 {fmtUsd(b.remaining)}
        </div>
      </div>
    </GlassCard>
  );
}
