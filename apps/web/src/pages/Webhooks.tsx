/**
 * Webhook 管理页（Tick 27 v1.6.2.0 引入）。
 *
 * 三个区域：
 * 1. 订阅列表（卡片）+ 启用切换 + 删除确认
 * 2. 添加订阅表单
 * 3. 签名验证内嵌工具（sign-test + verify）
 */
import { useState } from 'react';
import {
  Webhook,
  Plus,
  Trash2,
  Power,
  Copy,
  Check,
  ShieldCheck,
  AlertTriangle,
  History,
  RefreshCw,
} from 'lucide-react';
import { PageHeader } from './_PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { GlassCard } from '@/components/bits/GlassCard';
import {
  useWebhooks,
  useCreateWebhook,
  useUpdateWebhook,
  useDeleteWebhook,
  useSignTest,
  useVerifyWebhook,
  useWebhookDeliveries,
  useRetryDelivery,
  type WebhookSubscriptionRow,
} from '@/lib/useWebhooks';
import { timeAgo } from '@/lib/utils';
import { toast } from 'sonner';

export function WebhooksPage() {
  const { data, isLoading } = useWebhooks();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div>
      <PageHeader
        eyebrow="集成"
        title="Webhook 订阅"
        description="服务端事件触发时向下游 URL 出站 POST + HMAC 签名 + 指数退避重试。"
        status={isLoading ? '加载中' : '实时'}
        statusTone={isLoading ? 'warning' : 'success'}
        actions={
          <Button variant="primary" size="sm" onClick={() => setShowCreate((s) => !s)}>
            <Plus className="size-3.5" /> {showCreate ? '收起表单' : '添加订阅'}
          </Button>
        }
      />

      <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        {showCreate && (
          <GlassCard className="p-5">
            <CreateWebhookForm onCreated={() => setShowCreate(false)} />
          </GlassCard>
        )}

        {isLoading ? (
          <GlassCard className="p-8 text-center text-sm text-[var(--color-muted)]">
            正在加载订阅列表 …
          </GlassCard>
        ) : (data?.data ?? []).length === 0 ? (
          <GlassCard className="p-8 text-center text-sm text-[var(--color-muted)]">
            尚未注册任何 Webhook 订阅。点击右上「添加订阅」创建第一个。
          </GlassCard>
        ) : (
          (data?.data ?? []).map((sub) => <WebhookCard key={sub.id} sub={sub} />)
        )}

        <SignatureTool />
      </div>
    </div>
  );
}

