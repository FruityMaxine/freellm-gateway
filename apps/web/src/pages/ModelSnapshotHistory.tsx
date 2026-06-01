/**
 * 模型变更历史 + 快照 diff 页（组 8 Tick 3 v1.25.0.0）。
 *
 * 区别于 Models.tsx 详情弹窗的「近 10 条快照仅 takenAt+Badge」：本页是独立完整 diff 页 ——
 * 模型选择 → 快照时间线 + 相邻历史 diff 高亮（能力增删/上下文变化/free 变化）。
 */
import { useMemo, useState } from 'react';
import { History, Search, ArrowRight, Plus, Minus } from 'lucide-react';
import { PageHeader } from './_PageHeader';
import { GlassCard } from '@/components/bits/GlassCard';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  useSnapshotModels,
  useSnapshotHistory,
  type SnapshotModelRow,
  type SnapshotChange,
} from '@/lib/snapshot-history-hooks';

const CAP_LABELS: Record<string, string> = {
  stream: '流式',
  json: 'JSON',
  tools: '工具',
  vision: '视觉',
  audio: '音频',
  reasoning: '推理',
  longContext: '长上下文',
};

const shortId = (u: string) => u.split('/').pop() ?? u;
const capLabel = (k: string) => CAP_LABELS[k] ?? k;

function fmtContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function ModelSnapshotHistoryPage() {
  const { data: modelsData, isLoading: modelsLoading } = useSnapshotModels();
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const history = useSnapshotHistory(selected);

  const allModels = modelsData?.models ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allModels.filter((m) => !q || m.upstreamId.toLowerCase().includes(q)).slice(0, 60);
  }, [allModels, search]);

  const selModel = allModels.find((m) => m.modelId === selected);
  const timeline = history.data;

  return (
    <div>
      <PageHeader
        eyebrow="模型"
        title="变更历史"
        description="逐模型查看 ModelSnapshot 历史时间线与相邻快照 diff（能力增删 / 上下文变化 / 价格 free→paid），掌握模型池演变。"
        status={modelsLoading ? '加载中' : `${allModels.length} 模型有快照`}
        statusTone={modelsLoading ? 'warning' : 'success'}
      />

      <div className="mx-auto grid max-w-[1300px] gap-5 px-6 py-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* 模型选择器 */}
        <GlassCard className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Search className="size-4 text-[var(--color-muted)]" />
            <Input placeholder="搜索模型…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="max-h-[60vh] space-y-1 overflow-auto">
            {filtered.map((m) => (
              <ModelItem key={m.modelId} m={m} active={m.modelId === selected} onClick={() => setSelected(m.modelId)} />
            ))}
          </div>
        </GlassCard>

        {/* 时间线 + diff */}
        <div className="space-y-4">
          {!selected ? (
            <GlassCard className="p-10 text-center text-sm text-[var(--color-muted)]">
              从左侧选择一个模型查看其快照变更历史
            </GlassCard>
          ) : history.isLoading ? (
            <GlassCard className="p-10 text-center text-sm text-[var(--color-muted)]">正在加载快照历史 …</GlassCard>
          ) : (
            <>
              <GlassCard className="p-5">
                <div className="flex items-center gap-2">
                  <History className="size-4 text-[var(--color-primary)]" />
                  <h2 className="text-sm font-semibold text-[var(--color-ink)]">{shortId(selModel?.upstreamId ?? '')}</h2>
                  <Badge tone="muted">{timeline?.total ?? 0} 快照</Badge>
                  <Badge tone={(timeline?.changes.length ?? 0) > 0 ? 'warning' : 'success'}>
                    {timeline?.changes.length ?? 0} 处变更
                  </Badge>
                </div>
                {/* 快照时间线条 */}
                <div className="mt-4 flex flex-wrap gap-1">
                  {(timeline?.snapshots ?? []).map((s, i) => (
                    <span
                      key={i}
                      title={`${fmtTime(s.takenAt)} · ${s.isFree ? '免费' : '付费'} · ctx ${fmtContext(s.contextLength)}`}
                      className={'h-6 w-2 rounded-sm ' + (s.isFree ? 'bg-[var(--color-success)]/50' : 'bg-[var(--color-warning)]/50')}
                    />
                  ))}
                </div>
                <div className="mt-2 text-[10px] text-[var(--color-muted)]">
                  每竖条 = 一次快照（绿=免费 / 橙=付费），共 {timeline?.total ?? 0} 条
                </div>
              </GlassCard>

              {(timeline?.changes.length ?? 0) === 0 ? (
                <GlassCard className="p-8 text-center text-sm text-[var(--color-muted)]">
                  该模型在 {timeline?.total ?? 0} 个快照期间属性稳定，无能力 / 上下文 / 价格变化。
                </GlassCard>
              ) : (
                (timeline?.changes ?? []).map((c, i) => <ChangeCard key={i} c={c} />)
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ModelItem({ m, active, onClick }: { m: SnapshotModelRow; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        'flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] px-2.5 py-1.5 text-left text-xs transition-colors ' +
        (active
          ? 'bg-[var(--color-primary)]/12 text-[var(--color-primary)]'
          : 'text-[var(--color-body)] hover:bg-[var(--color-surface-soft)]')
      }
    >
      <span className="truncate" title={m.upstreamId}>{shortId(m.upstreamId)}</span>
      <span className="shrink-0 tabular-nums text-[10px] text-[var(--color-muted)]">{m.snapshotCount}</span>
    </button>
  );
}

function ChangeCard({ c }: { c: SnapshotChange }) {
  const fmtTimeLocal = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  return (
    <GlassCard className="p-4">
      <div className="mb-3 flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
        <span className="tabular-nums">{fmtTimeLocal(c.fromTakenAt)}</span>
        <ArrowRight className="size-3" />
        <span className="tabular-nums text-[var(--color-body)]">{fmtTimeLocal(c.toTakenAt)}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {c.capsAdded.map((k) => (
          <Badge key={`a-${k}`} tone="success">
            <Plus className="size-3" /> {capLabel(k)}
          </Badge>
        ))}
        {c.capsRemoved.map((k) => (
          <Badge key={`r-${k}`} tone="danger">
            <Minus className="size-3" /> {capLabel(k)}
          </Badge>
        ))}
        {c.contextFrom !== c.contextTo && (
          <Badge tone="info">
            上下文 {fmtContext(c.contextFrom)} → {fmtContext(c.contextTo)}
          </Badge>
        )}
        {c.freeFrom !== c.freeTo && (
          <Badge tone="warning">
            {c.freeFrom ? '免费' : '付费'} → {c.freeTo ? '免费' : '付费'}
          </Badge>
        )}
      </div>
    </GlassCard>
  );
}
