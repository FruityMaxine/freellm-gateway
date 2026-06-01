import { useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  RefreshCcw,
  Trash2,
} from 'lucide-react';
import { motion } from 'framer-motion';
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
  useCreateKey,
  useProjects,
  useRevokeKey,
  useRotateKey,
  useVirtualKeys,
  useVirtualKeyCost,
  useVirtualKeysCosts,
  useVirtualKeyMonthlyReport,
  useVkUsageSnapshot,
  useVkUsageAlerts,
  useTriggerVkUsageCheck,
  useVkWeeklyReportPreview,
  useForceSendWeeklyReport,
  useVkSpendLeaderboard,
  type CreateKeyInput,
  type VirtualKeyRow,
  type VkSpendScope,
  type VkSpendLeaderboardRow,
} from '@/lib/lab-keys-logs-hooks';
import { timeAgo } from '@/lib/utils';
import { toast } from 'sonner';

interface RevealState {
  secret: string;
  label: string;
  environment: 'live' | 'test';
}

export function VirtualKeysStub() {
  const { data, isLoading } = useVirtualKeys();
  // Tick 33 v1.7.5.0：每个 VK 近 7 天累计 cost 一次性拉
  const { data: costsData } = useVirtualKeysCosts(7);
  // Tick 39 v1.7.11.0：用量预警历史 + 手动触发
  const { data: alertsData } = useVkUsageAlerts();
  const triggerCheck = useTriggerVkUsageCheck();
  // Tick 41 v1.7.13.0：周报预览 + 强制发送
  const { data: weeklyData } = useVkWeeklyReportPreview();
  const sendWeekly = useForceSendWeeklyReport();
  const [showWeekly, setShowWeekly] = useState(false);
  const create = useCreateKey();
  const rotate = useRotateKey();
  const revoke = useRevokeKey();

  const costByVk = new Map((costsData?.data ?? []).map((c) => [c.virtualKeyId, c]));

  const [showCreate, setShowCreate] = useState(false);
  const [reveal, setReveal] = useState<RevealState | null>(null);
  const [unhide, setUnhide] = useState(false);
  const [active, setActive] = useState<VirtualKeyRow | null>(null);

  const keys = data?.data ?? [];

  const onCreate = async (input: CreateKeyInput) => {
    try {
      const r = await create.mutateAsync(input);
      setReveal({ secret: r.key.secret, label: r.key.label, environment: r.key.environment });
      setShowCreate(false);
      setUnhide(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="下游鉴权"
        title="虚拟密钥"
        description="fllm_live_* / fllm_test_* 密钥 · 权限矩阵 / RPM / 日额 / 轮换 / 吊销。"
        status={isLoading ? '加载中' : '实时'}
        statusTone={isLoading ? 'warning' : 'success'}
        actions={
          <>
            {/* Tick 39 v1.7.11.0：手动触发用量预警扫描 */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                toast.promise(triggerCheck.mutateAsync(), {
                  loading: '正在扫描所有密钥用量 …',
                  success: (r) =>
                    r.alertedVks.length > 0
                      ? `扫描完成：${r.alertedVks.length}/${r.scanned} 个密钥接近限额`
                      : `扫描完成：${r.scanned} 个密钥用量正常`,
                  error: '扫描失败',
                })
              }
              disabled={triggerCheck.isPending}
            >
              扫描预警
            </Button>
            {/* Tick 41 v1.7.13.0：周报预览 / 强制发送 */}
            <Button variant="ghost" size="sm" onClick={() => setShowWeekly(true)}>
              查看周报
            </Button>
            <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="size-3.5" /> 签发密钥
            </Button>
          </>
        }
      />

      {/* Tick 39 v1.7.11.0：用量预警 GlassCard，仅当 ≥1 条 alert 时显示 */}
      {alertsData && alertsData.data.length > 0 && (
        <div className="mx-auto max-w-7xl px-6 pt-4">
          <GlassCard className="border-[var(--color-warning)]/40 bg-[var(--color-warning)]/5 p-4">
            <div className="mb-2 text-sm font-medium text-[var(--color-warning)]">
              密钥用量预警（{alertsData.data.length}）
            </div>
            <div className="max-h-40 space-y-1.5 overflow-auto text-xs">
              {alertsData.data.slice(0, 10).map((a, i) => (
                <div key={i} className="flex items-start justify-between gap-2 rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)]/60 px-3 py-1.5">
                  <span className="flex-1 break-words text-[var(--color-ink)]">{a.message}</span>
                  <span className="shrink-0 tabular text-[10px] text-[var(--color-muted)]">{timeAgo(a.createdAt)}</span>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      )}

      {/* Tick 51 v1.7.23.0：VK Spend Top-N 排行卡片 */}
      <div className="mx-auto max-w-7xl px-6 pt-4">
        <VKSpendLeaderboardCard />
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {keys.map((k) => (
          <GlassCard key={k.id} className="cursor-pointer p-5" onClick={() => setActive(k)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-[var(--color-ink)]">
                <KeyRound className="size-4 text-[var(--color-primary)]" /> {k.label}
              </div>
              <Badge tone={k.enabled ? (k.environment === 'live' ? 'success' : 'info') : 'muted'}>
                {k.enabled ? (k.environment === 'live' ? '生产' : '测试') : '已吊销'}
              </Badge>
            </div>
            <div className="mt-3 truncate font-mono text-xs text-[var(--color-muted)]">{k.prefix}</div>
            <div className="mt-2 inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
              项目 · {k.projectId ?? '未分配'}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-1.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
              <span>RPM {k.permissions.maxRequestsPerMinute ?? '∞'}</span>
              <span>日 {k.permissions.maxRequestsPerDay ?? '∞'}</span>
              <span>{k.permissions.allowStreaming ? '流式' : '同步'}</span>
            </div>
            <div className="mt-4 flex items-center justify-between text-[11px] text-[var(--color-muted)]">
              <span>已用 {k.totalRequests} 次</span>
              <span>{k.lastUsedAt ? timeAgo(k.lastUsedAt) : '未使用'}</span>
            </div>
            {/* Tick 33 v1.7.5.0：7 天成本徽章 */}
            {(() => {
              const c = costByVk.get(k.id);
              if (!c || c.costUsd <= 0) return null;
              return (
                <div className="mt-2 flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-2.5 py-1.5 text-[10px]">
                  <span className="uppercase tracking-wider text-[var(--color-muted)]">7d 成本</span>
                  <span className="tabular text-[var(--color-warning)]">{formatCostUsdInline(c.costUsd)}</span>
                </div>
              );
            })()}
          </GlassCard>
        ))}

        {!isLoading && keys.length === 0 && (
          <GlassCard className="md:col-span-2 lg:col-span-3 p-8 text-center text-sm text-[var(--color-muted)]">
            尚未签发任何密钥。点击 <span className="text-[var(--color-primary)]">签发密钥</span> 创建第一个。
          </GlassCard>
        )}
      </div>

      {/* === Create modal === */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>签发虚拟密钥</DialogTitle>
            <DialogDescription>
              明文 secret 创建后仅显示一次，请立刻复制到密码管理器或 .env 中。
            </DialogDescription>
          </DialogHeader>
          <CreateForm onSubmit={onCreate} pending={create.isPending} />
        </DialogContent>
      </Dialog>

      {/* === One-time secret reveal === */}
      <Dialog open={!!reveal} onOpenChange={(o) => !o && setReveal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <span className="inline-flex items-center gap-2">
                <KeyRound className="size-4 text-[var(--color-primary)]" /> 立即保存此密钥
              </span>
            </DialogTitle>
            <DialogDescription>
              <strong className="text-[var(--color-warning)]">关闭后将无法再次查看。</strong>{' '}
              请立即复制到密码管理器或项目 .env 中。
            </DialogDescription>
          </DialogHeader>
          {reveal && (
            <div>
              <div className="mb-3 text-xs uppercase tracking-wider text-[var(--color-muted)]">
                {reveal.label} · {reveal.environment}
              </div>
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative rounded-[var(--radius-md)] border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 px-4 py-3 font-mono text-[12px]"
              >
                <span className="text-[var(--color-ink)]">
                  {unhide ? reveal.secret : `${reveal.secret.slice(0, 14)}${'•'.repeat(24)}${reveal.secret.slice(-6)}`}
                </span>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <Button size="icon" variant="ghost" onClick={() => setUnhide((u) => !u)}>
                    {unhide ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={async () => {
                      await navigator.clipboard.writeText(reveal.secret);
                      toast.success('已复制到剪贴板');
                    }}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
              </motion.div>
              <div className="mt-3 text-[11px] text-[var(--color-muted)]">
                服务端仅存储 <code className="font-mono">sha256(secret)</code> 哈希；明文不会落库或离开本弹窗。
              </div>
              <div className="mt-4 flex justify-end">
                <Button variant="primary" onClick={() => setReveal(null)}>
                  <Check className="size-3.5" /> 已保存
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Tick 41 v1.7.13.0：周报预览对话框 */}
      <Dialog open={showWeekly} onOpenChange={setShowWeekly}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>VK 用量周报</DialogTitle>
            <DialogDescription>
              {weeklyData?.lastSentAt
                ? `上次推送：${timeAgo(weeklyData.lastSentAt)}`
                : '尚未推送过周报'}
            </DialogDescription>
          </DialogHeader>
          {weeklyData?.report ? (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['请求', String(weeklyData.report.totals.requests)],
                  ['成本', `$${weeklyData.report.totals.costUsd.toFixed(2)}`],
                  ['Token', weeklyData.report.totals.totalTokens.toLocaleString()],
                  ['活跃 VK', String(weeklyData.report.totals.activeVks)],
                  ['告警 VK', String(weeklyData.report.totals.alertedVks)],
                  ['成功率', weeklyData.report.totals.requests === 0
                    ? '—'
                    : `${((weeklyData.report.totals.successful / weeklyData.report.totals.requests) * 100).toFixed(1)}%`,
                  ],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-2"
                  >
                    <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">{k}</div>
                    <div className="mt-1 tabular text-[var(--color-ink)]">{v}</div>
                  </div>
                ))}
              </div>
              {weeklyData.report.topVks.length > 0 && (
                <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-2">
                  <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                    Top 5 用量 VK
                  </div>
                  {weeklyData.report.topVks.map((v) => (
                    <div key={v.virtualKeyId} className="flex items-center justify-between text-[11px]">
                      <span className="truncate font-mono text-[var(--color-body-strong)]">{v.label}</span>
                      <span className="tabular text-[var(--color-warning)]">
                        ${v.costUsd.toFixed(3)} / {v.requests} 请求
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setShowWeekly(false)}>
                  关闭
                </Button>
                <Button
                  variant="primary"
                  onClick={() =>
                    toast.promise(sendWeekly.mutateAsync(), {
                      loading: '正在发送 …',
                      success: '已发送周报（emit webhook + 更新 lastSentAt）',
                      error: '发送失败',
                    })
                  }
                  disabled={sendWeekly.isPending}
                >
                  强制发送
                </Button>
              </div>
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-[var(--color-muted)]">
              正在加载周报 …
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* === Detail drawer === */}
      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{active?.label}</DialogTitle>
            <DialogDescription>{active?.prefix}</DialogDescription>
          </DialogHeader>
          {active && (
            <div className="space-y-3">
              {/* Tick 33 v1.7.5.0：成本卡片（按 active.id 拉 7 天/30 天数据） */}
              <VirtualKeyCostBlock vkId={active.id} />
              {/* Tick 39 v1.7.11.0：今日用量进度条 + 预警 */}
              <VirtualKeyUsageBlock vkId={active.id} />
              {/* Tick 38 v1.7.10.0：月度报告区 */}
              <VirtualKeyMonthlyReportBlock vkId={active.id} />
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  ['环境', active.environment === 'live' ? '生产' : '测试'],
                  ['状态', active.enabled ? '已启用' : '已吊销'],
                  ['RPM', String(active.permissions.maxRequestsPerMinute ?? '∞')],
                  ['日请求', String(active.permissions.maxRequestsPerDay ?? '∞')],
                  ['日 Token', String(active.permissions.maxTokensPerDay ?? '∞')],
                  ['日 USD', active.permissions.maxCostUsdPerDay != null ? `$${active.permissions.maxCostUsdPerDay}` : '∞'],
                  ['付费模型', active.permissions.allowPaidModels ? '允许' : '禁止'],
                  ['流式', active.permissions.allowStreaming ? '开启' : '关闭'],
                  ['思考强度', active.permissions.reasoningEffort ?? 'none'],
                  ['允许 reasoning', active.permissions.allowReasoning === false ? '禁止' : '允许'],
                  ['创建于', timeAgo(active.createdAt)],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-2"
                  >
                    <span className="uppercase tracking-wider text-[var(--color-muted)]">{k}</span>
                    <span className="font-mono text-[var(--color-ink)]">{v}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={async () => {
                    const r = await rotate.mutateAsync(active.id);
                    setActive(null);
                    setReveal({
                      secret: r.key.secret,
                      label: r.key.label,
                      environment: r.key.environment,
                    });
                  }}
                  disabled={rotate.isPending}
                >
                  <RefreshCcw className="size-3.5" /> 轮换密钥
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={async () => {
                    if (!confirm(`确定吊销 ${active.label}？下游请求将立即开始返回 401。`)) return;
                    await revoke.mutateAsync(active.id);
                    toast.success('密钥已吊销');
                    setActive(null);
                  }}
                  disabled={revoke.isPending}
                >
                  <Trash2 className="size-3.5" /> 吊销
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateForm({
  onSubmit,
  pending,
}: {
  onSubmit: (input: CreateKeyInput) => void;
  pending: boolean;
}) {
  const [label, setLabel] = useState('');
  const [env, setEnv] = useState<'live' | 'test'>('test');
  const [rpm, setRpm] = useState<number | ''>(60);
  const [dailyReq, setDailyReq] = useState<number | ''>(5000);
  const [dailyTok, setDailyTok] = useState<number | ''>('');
  const [dailyCost, setDailyCost] = useState<number | ''>('');
  const [allowPaid, setAllowPaid] = useState(false);
  const [allowStream, setAllowStream] = useState(true);
  // Tick 56 v1.7.28.0：思考强度 + 允许 reasoning
  const [reasoning, setReasoning] = useState<'none' | 'low' | 'medium' | 'high'>('none');
  const [allowReasoning, setAllowReasoning] = useState(true);
  const [projectId, setProjectId] = useState<string>('');
  const projects = useProjects();

  const disabled = !label.trim() || pending;

  return (
    <div className="space-y-3">
      <Input placeholder="标签名（例如 project-foo）" value={label} onChange={(e) => setLabel(e.currentTarget.value)} />
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-[var(--color-muted)]">
          环境
          <div className="mt-1 inline-flex w-full rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] p-1">
            {(['test', 'live'] as const).map((e) => (
              <button
                key={e}
                onClick={() => setEnv(e)}
                className={`flex-1 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs ${
                  env === e
                    ? 'bg-[var(--color-surface-card)] text-[var(--color-ink)]'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {e === 'test' ? '测试' : '生产'}
              </button>
            ))}
          </div>
        </label>
        <label className="text-xs text-[var(--color-muted)]">
          流式传输
          <div className="mt-1 inline-flex w-full rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] p-1">
            {[true, false].map((b) => (
              <button
                key={String(b)}
                onClick={() => setAllowStream(b)}
                className={`flex-1 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs ${
                  allowStream === b
                    ? 'bg-[var(--color-surface-card)] text-[var(--color-ink)]'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {b ? '开启' : '关闭'}
              </button>
            ))}
          </div>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NumberInput label="RPM 上限" value={rpm} onChange={setRpm} />
        <NumberInput label="日请求数" value={dailyReq} onChange={setDailyReq} />
        <NumberInput label="日 Token 数" value={dailyTok} onChange={setDailyTok} />
        <NumberInput label="日 USD 上限" value={dailyCost} onChange={setDailyCost} />
      </div>

      {/* Tick 56 v1.7.28.0：思考强度选择 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-[var(--color-muted)]">
          推理思考强度 (reasoning_effort)
          <div className="mt-1 inline-flex w-full rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] p-1">
            {(['none', 'low', 'medium', 'high'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setReasoning(r)}
                className={`flex-1 rounded-[var(--radius-sm)] px-2 py-1.5 text-[11px] ${
                  reasoning === r
                    ? 'bg-[var(--color-surface-card)] text-[var(--color-ink)]'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {r === 'none' ? '关闭' : r}
              </button>
            ))}
          </div>
        </label>
        <label className="text-xs text-[var(--color-muted)]">
          允许 reasoning 开关
          <div className="mt-1 inline-flex w-full rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] p-1">
            {[true, false].map((b) => (
              <button
                key={String(b)}
                onClick={() => setAllowReasoning(b)}
                className={`flex-1 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs ${
                  allowReasoning === b
                    ? 'bg-[var(--color-surface-card)] text-[var(--color-ink)]'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {b ? '允许' : '禁止'}
              </button>
            ))}
          </div>
        </label>
      </div>
      {/* Tick 59 v1.7.31.0：归属项目 + 允许付费 改成与其他控件统一风格 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-[var(--color-muted)]">
          归属项目
          <div className="mt-1 inline-flex w-full rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] p-1">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.currentTarget.value)}
              className="w-full appearance-none bg-transparent px-2.5 py-1 text-xs text-[var(--color-ink)] focus-visible:outline-none"
            >
              <option value="">默认项目</option>
              {(projects.data?.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.slug}）
                </option>
              ))}
            </select>
          </div>
        </label>
        <label className="text-xs text-[var(--color-muted)]">
          付费模型回退
          <div className="mt-1 inline-flex w-full rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] p-1">
            {[false, true].map((b) => (
              <button
                key={String(b)}
                onClick={() => setAllowPaid(b)}
                className={`flex-1 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs ${
                  allowPaid === b
                    ? 'bg-[var(--color-surface-card)] text-[var(--color-ink)]'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {b ? '允许' : '禁止'}
              </button>
            ))}
          </div>
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="primary"
          disabled={disabled}
          onClick={() =>
            onSubmit({
              label: label.trim(),
              environment: env,
              permissions: {
                allowedModels: [],
                deniedModels: [],
                allowedProviders: [],
                maxRequestsPerMinute: typeof rpm === 'number' ? rpm : null,
                maxRequestsPerDay: typeof dailyReq === 'number' ? dailyReq : null,
                maxTokensPerDay: typeof dailyTok === 'number' ? dailyTok : null,
                maxCostUsdPerDay: typeof dailyCost === 'number' ? dailyCost : null,
                allowPaidModels: allowPaid,
                allowStreaming: allowStream,
                reasoningEffort: reasoning,
                allowReasoning,
              },
              ...(projectId ? { projectId } : {}),
            })
          }
        >
          {pending ? '签发中…' : '签发密钥'}
        </Button>
      </div>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | '';
  onChange: (v: number | '') => void;
}) {
  return (
    <label className="text-xs text-[var(--color-muted)]">
      {label}
      <Input
        type="number"
        value={value}
        onChange={(e) => {
          const t = e.currentTarget.value;
          onChange(t === '' ? '' : Number.parseInt(t, 10));
        }}
        placeholder="∞"
        className="mt-1"
      />
    </label>
  );
}

/**
 * Tick 33 v1.7.5.0：VK 详情卡里的成本块（7 天 / 30 天切换 + top 模型列表）。
 */
function VirtualKeyCostBlock({ vkId }: { vkId: string }) {
  const [days, setDays] = useState<7 | 30>(7);
  const { data, isLoading } = useVirtualKeyCost(vkId, days);
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="uppercase tracking-wider text-[var(--color-muted)]">成本统计</span>
        <div className="flex items-center gap-1">
          {([7, 30] as const).map((d) => (
            <Button
              key={d}
              size="sm"
              variant={days === d ? 'primary' : 'ghost'}
              onClick={() => setDays(d)}
            >
              {d}d
            </Button>
          ))}
        </div>
      </div>
      {isLoading ? (
        <div className="py-2 text-center text-[var(--color-muted)]">正在加载 …</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                总成本
              </div>
              <div className="mt-1 tabular text-[var(--color-warning)]">
                {formatCostUsdInline(data.totalCostUsd)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                请求数
              </div>
              <div className="mt-1 tabular text-[var(--color-ink)]">{data.totalRequests}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                成功率
              </div>
              <div className="mt-1 tabular text-[var(--color-ink)]">
                {data.totalRequests === 0
                  ? '—'
                  : `${((data.successfulRequests / data.totalRequests) * 100).toFixed(1)}%`}
              </div>
            </div>
          </div>
          {data.topModels.length > 0 && (
            <div className="mt-3 border-t border-[var(--color-hairline)] pt-2">
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                Top 模型（按成本）
              </div>
              <div className="space-y-1">
                {data.topModels.map((m) => (
                  <div
                    key={`${m.upstreamProvider}:${m.upstreamModel}`}
                    className="flex items-center justify-between text-[11px]"
                  >
                    <span className="truncate font-mono text-[var(--color-body-strong)]">
                      {m.upstreamModel}
                    </span>
                    <span className="tabular text-[var(--color-warning)]">
                      {formatCostUsdInline(m.costUsd)} / {m.requests}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="py-2 text-center text-[var(--color-muted)]">无数据</div>
      )}
    </div>
  );
}

function formatCostUsdInline(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

/**
 * Tick 38 v1.7.10.0：月度报告块（月份选择 + 总览 + top 模型 + 错误分布 + CSV 下载）。
 */
function VirtualKeyMonthlyReportBlock({ vkId }: { vkId: string }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const { data, isLoading } = useVirtualKeyMonthlyReport(vkId, month);

  const downloadCsv = () => {
    const url = `/admin/virtual-keys/${vkId}/report.csv?month=${month}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `vk-report-${vkId}-${month}.csv`;
    a.click();
  };

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="uppercase tracking-wider text-[var(--color-muted)]">月度报告</span>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.currentTarget.value)}
            className="rounded-[var(--radius-sm)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] px-2 py-1 text-[11px] text-[var(--color-ink)]"
          />
          <Button size="sm" variant="subtle" onClick={downloadCsv}>
            导出 CSV
          </Button>
        </div>
      </div>
      {isLoading ? (
        <div className="py-2 text-center text-[var(--color-muted)]">正在生成报告 …</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <ReportStat label="请求" value={String(data.totals.requests)} />
            <ReportStat
              label="成功率"
              value={
                data.totals.requests === 0
                  ? '—'
                  : `${((data.totals.successful / data.totals.requests) * 100).toFixed(1)}%`
              }
            />
            <ReportStat label="成本" value={formatCostUsdInline(data.totals.costUsd)} tone="warning" />
            <ReportStat label="Token" value={data.totals.totalTokens.toLocaleString()} />
            <ReportStat label="P50 延迟" value={`${data.totals.p50LatencyMs} ms`} />
            <ReportStat label="P95 延迟" value={`${data.totals.p95LatencyMs} ms`} />
          </div>

          {data.topModels.length > 0 && (
            <div className="mt-3 border-t border-[var(--color-hairline)] pt-2">
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                Top 模型
              </div>
              <div className="space-y-1">
                {data.topModels.slice(0, 5).map((m) => (
                  <div
                    key={`${m.upstreamProvider}:${m.upstreamModel}`}
                    className="flex items-center justify-between text-[11px]"
                  >
                    <span className="truncate font-mono text-[var(--color-body-strong)]">
                      {m.upstreamModel}
                    </span>
                    <span className="tabular text-[var(--color-warning)]">
                      {formatCostUsdInline(m.costUsd)} / {m.requests}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.errorBreakdown.length > 0 && (
            <div className="mt-3 border-t border-[var(--color-hairline)] pt-2">
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                错误分布
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data.errorBreakdown.slice(0, 8).map((e) => (
                  <Badge key={e.errorKind} tone="danger">
                    {e.errorKind} × {e.count}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="py-2 text-center text-[var(--color-muted)]">无数据</div>
      )}
    </div>
  );
}

function ReportStat({ label, value, tone }: { label: string; value: string; tone?: 'warning' }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">{label}</div>
      <div
        className={`mt-1 tabular ${tone === 'warning' ? 'text-[var(--color-warning)]' : 'text-[var(--color-ink)]'}`}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Tick 39 v1.7.11.0：VK 今日用量进度条 + 接近上限预警。
 * 显示请求数 / token 数 的双进度条（当限额存在时），≥80% 时进度条变 warning 色。
 */
function VirtualKeyUsageBlock({ vkId }: { vkId: string }) {
  const { data, isLoading } = useVkUsageSnapshot(vkId);
  return (
    <div
      className={`rounded-[var(--radius-md)] border px-3 py-3 text-xs ${
        data?.approachingLimit
          ? 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10'
          : 'border-[var(--color-hairline)] bg-[var(--color-surface-soft)]'
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="uppercase tracking-wider text-[var(--color-muted)]">今日用量（24h）</span>
        {data?.approachingLimit && (
          <Badge tone="warning">接近上限</Badge>
        )}
      </div>
      {isLoading || !data ? (
        <div className="py-1 text-center text-[var(--color-muted)]">加载中 …</div>
      ) : (
        <div className="space-y-3">
          <UsageBar
            label="请求"
            consumed={data.requestsToday}
            limit={data.maxRequestsPerDay}
            pct={data.requestUsagePct}
          />
          <UsageBar
            label="Token"
            consumed={data.tokensToday}
            limit={data.maxTokensPerDay}
            pct={data.tokenUsagePct}
          />
        </div>
      )}
    </div>
  );
}

function UsageBar({
  label,
  consumed,
  limit,
  pct,
}: {
  label: string;
  consumed: number;
  limit: number | null;
  pct: number | null;
}) {
  if (limit === null) {
    return (
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[var(--color-muted)]">{label}</span>
        <span className="tabular text-[var(--color-ink)]">
          {consumed.toLocaleString()} <span className="text-[var(--color-muted)]">/ ∞</span>
        </span>
      </div>
    );
  }
  const ratio = pct ?? 0;
  const warning = ratio >= 0.8;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-[var(--color-muted)]">{label}</span>
        <span className="tabular text-[var(--color-ink)]">
          {consumed.toLocaleString()} / {limit.toLocaleString()} ({Math.round(ratio * 100)}%)
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-hairline)]">
        <div
          className={`h-full transition-all ${
            warning ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-primary)]'
          }`}
          style={{ width: `${Math.min(100, ratio * 100)}%` }}
        />
      </div>
    </div>
  );
}

// =============================================================================
// Tick 51 v1.7.23.0：VK Spend Top-N 排行卡片
// =============================================================================
function VKSpendLeaderboardCard() {
  const [scope, setScope] = useState<VkSpendScope>('month');
  const { data, isLoading } = useVkSpendLeaderboard(scope, 10);

  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-[var(--color-hairline)] pb-3">
        <div className="min-w-0">
          <div className="font-semibold text-[var(--color-ink)]">本{scope === 'day' ? '日' : scope === 'week' ? '周' : '月'}烧钱前 10</div>
          <div className="text-[11px] text-[var(--color-muted)]">
            按估算 USD 倒排，含成功率 + 平均每请求成本 + 占总比
          </div>
        </div>
        <div className="inline-flex rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] p-1 text-xs">
          {(['day', 'week', 'month'] as VkSpendScope[]).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`rounded-[var(--radius-sm)] px-2.5 py-1.5 ${
                scope === s
                  ? 'bg-[var(--color-surface-card)] text-[var(--color-ink)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              {s === 'day' ? '24h' : s === 'week' ? '7d' : '30d'}
            </button>
          ))}
        </div>
      </div>

      {data ? (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryStat label="窗口总 cost" value={`$${data.windowCostUsd.toFixed(4)}`} />
          <SummaryStat label="活跃 VK 数" value={data.totalVkCount.toLocaleString()} />
          <SummaryStat
            label="前 10 占比"
            value={data.windowCostUsd > 0 ? `${((data.shownCostUsd / data.windowCostUsd) * 100).toFixed(1)}%` : '—'}
          />
          <SummaryStat
            label="其余 VK 总 cost"
            value={`$${data.remainderCostUsd.toFixed(4)} (${data.remainderVkCount})`}
          />
        </div>
      ) : null}

      {isLoading || !data ? (
        <div className="py-6 text-center text-sm text-[var(--color-muted)]">加载中…</div>
      ) : data.rows.length === 0 ? (
        <div className="py-6 text-center text-sm text-[var(--color-muted)]">本窗口内无产生 cost 的 VK</div>
      ) : (
        <div className="space-y-1.5">
          {data.rows.map((r, i) => (
            <VKSpendRow key={r.virtualKeyId} rank={i + 1} row={r} />
          ))}
        </div>
      )}
    </GlassCard>
  );
}

function VKSpendRow({ rank, row }: { rank: number; row: VkSpendLeaderboardRow }) {
  const shareWidth = `${Math.max(2, Math.round(row.shareOfTotal * 100))}%`;
  return (
    <div className="relative flex items-center gap-3 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2">
      <div
        className="absolute inset-y-0 left-0 bg-[var(--color-primary)]/8"
        style={{ width: shareWidth }}
      />
      <div className="relative flex w-8 shrink-0 justify-center text-sm font-mono font-bold text-[var(--color-muted)]">
        #{rank}
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-[var(--color-ink)]">{row.label}</span>
          <Badge tone={row.enabled ? (row.environment === 'live' ? 'success' : 'info') : 'muted'}>
            {row.environment}
          </Badge>
          {!row.enabled ? <Badge tone="danger">已吊销</Badge> : null}
        </div>
        <div className="truncate font-mono text-[10px] text-[var(--color-muted)]">{row.prefix}</div>
      </div>
      <div className="relative shrink-0 text-right">
        <div className="font-semibold text-[var(--color-ink)]">${row.costUsd.toFixed(4)}</div>
        <div className="text-[10px] text-[var(--color-muted)]">
          {row.totalRequests} req · 成功率 {(row.successRate * 100).toFixed(1)}% · {(row.shareOfTotal * 100).toFixed(1)}%
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{label}</div>
      <div className="text-base font-semibold text-[var(--color-ink)]">{value}</div>
    </div>
  );
}
