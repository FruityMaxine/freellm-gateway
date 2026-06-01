/**
 * 模型能力矩阵页（组 7 Tick 3 v1.21.0.0）。
 *
 * 区别于 ModelCompare（2-4 模型选择对比雷达）：本页是**全部模型 × 全部能力**的一屏矩阵总览 ——
 * 7 维能力 Check/X 矩阵 + 按能力筛选（只看支持 vision/tools…）+ 按上下文/价格排序 + 顶部覆盖统计。
 */
import { useMemo, useState } from 'react';
import { LayoutGrid, Search, Check, X, Filter } from 'lucide-react';
import { PageHeader } from './_PageHeader';
import { GlassCard } from '@/components/bits/GlassCard';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useCapabilityMatrix, type CapabilityMatrixRow } from '@/lib/capability-matrix-hooks';

const CAP_ORDER = ['stream', 'json', 'tools', 'vision', 'audio', 'reasoning', 'longContext'] as const;
const CAP_LABELS: Record<string, string> = {
  stream: '流式',
  json: 'JSON',
  tools: '工具',
  vision: '视觉',
  audio: '音频',
  reasoning: '推理',
  longContext: '长上下文',
};

type SortKey = 'name' | 'context' | 'price';

const shortId = (u: string) => (u.length > 38 ? u.slice(0, 36) + '…' : u);

function fmtContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function fmtPrice(perToken: number | null): string {
  if (perToken == null) return '—';
  // OpenRouter auto-router 等用负值表示动态定价（如 -1），不当作真实负价展示。
  if (perToken < 0) return '动态';
  const per1M = perToken * 1_000_000;
  if (per1M === 0) return '$0';
  return `$${per1M >= 1 ? per1M.toFixed(2) : per1M.toFixed(3)}`;
}