function WebhookCard({ sub }: { sub: WebhookSubscriptionRow }) {
  const updateMut = useUpdateWebhook();
  const deleteMut = useDeleteWebhook();
  const [showDeliveries, setShowDeliveries] = useState(false);
  const deliveries = useWebhookDeliveries(showDeliveries ? sub.id : null);
  const retryMut = useRetryDelivery();

  const onRetry = async (id: string) => {
    try {
      const r = await retryMut.mutateAsync(id);
      toast.success(`重投${r?.result?.ok ? '成功' : '完成'}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const successRate =
    sub.totalDeliveries === 0
      ? null
      : Math.round(((sub.totalDeliveries - sub.totalFailures) / sub.totalDeliveries) * 1000) / 10;

  const onToggle = async () => {
    try {
      await updateMut.mutateAsync({ id: sub.id, patch: { enabled: !sub.enabled } });
      toast.success(`已${sub.enabled ? '禁用' : '启用'}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const onDelete = async () => {
    if (!confirm(`确定删除订阅 ${sub.url}？此操作不可撤销。`)) return;
    try {
      await deleteMut.mutateAsync(sub.id);
      toast.success('订阅已删除');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="grid size-10 place-items-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
            <Webhook className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-sm text-[var(--color-ink)]">{sub.url}</div>
            {sub.description && (
              <div className="text-[11px] text-[var(--color-muted)] mt-0.5">{sub.description}</div>
            )}
            <div className="mt-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
              <span>密钥 {sub.secretPreview}</span>
              <span>·</span>
              <span>{sub.eventTopics.length === 0 ? '订阅所有 topic' : `${sub.eventTopics.length} 个 topic`}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge tone={sub.enabled ? 'success' : 'muted'}>{sub.enabled ? '启用' : '已禁用'}</Badge>
          <Button variant="ghost" size="sm" onClick={onToggle} disabled={updateMut.isPending}>
            <Power className="size-3.5" />
            {sub.enabled ? '禁用' : '启用'}
          </Button>
          <Button variant="danger" size="sm" onClick={onDelete} disabled={deleteMut.isPending}>
            <Trash2 className="size-3.5" /> 删除
          </Button>
        </div>
      </div>

      {sub.eventTopics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {sub.eventTopics.map((t) => (
            <span
              key={t}
              className="rounded-[var(--radius-sm)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-body)]"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-4 gap-2 text-xs">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">总投递</div>
          <div className="mt-1 text-[var(--color-ink)] tabular">{sub.totalDeliveries}</div>
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">失败</div>
          <div className="mt-1 text-[var(--color-ink)] tabular">{sub.totalFailures}</div>
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">成功率</div>
          <div className="mt-1 text-[var(--color-ink)] tabular">
            {successRate === null ? '—' : `${successRate}%`}
          </div>
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">最近成功</div>
          <div className="mt-1 text-[var(--color-ink)]">{sub.lastSuccessAt ? timeAgo(sub.lastSuccessAt) : '—'}</div>
        </div>
      </div>

      {/* 组 5 Tick 4：投递历史明细 + 失败重试 */}
      <div className="mt-3">
        <Button variant="ghost" size="sm" onClick={() => setShowDeliveries((s) => !s)}>
          <History className="size-3.5" /> {showDeliveries ? '收起投递历史' : '投递历史'}
        </Button>
        {showDeliveries && (
          <div className="mt-2 space-y-1.5 border-t border-[var(--color-hairline)] pt-2">
            {deliveries.isLoading ? (
              <div className="text-[11px] text-[var(--color-muted)]">加载投递历史 …</div>
            ) : (deliveries.data?.data ?? []).length === 0 ? (
              <div className="text-[11px] text-[var(--color-muted)]">暂无投递记录。</div>
            ) : (
              (deliveries.data?.data ?? []).map((d) => (
                <div key={d.id} className="flex items-center gap-2 text-[11px]">
                  <span className={`size-2 shrink-0 rounded-full ${d.ok ? 'bg-[var(--color-success)]' : 'bg-[var(--color-error)]'}`} />
                  <span className="font-mono text-[var(--color-body-strong)]">{d.topic}</span>
                  <Badge tone={d.ok ? 'success' : 'danger'}>{d.httpStatus ?? '—'}</Badge>
                  <span className="text-[var(--color-muted)]">
                    {d.attempts} 次 · {d.durationMs ?? '—'}ms · {timeAgo(d.createdAt)}
                  </span>
                  {d.errorMessage && (
                    <span className="truncate text-[var(--color-error)]" title={d.errorMessage}>
                      {d.errorMessage}
                    </span>
                  )}
                  {!d.ok && (
                    <Button variant="ghost" size="sm" onClick={() => onRetry(d.id)} disabled={retryMut.isPending}>
                      <RefreshCw className="size-3" /> 重投
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {sub.lastErrorMessage && (
        <div className="mt-3 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-2 text-xs text-[var(--color-error)]">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div>
            <div>最近错误（{sub.lastErrorAt ? timeAgo(sub.lastErrorAt) : '—'}）</div>
            <div className="mt-0.5 font-mono text-[11px]">{sub.lastErrorMessage}</div>
          </div>
        </div>
      )}
    </GlassCard>
  );
}

function CreateWebhookForm({ onCreated }: { onCreated: () => void }) {
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [topicsRaw, setTopicsRaw] = useState('');
  const [description, setDescription] = useState('');
  const createMut = useCreateWebhook();

  const onSubmit = async () => {
    if (!url.trim() || !secret.trim()) {
      toast.error('URL 与 secret 不能为空');
      return;
    }
    const topics = topicsRaw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    try {
      await createMut.mutateAsync({
        url: url.trim(),
        secret: secret.trim(),
        eventTopics: topics,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      toast.success(`Webhook 订阅已注册：${url}`);
      setUrl('');
      setSecret('');
      setTopicsRaw('');
      setDescription('');
      onCreated();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-[var(--color-ink)]">新建 Webhook 订阅</div>
      <Input placeholder="URL（https:// 或 http://）" value={url} onChange={(e) => setUrl(e.currentTarget.value)} />
      <Input placeholder="HMAC secret（≥ 8 字符）" value={secret} onChange={(e) => setSecret(e.currentTarget.value)} />
      <Input
        placeholder="订阅 topic（逗号分隔，留空 = 订阅所有）例如 model:added, discovery:cycle"
        value={topicsRaw}
        onChange={(e) => setTopicsRaw(e.currentTarget.value)}
      />
      <Input placeholder="备注（可选）" value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={onSubmit} disabled={createMut.isPending}>
          {createMut.isPending ? '创建中…' : '注册订阅'}
        </Button>
      </div>
    </div>
  );
}

function SignatureTool() {
  const [secret, setSecret] = useState('');
  const [payload, setPayload] = useState('{"topic":"model:added","model":"mock/echo:free"}');
  const [signature, setSignature] = useState('');
  const [copied, setCopied] = useState(false);
  const signMut = useSignTest();
  const verifyMut = useVerifyWebhook();

  const onSign = async () => {
    if (!secret.trim() || !payload.trim()) {
      toast.error('secret 与 payload 不能为空');
      return;
    }
    try {
      const result = await signMut.mutateAsync({ secret: secret.trim(), payload: payload.trim() });
      setSignature(result.signatureHeader);
      toast.success('签名生成成功');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const onVerify = async () => {
    if (!secret.trim() || !payload.trim() || !signature.trim()) {
      toast.error('请先签名或填入签名头');
      return;
    }
    try {
      const result = await verifyMut.mutateAsync({
        secret: secret.trim(),
        payload: payload.trim(),
        signatureHeader: signature.trim(),
      });
      toast[result.valid ? 'success' : 'error'](
        result.valid ? '签名有效 ✓' : `验证失败：${result.reason ?? 'unknown'}`,
      );
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const copySignature = async () => {
    if (!signature) return;
    try {
      await navigator.clipboard.writeText(signature);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('复制失败');
    }
  };

  return (
    <GlassCard className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="size-4 text-[var(--color-primary)]" />
        <div className="text-sm font-medium text-[var(--color-ink)]">签名验证工具</div>
      </div>
      <p className="text-xs text-[var(--color-muted)] mb-3">
        用 secret 给 payload 签名生成 X-FreeLLM-Signature 头；或验证已有签名头是否对得上。
      </p>
      <div className="space-y-3">
        <Input placeholder="HMAC secret" value={secret} onChange={(e) => setSecret(e.currentTarget.value)} />
        <textarea
          value={payload}
          onChange={(e) => setPayload(e.currentTarget.value)}
          rows={4}
          className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] px-3 py-2 font-mono text-xs text-[var(--color-ink)] focus-visible:border-[var(--color-primary)] focus-visible:outline-none"
          placeholder="Payload JSON"
        />
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={onSign} disabled={signMut.isPending}>
            生成签名
          </Button>
          <Button variant="ghost" size="sm" onClick={onVerify} disabled={verifyMut.isPending}>
            验证签名
          </Button>
        </div>
        {signature && (
          <div>
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
              <span>签名头</span>
              <Button variant="ghost" size="sm" onClick={copySignature}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? '已复制' : '复制'}
              </Button>
            </div>
            <pre className="mt-2 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[#06070a] p-3 font-mono text-[11px] text-[var(--color-primary)]">
              {signature}
            </pre>
            <Input
              className="mt-2"
              placeholder="（也可粘贴外部签名头到这里验证）"
              value={signature}
              onChange={(e) => setSignature(e.currentTarget.value)}
            />
          </div>
        )}
      </div>
    </GlassCard>
  );
}
