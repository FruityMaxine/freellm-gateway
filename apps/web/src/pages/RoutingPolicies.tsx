/**
 * 多路由策略管理页（组 7 Tick 2 v1.20.0.0）。
 *
 * 区别于 RoutingPolicyEditor（单策略权重微调）：本页管理「多个命名策略」的生命周期 ——
 * 列表 + 创建 + 激活切换（单 active，下游 chat-completions 按 active 策略路由）+ 删除 + 跳转编辑。
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Network, Plus, Trash2, CheckCircle2, Circle, SlidersHorizontal, Power } from 'lucide-react';
import { PageHeader } from './_PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { GlassCard } from '@/components/bits/GlassCard';
import {
  useRoutingPolicies,
  useCreateRoutingPolicy,
  useActivateRoutingPolicy,
  useDeleteRoutingPolicy,
  type RoutingPolicyRow,
} from '@/lib/routing-policies-hooks';
import { toast } from 'sonner';

const MODES = [
  'auto-best-free',
  'round-robin-free',
  'weighted-free',
  'openrouter-free-router',
  'prefer-model-fallback',
  'provider-specific',
  'paid-allowed',
] as const;

const MODE_LABELS: Record<string, string> = {
  'auto-best-free': '自动择优 · 免费',
  'round-robin-free': '轮询 · 免费',
  'weighted-free': '加权评分 · 免费',
  'openrouter-free-router': 'OpenRouter 免费路由',
  'prefer-model-fallback': '偏好模型 + 回退',
  'provider-specific': '指定上游',
  'paid-allowed': '允许付费',
};

function weightSummary(weightsJson: string): string {
  try {
    const w = JSON.parse(weightsJson || '{}') as Record<string, number>;
    const top = Object.entries(w)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k} ${v.toFixed(2)}`);
    return top.length ? top.join(' · ') : '默认权重';
  } catch {
    return '默认权重';
  }
}

export function RoutingPoliciesPage() {
  const { data: policies, isLoading } = useRoutingPolicies();
  const createMut = useCreateRoutingPolicy();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<string>('weighted-free');
  const [activate, setActivate] = useState(false);

  const list = policies ?? [];
  const activeCount = list.filter((p) => p.isDefault).length;

  const onCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('请填写策略名称');
      return;
    }
    try {
      await createMut.mutateAsync({ name: trimmed, mode, activate });
      toast.success(`策略「${trimmed}」已创建${activate ? '并激活' : ''}`);
      setName('');
      setActivate(false);
      setShowCreate(false);
    } catch (e) {
      toast.error((e as Error).message ?? '创建失败');
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="路由"
        title="路由策略管理"
        description="管理多个命名路由策略：创建 / 激活切换 / 删除。下游请求始终按当前激活策略路由（单 active 由事务保证）。"
        status={isLoading ? '加载中' : `${list.length} 策略 · ${activeCount} 激活`}
        statusTone={activeCount === 1 ? 'success' : list.length === 0 ? 'muted' : 'warning'}
        actions={
          <Button variant="primary" size="sm" onClick={() => setShowCreate((s) => !s)}>
            <Plus className="size-3.5" /> {showCreate ? '收起' : '新建策略'}
          </Button>
        }
      />

      <div className="mx-auto max-w-5xl space-y-5 px-6 py-6">
        {showCreate && (
          <GlassCard className="space-y-4 p-5">
            <h2 className="text-sm font-semibold text-[var(--color-ink)]">新建命名策略</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-[var(--color-body)]">策略名称</label>
                <Input
                  placeholder="如 low-latency / cost-saver"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--color-body)]">路由模式</label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
                >
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-[var(--color-body)]">
              <input
                type="checkbox"
                checked={activate}
                onChange={(e) => setActivate(e.target.checked)}
                className="size-4 accent-[var(--color-primary)]"
              />
              创建后立即激活（设为下游路由的当前策略）
            </label>
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

        {activeCount !== 1 && list.length > 0 && (
          <GlassCard className="border-[var(--color-warning)]/40 p-3 text-xs text-[var(--color-warning)]">
            注意：当前激活策略数 = {activeCount}（期望 1）。请激活一个策略以保证下游路由有唯一基准。
          </GlassCard>
        )}

        {isLoading ? (
          <GlassCard className="p-8 text-center text-sm text-[var(--color-muted)]">
            正在加载策略列表 …
          </GlassCard>
        ) : list.length === 0 ? (
          <GlassCard className="p-8 text-center text-sm text-[var(--color-muted)]">
            尚无任何路由策略。点击右上「新建策略」创建第一个（首个自动激活）。
          </GlassCard>
        ) : (
          list.map((p) => <PolicyCard key={p.id} policy={p} />)
        )}
      </div>
    </div>
  );
}

function PolicyCard({ policy }: { policy: RoutingPolicyRow }) {
  const navigate = useNavigate();
  const activateMut = useActivateRoutingPolicy();
  const deleteMut = useDeleteRoutingPolicy();

  const onActivate = async () => {
    try {
      await activateMut.mutateAsync(policy.name);
      toast.success(`已激活策略「${policy.name}」`);
    } catch (e) {
      toast.error((e as Error).message ?? '激活失败');
    }
  };

  const onDelete = async () => {
    if (!confirm(`确定删除策略「${policy.name}」？此操作不可撤销。`)) return;
    try {
      const r = await deleteMut.mutateAsync(policy.name);
      toast.success(
        r?.reactivated ? `已删除，自动激活「${r.reactivated}」` : `策略「${policy.name}」已删除`,
      );
    } catch (e) {
      toast.error((e as Error).message ?? '删除失败');
    }
  };

  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className={
              'mt-0.5 grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)] ' +
              (policy.isDefault
                ? 'bg-[var(--color-primary)]/15 text-[var(--color-primary)]'
                : 'bg-[var(--color-surface-soft)] text-[var(--color-muted)]')
            }
          >
            <Network className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-[var(--color-ink)]">{policy.name}</h3>
              {policy.isDefault ? (
                <Badge tone="success">
                  <CheckCircle2 className="size-3" /> 激活中
                </Badge>
              ) : (
                <Badge tone="muted">
                  <Circle className="size-3" /> 待命
                </Badge>
              )}
              {!policy.enabled && <Badge tone="danger">已禁用</Badge>}
            </div>
            {policy.description && (
              <p className="mt-1 text-xs text-[var(--color-muted)]">{policy.description}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-muted)]">
              <span className="text-[var(--color-body)]">{MODE_LABELS[policy.mode] ?? policy.mode}</span>
              <span className="text-[var(--color-hairline-strong)]">·</span>
              <span className="tabular-nums">{weightSummary(policy.weightsJson)}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!policy.isDefault && (
            <Button variant="outline" size="sm" onClick={onActivate} disabled={activateMut.isPending}>
              <Power className="size-3.5" /> 激活
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/routing-policy-editor')}
            title="调权重"
          >
            <SlidersHorizontal className="size-3.5" /> 编辑
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} disabled={deleteMut.isPending} title="删除">
            <Trash2 className="size-4 text-[var(--color-error)]" />
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}
