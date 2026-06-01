/**
 * 组织/项目成本分摊报表页（组 8 Tick 4 v1.26.0.0）。
 *
 * 区别于 CostAnalytics（VK/模型维度）：本页按 organization → project 维度聚合成本，
 * 组织成本卡 + 占比条 + 点击下钻项目明细。
 */
import { useState } from 'react';
import { Landmark, ChevronDown, ChevronRight, FolderTree } from 'lucide-react';
import { PageHeader } from './_PageHeader';
import { GlassCard } from '@/components/bits/GlassCard';
import { Badge } from '@/components/ui/badge';
import { useOrgCost, type OrgCost } from '@/lib/org-cost-hooks';

const WINDOWS = [
  { days: 1, label: '今日' },
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' },
] as const;

const fmtUsd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(3)}`;
const fmtNum = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

export function OrgCostBreakdownPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useOrgCost(days);

  const orgs = data?.organizations ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="成本"
        title="组织成本分摊"
        description="按组织 → 项目维度聚合成本，组织成本卡 + 占比条 + 下钻项目明细。区别于成本分析的 VK/模型维度。"
        status={isLoading ? '加载中' : `总计 ${fmtUsd(data?.totalCost ?? 0)}`}
        statusTone={isLoading ? 'warning' : 'success'}
        actions={
          <div className="flex gap-1">
            {WINDOWS.map((w) => (
              <button
                key={w.days}
                onClick={() => setDays(w.days)}
                className={
                  'rounded-[var(--radius-md)] px-2.5 py-1.5 text-xs transition-colors ' +
                  (days === w.days
                    ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]')
                }
              >
                {w.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="mx-auto max-w-4xl space-y-4 px-6 py-6">
        {isLoading ? (
          <GlassCard className="p-8 text-center text-sm text-[var(--color-muted)]">正在加载成本分摊 …</GlassCard>
        ) : orgs.length === 0 ? (
          <GlassCard className="p-8 text-center text-sm text-[var(--color-muted)]">
            窗口内无带组织标签的成本记录。请求需携带 organizationId 才会计入分摊。
          </GlassCard>
        ) : (
          orgs.map((o) => <OrgCard key={o.organizationId} o={o} totalCost={data?.totalCost ?? 0} />)
        )}
      </div>
    </div>
  );
}

function OrgCard({ o, totalCost }: { o: OrgCost; totalCost: number }) {
  const [open, setOpen] = useState(true);
  return (
    <GlassCard className="p-5">
      <button onClick={() => setOpen((s) => !s)} className="flex w-full items-center gap-3 text-left">
        <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
          <Landmark className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--color-ink)]">{o.name}</h3>
            <Badge tone="primary">{o.pct}%</Badge>
            {open ? (
              <ChevronDown className="ml-auto size-4 text-[var(--color-muted)]" />
            ) : (
              <ChevronRight className="ml-auto size-4 text-[var(--color-muted)]" />
            )}
          </div>
          <div className="mt-1 flex items-center gap-x-3 text-[11px] tabular-nums text-[var(--color-muted)]">
            <span className="font-semibold text-[var(--color-primary)]">{fmtUsd(o.cost)}</span>
            <span>{o.requests} 请求</span>
            <span>{fmtNum(o.tokens)} tok</span>
          </div>
        </div>
      </button>

      {/* 占比条 */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-soft)]">
        <div
          className="h-full rounded-full bg-[var(--color-primary)]"
          style={{ width: `${totalCost > 0 ? Math.min(100, (o.cost / totalCost) * 100) : 0}%` }}
        />
      </div>

      {/* 项目下钻 */}
      {open && o.projects.length > 0 && (
        <div className="mt-4 space-y-1.5 border-t border-[var(--color-hairline)] pt-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
            <FolderTree className="size-3" /> 项目明细
          </div>
          {o.projects.map((p) => (
            <div key={p.projectId} className="flex items-center gap-2 text-xs">
              <span className="flex-1 truncate text-[var(--color-body)]">{p.name}</span>
              <span className="tabular-nums text-[var(--color-muted)]">{p.requests} 请求</span>
              <span className="tabular-nums text-[var(--color-muted)]">{fmtNum(p.tokens)} tok</span>
              <span className="w-16 text-right font-semibold tabular-nums text-[var(--color-primary)]">{fmtUsd(p.cost)}</span>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