export function ModelCapabilityMatrixPage() {
  const { data, isLoading } = useCapabilityMatrix();
  const [search, setSearch] = useState('');
  const [capFilter, setCapFilter] = useState<Set<string>>(new Set());
  const [freeOnly, setFreeOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('context');

  const models = data?.models ?? [];
  const stats = data?.stats ?? {};

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const caps = [...capFilter];
    const rows = models.filter((m) => {
      if (q && !m.upstreamId.toLowerCase().includes(q) && !(m.family ?? '').toLowerCase().includes(q))
        return false;
      if (freeOnly && !m.isFree) return false;
      for (const c of caps) if (!m.capabilities[c]) return false;
      return true;
    });
    rows.sort((a, b) => {
      if (sortKey === 'name') return a.upstreamId.localeCompare(b.upstreamId);
      if (sortKey === 'context') return b.contextLength - a.contextLength;
      // price asc，null 排最后
      const pa = a.promptPrice ?? Infinity;
      const pb = b.promptPrice ?? Infinity;
      return pa - pb;
    });
    return rows;
  }, [models, search, capFilter, freeOnly, sortKey]);

  const toggleCap = (c: string) =>
    setCapFilter((s) => {
      const n = new Set(s);
      n.has(c) ? n.delete(c) : n.add(c);
      return n;
    });

  return (
    <div>
      <PageHeader
        eyebrow="模型"
        title="能力矩阵"
        description="全部模型 × 7 维能力一屏总览（流式/JSON/工具/视觉/音频/推理/长上下文），按能力筛选 + 上下文/价格排序 + 覆盖统计。"
        status={isLoading ? '加载中' : `${data?.total ?? 0} 模型`}
        statusTone={isLoading ? 'warning' : 'success'}
      />

      <div className="mx-auto max-w-[1400px] space-y-5 px-6 py-6">
        {/* 能力覆盖统计卡 */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {CAP_ORDER.map((c) => {
            const s = stats[c];
            return (
              <GlassCard key={c} className="p-3">
                <div className="text-[11px] text-[var(--color-muted)]">{CAP_LABELS[c]}</div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--color-ink)]">
                  {s ? `${s.pct}%` : '—'}
                </div>
                <div className="mb-1 text-[10px] tabular-nums text-[var(--color-muted)]">
                  {s ? `${s.supported}/${s.total}` : ''}
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-surface-soft)]">
                  <div
                    className="h-full rounded-full bg-[var(--color-primary)]"
                    style={{ width: `${s?.pct ?? 0}%` }}
                  />
                </div>
              </GlassCard>
            );
          })}
        </div>

        {/* 工具条 */}
        <GlassCard className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-[220px] flex-1 items-center gap-2">
              <Search className="size-4 shrink-0 text-[var(--color-muted)]" />
              <Input
                placeholder="搜索 upstreamId / family…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[var(--color-muted)]">排序</span>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="h-9 rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-2.5 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
              >
                <option value="context">上下文降序</option>
                <option value="price">价格升序</option>
                <option value="name">名称</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-muted)]">
              <Filter className="size-3" /> 能力筛选
            </span>
            {CAP_ORDER.map((c) => (
              <button
                key={c}
                onClick={() => toggleCap(c)}
                className={
                  'rounded-full border px-2.5 py-1 text-[11px] transition-colors ' +
                  (capFilter.has(c)
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]'
                    : 'border-[var(--color-hairline)] text-[var(--color-muted)] hover:text-[var(--color-ink)]')
                }
              >
                {CAP_LABELS[c]}
              </button>
            ))}
            <button
              onClick={() => setFreeOnly((f) => !f)}
              className={
                'rounded-full border px-2.5 py-1 text-[11px] transition-colors ' +
                (freeOnly
                  ? 'border-[var(--color-success)] bg-[var(--color-success)]/15 text-[var(--color-success)]'
                  : 'border-[var(--color-hairline)] text-[var(--color-muted)] hover:text-[var(--color-ink)]')
              }
            >
              仅免费
            </button>
            <span className="ml-auto text-[11px] tabular-nums text-[var(--color-muted)]">
              {filtered.length} / {data?.total ?? 0}
            </span>
          </div>
        </GlassCard>

        {/* 矩阵表 */}
        <GlassCard className="overflow-hidden p-0">
          <div className="max-h-[62vh] overflow-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-[var(--color-surface-card)]">
                <tr className="border-b border-[var(--color-hairline-strong)] text-[var(--color-muted)]">
                  <th className="px-3 py-2.5 text-left font-medium">模型</th>
                  {CAP_ORDER.map((c) => (
                    <th key={c} className="px-2 py-2.5 text-center font-medium">
                      {CAP_LABELS[c]}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-right font-medium">上下文</th>
                  <th className="px-3 py-2.5 text-right font-medium">输入价/1M</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-10 text-center text-[var(--color-muted)]">
                      正在加载能力矩阵 …
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-10 text-center text-[var(--color-muted)]">
                      无匹配模型，调整筛选条件
                    </td>
                  </tr>
                ) : (
                  filtered.map((m) => <MatrixRow key={m.id} m={m} />)
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

function MatrixRow({ m }: { m: CapabilityMatrixRow }) {
  return (
    <tr className="border-b border-[var(--color-hairline)] hover:bg-[var(--color-surface-soft)]/40">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-[var(--color-ink)]" title={m.upstreamId}>
            {shortId(m.upstreamId)}
          </span>
          {m.isFree && <Badge tone="success">免费</Badge>}
        </div>
        <div className="text-[10px] text-[var(--color-muted)]">{m.providerSlug}</div>
      </td>
      {CAP_ORDER.map((c) => (
        <td key={c} className="px-2 py-2 text-center">
          {m.capabilities[c] ? (
            <Check className="mx-auto size-4 text-[var(--color-success)]" />
          ) : (
            <X className="mx-auto size-3.5 text-[var(--color-hairline-strong)]" />
          )}
        </td>
      ))}
      <td className="px-3 py-2 text-right tabular-nums text-[var(--color-body)]">
        {fmtContext(m.contextLength)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-[var(--color-body)]">
        {fmtPrice(m.promptPrice)}
      </td>
    </tr>
  );
}
