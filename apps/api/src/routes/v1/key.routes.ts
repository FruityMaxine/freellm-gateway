/**
 * GET /v1/key —— 返回当前虚拟密钥的元信息。
 */
import type { FastifyPluginAsync } from 'fastify';
import { FreeLLMError } from '@freellm/shared';
import { getPrisma } from '../../lib/prisma.js';

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/v1/key', async (req) => {
    const vk = req.virtualKey;
    if (!vk) throw new FreeLLMError('unauthorized', '需要虚拟密钥');
    const row = await getPrisma().virtualKey.findUnique({ where: { id: vk.id } });
    if (!row) throw new FreeLLMError('not_found', '虚拟密钥已被删除');
    return {
      id: row.id,
      label: row.label,
      environment: row.environment,
      prefix: row.prefix,
      enabled: row.enabled,
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt,
      totalRequests: row.totalRequests,
      totalTokens: row.totalTokens.toString(),
      permissions: vk.permissions,
    };
  });
};

export default plugin;
