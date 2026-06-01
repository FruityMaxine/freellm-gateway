/**
 * 告警通知渠道 CRUD + 测试发送（组 8 Tick 5 v1.27.0.0）。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { FreeLLMError } from '@freellm/shared';
import { getPrisma } from '../../lib/prisma.js';
import { requireAdmin } from '../../plugins/admin-auth.js';
import { NotifyChannelService, assertSafeTarget } from '../../services/notify-channel.service.js';

const TYPES = ['email', 'slack', 'webhook'] as const;

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/notify-channels', async (req) => {
    requireAdmin(req);
    const prisma = getPrisma();
    return { channels: await prisma.notifyChannel.findMany({ orderBy: { createdAt: 'desc' } }) };
  });

  app.post('/admin/notify-channels', async (req) => {
    requireAdmin(req);
    const body = z
      .object({
        name: z.string().min(1).max(80),
        type: z.enum(TYPES).default('email'),
        target: z.string().min(1).max(500),
      })
      .parse(req.body ?? {});
    // SSRF 防护：slack/webhook 的 target 是 URL，落库前校验拒绝内网地址。
    if (body.type !== 'email') {
      try {
        assertSafeTarget(body.target);
      } catch (e) {
        throw new FreeLLMError('bad_request', `目标地址不合法：${(e as Error).message}`);
      }
    }
    const prisma = getPrisma();
    const channel = await prisma.notifyChannel.create({ data: body });
    return { ok: true, channel };
  });

  app.patch('/admin/notify-channels/:id', async (req) => {
    requireAdmin(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z
      .object({
        name: z.string().min(1).max(80).optional(),
        target: z.string().min(1).max(500).optional(),
        enabled: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    const prisma = getPrisma();
    const existing = await prisma.notifyChannel.findUnique({ where: { id } });
    if (!existing) throw new FreeLLMError('not_found', `渠道 ${id} 不存在`);
    // 改了 target 且非 email 渠道 → 重新 SSRF 校验。
    if (body.target && existing.type !== 'email') {
      try {
        assertSafeTarget(body.target);
      } catch (e) {
        throw new FreeLLMError('bad_request', `目标地址不合法：${(e as Error).message}`);
      }
    }
    const channel = await prisma.notifyChannel.update({ where: { id }, data: body });
    return { ok: true, channel };
  });

  app.delete('/admin/notify-channels/:id', async (req) => {
    requireAdmin(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const prisma = getPrisma();
    const existing = await prisma.notifyChannel.findUnique({ where: { id } });
    if (!existing) throw new FreeLLMError('not_found', `渠道 ${id} 不存在`);
    await prisma.notifyChannel.delete({ where: { id } });
    return { ok: true, deleted: id };
  });

  app.post('/admin/notify-channels/:id/test', async (req) => {
    requireAdmin(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const prisma = getPrisma();
    const channel = await prisma.notifyChannel.findUnique({ where: { id } });
    if (!channel) throw new FreeLLMError('not_found', `渠道 ${id} 不存在`);
    const result = await new NotifyChannelService(prisma).testSend(channel);
    return { ok: result.ok, detail: result.detail };
  });
};

export default plugin;
