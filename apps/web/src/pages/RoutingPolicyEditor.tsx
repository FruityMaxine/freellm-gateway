/**
 * 路由策略可视化编辑器（组 6 Tick 5 v1.19.0.0）。
 *
 * 区别于 RoutingLab（只切 mode 枚举、无权重编辑）：本页提供 8 维权重 slider 可视化编辑，
 * 并在**右栏实时**用 top3 真实模型的 9 维原始分重算 composite + 排名 —— 拖动任一 slider，
 * 三个真实模型的 composite 与排名立即重排，让运营直观看到「调高延迟权重 → 低延迟模型上位」。
 * 这是本页的防薄化核心：不是一个静态 mode 下拉，而是带实时排名反馈的策略调参台。
 */
import { useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal, RotateCcw, Save, Check, Trophy, ArrowDown, ArrowUp } from 'lucide-react';
import { PageHeader } from './_PageHeader';
import { GlassCard } from '@/components/bits/GlassCard';
import { Button } from '@/components/ui/button';
import {
  useRoutingPolicyEditor,
  useSaveRoutingPolicy,
  type PolicyWeights,
} from '@/lib/routing-policy-hooks';

const DIM_LABELS: Record<string, string> = {
  availability: '可用性',
  latency: '延迟',
  rateLimit: '限流',
  quality: '质量',
  context: '上下文',
  freshness: '新鲜度',
  cost: '成本',
  stability: '稳定性',
};

const MODE_LABELS: Record<string, string> = {
  'auto-best-free': '自动择优 · 免费',
  'round-robin-free': '轮询 · 免费',
  'weighted-free': '加权评分 · 免费',
  'openrouter-free-router': 'OpenRouter 免费路由',
  'prefer-model-fallback': '偏好模型 + 回退',
  'provider-specific': '指定上游',
  'paid-allowed': '允许付费',
};

const shortId = (u: string) => u.split('/').pop() ?? u;

interface PreviewRow {
  upstreamId: string;
  composite: number;
}

