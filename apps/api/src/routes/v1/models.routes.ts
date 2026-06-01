/**
 * GET /v1/models —— OpenAI 兼容的模型列表端点。
 * 输出会按调用方虚拟密钥的允许 / 拒绝 / 上游白名单做过滤。
 */
import type { FastifyPluginAsync } from 'fastify';
import { FreeLLMError } from '@freellm/shared';
import { getPrisma } from '../../lib/prisma.js';

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/v1/models', async (req) => {
    const vk = req.virtualKey;
    if (!vk) throw new FreeLLMError('unauthorized', '需要虚拟密钥');

    const prisma = getPrisma();
    const models = await prisma.model.findMany({
      where: { status: { notIn: ['removed', 'disabled'] } },
      include: { provider: true },
      take: 1000,
    });
    const perm = vk.permissions;
    const filtered = models.filter((m) => {
      if (perm.allowedModels?.length && !perm.allowedModels.includes(m.upstreamId)) return false;
      if (perm.deniedModels?.includes(m.upstreamId)) return false;
      if (perm.allowedProviders?.length && !perm.allowedProviders.includes(m.provider.slug)) return false;
      if (!perm.allowPaidModels && !m.isFree) return false;
      return true;
    });
    return {
      object: 'list',
      data: filtered.map((m) => ({
        id: m.upstreamId,
        object: 'model',
        created: Math.floor(m.firstSeenAt.getTime() / 1000),
        owned_by: m.provider.slug,
        // FreeLLM extras (not OpenAI-spec)
        freellm: {
          providerSlug: m.provider.slug,
          isFree: m.isFree,
          contextLength: m.contextLength,
          status: m.status,
        },
      })),
    };
  });
};

export default plugin;
