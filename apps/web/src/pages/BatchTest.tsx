/**
 * 批量模型测试台（组 7 Tick 4 v1.22.0.0）。
 *
 * 区别于 RoutingLab/test-chat（单模型单次试跑）：本页对 2-6 个模型**并排**发同一 prompt，
 * 一屏对比响应文本 / 延迟 / token，并自动标注最快、最长输出。
 */
import { useMemo, useState } from 'react';
import { FlaskConical, Search, X, Send, Zap, AlignLeft, Check, AlertTriangle } from 'lucide-react';
import { PageHeader } from './_PageHeader';
import { GlassCard } from '@/components/bits/GlassCard';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useModels } from '@/lib/admin-hooks';
import { useBatchTest, type BatchTestResult } from '@/lib/batch-test-hooks';
import { toast } from 'sonner';

const shortId = (u: string) => u.split('/').pop() ?? u;
const MAX_SEL = 6;

export function BatchTestPage() {
  const { data: modelsData } = useModels();
  const batch = useBatchTest();
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [prompt, setPrompt] = useState('用一句话解释什么是路由网关。');

  const allModels = modelsData?.data ?? [];
  const selModels = useMemo(
    () => allModels.filter((m) => selected.includes(m.id)),
    [allModels, selected],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allModels.filter((m) => !q || m.upstreamId.toLowerCase().includes(q)).slice(0, 24);
  }, [allModels, search]);

  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : s.length < MAX_SEL ? [...s, id] : s,
    );

  const results = batch.data?.results ?? [];
  const summary = useMemo(() => {
    const ok = results.filter((r) => r.success);
    if (ok.length === 0) return null;
    const fastest = ok.reduce((a, b) => (a.latencyMs <= b.latencyMs ? a : b));
    const longest = ok.reduce((a, b) =>
      (a.responseText?.length ?? 0) >= (b.responseText?.length ?? 0) ? a : b,
    );
    return { fastestId: fastest.modelId, longestId: longest.modelId };
  }, [results]);

  const onRun = async () => {
    if (selected.length < 2) {
      toast.error('请至少选择 2 个模型');
      return;
    }
    if (!prompt.trim()) {
      toast.error('请输入测试 prompt');
      return;
    }
    try {
      await batch.mutateAsync({ modelIds: selected, prompt });
    } catch (e) {
      toast.error((e as Error).message ?? '批量测试失败');
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="测试"
        title="批量测试台"
        description="对 2-6 个模型并排发同一 prompt，一屏对比响应 / 延迟 / token，自动标注最快与最长输出。"
        status={`已选 ${selected.length}/${MAX_SEL}`}
        statusTone={selected.length >= 2 ? 'success' : 'muted'}
        actions={
          <Button variant="primary" size="sm" onClick={onRun} disabled={batch.isPending || selected.length < 2}>
            <Send className="size-3.5" /> {batch.isPending ? '测试中…' : '发送'}
          </Button>
        }
      />

      <div className="mx-auto max-w-[1400px] space-y-5 px-6 py-6">
        {/* prompt 输入 */}
        <GlassCard className="space-y-3 p-5">
          <label className="text-xs font-medium text-[var(--color-body)]">测试 Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            maxLength={8000}
            className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
            placeholder="输入要同时发给多个模型的 prompt…"
          />
        </GlassCard>

        {/* 模型选择 */}
        <GlassCard className="space-y-3 p-5">
          {selModels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selModels.map((m) => (
                <span
                  key={m.id}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/15 px-2.5 py-1 text-[11px] text-[var(--color-primary)]"
                >
                  {shortId(m.upstreamId)}
                  <button onClick={() => toggle(m.id)} className="hover:text-[var(--color-ink)]">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Search className="size-4 text-[var(--color-muted)]" />
            <Input
              placeholder="搜索模型加入对比（最多 6）…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-md"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {filtered.map((m) => {
              const on = selected.includes(m.id);
              const full = selected.length >= MAX_SEL && !on;
              return (
                <button
                  key={m.id}
                  onClick={() => toggle(m.id)}
                  disabled={full}
                  className={
                    'rounded-full border px-2.5 py-1 text-[11px] transition-colors ' +
                    (on
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]'
                      : full
                        ? 'border-[var(--color-hairline)] text-[var(--color-hairline-strong)] cursor-not-allowed'
                        : 'border-[var(--color-hairline)] text-[var(--color-muted)] hover:text-[var(--color-ink)]')
                  }
                >
                  {shortId(m.upstreamId)}
                </button>
              );
            })}
          </div>
        </GlassCard>

        {/* 结果对比 */}
        {results.length > 0 && (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(auto-fit, minmax(280px, 1fr))` }}
          >
            {results.map((r) => (
              <ResultCard
                key={r.modelId}
                r={r}
                isFastest={summary?.fastestId === r.modelId}
                isLongest={summary?.longestId === r.modelId}
              />
            ))}
          </div>
        )}
        {batch.isPending && (
          <GlassCard className="p-8 text-center text-sm text-[var(--color-muted)]">
            正在并发测试 {selected.length} 个模型 …
          </GlassCard>
        )}
      </div>
    </div>
  );
}

function ResultCard({
  r,
  isFastest,
  isLongest,
}: {
  r: BatchTestResult;
  isFastest: boolean;
  isLongest: boolean;
}) {
  return (
    <GlassCard className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="truncate text-xs font-semibold text-[var(--color-ink)]" title={r.upstreamId}>
          {shortId(r.upstreamId)}
        </span>
        {r.success ? (
          <Badge tone="success">
            <Check className="size-3" /> 成功
          </Badge>
        ) : (
          <Badge tone="danger">
            <AlertTriangle className="size-3" /> 失败
          </Badge>
        )}
      </div>
      {r.providerSlug && <div className="-mt-2 text-[10px] text-[var(--color-muted)]">{r.providerSlug}</div>}

      {r.success ? (
        <p className="max-h-48 overflow-auto whitespace-pre-wrap rounded-[var(--radius-md)] bg-[var(--color-surface-soft)]/40 p-2.5 text-xs leading-relaxed text-[var(--color-body)]">
          {r.responseText || '(空响应)'}
        </p>
      ) : (
        <p className="rounded-[var(--radius-md)] bg-[var(--color-error)]/10 p-2.5 text-xs text-[var(--color-error)]">
          {r.error ?? '执行失败'}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] tabular-nums text-[var(--color-muted)]">
        <span className="inline-flex items-center gap-1">
          <Zap className="size-3" /> {r.latencyMs}ms
        </span>
        {r.completionTokens != null && (
          <span className="inline-flex items-center gap-1">
            <AlignLeft className="size-3" /> {r.completionTokens} tok
          </span>
        )}
        {isFastest && <Badge tone="primary">最快</Badge>}
        {isLongest && <Badge tone="info">最长输出</Badge>}
      </div>
    </GlassCard>
  );
}
