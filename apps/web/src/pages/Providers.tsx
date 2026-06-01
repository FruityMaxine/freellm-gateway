import { useState } from 'react';
import { AlertCircle, Cable, CheckCircle2, DollarSign, Plus, RefreshCw, XCircle } from 'lucide-react';
import { PageHeader } from './_PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { GlassCard } from '@/components/bits/GlassCard';
import { StatusBadge } from '@/components/data/StatusBadge';
import {
  useProviders,
  useProviderForecast,
  useRefreshModels,
  useProvidersHealth,
  useTriggerProviderHealth,
  useTriggerBalanceCheck,
  useBalanceAlerts,
} from '@/lib/admin-hooks';
import {
  useAdminProviders,
  useCreateProvider,
  useDeleteProvider,
  useRotateProviderKey,
  useUpdateProvider,
} from '@/lib/provider-admin-hooks';
import { PROVIDER_TEMPLATES, type ProviderTemplate } from '@/lib/provider-templates';
import { timeAgo } from '@/lib/utils';
import { toast } from 'sonner';

const KIND_META: Record<string, { color: string; label: string }> = {
  openrouter: { color: 'var(--color-accent-magenta)', label: 'OpenRouter' },
  openai: { color: 'var(--color-accent-emerald)', label: 'OpenAI' },
  anthropic: { color: 'var(--color-accent-amber)', label: 'Anthropic' },
  google: { color: 'var(--color-accent-blue)', label: 'Google' },
  deepseek: { color: 'var(--color-accent-violet)', label: 'DeepSeek' },
  mock: { color: 'var(--color-primary)', label: 'Mock' },
};

