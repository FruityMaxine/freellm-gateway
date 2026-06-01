/**
 * 模型快照历史 + 相邻 diff 端点（组 8 Tick 3 v1.25.0.0）。
 *   GET /admin/model-snapshots/models —— 有快照的模型列表（供选择，含快照数）
 *   GET /admin/model-snapshots?modelId= —— 该模型快照时间线 + 相邻历史 diff（diffAdjacentSnapshots）
 *
 * 区别于 Models.tsx 详情弹窗的「近 10 条快照仅 takenAt+Badge」：本端点返回真实相邻 diff。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import { requireAdmin } from '../../plugins/admin-auth.js';
import { diffAdjacentSnapshots } from '../../services/snapshot-diff.service.js';

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/model-snapshots/models', async (req) => {
    requireAdmin(req);
    const prisma = getPrisma();
    const grouped = await prisma.modelSnapshot.groupBy({
      by: ['modelId', 'upstreamId'],
      where: { modelId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { modelId: 'desc' } },
      take: 200,
    });
    return {
      models: grouped.map((g) => ({
        modelId: g.modelId,
        upstreamId: g.upstreamId,
        snapshotCount: g._count._all,
      })),
    };
  });

  app.get('/admin/model-snapshots', async (req) => {
    requireAdmin(req);
    const q = z.object({ modelId: z.string().min(1) }).parse(req.query ?? {});
    const prisma = getPrisma();
    return diffAdjacentSnapshots(prisma, q.modelId);
  });
};

export default plugin;
