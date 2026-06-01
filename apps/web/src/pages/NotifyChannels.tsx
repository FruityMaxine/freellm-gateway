/**
 * 告警通知渠道管理页（组 8 Tick 5 v1.27.0.0）。
 *
 * 区别于 Webhooks（通用 webhook 订阅基建）：本页管理告警系统的 email/slack/webhook 多渠道，
 * alert-rule 命中时按 enabled 渠道分发（email 走外部邮件网关）。
 */
import { useState } from 'react';
import { BellRing, Mail, Slack, Webhook as WebhookIcon, Plus, Trash2, Power, Send } from 'lucide-react';
import { PageHeader } from './_PageHeader';
import { GlassCard } from '@/components/bits/GlassCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  useNotifyChannels,
  useCreateNotifyChannel,
  useUpdateNotifyChannel,
  useDeleteNotifyChannel,
  useTestNotifyChannel,
  type NotifyChannelRow,
} from '@/lib/notify-channels-hooks';
import { toast } from 'sonner';

const TYPES = ['email', 'slack', 'webhook'] as const;
const TYPE_LABELS: Record<string, string> = { email: '邮件', slack: 'Slack', webhook: 'Webhook' };
const TYPE_TONE: Record<string, 'primary' | 'info' | 'success'> = {
  email: 'primary',
  slack: 'info',
  webhook: 'success',
};

function TypeIcon({ type }: { type: string }) {
  if (type === 'email') return <Mail className="size-5" />;
  if (type === 'slack') return <Slack className="size-5" />;
  return <WebhookIcon className="size-5" />;
}

const TARGET_HINT: Record<string, string> = {
  email: '收件备注 / source（邮件发往服务器统一收件箱）',
  slack: 'Slack incoming webhook URL',
  webhook: '目标 URL',
};

export function NotifyChannelsPage() {
  const { data, isLoading } = useNotifyChannels();
  const createMut = useCreateNotifyChannel();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('email');
  const [target, setTarget] = useState('');

  const channels = data?.channels ?? [];

  const onCreate = async () => {
    if (!name.trim()) return toast.error('请填写渠道名称');
    if (!target.trim()) return toast.error('请填写目标');
    try {
      await createMut.mutateAsync({ name: name.trim(), type, target: target.trim() });
      toast.success(`渠道「${name.trim()}」已创建`);
      setName('');
      setTarget('');
      setShowCreate(false);
    } catch (e) {
      toast.error((e as Error).message ?? '创建失败');
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="告警"
        title="通知渠道"
        description="管理告警 email / Slack / Webhook 多渠道。alert-rule 命中时按启用渠道分发（邮件走配置的邮件网关）。"
        status={isLoading ? '加载中' : `${channels.length} 渠道`}
        statusTone={isLoading ? 'warning' : 'success'}
        actions={
          <Button variant="primary" size="sm" onClick={() => setShowCreate((s) => !s)}>
            <Plus className="size-3.5" /> {showCreate ? '收起' : '新建渠道'}
          </Button>
        }
      />

      <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
        {showCreate && (
          <GlassCard className="space-y-4 p-5">
            <h2 className="text-sm font-semibold text-[var(--color-ink)]">新建通知渠道</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-[var(--color-body)]">名称</label>
                <Input placeholder="如 运维邮件组" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--color-body)]">类型</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-[var(--color-body)]">目标（{TARGET_HINT[type]}）</label>
                <Input
                  placeholder={type === 'email' ? 'ops-team' : 'https://...'}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </div>
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
          <GlassCard className="p-8 text-center text-sm text-[var(--color-muted)]">正在加载渠道 …</GlassCard>
        ) : channels.length === 0 ? (
          <GlassCard className="p-8 text-center text-sm text-[var(--color-muted)]">
            尚无通知渠道。点击右上「新建渠道」添加 email / Slack / Webhook 接收告警。
          </GlassCard>
        ) : (
          channels.map((c) => <ChannelCard key={c.id} c={c} />)
        )}
      </div>
    </div>
  );
}

function ChannelCard({ c }: { c: NotifyChannelRow }) {
  const updateMut = useUpdateNotifyChannel();
  const deleteMut = useDeleteNotifyChannel();
  const testMut = useTestNotifyChannel();

  const onTest = async () => {
    try {
      const r = await testMut.mutateAsync(c.id);
      if (r.ok) toast.success(`测试发送成功（${r.detail}）`);
      else toast.error(`测试发送失败：${r.detail}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const onToggle = async () => {
    try {
      await updateMut.mutateAsync({ id: c.id, patch: { enabled: !c.enabled } });
      toast.success(`已${c.enabled ? '停用' : '启用'}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const onDelete = async () => {
    if (!confirm(`确定删除渠道「${c.name}」？`)) return;
    try {
      await deleteMut.mutateAsync(c.id);
      toast.success('渠道已删除');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <GlassCard className={'p-5 ' + (!c.enabled ? 'opacity-60' : '')}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
            <TypeIcon type={c.type} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-[var(--color-ink)]">{c.name}</h3>
              <Badge tone={TYPE_TONE[c.type] ?? 'default'}>{TYPE_LABELS[c.type] ?? c.type}</Badge>
              {!c.enabled && <Badge tone="danger">已停用</Badge>}
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-[var(--color-muted)]" title={c.target}>
              {c.target}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={onTest} disabled={testMut.isPending}>
            <Send className="size-3.5" /> {testMut.isPending ? '发送中…' : '测试'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onToggle} disabled={updateMut.isPending}>
            <Power className="size-3.5" /> {c.enabled ? '停用' : '启用'}
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} disabled={deleteMut.isPending} title="删除">
            <Trash2 className="size-4 text-[var(--color-error)]" />
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}