export function ProvidersStub() {
  const { data, isLoading } = useProviders();
  const { data: healthData } = useProvidersHealth();
  const triggerHealth = useTriggerProviderHealth();
  const refresh = useRefreshModels();
  const [open, setOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  const list = data?.providers ?? [];
  const active = list.find((p) => p.slug === activeSlug) ?? null;
  const healthBySlug = new Map((healthData?.data ?? []).map((h) => [h.slug, h]));
  // Tick 37 v1.7.9.0：余额预警 cron + 手动触发
  const triggerBalanceCheck = useTriggerBalanceCheck();
  const { data: balanceAlerts } = useBalanceAlerts();

  return (
    <div>
      <PageHeader
        eyebrow="上游"
        title="上游服务"
        description="为模型池提供算力的上游服务。可配置 baseUrl、密钥引用、健康检查及冷却恢复。"
        status={isLoading ? '加载中' : '实时'}
        statusTone={isLoading ? 'warning' : 'success'}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                toast.promise(triggerBalanceCheck.mutateAsync(), {
                  loading: '正在检查所有上游余额 …',
                  success: (r) =>
                    r.alerted > 0
                      ? `检查完成：${r.alerted}/${r.total} 个上游低余额`
                      : `检查完成：${r.total} 个上游均正常`,
                  error: '余额检查失败',
                })
              }
              disabled={triggerBalanceCheck.isPending}
            >
              <DollarSign className="size-3.5" /> 检查余额
            </Button>
            <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>
              <Plus className="size-3.5" /> 添加上游
            </Button>
          </>
        }
      />

      {/* Tick 37 v1.7.9.0：余额预警历史区，仅当 ≥1 条 balance_low 时显示 */}
      {balanceAlerts && balanceAlerts.data.length > 0 && (
        <div className="mx-auto max-w-7xl px-6 pt-4">
          <GlassCard className="border-[var(--color-warning)]/40 bg-[var(--color-warning)]/5 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--color-warning)]">
              <AlertCircle className="size-4" /> 余额预警（{balanceAlerts.data.length}）
            </div>
            <div className="max-h-48 space-y-1.5 overflow-auto text-xs">
              {balanceAlerts.data.slice(0, 10).map((a, i) => (
                <div key={i} className="flex items-start justify-between gap-2 rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)]/60 px-3 py-1.5">
                  <span className="flex-1 break-words text-[var(--color-ink)]">{a.message}</span>
                  <span className="shrink-0 tabular text-[10px] text-[var(--color-muted)]">{timeAgo(a.createdAt)}</span>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      )}

      {/* Tick 54 v1.7.26.0：完整 CRUD 卡 (在原"概览卡"上面) */}
      <div className="mx-auto max-w-7xl px-6 pt-4">
        <AdminProvidersAdvancedCard />
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {list.map((p) => {
          const meta = KIND_META[p.slug] ?? { color: 'var(--color-muted)', label: p.slug };
          return (
            <GlassCard key={p.slug} onClick={() => { setActiveSlug(p.slug); setOpen(true); }} className="cursor-pointer p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-[var(--radius-md)] text-[var(--color-canvas)]" style={{ background: meta.color }}><Cable className="size-5" /></span>
                  <div>
                    <div className="font-semibold text-[var(--color-ink)]">{meta.label}</div>
                    <div className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">{p.slug}</div>
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/70 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">最近同步</div>
                  <div className="mt-1 text-[var(--color-ink)]">{timeAgo(p.lastSyncAt)}</div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/70 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">24 小时错误</div>
                  <div className="mt-1 text-[var(--color-ink)] tabular">{p.errorCount24h}</div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/70 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">优先级</div>
                  <div className="mt-1 text-[var(--color-ink)] tabular">{p.priority}</div>
                </div>
              </div>

              {/* Tick 31 v1.7.3.0：健康检查徽章 + lastHealthAt 时间提示 */}
              {(() => {
                const h = healthBySlug.get(p.slug);
                if (!h?.lastHealthAt) return null;
                const ok = h.status === 'active';
                return (
                  <div className="mt-4 flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/60 px-3 py-2 text-[11px]">
                    <div className="flex items-center gap-2">
                      {ok ? (
                        <CheckCircle2 className="size-3.5 text-[var(--color-success)]" />
                      ) : (
                        <XCircle className="size-3.5 text-[var(--color-warning)]" />
                      )}
                      <span className={ok ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'}>
                        {ok ? '健康' : h.lastErrorMessage ?? '异常'}
                      </span>
                    </div>
                    <span className="text-[var(--color-muted)]">
                      检查于 {timeAgo(h.lastHealthAt)}
                    </span>
                  </div>
                );
              })()}

              <div className="mt-4 flex items-center gap-2">
                <Button variant="subtle" size="sm" onClick={(e) => {
                    e.stopPropagation();
                    toast.promise(refresh.mutateAsync(p.slug), {
                      loading: `正在刷新 ${p.slug} …`,
                      success: (d) => `已刷新：发现 ${d.reports?.[0]?.discovered ?? 0} 个模型`,
                      error: '刷新失败',
                    });
                  }} disabled={refresh.isPending}>
                  <RefreshCw className="size-3.5" /> 刷新
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    toast.promise(triggerHealth.mutateAsync(p.slug), {
                      loading: `正在检查 ${p.slug} …`,
                      success: (r) =>
                        r.ok
                          ? `健康检查通过（${r.latencyMs ?? '?'} ms）`
                          : `健康检查失败：${r.message ?? r.errorKind ?? '未知'}`,
                      error: '触发健康检查失败',
                    });
                  }}
                  disabled={triggerHealth.isPending}
                >
                  {p.status === 'active' ? (
                    <CheckCircle2 className="size-3.5 text-[var(--color-success)]" />
                  ) : (
                    <XCircle className="size-3.5 text-[var(--color-warning)]" />
                  )}
                  连接测试
                </Button>
              </div>
            </GlassCard>
          );
        })}

        {!list.length && (
          <GlassCard className="p-8 text-center text-sm text-[var(--color-muted)]">
            {isLoading ? '正在加载上游 …' : '尚未配置任何上游。'}
          </GlassCard>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{active?.name ?? '—'}</DialogTitle>
            <DialogDescription>配置快照 · 余额预测 · 内联编辑与连接测试将于后续版本上线。</DialogDescription>
          </DialogHeader>
          {active && (
            <div className="space-y-3 text-xs">
              {[
                ['标识', active.slug],
                ['类型', active.kind],
                ['状态', active.status],
                ['优先级', String(active.priority)],
                ['最近同步', timeAgo(active.lastSyncAt)],
                ['最近错误', active.lastErrorMessage ?? '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-2">
                  <span className="uppercase tracking-wider text-[var(--color-muted)]">{k}</span>
                  <span className="font-mono text-[var(--color-ink)]">{v}</span>
                </div>
              ))}
              <ProviderForecastCard slug={active.slug} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AddProviderDialog open={showAdd} onClose={() => setShowAdd(false)} />
    </div>
  );
}

function ProviderForecastCard({ slug }: { slug: string }) {
  const { data, isLoading, isError } = useProviderForecast(slug);
  if (isLoading) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-3 text-center text-[var(--color-muted)]">
        正在加载余额预测 …
      </div>
    );
  }
  if (isError || !data) {
    return null;
  }
  const lowBalance =
    data.estimatedDaysRemaining !== null && data.estimatedDaysRemaining < data.alertThresholdDays;
  return (
    <div
      className={`mt-2 rounded-[var(--radius-md)] border px-3 py-3 ${
        lowBalance
          ? 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10'
          : 'border-[var(--color-hairline)] bg-[var(--color-surface-soft)]'
      }`}
    >
      <div className="mb-2 text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
        余额预测
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">剩余</div>
          <div className="mt-1 text-[var(--color-ink)] tabular">
            {data.balanceRemaining === null ? '不支持' : `$${data.balanceRemaining}`}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">日消耗</div>
          <div className="mt-1 text-[var(--color-ink)] tabular">
            {data.burnRateTokensPerDay.toLocaleString()} tok
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">预估剩余</div>
          <div
            className={`mt-1 tabular ${lowBalance ? 'text-[var(--color-warning)]' : 'text-[var(--color-ink)]'}`}
          >
            {data.estimatedDaysRemaining === null ? '—' : `${data.estimatedDaysRemaining} 天`}
          </div>
        </div>
      </div>
      {lowBalance && (
        <div className="mt-2 text-[11px] text-[var(--color-warning)]">
          ⚠️ 预估剩余 &lt; {data.alertThresholdDays} 天，建议及时充值。
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Tick 54 v1.7.26.0：添加上游服务对话框 — 真功能, 10 预置模板
// =============================================================================
function AddProviderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tplId, setTplId] = useState<string>('openrouter');
  const [slug, setSlug] = useState('openrouter');
  const [name, setName] = useState('OpenRouter');
  const [baseUrl, setBaseUrl] = useState('https://openrouter.ai/api/v1');
  const [apiKey, setApiKey] = useState('');
  const [priority, setPriority] = useState(100);
  const create = useCreateProvider();

  const tpl: ProviderTemplate | undefined = PROVIDER_TEMPLATES.find((t) => t.id === tplId);

  function applyTemplate(t: ProviderTemplate) {
    setTplId(t.id);
    setSlug(t.defaultSlug);
    setName(t.name);
    setBaseUrl(t.baseUrl);
  }

  async function onSubmit() {
    if (!slug || !name || !baseUrl) {
      toast.error('请填完 标识 / 名称 / baseUrl');
      return;
    }
    if (!tpl) {
      toast.error('请选择厂商');
      return;
    }
    try {
      await create.mutateAsync({
        slug,
        kind: tpl.kind,
        name,
        baseUrl,
        compatibleMode: tpl.compatibleMode,
        priority,
        ...(apiKey ? { apiKey } : {}),
      });
      toast.success(`已添加上游 ${name}${apiKey ? ' (含 API Key)' : ' (空 Key, 之后可在卡片填)'}`);
      onClose();
      setApiKey('');
    } catch (e) {
      toast.error('创建失败: ' + (e as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加上游服务</DialogTitle>
          <DialogDescription>
            选预置厂商 (baseUrl 自动填) 或自定义 OpenAI 兼容 endpoint。仅 API Key 在你这填。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {/* 预置模板下拉 */}
          <div>
            <label className="mb-1.5 block text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
              厂商模板
            </label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {PROVIDER_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  className={`rounded-[var(--radius-md)] border px-2.5 py-2 text-left text-[11px] ${
                    tplId === t.id
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-ink)]'
                      : 'border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-body)] hover:border-[var(--color-primary)]/40'
                  }`}
                >
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-[10px] text-[var(--color-muted)]">
                    {t.free ? '含免费层' : '付费'} · {t.compatibleMode}
                  </div>
                </button>
              ))}
            </div>
            {tpl?.notes && (
              <div className="mt-1.5 text-[10px] text-[var(--color-muted)]">{tpl.notes}</div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--color-muted)]">标识 (slug)</label>
              <Input value={slug} onChange={(e) => setSlug(e.currentTarget.value.toLowerCase())} placeholder="openrouter" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--color-muted)]">显示名</label>
              <Input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="OpenRouter" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--color-muted)]">baseUrl</label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.currentTarget.value)} placeholder="https://..." />
          </div>

          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
              API Key (可选 · 留空后续在卡片填)
            </label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.currentTarget.value)}
              placeholder={tpl?.keyHint ?? 'sk-...'}
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
              路由优先级 (越高越先选, 默认 100)
            </label>
            <Input
              type="number"
              min={0}
              max={1000}
              value={priority}
              onChange={(e) => setPriority(Number(e.currentTarget.value) || 0)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
              取消
            </Button>
            <Button variant="primary" onClick={onSubmit} disabled={create.isPending}>
              {create.isPending ? '创建中…' : '确认添加'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Tick 54 v1.7.26.0：管理员 Provider 列表 — 含 enable/disable + 改 key + 删除
// =============================================================================
export function AdminProvidersAdvancedCard() {
  const { data, isLoading } = useAdminProviders();
  const upd = useUpdateProvider();
  const del = useDeleteProvider();
  const rotate = useRotateProviderKey();
  const [editKeyFor, setEditKeyFor] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');

  if (isLoading || !data) return null;

  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-center justify-between border-b border-[var(--color-hairline)] pb-3">
        <div>
          <div className="font-semibold text-[var(--color-ink)]">完整管理 (CRUD)</div>
          <div className="text-[11px] text-[var(--color-muted)]">
            启用 / 禁用 · 换 API Key · 删除上游 (会从 registry 摘掉)
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        {data.data.map((p) => (
          <div
            key={p.slug}
            className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[var(--color-ink)]">{p.name}</span>
                  <span className="font-mono text-[10px] text-[var(--color-muted)]">{p.slug}</span>
                  {p.enabled ? null : (
                    <span className="rounded-[var(--radius-sm)] bg-[var(--color-muted)]/20 px-1.5 py-0.5 text-[10px] text-[var(--color-muted)]">
                      已禁用
                    </span>
                  )}
                  {p.registered ? (
                    <span className="rounded-[var(--radius-sm)] bg-[var(--color-success)]/15 px-1.5 py-0.5 text-[10px] text-[var(--color-success)]">
                      registry
                    </span>
                  ) : (
                    <span className="rounded-[var(--radius-sm)] bg-[var(--color-warning)]/15 px-1.5 py-0.5 text-[10px] text-[var(--color-warning)]">
                      未注册
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--color-muted)]">
                  {p.kind} · {p.baseUrl} · key: {p.keyDigest ?? '(无)'}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditKeyFor(editKeyFor === p.slug ? null : p.slug);
                    setNewKey('');
                  }}
                >
                  换 Key
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    upd
                      .mutateAsync({ slug: p.slug, patch: { enabled: !p.enabled } })
                      .then(() => toast.success(`已${p.enabled ? '禁用' : '启用'} ${p.name}`))
                      .catch((e) => toast.error('失败: ' + (e as Error).message))
                  }
                >
                  {p.enabled ? '禁用' : '启用'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (!confirm(`删除上游 ${p.name}? 关联 API Key 与 cooldown 也会清除。`)) return;
                    del
                      .mutateAsync(p.slug)
                      .then(() => toast.success('已删除'))
                      .catch((e) => toast.error('删除失败: ' + (e as Error).message));
                  }}
                >
                  删除
                </Button>
              </div>
            </div>
            {editKeyFor === p.slug && (
              <div className="mt-2 flex gap-2">
                <Input
                  type="password"
                  placeholder="新 API Key"
                  value={newKey}
                  onChange={(e) => setNewKey(e.currentTarget.value)}
                  className="flex-1"
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    if (!newKey) {
                      toast.error('密钥不能为空');
                      return;
                    }
                    rotate
                      .mutateAsync({ slug: p.slug, apiKey: newKey })
                      .then(() => {
                        toast.success('Key 已更新 + registry 已重装');
                        setEditKeyFor(null);
                        setNewKey('');
                      })
                      .catch((e) => toast.error('失败: ' + (e as Error).message));
                  }}
                >
                  确认
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
