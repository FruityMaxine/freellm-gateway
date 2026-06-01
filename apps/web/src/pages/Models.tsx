import { useMemo, useRef, useState } from 'react';
import {
  CheckSquare,
  Download,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShieldOff,
  Sparkles,
  Square,
  Upload,
  X,
} from 'lucide-react';
import { PageHeader } from './_PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DataTable, type Column } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/data/StatusBadge';
import { GlassCard } from '@/components/bits/GlassCard';
import {
  useModels,
  useRefreshModels,
  usePatchModel,
  useEvaluateAutoBlacklist,
  useBulkPatchModels,
  useExportModels,
  useImportModels,
  useModelDetail,
  type BulkAction,
  type ModelRow,
} from '@/lib/admin-hooks';
import { ModelScoreRadar } from '@/components/charts/ModelScoreRadar';
import { timeAgo } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type FreeFilter = 'all' | 'free' | 'paid';
type StatusFilter = 'all' | 'active' | 'degraded' | 'rate_limited' | 'disabled' | 'paid_now';

export function ModelsStub() {
  const [search, setSearch] = useState('');
  const [freeFilter, setFreeFilter] = useState<FreeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedRow, setSelectedRow] = useState<ModelRow | null>(null);
  // Tick 44 v1.7.16.0：拉模型详情含 ModelScore 9 维 + errorEvents
  const detail = useModelDetail(selectedRow?.id ?? null);

  const { data, isLoading, refetch, isFetching } = useModels({
    ...(freeFilter !== 'all' ? { free: (freeFilter === 'free' ? 'true' : 'false') as 'true' | 'false' } : {}),
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(search ? { search } : {}),
  });
  const refresh = useRefreshModels();
  const patch = usePatchModel();
  const evaluateBlacklist = useEvaluateAutoBlacklist();
  // Tick 35 v1.7.7.0：批量管理
  const bulkPatch = useBulkPatchModels();
  const exportModels = useExportModels();
  const importModels = useImportModels();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const rows = useMemo(() => data?.data ?? [], [data]);
  const families = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const k = r.family ?? '—';
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [rows]);

  const allVisibleSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const toggleAll = () => {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const r of rows) next.delete(r.id);
        return next;
      }
      const next = new Set(prev);
      for (const r of rows) next.add(r.id);
      return next;
    });
  };

  const runBulk = (action: BulkAction) => {
    if (selectedIds.size === 0) {
      toast.error('请先勾选至少一个模型');
      return;
    }
    const ids = Array.from(selectedIds);
    const labelMap: Record<BulkAction, string> = {
      blacklist: '加入黑名单',
      whitelist: '加入白名单',
      enable: '强制启用',
      disable: '强制禁用',
      reset: '清空覆盖',
    };
    toast.promise(bulkPatch.mutateAsync({ ids, action }), {
      loading: `正在对 ${ids.length} 个模型执行 ${labelMap[action]} …`,
      success: (r) => {
        setSelectedIds(new Set());
        return `${labelMap[action]} 完成：${r.modified}/${r.requested}`;
      },
      error: '批量操作失败',
    });
  };

  const onExport = async () => {
    try {
      const result = await exportModels.mutateAsync();
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `freellm-models-override-${new Date().toISOString()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${result.total} 个模型配置`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const json = JSON.parse(String(reader.result));
        const models = Array.isArray(json) ? json : json.models;
        if (!Array.isArray(models)) {
          toast.error('JSON 格式错误：缺少 models 数组');
          return;
        }
        const r = await importModels.mutateAsync(models);
        toast.success(`导入完成：修改 ${r.modified} 个，跳过 ${r.skipped} 个`);
      } catch (e) {
        toast.error((e as Error).message);
      }
    };
    reader.readAsText(file);
  };

  const columns: Column<ModelRow>[] = [
    {
      id: 'select',
      header: (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleAll();
          }}
          className="grid place-items-center"
          aria-label="选择全部"
        >
          {allVisibleSelected ? (
            <CheckSquare className="size-4 text-[var(--color-primary)]" />
          ) : (
            <Square className="size-4 text-[var(--color-muted)]" />
          )}
        </button>
      ) as unknown as string,
      cell: (r) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedIds((prev) => {
              const next = new Set(prev);
              if (next.has(r.id)) next.delete(r.id);
              else next.add(r.id);
              return next;
            });
          }}
          className="grid place-items-center"
        >
          {selectedIds.has(r.id) ? (
            <CheckSquare className="size-4 text-[var(--color-primary)]" />
          ) : (
            <Square className="size-4 text-[var(--color-muted)]" />
          )}
        </button>
      ),
      width: '0.3fr',
    },
    {
      id: 'upstreamId',
      header: '模型',
      cell: (r) => (
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-[12px] text-[var(--color-body-strong)]">{r.upstreamId}</span>
            {/* Tick 34 v1.7.6.0：自动黑名单标记 */}
            {r.autoBlacklisted && (
              <span
                className="inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--color-warning)]"
                title={r.notes ?? '自动黑名单'}
              >
                <ShieldOff className="size-2.5" /> 自动黑名单
              </span>
            )}
          </div>
          <span className="truncate text-[11px] text-[var(--color-muted)]">{r.displayName}</span>
        </div>
      ),
      sortable: true,
      sortKey: (r) => r.upstreamId,
      width: '2.4fr',
    },
    { id: 'provider', header: '上游', cell: (r) => <span>{r.providerSlug}</span>, sortable: true, sortKey: (r) => r.providerSlug, width: '1fr' },
    { id: 'family', header: '系列', cell: (r) => <Badge tone="muted">{r.family ?? '—'}</Badge>, width: '0.8fr' },
    {
      id: 'isFree',
      header: '计费',
      cell: (r) => <Badge tone={r.isFree ? 'primary' : 'muted'}>{r.isFree ? '免费' : '付费'}</Badge>,
      width: '0.6fr',
      sortable: true,
      sortKey: (r) => (r.isFree ? 0 : 1),
    },
    {
      id: 'ctx',
      header: '上下文',
      cell: (r) => <span className="tabular">{(r.contextLength ?? 0).toLocaleString()}</span>,
      align: 'right',
      sortable: true,
      sortKey: (r) => r.contextLength,
      width: '0.8fr',
    },
    {
      id: 'score',
      header: '评分',
      cell: (r) => (
        <span className={cn('tabular', r.composite && r.composite > 0.6 ? 'text-[var(--color-primary)]' : '')}>
          {(r.composite ?? 0).toFixed(2)}
        </span>
      ),
      align: 'right',
      sortable: true,
      sortKey: (r) => r.composite ?? 0,
      width: '0.6fr',
    },
    { id: 'status', header: '状态', cell: (r) => <StatusBadge status={r.status} />, width: '0.8fr' },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="模型池"
        title="模型管理"
        description={`已发现 ${data?.total ?? 0} 个模型，覆盖全部上游池，可通过搜索 + 筛选钻取。`}
        status={isFetching ? '同步中' : '实时'}
        statusTone={isFetching ? 'warning' : 'success'}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} /> 重新拉取
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                toast.promise(refresh.mutateAsync(undefined), {
                  loading: '正在拉取模型 …',
                  success: (d) => `已刷新 ${d.reports?.[0]?.discovered ?? 0} 个模型`,
                  error: '刷新失败',
                })
              }
              disabled={refresh.isPending}
            >
              {refresh.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              重新拉取上游
            </Button>
            {/* Tick 34 v1.7.6.0：手动触发自动黑名单评估（cron 也会定时跑） */}
            <Button
              variant="subtle"
              size="sm"
              onClick={() =>
                toast.promise(evaluateBlacklist.mutateAsync(), {
                  loading: '正在评估健康状况 …',
                  success: (r) =>
                    r.blacklisted.length === 0
                      ? `评估完成（${r.evaluated} 个模型）：无新黑名单`
                      : `评估完成：${r.blacklisted.length} 个模型加入自动黑名单`,
                  error: '评估失败',
                })
              }
              disabled={evaluateBlacklist.isPending}
            >
              <ShieldOff className="size-3.5" /> 评估黑名单
            </Button>
            {/* Tick 35 v1.7.7.0：导入 / 导出 JSON */}
            <Button variant="ghost" size="sm" onClick={onExport} disabled={exportModels.isPending}>
              <Download className="size-3.5" /> 导出 JSON
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={importModels.isPending}
            >
              <Upload className="size-3.5" /> 导入 JSON
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) onImport(f);
                e.currentTarget.value = '';
              }}
            />
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted)]" />
            <Input value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder="上游 ID / 名称 / 系列" className="pl-9" />
          </div>

          <div className="inline-flex rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] p-1 text-xs">
            {(['all', 'free', 'paid'] as FreeFilter[]).map((f) => (
              <button key={f} onClick={() => setFreeFilter(f)} className={cn('rounded-[var(--radius-sm)] px-3 py-1.5', freeFilter === f ? 'bg-[var(--color-surface-card)] text-[var(--color-ink)]' : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]')}>{f === 'all' ? '全部' : f === 'free' ? '免费' : '付费'}</button>
            ))}
          </div>

          <div className="inline-flex rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] p-1 text-xs">
            {(['all', 'active', 'degraded', 'rate_limited', 'disabled', 'paid_now'] as StatusFilter[]).map((s) => {
              const label = { all: '全部', active: '可用', degraded: '降级', rate_limited: '限流', disabled: '禁用', paid_now: '转付费' }[s];
              return (
                <button key={s} onClick={() => setStatusFilter(s)} className={cn('rounded-[var(--radius-sm)] px-2.5 py-1.5', statusFilter === s ? 'bg-[var(--color-surface-card)] text-[var(--color-ink)]' : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]')}>{label}</button>
              );
            })}
          </div>

          <div className="ml-auto inline-flex items-center gap-2 text-xs text-[var(--color-muted)]"><Filter className="size-3.5" /> {rows.length} / {data?.total ?? 0}</div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {families.map(([family, count]) => (
            <button key={family} onClick={() => setSearch(family === '—' ? '' : family)} className="rounded-full border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/70 px-2.5 py-1 text-[11px] uppercase tracking-wider text-[var(--color-muted)] hover:border-[var(--color-primary)]/40 hover:text-[var(--color-primary)]">{family} · {count}</button>
          ))}
        </div>
      </PageHeader>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Tick 35 v1.7.7.0：批量操作工具条 — 选中 ≥1 个模型时显示 */}
        {selectedIds.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 px-4 py-2.5 text-sm">
            <div className="text-[var(--color-ink)]">
              已选中 <span className="tabular font-semibold">{selectedIds.size}</span> 个模型
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => runBulk('blacklist')} disabled={bulkPatch.isPending}>
                加入黑名单
              </Button>
              <Button variant="ghost" size="sm" onClick={() => runBulk('whitelist')} disabled={bulkPatch.isPending}>
                加入白名单
              </Button>
              <Button variant="ghost" size="sm" onClick={() => runBulk('enable')} disabled={bulkPatch.isPending}>
                强制启用
              </Button>
              <Button variant="ghost" size="sm" onClick={() => runBulk('disable')} disabled={bulkPatch.isPending}>
                强制禁用
              </Button>
              <Button variant="ghost" size="sm" onClick={() => runBulk('reset')} disabled={bulkPatch.isPending}>
                清空覆盖
              </Button>
              <Button variant="subtle" size="sm" onClick={() => setSelectedIds(new Set())}>
                <X className="size-3.5" /> 清空选择
              </Button>
            </div>
          </div>
        )}
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => setSelectedRow(r)}
          loading={isLoading}
          empty={
            <div>
              <div>当前筛选条件下没有匹配的模型。</div>
              <Button variant="link" size="sm" onClick={() => { setSearch(''); setFreeFilter('all'); setStatusFilter('all'); }}>清除筛选</Button>
            </div>
          }
        />
      </div>

      <Dialog open={!!selectedRow} onOpenChange={(o) => !o && setSelectedRow(null)}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>{selectedRow?.upstreamId}</DialogTitle>
              <button onClick={() => setSelectedRow(null)} className="text-[var(--color-muted)] hover:text-[var(--color-ink)]"><X className="size-4" /></button>
            </div>
            <DialogDescription>{selectedRow?.displayName}</DialogDescription>
          </DialogHeader>
          {selectedRow && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                {[
                  ['上游', selectedRow.providerSlug],
                  ['系列', selectedRow.family ?? '—'],
                  ['上下文', selectedRow.contextLength.toLocaleString()],
                  ['计费', selectedRow.isFree ? '免费' : '付费'],
                  ['综合分', (selectedRow.composite ?? 0).toFixed(2)],
                  ['状态', selectedRow.status],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">{k}</div>
                    <div className="mt-0.5 font-mono text-[var(--color-ink)]">{v}</div>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wider text-[var(--color-muted)]">手动覆盖</div>
                <div className="flex flex-wrap gap-2">
                  <Button variant={selectedRow.status === 'disabled' ? 'danger' : 'subtle'} size="sm" onClick={async () => {
                      await patch.mutateAsync({ id: selectedRow.id, manualOverride: selectedRow.status === 'disabled' ? 'force_enabled' : 'force_disabled' });
                      toast.success(selectedRow.status === 'disabled' ? '已启用' : '已禁用');
                      setSelectedRow(null);
                    }}>{selectedRow.status === 'disabled' ? '启用' : '禁用'}</Button>
                  <Button variant={selectedRow.blacklisted ? 'danger' : 'outline'} size="sm" onClick={async () => {
                      await patch.mutateAsync({ id: selectedRow.id, blacklisted: !selectedRow.blacklisted });
                      toast.success(selectedRow.blacklisted ? '已移出黑名单' : '已加入黑名单');
                      setSelectedRow(null);
                    }}>{selectedRow.blacklisted ? '取消拉黑' : '加入黑名单'}</Button>
                  <Button variant={selectedRow.whitelisted ? 'primary' : 'outline'} size="sm" onClick={async () => {
                      await patch.mutateAsync({ id: selectedRow.id, whitelisted: !selectedRow.whitelisted });
                      toast.success(selectedRow.whitelisted ? '已移出白名单' : '已加入白名单');
                      setSelectedRow(null);
                    }}>{selectedRow.whitelisted ? '取消加白' : '加入白名单'}</Button>
                </div>

                <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/70 p-3">
                  <div className="flex items-center justify-between text-xs text-[var(--color-body)]">
                    <span>权重调整</span>
                    <span className="tabular text-[var(--color-primary)]">{selectedRow.weightAdj.toFixed(2)}</span>
                  </div>
                  <input type="range" min={-1} max={1} step={0.1} defaultValue={selectedRow.weightAdj} onChange={(e) => { void patch.mutateAsync({ id: selectedRow.id, weightAdj: Number.parseFloat(e.currentTarget.value) }); }} className="mt-2 w-full accent-[var(--color-primary)]" />
                </div>
              </div>

              {/* Tick 44 v1.7.16.0：评分维度雷达图（ModelScore 9 维） */}
              <GlassCard className="p-4">
                <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wider text-[var(--color-muted)]">
                  <span>评分维度</span>
                  {detail.data?.scores?.updatedAt && (
                    <span className="text-[10px]">
                      更新于 {timeAgo(detail.data.scores.updatedAt)}
                    </span>
                  )}
                </div>
                {detail.isLoading ? (
                  <div className="grid h-[200px] place-items-center text-xs text-[var(--color-muted)]">
                    正在加载评分 …
                  </div>
                ) : detail.data?.scores ? (
                  <>
                    <ModelScoreRadar
                      scores={detail.data.scores}
                      composite={detail.data.scores.composite}
                    />
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                      <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)]/60 px-2 py-1.5">
                        <div className="uppercase tracking-wider text-[var(--color-muted)]">24h 成功</div>
                        <div className="mt-0.5 tabular text-[var(--color-success)]">
                          {detail.data.scores.successCount24h}
                        </div>
                      </div>
                      <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)]/60 px-2 py-1.5">
                        <div className="uppercase tracking-wider text-[var(--color-muted)]">24h 失败</div>
                        <div className="mt-0.5 tabular text-[var(--color-error)]">
                          {detail.data.scores.failureCount24h}
                        </div>
                      </div>
                      <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)]/60 px-2 py-1.5">
                        <div className="uppercase tracking-wider text-[var(--color-muted)]">24h 429</div>
                        <div className="mt-0.5 tabular text-[var(--color-warning)]">
                          {detail.data.scores.rateLimit24h}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="grid h-[200px] place-items-center text-xs text-[var(--color-muted)]">
                    暂无评分数据。
                  </div>
                )}
              </GlassCard>

              {/* Tick 44 v1.7.16.0：近 20 条错误事件 */}
              {detail.data?.errorEvents && detail.data.errorEvents.length > 0 && (
                <GlassCard className="p-4">
                  <div className="mb-2 text-xs uppercase tracking-wider text-[var(--color-muted)]">
                    最近错误事件（{detail.data.errorEvents.length}）
                  </div>
                  <div className="max-h-40 space-y-1.5 overflow-auto text-[11px]">
                    {detail.data.errorEvents.map((e) => (
                      <div
                        key={e.id}
                        className="flex items-start justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/60 px-2.5 py-1.5"
                      >
                        <div className="flex-1 break-words">
                          <span
                            className={cn(
                              'mr-1.5 inline-block rounded px-1.5 text-[9px] uppercase tracking-wider',
                              e.severity === 'error' || e.severity === 'critical'
                                ? 'bg-[var(--color-error)]/15 text-[var(--color-error)]'
                                : 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]',
                            )}
                          >
                            {e.kind}
                          </span>
                          <span className="text-[var(--color-ink)]">{e.message}</span>
                        </div>
                        <span className="shrink-0 text-[10px] tabular text-[var(--color-muted)]">
                          {timeAgo(e.createdAt)}
                          {e.resolvedAt ? ' · ✓' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </GlassCard>
              )}

              {/* Tick 44 v1.7.16.0：近 10 条 ModelSnapshot 历史 */}
              {detail.data?.snapshots && detail.data.snapshots.length > 0 && (
                <GlassCard className="p-4">
                  <div className="mb-2 text-xs uppercase tracking-wider text-[var(--color-muted)]">
                    快照历史（近 {detail.data.snapshots.length} 次发现）
                  </div>
                  <div className="space-y-1 text-[11px]">
                    {detail.data.snapshots.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)]/60 px-2.5 py-1"
                      >
                        <span className="text-[var(--color-muted)]">{timeAgo(s.takenAt)}</span>
                        <Badge tone={s.isFree ? 'primary' : 'muted'}>
                          {s.isFree ? '免费' : '付费'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </GlassCard>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
