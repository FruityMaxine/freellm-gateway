/**
 * 多路由策略管理 CRUD（组 7 Tick 2 v1.20.0.0）。
 *
 * 区别于 routing.routes（仅 GET 列表 + PATCH 编辑权重）与 routing-policy-editor（单 default upsert）：
 * 本文件补齐「多命名策略」生命周期 —— 创建 / 删除 / 激活切换。
 *
 * 激活切换是核心：chat-completions.routes 以 `findFirst({isDefault:true,enabled:true})` 加载 active 策略，
 * 故「单 active」是硬不变量。所有改写 isDefault 的操作都包在 prisma.$transaction 内
 * （先 updateMany 全部置 false，再把目标置 true），杜绝并发下出现 0 个或多个 active。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { FreeLLMError } from '@freellm/shared';
import { getPrisma } from '../../lib/prisma.js';
import { requireAdmin } from '../../plugins/admin-auth.js';

const MODES = [
  'auto-best-free',
  'round-robin-free',
  'weighted-free',
  'openrouter-free-router',
  'prefer-model-fallback',
  'provider-specific',
  'paid-allowed',
] as const;

const plugin: FastifyPluginAsync = async (app) => {
  // POST /admin/routing-policies —— 创建命名策略
  app.post('/admin/routing-policies', async (req) => {
    requireAdmin(req);
    const body = z
      .object({
        name: z.string().min(1).max(60),
        description: z.string().max(200).optional(),
        mode: z.enum(MODES).default('weighted-free'),
        weights: z.record(z.number()).optional(),
        activate: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    const prisma = getPrisma();
    const exists = await prisma.routingPolicy.findUnique({ where: { name: body.name } });
    if (exists) throw new FreeLLMError('bad_request', `策略 ${body.name} 已存在`);

    // 首个策略或显式 activate → 设为 active（事务保单 active）
    const isFirst = (await prisma.routingPolicy.count()) === 0;
    const shouldActivate = body.activate ?? isFirst;

    const policy = await prisma.$transaction(async (tx) => {
      if (shouldActivate) {
        await tx.routingPolicy.updateMany({ data: { isDefault: false } });
      }
      return tx.routingPolicy.create({
        data: {
          name: body.name,
          description: body.description ?? null,
          mode: body.mode,
          weightsJson: JSON.stringify(body.weights ?? {}),
          isDefault: shouldActivate,
          enabled: true,
        },
      });
    });
    return { ok: true, policy };
  });

  // POST /admin/routing-policy/:name/activate —— 激活切换（事务保单 active）
  app.post('/admin/routing-policy/:name/activate', async (req) => {
    requireAdmin(req);
    const params = z.object({ name: z.string().min(1) }).parse(req.params);
    const prisma = getPrisma();
    const existing = await prisma.routingPolicy.findUnique({ where: { name: params.name } });
    if (!existing) throw new FreeLLMError('not_found', `策略 ${params.name} 不存在`);

    const policy = await prisma.$transaction(async (tx) => {
      await tx.routingPolicy.updateMany({ data: { isDefault: false } });
      return tx.routingPolicy.update({
        where: { name: params.name },
        data: { isDefault: true, enabled: true },
      });
    });
    return { ok: true, policy };
  });

  // DELETE /admin/routing-policy/:name —— 删除（若删的是 active 且尚有其他策略，回退激活一个，避免 0 active）
  app.delete('/admin/routing-policy/:name', async (req) => {
    requireAdmin(req);
    const params = z.object({ name: z.string().min(1) }).parse(req.params);
    const prisma = getPrisma();
    const existing = await prisma.routingPolicy.findUnique({ where: { name: params.name } });
    if (!existing) throw new FreeLLMError('not_found', `策略 ${params.name} 不存在`);

    const result = await prisma.$transaction(async (tx) => {
      await tx.routingPolicy.delete({ where: { name: params.name } });
      if (existing.isDefault) {
        const fallback = await tx.routingPolicy.findFirst({ orderBy: { name: 'asc' } });
        if (fallback) {
          await tx.routingPolicy.update({ where: { id: fallback.id }, data: { isDefault: true } });
          return { reactivated: fallback.name as string | null };
        }
      }
      return { reactivated: null as string | null };
    });
    return { ok: true, deleted: params.name, reactivated: result.reactivated };
  });
};

export default plugin;
