import { useEffect, useState } from 'react';
import {
  Check, Cog, Download, KeyRound, Languages, Layers, LifeBuoy, RefreshCw, RotateCcw, ScrollText, ShieldCheck, Sparkles, Sun, Upload,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { PageHeader } from './_PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { GlassCard } from '@/components/bits/GlassCard';
import {
  useSettings,
  usePatchSettings,
  useRetentionPolicy,
  useUpdateRetentionPolicy,
  useRunRetentionPurge,
  useCronStatus,
  useRetryPolicy,
  useUpdateRetryPolicy,
  useRetryPolicyPreview,
  type SettingsBag,
  type RetentionPolicy,
  type RetryPolicy,
  type BackoffPreview,
} from '@/lib/settings-hooks';
import { useTheme } from '@/components/layout/ThemeProvider';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface GroupDef {
  id: string;
  title: string;
  description: string;
  Icon: typeof Cog;
  defaults: SettingsBag;
}

const GROUPS: GroupDef[] = [
  { id: 'discovery', title: '模型发现', description: '模型同步周期 + 快照保留天数', Icon: Sparkles, defaults: { 'model.discovery.intervalMinutes': 30, 'model.discovery.snapshotRetentionDays': 30, 'model.discovery.autoRefreshOnBoot': true } },
  { id: 'routing', title: '路由策略', description: '默认策略 + 尝试次数 + 付费回落开关', Icon: Layers, defaults: { 'routing.maxAttempts': 4, 'routing.allowPaidFallback': false, 'routing.preferMockOnDemo': true } },
  { id: 'logging', title: '日志', description: 'Prompt 摘要 / 完整记录 / 保留天数', Icon: ScrollText, defaults: { 'logging.promptDigest': true, 'logging.fullPrompt': false, 'logging.retentionDays': 30 } },
  { id: 'security', title: '安全', description: '会话时长 + 锁定阈值 + CORS 白名单', Icon: ShieldCheck, defaults: { 'security.sessionTtlHours': 168, 'security.lockoutThreshold': 5, 'security.lockoutMinutes': 10 } },
  { id: 'mock', title: 'Mock 模式', description: '演示模式 — 无上游 Key 时也能跑全链路', Icon: LifeBuoy, defaults: { 'mock.enabled': true, 'mock.scenario': 'success', 'mock.firstTokenLatencyMs': 5 } },
  { id: 'theme', title: '主题', description: '深色 / 浅色 / 自动。仅本地浏览器保存', Icon: Sun, defaults: { 'ui.theme': 'dark' } },
  { id: 'language', title: '语言', description: '界面语言。目前接入中文 + 英文', Icon: Languages, defaults: { 'ui.locale': 'zh-CN' } },
  { id: 'admin', title: '管理员密码', description: '提示管理员去管理员面板重置密码', Icon: KeyRound, defaults: { 'admin.passwordResetRequested': false } },
];

function mergeDefaults(): SettingsBag {
  const out: SettingsBag = {};
  for (const g of GROUPS) Object.assign(out, g.defaults);
  return out;
}

export function SettingsStub() {
  const { data, isLoading, refetch, isFetching } = useSettings();
  const patch = usePatchSettings();
  const { mode, setMode } = useTheme();

  const initial: SettingsBag = { ...mergeDefaults(), ...(data?.data ?? {}) };
  const [local, setLocal] = useState<SettingsBag>(initial);
  const [restoreSeed, setRestoreSeed] = useState(0);

  useEffect(() => {
    if (data) setLocal({ ...mergeDefaults(), ...data.data });
  }, [data, restoreSeed]);

  const dirty = JSON.stringify(local) !== JSON.stringify(initial);
  const update = (key: string, value: unknown) => setLocal((s) => ({ ...s, [key]: value }));

  const onSave = async () => {
    const diff: SettingsBag = {};
    for (const k of Object.keys(local)) {
      if (JSON.stringify(local[k]) !== JSON.stringify(initial[k])) diff[k] = local[k];
    }
    if (!Object.keys(diff).length) return;
    try {
      await patch.mutateAsync(diff);
      toast.success(`Saved ${Object.keys(diff).length} setting(s).`);
    } catch (e) { toast.error((e as Error).message); }
  };

  const onReset = () => {
    setLocal({ ...mergeDefaults(), ...(data?.data ?? {}) });
    setRestoreSeed((s) => s + 1);
    toast('Reverted to baseline.');
  };

  const onExport = () => {
    const blob = new Blob([JSON.stringify(local, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `freellm-settings-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const onImport = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json';
    input.onchange = async () => {
      const f = input.files?.[0]; if (!f) return;
      try {
        const parsed = JSON.parse(await f.text());
        if (typeof parsed === 'object' && parsed) {
          setLocal({ ...mergeDefaults(), ...parsed });
          toast.success(`Imported ${Object.keys(parsed).length} keys`);
        }
      } catch (e) { toast.error((e as Error).message); }
    };
    input.click();
  };

  return (
    <div>
      <PageHeader
        eyebrow="control plane"
        title="Settings"
        description="8 configuration groups with dirty-state save bar + JSON import/export."
        status={isLoading ? 'loading' : 'live'}
        statusTone={isLoading ? 'warning' : 'success'}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} /> Reload
            </Button>
            <Button variant="subtle" size="sm" onClick={onExport}><Download className="size-3.5" /> Export JSON</Button>
            <Button variant="subtle" size="sm" onClick={onImport}><Upload className="size-3.5" /> Import JSON</Button>
          </>
        }
      />

      <div className="mx-auto max-w-7xl px-6 py-8 grid gap-4 md:grid-cols-2">
        {GROUPS.map((g) => (
          <SettingsGroup key={g.id} group={g} values={local} onChange={update} themeMode={mode} setThemeMode={setMode} />
        ))}
        {/* Tick 46 v1.7.18.0：数据保留策略卡片 */}
        <RetentionPolicyCard />
        {/* Tick 47 v1.7.19.0：cron 调度状态卡片 */}
        <CronStatusCard />
        {/* Tick 48 v1.7.20.0：重试/退避策略卡片 */}
        <RetryPolicyCard />
      </div>

      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 24 }}
            className="fixed inset-x-0 bottom-6 z-40 mx-auto flex w-full max-w-2xl items-center gap-3 rounded-[var(--radius-xl)] border border-[var(--color-primary)]/40 bg-[var(--color-surface-elevated)]/95 px-4 py-3 shadow-[var(--shadow-glow)] backdrop-blur"
          >
            <Badge tone="warning">unsaved</Badge>
            <div className="flex-1 text-sm text-[var(--color-body)]">
              You have local changes. Save to persist to the <code className="font-mono">settings</code> table.
            </div>
            <Button variant="ghost" size="sm" onClick={onReset} disabled={patch.isPending}><RotateCcw className="size-3.5" /> Discard</Button>
            <Button variant="primary" size="sm" onClick={onSave} disabled={patch.isPending}><Check className="size-3.5" /> {patch.isPending ? 'Saving…' : 'Save'}</Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SettingsGroup({ group, values, onChange, themeMode, setThemeMode }: {
  group: GroupDef; values: SettingsBag; onChange: (k: string, v: unknown) => void;
  themeMode: 'dark' | 'light' | 'auto'; setThemeMode: (m: 'dark' | 'light' | 'auto') => void;
}) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-center gap-3 border-b border-[var(--color-hairline)] pb-3">
        <span className="grid size-9 place-items-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/30">
          <group.Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="font-semibold text-[var(--color-ink)]">{group.title}</div>
          <div className="text-[11px] text-[var(--color-muted)]">{group.description}</div>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {group.id === 'theme' ? (
          <Row label="Mode"><ThemeSwitch mode={themeMode} setMode={setThemeMode} /></Row>
        ) : group.id === 'admin' ? (
          <AdminPasswordPanel />
        ) : (
          Object.entries(group.defaults).map(([key, fallback]) => (
            <Row key={key} label={prettyLabel(key)}>
              <FieldByValue k={key} value={values[key] ?? fallback} onChange={(v) => onChange(key, v)} />
            </Row>
          ))
        )}
      </div>
    </GlassCard>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[1fr_auto] items-center gap-3 text-xs">
      <span className="font-mono text-[var(--color-muted)]">{label}</span>
      <div className="justify-self-end">{children}</div>
    </label>
  );
}

function FieldByValue({ k, value, onChange }: { k: string; value: unknown; onChange: (v: unknown) => void }) {
  if (typeof value === 'boolean') {
    return (
      <button
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
        className={cn(
          'inline-flex h-6 w-11 items-center rounded-full border transition-colors',
          value ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/30' : 'border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)]',
        )}
      >
        <span className={cn('block size-4 rounded-full bg-[var(--color-primary)] transition-transform', value ? 'translate-x-6' : 'translate-x-1')} />
      </button>
    );
  }
  if (typeof value === 'number') {
    return <Input type="number" value={value} onChange={(e) => { const v = e.currentTarget.value; onChange(v === '' ? 0 : Number.parseFloat(v)); }} className="w-28 text-right tabular" />;
  }
  return <Input type="text" value={String(value ?? '')} onChange={(e) => onChange(e.currentTarget.value)} className="w-48" placeholder={k} />;
}

function ThemeSwitch({ mode, setMode }: { mode: 'dark' | 'light' | 'auto'; setMode: (m: 'dark' | 'light' | 'auto') => void }) {
  return (
    <div className="inline-flex rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] p-1 text-xs">
      {(['dark', 'light', 'auto'] as const).map((m) => (
        <button key={m} onClick={() => setMode(m)} className={cn('rounded-[var(--radius-sm)] px-3 py-1.5 capitalize', mode === m ? 'bg-[var(--color-surface-card)] text-[var(--color-ink)]' : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]')}>
          {m}
        </button>
      ))}
    </div>
  );
}

function AdminPasswordPanel() {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  return (
    <div className="space-y-2 text-xs">
      <Input type="password" value={oldPw} onChange={(e) => setOldPw(e.currentTarget.value)} placeholder="Current password" />
      <Input type="password" value={newPw} onChange={(e) => setNewPw(e.currentTarget.value)} placeholder="New password" />
      <Button variant="subtle" size="sm" onClick={() => toast('Password change endpoint scheduled for next sprint (security hardening).')} disabled={!oldPw || !newPw} className="w-full">
        Request password change
      </Button>
    </div>
  );
}

function prettyLabel(key: string): string {
  return key.replace(/^[^.]+\./, '').replace(/([A-Z])/g, ' $1').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Tick 46 v1.7.18.0：数据保留策略卡片。
 *
 * 配置 3 个域的保留天数（audit / playground session / error event 已解决），
 * 0 = 永不清；上限 3650 天。"立即清扫" 按钮跳过 cron 触发一次完整 purge。
 */
function RetentionPolicyCard() {
  const { data, isLoading, refetch } = useRetentionPolicy();
  const update = useUpdateRetentionPolicy();
  const purge = useRunRetentionPurge();
  const [local, setLocal] = useState<RetentionPolicy | null>(null);

  useEffect(() => {
    if (data) setLocal(data);
  }, [data]);

  const dirty =
    local && data && JSON.stringify(local) !== JSON.stringify(data);

  const onSave = async () => {
    if (!local) return;
    try {
      await update.mutateAsync(local);
      toast.success('保留策略已保存');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onPurge = () => {
    toast.promise(purge.mutateAsync(), {
      loading: '正在清扫过期数据 …',
      success: (r) =>
        `清扫完成：audit ${r.auditPurged} / sessions ${r.playgroundSessionsPurged} / errors ${r.errorEventsPurged}`,
      error: '清扫失败',
    });
    void refetch();
  };

  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-[var(--color-primary)]" />
          <div>
            <div className="text-sm font-medium text-[var(--color-ink)]">数据保留策略</div>
            <div className="text-[11px] text-[var(--color-muted)]">
              cron 每 24 小时按下方天数清扫；0 = 永不清。
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onPurge} disabled={purge.isPending}>
          {purge.isPending ? '清扫中…' : '立即清扫'}
        </Button>
      </div>
      {isLoading || !local ? (
        <div className="py-6 text-center text-xs text-[var(--color-muted)]">加载中…</div>
      ) : (
        <div className="space-y-2 text-xs">
          <RetentionRow
            label="操作审计日志"
            hint="管理员所有写操作记录"
            value={local.adminAuditRetentionDays}
            onChange={(v) => setLocal({ ...local, adminAuditRetentionDays: v })}
          />
          <RetentionRow
            label="Playground 会话"
            hint="访客匿名会话历史"
            value={local.playgroundSessionRetentionDays}
            onChange={(v) => setLocal({ ...local, playgroundSessionRetentionDays: v })}
          />
          <RetentionRow
            label="已解决告警"
            hint="未解决永不清"
            value={local.errorEventRetentionDays}
            onChange={(v) => setLocal({ ...local, errorEventRetentionDays: v })}
          />
          {dirty && (
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLocal(data ?? null)}
                disabled={update.isPending}
              >
                取消
              </Button>
              <Button variant="primary" size="sm" onClick={onSave} disabled={update.isPending}>
                {update.isPending ? '保存中…' : '保存策略'}
              </Button>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}

function RetentionRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/60 px-3 py-2">
      <div>
        <div className="text-[var(--color-ink)]">{label}</div>
        <div className="text-[10px] text-[var(--color-muted)]">{hint}</div>
      </div>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={0}
          max={3650}
          value={String(value)}
          onChange={(e) => {
            const n = Number.parseInt(e.currentTarget.value, 10);
            if (Number.isFinite(n)) onChange(Math.max(0, Math.min(3650, n)));
          }}
          className="w-20 text-right"
        />
        <span className="text-[10px] text-[var(--color-muted)]">天</span>
      </div>
    </div>
  );
}

/**
 * Tick 47 v1.7.19.0：cron 调度状态卡片。
 * 每 10 秒轮询 /admin/cron/status，展示每个 cron job 的：
 *   - 上次运行时间（"3 分钟前"）
 *   - 周期 + 上次耗时
 *   - 成功 / 失败计数
 *   - 是否 stale（> 2 × 周期 未跑）
 *   - 最近错误（点击展开）
 */
function CronStatusCard() {
  const { data, isLoading } = useCronStatus();
  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Cog className="size-4 text-[var(--color-primary)]" />
        <div>
          <div className="text-sm font-medium text-[var(--color-ink)]">Cron 调度状态</div>
          <div className="text-[11px] text-[var(--color-muted)]">
            每 10 秒刷新，stale = 超 2 倍周期未跑（应警觉）
          </div>
        </div>
      </div>
      {isLoading || !data ? (
        <div className="py-4 text-center text-xs text-[var(--color-muted)]">加载中…</div>
      ) : data.data.length === 0 ? (
        <div className="py-4 text-center text-xs text-[var(--color-muted)]">
          暂无注册的 cron job（测试模式下不启动）。
        </div>
      ) : (
        <div className="space-y-1.5 text-xs">
          {data.data.map((j) => (
            <CronJobRow key={j.name} job={j} />
          ))}
        </div>
      )}
    </GlassCard>
  );
}

function CronJobRow({ job }: { job: import('@/lib/settings-hooks').CronJobStatus }) {
  const periodLabel = formatPeriod(job.everyMs);
  const lastRunLabel = job.lastRunAt
    ? formatRelativeMs(job.sinceLastRunMs ?? 0)
    : '尚未运行';
  return (
    <div
      className={cn(
        'rounded-[var(--radius-md)] border px-3 py-2',
        job.stale
          ? 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/5'
          : 'border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/60',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-[var(--color-body-strong)]">{job.name}</span>
          {job.stale && <Badge tone="warning">stale</Badge>}
          {job.failureCount > 0 && <Badge tone="danger">{job.failureCount} 失败</Badge>}
        </div>
        <span className="text-[10px] tabular text-[var(--color-muted)]">{periodLabel}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-[var(--color-muted)]">
        <span>上次：<span className="text-[var(--color-body-strong)]">{lastRunLabel}</span></span>
        {job.lastDurationMs !== null && (
          <span>耗时 <span className="text-[var(--color-body-strong)]">{job.lastDurationMs} ms</span></span>
        )}
        <span>成功 <span className="text-[var(--color-success)]">{job.successCount}</span></span>
        {job.lastError && (
          <span className="text-[var(--color-error)]" title={job.lastError}>
            最近错误：{job.lastError.slice(0, 60)}{job.lastError.length > 60 ? '…' : ''}
          </span>
        )}
      </div>
    </div>
  );
}

function formatPeriod(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `每 ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `每 ${hours}h`;
  return `每 ${Math.round(hours / 24)}d`;
}

function formatRelativeMs(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒前`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)} 分钟前`;
  if (ms < 24 * 60 * 60_000) return `${Math.round(ms / (60 * 60_000))} 小时前`;
  return `${Math.round(ms / (24 * 60 * 60_000))} 天前`;
}

// =============================================================================
// Tick 48 v1.7.20.0：重试/退避策略卡片
// =============================================================================
function RetryPolicyCard() {
  const { data, isLoading } = useRetryPolicy();
  const update = useUpdateRetryPolicy();
  const [draft, setDraft] = useState<RetryPolicy | null>(null);
  const policy = draft ?? data;
  useEffect(() => {
    if (data && !draft) setDraft(data);
  }, [data, draft]);
  const preview = useRetryPolicyPreview(policy?.maxAttempts);
  const dirty = draft != null && data != null && JSON.stringify(draft) !== JSON.stringify(data);

  function patch<K extends keyof RetryPolicy>(k: K, v: RetryPolicy[K]) {
    if (!policy) return;
    setDraft({ ...policy, [k]: v });
  }

  async function onSave() {
    if (!draft) return;
    try {
      await update.mutateAsync({
        maxAttempts: draft.maxAttempts,
        initialBackoffMs: draft.initialBackoffMs,
        maxBackoffMs: draft.maxBackoffMs,
        jitterRatio: draft.jitterRatio,
        retryOnStatusCodes: draft.retryOnStatusCodes,
        retryOnErrorKinds: draft.retryOnErrorKinds,
      });
      toast.success('重试策略已保存');
      setDraft(null);
    } catch (err) {
      toast.error('保存失败: ' + (err as Error).message);
    }
  }

  function onReset() {
    if (data) setDraft({ ...data });
  }

  if (isLoading || !policy) {
    return (
      <GlassCard className="p-5">
        <div className="text-sm text-[var(--color-muted)]">加载重试策略中…</div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-5">
      <div className="flex items-center gap-3 border-b border-[var(--color-hairline)] pb-3">
        <span className="grid size-9 place-items-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/30">
          <RefreshCw className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="font-semibold text-[var(--color-ink)]">重试/退避策略</div>
          <div className="text-[11px] text-[var(--color-muted)]">
            jittered exponential backoff · 应用于 /v1/chat/completions 与 test-chat
          </div>
        </div>
      </div>
      <div className="space-y-2.5 pt-3">
        <RetryRow label="最大尝试数" hint="1-10 次（覆盖 env 默认）">
          <Input
            type="number" min={1} max={10}
            value={policy.maxAttempts}
            onChange={(e) => patch('maxAttempts', Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
          />
        </RetryRow>
        <RetryRow label="初始退避 ms" hint="第一次失败后等待的基础毫秒数">
          <Input
            type="number" min={0} max={60000}
            value={policy.initialBackoffMs}
            onChange={(e) => patch('initialBackoffMs', Math.max(0, Math.min(60000, Number(e.target.value) || 0)))}
          />
        </RetryRow>
        <RetryRow label="退避上限 ms" hint="防指数爆炸，建议 5000-10000">
          <Input
            type="number" min={0} max={60000}
            value={policy.maxBackoffMs}
            onChange={(e) => patch('maxBackoffMs', Math.max(0, Math.min(60000, Number(e.target.value) || 0)))}
          />
        </RetryRow>
        <RetryRow label="抖动比例" hint="0-1，0.3 = ±30% 随机抖动避免群体重试">
          <Input
            type="number" min={0} max={1} step={0.05}
            value={policy.jitterRatio}
            onChange={(e) => patch('jitterRatio', Math.max(0, Math.min(1, Number(e.target.value) || 0)))}
          />
        </RetryRow>
        <RetryRow label="HTTP 白名单" hint="逗号分隔（空 = 默认 isRetriableKind）">
          <Input
            type="text"
            value={policy.retryOnStatusCodes.join(',')}
            placeholder="429,500,502,503,504"
            onChange={(e) => patch(
              'retryOnStatusCodes',
              e.target.value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n >= 100 && n < 600),
            )}
          />
        </RetryRow>
        <RetryRow label="错误 kind 白名单" hint="逗号分隔（空 = 默认 isRetriableKind）">
          <Input
            type="text"
            value={policy.retryOnErrorKinds.join(',')}
            placeholder="rate_limited,timeout,network_error"
            onChange={(e) => patch(
              'retryOnErrorKinds',
              e.target.value.split(',').map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 64),
            )}
          />
        </RetryRow>
      </div>

      <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3">
        <div className="mb-2 text-xs font-semibold text-[var(--color-muted)]">退避预览（保存后生效）</div>
        {preview.isLoading || !preview.data ? (
          <div className="text-[11px] text-[var(--color-muted)]">加载预览中…</div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {preview.data.data.map((p: BackoffPreview) => (
              <div
                key={p.attempt}
                className="rounded-[var(--radius-sm)] bg-[var(--color-surface-elevated)] px-2 py-1.5 text-[11px]"
              >
                <div className="font-semibold text-[var(--color-ink)]">第 {p.attempt} 次</div>
                <div className="text-[var(--color-muted)]">基础 {p.baseMs} ms</div>
                <div className="text-[var(--color-muted)]">±jitter: {p.withJitterMinMs}-{p.withJitterMaxMs}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {dirty && (
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--color-hairline)] pt-3">
          <Button variant="ghost" size="sm" onClick={onReset} disabled={update.isPending}>
            <RotateCcw className="size-3.5" /> 重置
          </Button>
          <Button variant="primary" size="sm" onClick={onSave} disabled={update.isPending}>
            <Check className="size-3.5" /> {update.isPending ? '保存中…' : '保存策略'}
          </Button>
        </div>
      )}
    </GlassCard>
  );
}

function RetryRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-hairline)]/60 bg-[var(--color-surface)]/40 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[var(--color-ink)]">{label}</div>
        {hint ? <div className="text-[10px] text-[var(--color-muted)]">{hint}</div> : null}
      </div>
      <div className="w-48 shrink-0">{children}</div>
    </div>
  );
}
