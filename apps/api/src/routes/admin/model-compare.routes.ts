/**
 * GET /admin/model-compare?ids=id1,id2,... —— 多模型 9 维对比（组 6 Tick 4 v1.18.0.0）。
 * 取 2-4 个模型的 9 维评分 + composite + 元数据（context/free/provider）供并排对比。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import { requireAdmin } from '../../plugins/admin-auth.js';

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/model-compare', async (req) => {
    requireAdmin(req);
    const q = z.object({ ids: z.string() }).parse(req.query);
    const ids = q.ids
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4);
    const models = await getPrisma().model.findMany({
      where: { id: { in: ids } },
      include: { provider: { select: { slug: true } }, scores: true },
    });
    const data = models.map((m) => ({
      id: m.id,
      upstreamId: m.upstreamId,
      providerSlug: m.provider.slug,
      contextLength: m.contextLength,
      isFree: m.isFree,
      composite: m.scores?.composite ?? null,
      scores: m.scores
        ? {
            availabilityScore: m.scores.availabilityScore,
            latencyScore: m.scores.latencyScore,
            rateLimitScore: m.scores.rateLimitScore,
            qualityScore: m.scores.qualityScore,
            contextScore: m.scores.contextScore,
            capabilityScore: m.scores.capabilityScore,
            freshnessScore: m.scores.freshnessScore,
            costScore: m.scores.costScore,
            stabilityScore: m.scores.stabilityScore,
          }
        : null,
    }));
    // 保持与请求 ids 顺序一致
    data.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    return { data };
  });
};

export default plugin;
