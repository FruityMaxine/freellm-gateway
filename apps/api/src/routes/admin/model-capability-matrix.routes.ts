/**
 * 模型能力矩阵端点（组 7 Tick 3 v1.21.0.0）。
 *
 * 区别于 model-compare（2-4 模型选择对比）：本端点返回**全部模型 × 全部能力维度**的矩阵，
 * 供前端一屏总览 + 按能力筛选 + 覆盖统计。能力维度取自 Model.capabilitiesJson，
 * 实测含 7 维：stream / json / tools / vision / audio / reasoning / longContext。
 */
import type { FastifyPluginAsync } from 'fastify';
import { getPrisma } from '../../lib/prisma.js';
import { requireAdmin } from '../../plugins/admin-auth.js';

const CAP_KEYS = [
  'stream',
  'json',
  'tools',
  'vision',
  'audio',
  'reasoning',
  'longContext',
] as const;

function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/model-capability-matrix', async (req) => {
    requireAdmin(req);
    const prisma = getPrisma();
    const models = await prisma.model.findMany({
      include: { provider: { select: { slug: true } } },
      orderBy: { upstreamId: 'asc' },
    });

    const rows = models.map((m) => {
      const caps = safeParse<Record<string, unknown>>(m.capabilitiesJson, {});
      const pricing = safeParse<Record<string, string>>(m.pricingJson, {});
      const capabilities: Record<string, boolean> = {};
      for (const k of CAP_KEYS) capabilities[k] = Boolean(caps[k]);
      return {
        id: m.id,
        upstreamId: m.upstreamId,
        family: m.family,
        providerSlug: m.provider.slug,
        contextLength: m.contextLength,
        isFree: m.isFree,
        // per-token 价格（USD），前端转 per-1M 展示
        promptPrice: pricing.prompt ? Number(pricing.prompt) : null,
        completionPrice: pricing.completion ? Number(pricing.completion) : null,
        capabilities,
      };
    });

    // 各能力维度覆盖统计
    const stats: Record<string, { supported: number; total: number; pct: number }> = {};
    for (const k of CAP_KEYS) {
      const supported = rows.filter((r) => r.capabilities[k]).length;
      stats[k] = {
        supported,
        total: rows.length,
        pct: rows.length ? Math.round((supported / rows.length) * 100) : 0,
      };
    }

    return { models: rows, stats, capKeys: CAP_KEYS, total: rows.length };
  });
};

export default plugin;
