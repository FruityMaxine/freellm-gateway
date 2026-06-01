/**
 * 错误率时间序列聚合服务（Tick 49 v1.7.21.0 引入）。
 *
 * 联动 Tick 32 metrics-timeseries 但维度更细：把 RequestLog 按窗口分桶后
 * 进一步按 HTTP status class 拆出 2xx / 4xx / 5xx，并派生 errorRate (failed/total)
 * + clientErrorRate (4xx/total) + serverErrorRate (5xx/total)。
 *
 * 与 Tick 32 区别：
 *   - Tick 32 只 success vs failed 二分（≥400 都算 failed），无类别细分；
 *   - 本服务做 2xx / 4xx / 5xx / status=null 四类细分 + 三类 rate 派生；
 *   - errorRate 用于 Logs 页 AreaChart 单线展示故障爬升曲线；
 *   - 5xx 单独可视 → 帮运维区分"用户输错"vs"上游烂"。
 *
 * SQLite 同样无 date_trunc，JS 端 bucket；上限 10000 条防 OOM。
 */
import type { PrismaClient, RequestLog } from '@prisma/client';

export type ErrorRateWindow = '1h' | '24h' | '7d';

export interface ErrorRateBucket {
  /** ISO 时间戳：bucket 起始时刻。 */
  t: string;
  total: number;
  status2xx: number;
  status4xx: number;
  status5xx: number;
  statusNull: number;
  errorRate: number;
  clientErrorRate: number;
  serverErrorRate: number;
}

export interface ErrorRatePayload {
  window: ErrorRateWindow;
  bucketMs: number;
  buckets: ErrorRateBucket[];
  /** 整窗口聚合的 4 类 + 3 rate，供 Web 顶部 KPI 卡显示。 */
  summary: {
    total: number;
    status2xx: number;
    status4xx: number;
    status5xx: number;
    statusNull: number;
    errorRate: number;
    clientErrorRate: number;
    serverErrorRate: number;
  };
}

interface WindowConfig {
  totalMs: number;
  bucketMs: number;
  bucketCount: number;
}

const WINDOW_CONFIG: Record<ErrorRateWindow, WindowConfig> = {
  '1h': { totalMs: 60 * 60_000, bucketMs: 60_000, bucketCount: 60 },
  '24h': { totalMs: 24 * 60 * 60_000, bucketMs: 60 * 60_000, bucketCount: 24 },
  '7d': { totalMs: 7 * 24 * 60 * 60_000, bucketMs: 24 * 60 * 60_000, bucketCount: 7 },
};

const MAX_ROWS = 10_000;

export class ErrorRateTimeseriesService {
  constructor(private readonly prisma: PrismaClient) {}

  async build(window: ErrorRateWindow, now: Date = new Date()): Promise<ErrorRatePayload> {
    const cfg = WINDOW_CONFIG[window];
    const since = new Date(now.getTime() - cfg.totalMs);

    const rows = await this.prisma.requestLog.findMany({
      where: { startedAt: { gte: since, lte: now } },
      select: { startedAt: true, status: true },
      orderBy: { startedAt: 'asc' },
      take: MAX_ROWS,
    });

    const buckets = makeEmptyBuckets(window, now);
    bucketByStatus(rows, buckets, cfg.bucketMs);
    const summary = aggregateSummary(buckets);
    return {
      window,
      bucketMs: cfg.bucketMs,
      buckets,
      summary,
    };
  }
}

export function makeEmptyBuckets(window: ErrorRateWindow, now: Date): ErrorRateBucket[] {
  const cfg = WINDOW_CONFIG[window];
  const alignedNow = floorToBucket(now.getTime(), cfg.bucketMs);
  const buckets: ErrorRateBucket[] = [];
  for (let i = cfg.bucketCount - 1; i >= 0; i -= 1) {
    const start = alignedNow - i * cfg.bucketMs;
    buckets.push(emptyBucket(new Date(start).toISOString()));
  }
  return buckets;
}

export function bucketByStatus(
  rows: Pick<RequestLog, 'startedAt' | 'status'>[],
  buckets: ErrorRateBucket[],
  bucketMs: number,
): void {
  if (buckets.length === 0) return;
  const bucket0Start = new Date(buckets[0]!.t).getTime();
  const lastIdx = buckets.length - 1;
  for (const r of rows) {
    const ts = r.startedAt.getTime();
    const idx = Math.floor((ts - bucket0Start) / bucketMs);
    if (idx < 0 || idx > lastIdx) continue;
    const b = buckets[idx]!;
    b.total += 1;
    if (r.status == null) {
      b.statusNull += 1;
    } else if (r.status >= 200 && r.status < 400) {
      b.status2xx += 1;
    } else if (r.status >= 400 && r.status < 500) {
      b.status4xx += 1;
    } else if (r.status >= 500 && r.status < 600) {
      b.status5xx += 1;
    } else {
      // 其它非常规 status 计入 null 桶
      b.statusNull += 1;
    }
  }
  // 派生 rates
  for (const b of buckets) {
    const denom = b.total;
    if (denom === 0) {
      b.errorRate = 0;
      b.clientErrorRate = 0;
      b.serverErrorRate = 0;
    } else {
      const failed = b.status4xx + b.status5xx + b.statusNull;
      b.errorRate = round4(failed / denom);
      b.clientErrorRate = round4(b.status4xx / denom);
      b.serverErrorRate = round4(b.status5xx / denom);
    }
  }
}

export function aggregateSummary(buckets: ErrorRateBucket[]): ErrorRatePayload['summary'] {
  const sum = buckets.reduce(
    (acc, b) => {
      acc.total += b.total;
      acc.status2xx += b.status2xx;
      acc.status4xx += b.status4xx;
      acc.status5xx += b.status5xx;
      acc.statusNull += b.statusNull;
      return acc;
    },
    { total: 0, status2xx: 0, status4xx: 0, status5xx: 0, statusNull: 0 },
  );
  const denom = sum.total;
  const failed = sum.status4xx + sum.status5xx + sum.statusNull;
  return {
    ...sum,
    errorRate: denom === 0 ? 0 : round4(failed / denom),
    clientErrorRate: denom === 0 ? 0 : round4(sum.status4xx / denom),
    serverErrorRate: denom === 0 ? 0 : round4(sum.status5xx / denom),
  };
}

function emptyBucket(t: string): ErrorRateBucket {
  return {
    t,
    total: 0,
    status2xx: 0,
    status4xx: 0,
    status5xx: 0,
    statusNull: 0,
    errorRate: 0,
    clientErrorRate: 0,
    serverErrorRate: 0,
  };
}

function floorToBucket(ts: number, bucketMs: number): number {
  return Math.floor(ts / bucketMs) * bucketMs;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
