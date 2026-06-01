/**
 * Admin：dashboard 指标聚合端点。
 *
 * Tick 16 v1.0.1.0：加 5 秒 TTL 缓存。Dashboard 默认 5 秒轮询 + 单页可能多个组件
 * 共享同一份 metrics，原版每请求重跑 8 个 Prisma 查询；缓存后高频轮询不再打 DB。
 *
 * 数据写入路径（discovery / 模型 patch / virtual key 改动等）会通过 invalidate
 * 显式失效，确保操作即时反馈。
 */
import type { FastifyPluginAsync } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { getPrisma } from '../../lib/prisma.js';
import { createTtlCache } from '../../lib/ttl-cache.js';

interface MetricsPayload {
  generatedAt: string;
  window: string;
  requestsToday: number;
  successRate: number | null;
  rateLimitedToday: number;
  avgLatencyMs: number;
  activeFreeModels: number;
  providers: Array<{ slug: string; name: string; status: string; lastSyncAt: Date | null }>;
  cooldowns: number;
  virtualKeys: number;
  modelsAddedLastDay: Array<{ upstreamId: string; isFree: boolean; firstSeenAt: Date }>;
  // Tick 30 v1.7.2.0：累计估算成本（USD）+ top 5 模型 cost 排行。
  costToday: number;
  cost7d: number;
  topCostModels: Array<{ upstreamModel: string; upstreamProvider: string; costUsd: number; requests: number }>;
}

async function buildMetrics(prisma: PrismaClient): Promise<MetricsPayload> {
  const since24h = new Date(Date.now() - 24 * 60 * 60_000);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const [
    requestsToday,
    successesToday,
    rateLimitedToday,
    activeFreeModels,
    modelsLastDay,
    providers,
    cooldowns,
    virtualKeys,
    costAgg24h,
    costAgg7d,
    topCostRows,
  ] = await Promise.all([
    prisma.requestLog.count({ where: { startedAt: { gte: since24h } } }),
    prisma.requestLog.count({
      where: { startedAt: { gte: since24h }, status: { lt: 400 } },
    }),
    prisma.requestLog.count({
      where: { startedAt: { gte: since24h }, errorKind: 'rate_limited' },
    }),
    prisma.model.count({ where: { isFree: true, status: 'active' } }),
    prisma.model.findMany({
      where: { firstSeenAt: { gte: since24h } },
      select: { upstreamId: true, isFree: true, firstSeenAt: true },
      orderBy: { firstSeenAt: 'desc' },
      take: 20,
    }),
    prisma.provider.findMany({
      select: { slug: true, name: true, status: true, lastSyncAt: true },
    }),
    prisma.cooldown.findMany({
      where: { expiresAt: { gte: new Date() } },
      select: { id: true, scope: true, reason: true, expiresAt: true },
    }),
    prisma.virtualKey.count({ where: { enabled: true, revokedAt: null } }),
    // Tick 30 v1.7.2.0：cost 累计。aggregate sum(estimatedCostUsd) 跨 24h / 7d。
    prisma.requestLog.aggregate({
      where: { startedAt: { gte: since24h }, estimatedCostUsd: { not: null } },
      _sum: { estimatedCostUsd: true },
    }),
    prisma.requestLog.aggregate({
      where: { startedAt: { gte: since7d }, estimatedCostUsd: { not: null } },
      _sum: { estimatedCostUsd: true },
    }),
    prisma.requestLog.groupBy({
      by: ['upstreamModel', 'upstreamProvider'],
      where: { startedAt: { gte: since7d }, estimatedCostUsd: { not: null } },
      _sum: { estimatedCostUsd: true },
      _count: { _all: true },
      orderBy: { _sum: { estimatedCostUsd: 'desc' } },
      take: 5,
    }),
  ]);

  const avgLatencyMs = await averageLatency(prisma, since24h);

  return {
    generatedAt: new Date().toISOString(),
    window: '24h',
    requestsToday,
    successRate: requestsToday === 0 ? null : Math.round((successesToday / requestsToday) * 1000) / 10,
    rateLimitedToday,
    avgLatencyMs,
    activeFreeModels,
    providers: providers.map((p) => ({ slug: p.slug, name: p.name, status: p.status, lastSyncAt: p.lastSyncAt })),
    cooldowns: cooldowns.length,
    virtualKeys,
    modelsAddedLastDay: modelsLastDay,
    costToday: roundUsd(costAgg24h._sum.estimatedCostUsd ?? 0),
    cost7d: roundUsd(costAgg7d._sum.estimatedCostUsd ?? 0),
    topCostModels: topCostRows
      .filter((r) => r.upstreamModel && r.upstreamProvider)
      .map((r) => ({
        upstreamModel: r.upstreamModel ?? 'unknown',
        upstreamProvider: r.upstreamProvider ?? 'unknown',
        costUsd: roundUsd(r._sum.estimatedCostUsd ?? 0),
        requests: r._count._all,
      })),
  };
}

/** 把 cost 数字截到 6 位小数避免浮点尾巴 */
function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

const metricsCache = createTtlCache<MetricsPayload>({
  name: 'admin-metrics',
  ttlMs: 5_000,
  loader: () => buildMetrics(getPrisma()),
});

export function invalidateMetricsCache(): void {
  metricsCache.invalidate();
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/metrics', async () => {
    return metricsCache.get();
  });
};

export default plugin;

async function averageLatency(prisma: PrismaClient, since: Date): Promise<number> {
  const rows = await prisma.requestLog.findMany({
    where: { startedAt: { gte: since }, durationMs: { not: null } },
    select: { durationMs: true },
    take: 5000,
  });
  if (!rows.length) return 0;
  const total = rows.reduce((acc, r) => acc + (r.durationMs ?? 0), 0);
  return Math.round(total / rows.length);
}
