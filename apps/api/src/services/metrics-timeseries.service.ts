/**
 * Dashboard 时间序列聚合服务（Tick 32 v1.7.4.0 引入）。
 *
 * 当前 /admin/metrics 只给出 24h 总计；为了让 Dashboard 看到"晚上 vs 早上"
 * 或"和昨天对比"的趋势，本服务按可选窗口（1h / 24h / 7d）+ 固定 bucket 大小
 * 聚合 request_logs，返回时间序列数组。
 *
 * SQLite + Prisma 无法 raw groupBy 时间戳（没有 date_trunc），所以本服务用
 * findMany 拉取窗口内所有日志再 JS 端 bucket 累加；上限 cap 在 10000 条避免 OOM。
 * 单 5 秒 TTL 缓存（与 /admin/metrics 一致）由 endpoint 层套。
 */
import type { PrismaClient, RequestLog } from '@prisma/client';

export type TimeseriesWindow = '1h' | '24h' | '7d';

export interface TimeseriesBucket {
  /** ISO 时间戳：bucket 起始时刻。 */
  t: string;
  requests: number;
  success: number;
  failed: number;
  costUsd: number;
}

export interface TimeseriesPayload {
  window: TimeseriesWindow;
  bucketMs: number;
  buckets: TimeseriesBucket[];
}

interface WindowConfig {
  totalMs: number;
  bucketMs: number;
  bucketCount: number;
}

const WINDOW_CONFIG: Record<TimeseriesWindow, WindowConfig> = {
  '1h': { totalMs: 60 * 60_000, bucketMs: 60_000, bucketCount: 60 },        // 60 buckets × 1 分钟
  '24h': { totalMs: 24 * 60 * 60_000, bucketMs: 60 * 60_000, bucketCount: 24 }, // 24 buckets × 1 小时
  '7d': { totalMs: 7 * 24 * 60 * 60_000, bucketMs: 24 * 60 * 60_000, bucketCount: 7 }, // 7 buckets × 1 天
};

/** 单次 findMany 最多取多少 row（防 OOM）。超过时尾部丢弃，前端会看到一个 truncated flag。 */
const MAX_ROWS = 10_000;

export class MetricsTimeseriesService {
  constructor(private readonly prisma: PrismaClient) {}

  async buildTimeseries(window: TimeseriesWindow, now: Date = new Date()): Promise<TimeseriesPayload> {
    const cfg = WINDOW_CONFIG[window];
    const since = new Date(now.getTime() - cfg.totalMs);

    const rows = await this.prisma.requestLog.findMany({
      where: { startedAt: { gte: since, lte: now } },
      select: { startedAt: true, status: true, estimatedCostUsd: true },
      orderBy: { startedAt: 'asc' },
      take: MAX_ROWS,
    });

    const buckets = makeEmptyBuckets(window, now);
    bucketRequests(rows, buckets, cfg.bucketMs, now);
    return {
      window,
      bucketMs: cfg.bucketMs,
      buckets,
    };
  }
}

/** 按 bucket 数构造空槽（按时间从旧到新）。 */
export function makeEmptyBuckets(window: TimeseriesWindow, now: Date): TimeseriesBucket[] {
  const cfg = WINDOW_CONFIG[window];
  // 把 now 截齐到 bucket 边界（例如 24h 模式下取 now 所在小时整点）
  const alignedNow = floorToBucket(now.getTime(), cfg.bucketMs);
  const buckets: TimeseriesBucket[] = [];
  for (let i = cfg.bucketCount - 1; i >= 0; i--) {
    const start = alignedNow - i * cfg.bucketMs;
    buckets.push({
      t: new Date(start).toISOString(),
      requests: 0,
      success: 0,
      failed: 0,
      costUsd: 0,
    });
  }
  return buckets;
}

/** 把 rows 累加到对应 bucket。bucket 索引 = floor((row.startedAt - bucket0Start) / bucketMs)。 */
export function bucketRequests(
  rows: Pick<RequestLog, 'startedAt' | 'status' | 'estimatedCostUsd'>[],
  buckets: TimeseriesBucket[],
  bucketMs: number,
  _now: Date,
): void {
  if (buckets.length === 0) return;
  const bucket0Start = new Date(buckets[0]!.t).getTime();
  const lastBucketIdx = buckets.length - 1;
  for (const r of rows) {
    const ts = r.startedAt.getTime();
    const idx = Math.floor((ts - bucket0Start) / bucketMs);
    if (idx < 0 || idx > lastBucketIdx) continue;
    const b = buckets[idx]!;
    b.requests += 1;
    if (r.status !== null && r.status < 400) {
      b.success += 1;
    } else {
      b.failed += 1;
    }
    if (r.estimatedCostUsd !== null) {
      b.costUsd = round6(b.costUsd + r.estimatedCostUsd);
    }
  }
}

/** floor 到最近的 bucketMs 整数倍。 */
function floorToBucket(ts: number, bucketMs: number): number {
  return Math.floor(ts / bucketMs) * bucketMs;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
