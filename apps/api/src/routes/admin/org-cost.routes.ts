/**
 * 组织/项目成本分摊端点（组 8 Tick 4 v1.26.0.0）。
 *
 * 区别于 cost-analytics（VK/模型维度）：本端点按 organizationId/projectId 维度聚合
 * RequestLog.estimatedCostUsd。RequestLog 有 organizationId+projectId 双索引，直接 groupBy 无需 join。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import { requireAdmin } from '../../plugins/admin-auth.js';

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/org-cost-breakdown', async (req) => {
    requireAdmin(req);
    const q = z
      .object({ days: z.coerce.number().int().positive().max(90).default(30) })
      .parse(req.query ?? {});
    const prisma = getPrisma();
    const since = new Date(Date.now() - q.days * 86_400_000);
    const baseWhere = { startedAt: { gte: since }, organizationId: { not: null } };

    // 按 organization 聚合
    const orgRows = await prisma.requestLog.groupBy({
      by: ['organizationId'],
      where: baseWhere,
      _sum: { estimatedCostUsd: true, totalTokens: true },
      _count: { _all: true },
    });
    // 按 project 聚合（下钻）
    const projRows = await prisma.requestLog.groupBy({
      by: ['projectId', 'organizationId'],
      where: { ...baseWhere, projectId: { not: null } },
      _sum: { estimatedCostUsd: true, totalTokens: true },
      _count: { _all: true },
    });

    // 名称映射
    const orgIds = orgRows.map((r) => r.organizationId).filter((x): x is string => !!x);
    const projIds = projRows.map((r) => r.projectId).filter((x): x is string => !!x);
    const orgs = await prisma.organization.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, name: true, slug: true },
    });
    const projects = await prisma.project.findMany({
      where: { id: { in: projIds } },
      select: { id: true, name: true, slug: true },
    });
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    const projName = new Map(projects.map((p) => [p.id, p.name]));

    const totalCost = orgRows.reduce((s, r) => s + (r._sum.estimatedCostUsd ?? 0), 0);

    // 按 organizationId 预分组，避免 organizations.map 内 O(orgs×projRows) 嵌套 filter。
    const projByOrg = new Map<string, typeof projRows>();
    for (const p of projRows) {
      const k = p.organizationId as string;
      const arr = projByOrg.get(k);
      if (arr) arr.push(p);
      else projByOrg.set(k, [p]);
    }

    const organizations = orgRows
      .map((r) => ({
        organizationId: r.organizationId as string,
        name: orgName.get(r.organizationId as string) ?? '(未命名组织)',
        cost: r._sum.estimatedCostUsd ?? 0,
        tokens: r._sum.totalTokens ?? 0,
        requests: r._count._all,
        pct: totalCost > 0 ? Math.round(((r._sum.estimatedCostUsd ?? 0) / totalCost) * 10000) / 100 : 0,
        projects: (projByOrg.get(r.organizationId as string) ?? [])
          .map((p) => ({
            projectId: p.projectId as string,
            name: projName.get(p.projectId as string) ?? '(未命名项目)',
            cost: p._sum.estimatedCostUsd ?? 0,
            tokens: p._sum.totalTokens ?? 0,
            requests: p._count._all,
          }))
          .sort((a, b) => b.cost - a.cost),
      }))
      .sort((a, b) => b.cost - a.cost);

    return { windowDays: q.days, totalCost, organizations };
  });
};

export default plugin;
