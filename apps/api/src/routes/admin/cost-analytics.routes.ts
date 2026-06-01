/**
 * GET /admin/cost-analytics —— 成本分析三源聚合（组 5 Tick 5 v1.15.0.0）。
 * VK spend 排行（复用 VkSpendLeaderboardService）+ 模型成本 Top-N + 成本趋势 byDay。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import { VkSpendLeaderboardService } from '../../services/vk-spend-leaderboard.service.js';
import { requireAdmin } from '../../plugins/admin-auth.js';

const SCOPE_DAYS = { day: 1, week: 7, month: 30 } as const;

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/cost-analytics', async (req) => {
    requireAdmin(req);
    const q = z.object({ scope: z.enum(['day', 'week', 'month']).optional() }).parse(req.query);
    const scope = q.scope ?? 'month';
    const windowDays = SCOPE_DAYS[scope];
    const prisma = getPrisma();
    const since = new Date(Date.now() - windowDays * 86_400_000);

    // 1) VK spend 排行（复用现成 leaderboard service）。
    const vkLeaderboard = await new VkSpendLeaderboardService(prisma).build(scope, 15);

    // 2) 模型成本 Top-N（按 estimatedCostUsd 降序）。
    const modelRows = await prisma.requestLog.groupBy({
      by: ['upstreamModel', 'upstreamProvider'],
      where: { startedAt: { gte: since }, estimatedCostUsd: { not: null } },
      _sum: { estimatedCostUsd: true, totalTokens: true },
      _count: { _all: true },
      orderBy: { _sum: { estimatedCostUsd: 'desc' } },
      take: 15,
    });
    const modelCosts = modelRows.map((r) => ({
      upstreamModel: r.upstreamModel ?? '(unknown)',
      upstreamProvider: r.upstreamProvider ?? '—',
      costUsd: round6(r._sum.estimatedCostUsd ?? 0),
      requests: r._count._all,
      totalTokens: r._sum.totalTokens ?? 0,
    }));

    // 3) 成本趋势 byDay。
    const logs = await prisma.requestLog.findMany({
      where: { startedAt: { gte: since }, estimatedCostUsd: { not: null } },
      select: { startedAt: true, estimatedCostUsd: true },
    });
    const byDay = new Map<string, number>();
    for (const l of logs) {
      const k = l.startedAt.toISOString().slice(0, 10);
      byDay.set(k, (byDay.get(k) ?? 0) + (l.estimatedCostUsd ?? 0));
    }
    const costTrend = Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, cost]) => ({ day, costUsd: round6(cost) }));

    return {
      scope,
      windowDays,
      vkLeaderboard,
      modelCosts,
      costTrend,
      generatedAt: new Date().toISOString(),
    };
  });
};

export default plugin;
