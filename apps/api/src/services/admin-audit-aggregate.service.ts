/**
 * 管理员审计聚合统计服务（Tick 43 v1.7.15.0 引入）。
 *
 * Tick 29 落了 AdminAuditLog 详细日志，本服务提供反向聚合视图：
 *   - byUser：按 username 分组，看"谁改东西最多"
 *   - byResource：按 resourceType 分组，看"哪类资源被改最频繁"
 *   - byAction：按 action 分组，看 create/update/delete/login 的操作分布
 *   - byDay：按 yyyy-mm-dd 聚合（JS 端 bucket，SQLite 没有 date_trunc），
 *     供前端折线图画"近 N 天审计活动趋势"
 *
 * 设计：所有维度统一 since/until 时间窗口；每个 bucket 含 count + 失败比例（
 * status >= 400 占比）便于看"哪个用户失败操作最多"。
 */
import type { PrismaClient } from '@prisma/client';

export type AuditStatsDimension = 'user' | 'resource' | 'action' | 'day';

export interface AuditStatsBucket {
  key: string; // username / resourceType / action / yyyy-mm-dd
  total: number;
  failed: number; // status >= 400
  failureRate: number; // 0-1
}

export interface AuditStatsResult {
  dimension: AuditStatsDimension;
  windowStart: string;
  windowEnd: string;
  buckets: AuditStatsBucket[];
  totalEvents: number;
  generatedAt: string;
}

export interface AuditStatsOptions {
  since?: Date;
  until?: Date;
  /** topN 限制（按 total 降序裁剪），默认 20。byDay 维度自动忽略此参数（按时间排序全返回）。 */
  topN?: number;
}

export class AdminAuditAggregateService {
  constructor(private readonly prisma: PrismaClient) {}

  async stats(dimension: AuditStatsDimension, opts: AuditStatsOptions = {}): Promise<AuditStatsResult> {
    const windowEnd = opts.until ?? new Date();
    const windowStart = opts.since ?? new Date(windowEnd.getTime() - 7 * 24 * 60 * 60_000);
    const topN = opts.topN ?? 20;

    if (dimension === 'day') {
      return this.statsByDay(windowStart, windowEnd);
    }

    const groupByField = (
      { user: 'username', resource: 'resourceType', action: 'action' } as const
    )[dimension];

    const [totalRows, failedRows] = await Promise.all([
      this.prisma.adminAuditLog.groupBy({
        by: [groupByField],
        where: { createdAt: { gte: windowStart, lte: windowEnd } },
        _count: { _all: true },
      }),
      this.prisma.adminAuditLog.groupBy({
        by: [groupByField],
        where: {
          createdAt: { gte: windowStart, lte: windowEnd },
          status: { gte: 400 },
        },
        _count: { _all: true },
      }),
    ]);

    const failedMap = new Map(
      failedRows.map((r) => [r[groupByField] as string, r._count._all]),
    );
    const buckets: AuditStatsBucket[] = totalRows
      .map((r) => {
        const key = (r[groupByField] as string) ?? 'unknown';
        const total = r._count._all;
        const failed = failedMap.get(key) ?? 0;
        return {
          key,
          total,
          failed,
          failureRate: total === 0 ? 0 : Math.round((failed / total) * 1000) / 1000,
        };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, topN);

    return {
      dimension,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      buckets,
      totalEvents: totalRows.reduce((acc, r) => acc + r._count._all, 0),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * 按日聚合（SQLite 无 date_trunc → JS 端 findMany 后桶分）。
   * 按窗口天数生成完整空桶（避免折线图断点）。
   */
  private async statsByDay(windowStart: Date, windowEnd: Date): Promise<AuditStatsResult> {
    const rows = await this.prisma.adminAuditLog.findMany({
      where: { createdAt: { gte: windowStart, lte: windowEnd } },
      select: { createdAt: true, status: true },
    });

    const startDay = new Date(
      Date.UTC(
        windowStart.getUTCFullYear(),
        windowStart.getUTCMonth(),
        windowStart.getUTCDate(),
      ),
    );
    // 桶数应覆盖从 startDay 到 windowEnd 的全部 UTC 日期（含两端）。
    // 例：windowStart=05-16 16:00 → startDay=05-16 00:00 → windowEnd=05-23 16:00
    // diff = 7.66 天 → ceil=8 → buckets 覆盖 05-16..05-23 (8 天)
    const dayCount = Math.max(
      1,
      Math.ceil((windowEnd.getTime() - startDay.getTime()) / (24 * 60 * 60_000)),
    );

    const buckets: AuditStatsBucket[] = Array.from({ length: dayCount }, (_, i) => {
      const d = new Date(startDay.getTime() + i * 24 * 60 * 60_000);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
        d.getUTCDate(),
      ).padStart(2, '0')}`;
      return { key, total: 0, failed: 0, failureRate: 0 };
    });

    for (const row of rows) {
      const idx = Math.floor((row.createdAt.getTime() - startDay.getTime()) / (24 * 60 * 60_000));
      if (idx < 0 || idx >= buckets.length) continue;
      const b = buckets[idx]!;
      b.total += 1;
      if (row.status >= 400) b.failed += 1;
    }
    for (const b of buckets) {
      b.failureRate = b.total === 0 ? 0 : Math.round((b.failed / b.total) * 1000) / 1000;
    }

    return {
      dimension: 'day',
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      buckets,
      totalEvents: rows.length,
      generatedAt: new Date().toISOString(),
    };
  }
}
