/**
 * 模型对比工具（组 6 Tick 4 v1.18.0.0）。
 *
 * 区别于 Models.tsx（单选单模型雷达）：本页多选 2-4 个模型，9 维评分雷达**叠加**对比
 * + composite/上下文/价格并排表，快速定位各模型强弱。复用扩展后的 ModelScoreRadar（多 series）。
 */
import { useMemo, useState } from 'react';
import { GitCompare, Search, X } from 'lucide-react';
import { PageHeader } from './_PageHeader';
import { Input } from '@/components/ui/input';
import { GlassCard } from '@/components/bits/GlassCard';
import { ModelScoreRadar, type RadarSeries, type ModelScoreDimensions } from '@/components/charts/ModelScoreRadar';
import { useModels } from '@/lib/admin-hooks';
import { useModelCompare, type ModelCompareRow } from '@/lib/model-compare-hooks';

const COLORS = ['#a3e635', '#38bdf8', '#fbbf24', '#f472b6'];

const DIM_LABELS: Array<[keyof ModelScoreDimensions, string]> = [
  ['availabilityScore', '可用性'],
  ['latencyScore', '延迟'],
  ['rateLimitScore', '限流'],
  ['qualityScore', '质量'],
  ['contextScore', '上下文'],
  ['capabilityScore', '能力'],
  ['freshnessScore', '新鲜度'],
  ['costScore', '成本'],
  ['stabilityScore', '稳定性'],
];

const shortId = (u: string) => u.split('/').pop() ?? u;

export function ModelComparePage() {
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const { data: modelsData } = useModels();
  const compare = useModelCompare(selected);

  const allModels = modelsData?.data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allModels.filter((m) => !q || m.upstreamId.toLowerCase().includes(q)).slice(0, 30);
  }, [allModels, search]);

  const rows = compare.data?.data ?? [];
  const series: RadarSeries[] = rows
    .filter((r) => r.scores)
    .map((r, i) => ({ name: shortId(r.upstreamId), scores: r.scores as ModelScoreDimensions, color: COLORS[i % COLORS.length] }));

  const toggle = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 4 ? [...s, id] : s));
  };

  return (
    <div>
      <PageHeader
        eyebrow="对比"
        title="模型对比"
        description="多选 2-4 个模型，9 维评分雷达叠加 + composite/上下文/价格并排对比，快速定位各模型强弱。"
        status={`已选 ${selected.length}/4`}
        statusTone={selected.length >= 2 ? 'success' : 'muted'}
      />
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <GlassCard className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Search className="size-4 text-[var(--color-muted)]" />
            <Input
              placeholder="搜索模型 upstreamId..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-md"
            />
          </div>
          {selected.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {selected.map((id, i) => {
                const m = allModels.find((x) => x.id === id);
                return (
                  <button
                    key={id}
                    onClick={() => toggle(id)}
                    className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] text-[#0a0a0a]"
                    style={{ background: COLORS[i % COLORS.length] }}
                  >
                    {m ? shortId(m.upstreamId) : id} <X className="size-3" />
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {filtered.map((m) => (
              <button
                key={m.id}
                onClick={() => toggle(m.id)}
                disabled={!selected.includes(m.id) && selected.length >= 4}
                className={`rounded px-2 py-1 font-mono text-[10px] ${
                  selected.includes(m.id)
                    ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]'
                    : 'bg-[var(--color-surface-soft)] text-[var(--color-muted)] disabled:opacity-40'
                }`}
              >
                {shortId(m.upstreamId)} {m.composite != null && `(${m.composite.toFixed(2)})`}
              </button>
            ))}
          </div>
        </GlassCard>

        {selected.length === 0 ? (
          <GlassCard className="p-8 text-center text-sm text-[var(--color-muted)]">
            <GitCompare className="mx-auto mb-3 size-6" /> 选择 2-4 个模型开始对比。
          </GlassCard>
        ) : (
          <>
            <GlassCard className="p-5">
              <div className="mb-3 text-sm font-medium text-[var(--color-ink)]">9 维评分雷达叠加</div>
              {series.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-sm text-[var(--color-muted)]">
                  所选模型暂无评分数据。
                </div>
              ) : (
                <ModelScoreRadar series={series} />
              )}
            </GlassCard>
            <GlassCard className="p-5">
              <div className="mb-3 text-sm font-medium text-[var(--color-ink)]">并排对比</div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-[var(--color-muted)]">
                      <th className="p-2 text-left">指标</th>
                      {rows.map((r, i) => (
                        <th key={r.id} className="p-2 text-right font-mono" style={{ color: COLORS[i % COLORS.length] }}>
                          {shortId(r.upstreamId)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <CompareRow label="Provider" rows={rows} get={(r) => r.providerSlug} />
                    <CompareRow label="综合分" rows={rows} get={(r) => r.composite?.toFixed(3) ?? '—'} />
                    <CompareRow label="上下文" rows={rows} get={(r) => r.contextLength.toLocaleString()} />
                    <CompareRow label="免费" rows={rows} get={(r) => (r.isFree ? '是' : '否')} />
                    {DIM_LABELS.map(([key, label]) => (
                      <CompareRow key={key} label={label} rows={rows} get={(r) => (r.scores ? r.scores[key].toFixed(2) : '—')} />
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          </>
        )}
      </div>
    </div>
  );
}

function CompareRow({
  label,
  rows,
  get,
}: {
  label: string;
  rows: ModelCompareRow[];
  get: (r: ModelCompareRow) => string;
}) {
  return (
    <tr className="border-t border-[var(--color-hairline)]">
      <td className="p-2 text-left text-[var(--color-muted)]">{label}</td>
      {rows.map((r) => (
        <td key={r.id} className="p-2 text-right tabular text-[var(--color-body-strong)]">
          {get(r)}
        </td>
      ))}
    </tr>
  );
}
