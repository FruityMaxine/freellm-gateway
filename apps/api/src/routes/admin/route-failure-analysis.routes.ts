/**
 * 路由失败模式聚合分析端点（组 8 Tick 2 v1.24.0.0）。
 *
 * 区别于 Logs（单请求路由尝试瀑布）与 RouteHealth（熔断+评分）：本端点对**全部 RouteAttempt
 * 跨请求聚合**——按 errorKind groupBy 统计失败占比、按 upstreamModel 聚合失败率、cooldown 触发数、
 * 慢响应 top、多尝试失败链 top。是完全不同的分析视角（聚合统计而非单请求展开）。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import { requireAdmin } from '../../plugins/admin-auth.js';

// errorKind 为 null 或空字符串视为成功；其余视为失败。
const FAIL_WHERE = { AND: [{ errorKind: { not: null } }, { errorKind: { not: '' } }] };

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/route-failure-analysis', async (req) => {
    requireAdmin(req);
    const q = z
      .object({ days: z.coerce.number().int().positive().max(90).default(7) })
      .parse(req.query ?? {});
    const prisma = getPrisma();
    const since = new Date(Date.now() - q.days * 86_400_000);
    const baseWhere = { startedAt: { gte: since } };

    // ① errorKind 占比（去重铁律：真 groupBy by errorKind）
    const byKind = await prisma.routeAttempt.groupBy({
      by: ['errorKind'],
      where: baseWhere,
      _count: { _all: true },
      _avg: { durationMs: true, firstTokenMs: true },
    });
    const totalAttempts = byKind.reduce((s, k) => s + k._count._all, 0);
    const errorKinds = byKind
      .map((k) => ({
        errorKind: k.errorKind || 'success',
        isSuccess: !k.errorKind,
        count: k._count._all,
        pct: totalAttempts ? Math.round((k._count._all / totalAttempts) * 10000) / 100 : 0,
        avgDurationMs: k._avg.durationMs != null ? Math.round(k._avg.durationMs) : null,
      }))
      .sort((a, b) => b.count - a.count);

    // ② 按 upstreamModel 聚合失败率
    const byModel = await prisma.routeAttempt.groupBy({
      by: ['upstreamModel'],
      where: baseWhere,
      _count: { _all: true },
    });
    const failByModel = await prisma.routeAttempt.groupBy({
      by: ['upstreamModel'],
      where: { ...baseWhere, ...FAIL_WHERE },
      _count: { _all: true },
    });
    const failMap = new Map(failByModel.map((m) => [m.upstreamModel, m._count._all]));
    const modelFailureRates = byModel
      .map((m) => {
        const total = m._count._all;
        const failed = failMap.get(m.upstreamModel) ?? 0;
        return {
          upstreamModel: m.upstreamModel ?? '(unknown)',
          total,
          failed,
          failureRate: total ? Math.round((failed / total) * 10000) / 100 : 0,
        };
      })
      .sort((a, b) => b.failureRate - a.failureRate || b.total - a.total)
      .slice(0, 15);

    // ③ cooldown 触发统计
    const cooldownCount = await prisma.routeAttempt.count({
      where: { ...baseWhere, cooldownTriggered: true },
    });

    // ④ 慢响应 top
    const slowest = await prisma.routeAttempt.findMany({
      where: { ...baseWhere, durationMs: { not: null } },
      orderBy: { durationMs: 'desc' },
      take: 10,
      select: {
        requestId: true,
        upstreamModel: true,
        durationMs: true,
        firstTokenMs: true,
        status: true,
        errorKind: true,
      },
    });

    // ⑤ 多尝试失败链 top（ordinal>1 = 发生过 fallback 的请求）
    const byRequest = await prisma.routeAttempt.groupBy({
      by: ['requestId'],
      where: baseWhere,
      _max: { ordinal: true },
    });
    const multiAttemptChains = byRequest
      .filter((r) => (r._max.ordinal ?? 1) > 1)
      .map((r) => ({ requestId: r.requestId, attempts: r._max.ordinal ?? 1 }))
      .sort((a, b) => b.attempts - a.attempts)
      .slice(0, 10);

    const successCount = errorKinds.find((k) => k.isSuccess)?.count ?? 0;
    const successRate =
      totalAttempts ? Math.round((successCount / totalAttempts) * 10000) / 100 : 0;

    return {
      windowDays: q.days,
      totalAttempts,
      successRate,
      cooldownCount,
      errorKinds,
      modelFailureRates,
      slowest,
      multiAttemptChains,
    };
  });
};

export default plugin;
