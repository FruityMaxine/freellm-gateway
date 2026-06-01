/**
 * GET /v1/usage —— 返回当前虚拟密钥近 24 小时 / 7 天的用量汇总。
 */
import type { FastifyPluginAsync } from 'fastify';
import { FreeLLMError } from '@freellm/shared';
import { getPrisma } from '../../lib/prisma.js';

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/v1/usage', async (req) => {
    const vk = req.virtualKey;
    if (!vk) throw new FreeLLMError('unauthorized', '需要虚拟密钥');

    const prisma = getPrisma();
    const since24h = new Date(Date.now() - 24 * 60 * 60_000);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60_000);

    const [requests24h, requests7d, failed24h] = await Promise.all([
      prisma.requestLog.findMany({
        where: { virtualKeyId: vk.id, startedAt: { gte: since24h } },
        select: { totalTokens: true, status: true, durationMs: true, upstreamProvider: true, upstreamModel: true },
      }),
      prisma.requestLog.count({ where: { virtualKeyId: vk.id, startedAt: { gte: since7d } } }),
      prisma.requestLog.count({
        where: { virtualKeyId: vk.id, startedAt: { gte: since24h }, status: { gte: 400 } },
      }),
    ]);

    const tokens24h = requests24h.reduce((acc, r) => acc + r.totalTokens, 0);
    const avgLatencyMs =
      requests24h.length === 0
        ? 0
        : Math.round(
            requests24h.reduce((acc, r) => acc + (r.durationMs ?? 0), 0) / requests24h.length,
          );

    const providerBreakdown: Record<string, number> = {};
    for (const r of requests24h) {
      const k = r.upstreamProvider ?? 'unknown';
      providerBreakdown[k] = (providerBreakdown[k] ?? 0) + 1;
    }
    const modelBreakdown: Record<string, number> = {};
    for (const r of requests24h) {
      const k = r.upstreamModel ?? 'unknown';
      modelBreakdown[k] = (modelBreakdown[k] ?? 0) + 1;
    }

    return {
      object: 'usage.summary',
      window_24h: {
        requests: requests24h.length,
        failed: failed24h,
        tokens: tokens24h,
        avg_latency_ms: avgLatencyMs,
        by_provider: providerBreakdown,
        by_model: modelBreakdown,
      },
      window_7d: { requests: requests7d },
      retrieved_at: new Date().toISOString(),
    };
  });
};

export default plugin;