export function RoutingPolicyEditorPage() {
  const { data, isLoading } = useRoutingPolicyEditor();
  const save = useSaveRoutingPolicy();

  const [weights, setWeights] = useState<PolicyWeights>({});
  const [mode, setMode] = useState<string>('weighted-free');
  const [savedFlash, setSavedFlash] = useState(false);
  // 用于"排名变化"指示：保存/重置时刻的基线排名顺序
  const [baselineOrder, setBaselineOrder] = useState<string[]>([]);

  useEffect(() => {
    if (!data) return;
    const src =
      data.policy?.weights && Object.keys(data.policy.weights).length
        ? { ...data.defaultWeights, ...data.policy.weights }
        : data.defaultWeights;
    const filtered: PolicyWeights = {};
    for (const k of data.weightKeys) filtered[k] = Number(src[k] ?? 0);
    setWeights(filtered);
    setMode(data.policy?.mode ?? 'weighted-free');
  }, [data]);

  const weightSum = useMemo(
    () => Object.values(weights).reduce((a, b) => a + b, 0),
    [weights],
  );

  // 实时 composite 预览 + 排名（防薄化关键）：composite = Σ(weight × rawScore)，与 scorer.ts 同式。
  const preview = useMemo<PreviewRow[]>(() => {
    if (!data) return [];
    return data.sampleModels
      .map((m) => ({
        upstreamId: m.upstreamId,
        composite: data.weightKeys.reduce(
          (acc, k) => acc + (weights[k] ?? 0) * (m.scores[k] ?? 0),
          0,
        ),
      }))
      .sort((a, b) => b.composite - a.composite);
  }, [data, weights]);

  // 基线初始化（首次加载后锚定一次）
  useEffect(() => {
    if (preview.length && baselineOrder.length === 0) {
      setBaselineOrder(preview.map((p) => p.upstreamId));
    }
  }, [preview, baselineOrder.length]);

  const maxComposite = preview.length ? Math.max(...preview.map((p) => p.composite), 0.0001) : 1;

  const setWeight = (k: string, v: number) => setWeights((w) => ({ ...w, [k]: v }));

  const reset = () => {
    if (!data) return;
    const f: PolicyWeights = {};
    for (const k of data.weightKeys) f[k] = data.defaultWeights[k] ?? 0;
    setWeights(f);
    setBaselineOrder([]); // 重置基线
  };

  const onSave = async () => {
    if (!data) return;
    await save.mutateAsync({ name: data.policy?.name ?? 'default', mode, weights });
    setBaselineOrder(preview.map((p) => p.upstreamId)); // 保存后锚定新基线
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2200);
  };

  // 相对基线的名次变化（↑ 上升 / ↓ 下降）
  const rankDelta = (upstreamId: string, currentIdx: number): number => {
    const baseIdx = baselineOrder.indexOf(upstreamId);
    if (baseIdx < 0) return 0;
    return baseIdx - currentIdx; // 正 = 名次上升
  };

  return (
    <div>
      <PageHeader
        eyebrow="路由"
        title="路由策略编辑器"
        description="可视化调节 8 维评分权重，右侧用真实 top3 模型实时重算 composite 与排名 —— 拖动 slider 即见排名变化，所见即所得后保存为默认策略。"
        status={isLoading ? '加载中' : mode ? MODE_LABELS[mode] ?? mode : '—'}
        statusTone={savedFlash ? 'success' : 'muted'}
      />
      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
        {/* 左栏：权重 slider + 模式 + 操作 */}
        <GlassCard className="space-y-5 p-6">
          <div className="flex items-center gap-2 text-[var(--color-ink)]">
            <SlidersHorizontal className="size-4 text-[var(--color-primary)]" />
            <h2 className="text-sm font-semibold tracking-tight">评分权重（8 维）</h2>
            <span className="ml-auto text-[11px] tabular-nums text-[var(--color-muted)]">
              权重和 <span className="text-[var(--color-ink)]">{weightSum.toFixed(2)}</span>
            </span>
          </div>

          <div className="space-y-4">
            {(data?.weightKeys ?? []).map((k) => {
              const v = weights[k] ?? 0;
              const pct = Math.round((v / (weightSum || 1)) * 100);
              return (
                <div key={k}>
                  <div className="mb-1 flex items-baseline justify-between text-xs">
                    <span className="text-[var(--color-body)]">{DIM_LABELS[k] ?? k}</span>
                    <span className="tabular-nums">
                      <span className="text-[var(--color-primary)]">{v.toFixed(2)}</span>
                      <span className="ml-1.5 text-[10px] text-[var(--color-muted)]">{pct}%</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={v}
                    onChange={(e) => setWeight(k, Number(e.target.value))}
                    aria-label={`${DIM_LABELS[k] ?? k} 权重`}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--color-surface-soft)] accent-[var(--color-primary)] outline-none"
                    style={{
                      background: `linear-gradient(to right, var(--color-primary) ${v * 100}%, var(--color-surface-soft) ${v * 100}%)`,
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* 路由模式切换 */}
          <div className="border-t border-[var(--color-hairline)] pt-4">
            <div className="mb-2 text-xs font-medium text-[var(--color-body)]">路由模式</div>
            <div className="flex flex-wrap gap-2">
              {(data?.modes ?? []).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={
                    'rounded-[var(--radius-md)] border px-2.5 py-1.5 text-[11px] transition-colors ' +
                    (mode === m
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/12 text-[var(--color-primary)]'
                      : 'border-[var(--color-hairline)] text-[var(--color-muted)] hover:border-[var(--color-hairline-strong)] hover:text-[var(--color-ink)]')
                  }
                >
                  {MODE_LABELS[m] ?? m}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 border-t border-[var(--color-hairline)] pt-4">
            <Button variant="primary" size="sm" onClick={onSave} disabled={save.isPending || !data}>
              {savedFlash ? <Check /> : <Save />}
              {savedFlash ? '已保存' : save.isPending ? '保存中…' : '保存为默认策略'}
            </Button>
            <Button variant="subtle" size="sm" onClick={reset} disabled={!data}>
              <RotateCcw />
              重置默认
            </Button>
          </div>
          {save.isError && (
            <p className="text-xs text-[var(--color-error)]">保存失败，请重试。</p>
          )}
        </GlassCard>

        {/* 右栏：实时 composite 预览 + 排名 */}
        <GlassCard className="space-y-4 p-6">
          <div className="flex items-center gap-2 text-[var(--color-ink)]">
            <Trophy className="size-4 text-[var(--color-primary)]" />
            <h2 className="text-sm font-semibold tracking-tight">实时排名预览</h2>
            <span className="ml-auto text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
              真实 top3 模型
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
            用三个真实模型的 9 维原始分 × 当前权重实时重算 composite（公式与后端 scorer 一致），
            拖动左侧 slider 即见名次重排。
          </p>

          <div className="space-y-3">
            {preview.length === 0 && (
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-hairline)] px-4 py-8 text-center text-xs text-[var(--color-muted)]">
                暂无样本模型评分数据
              </div>
            )}
            {preview.map((p, i) => {
              const delta = rankDelta(p.upstreamId, i);
              return (
                <div
                  key={p.upstreamId}
                  className="rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/40 p-3.5"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className={
                        'grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ' +
                        (i === 0
                          ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]'
                          : 'bg-[var(--color-surface-card)] text-[var(--color-muted)]')
                      }
                    >
                      {i + 1}
                    </span>
                    <span className="flex-1 truncate text-xs font-medium text-[var(--color-ink)]" title={p.upstreamId}>
                      {shortId(p.upstreamId)}
                    </span>
                    {delta !== 0 && (
                      <span
                        className={
                          'inline-flex items-center gap-0.5 text-[10px] tabular-nums ' +
                          (delta > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]')
                        }
                        title="相对上次保存/重置的名次变化"
                      >
                        {delta > 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
                        {Math.abs(delta)}
                      </span>
                    )}
                    <span className="tabular-nums text-xs font-semibold text-[var(--color-primary)]">
                      {p.composite.toFixed(3)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-soft)]">
                    <div
                      className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-200"
                      style={{ width: `${Math.max(2, (p.composite / maxComposite) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/30 px-3 py-2.5 text-[10px] leading-relaxed text-[var(--color-muted)]">
            composite = Σ(权重<sub>i</sub> × 原始分<sub>i</sub>)，i 遍历 8 维。
            排名箭头表示相对上次保存的名次升降。
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
