/**
 * 成本预算 CRUD（组 7 Tick 5 v1.23.0.0）。
 * GET 列表带实时 spent/pct；POST 创建；PATCH 改名/额度/周期/启用；DELETE 删除。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { FreeLLMError } from '@freellm/shared';
import { getPrisma } from '../../lib/prisma.js';
import { requireAdmin } from '../../plugins/admin-auth.js';
import { BudgetService } from '../../services/budget.service.js';

const SCOPES = ['global', 'vk', 'model'] as const;
const PERIODS = ['day', 'week', 'month'] as const;

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/budgets', async (req) => {
    requireAdmin(req);
    const svc = new BudgetService(getPrisma());
    return { budgets: await svc.listWithSpend() };
  });

  app.post('/admin/budgets', async (req) => {
    requireAdmin(req);
    const body = z
      .object({
        name: z.string().min(1).max(80),
        scope: z.enum(SCOPES).default('global'),
        targetId: z.string().max(120).optional(),
        limitUsd: z.number().positive(),
        period: z.enum(PERIODS).default('month'),
      })
      .parse(req.body ?? {});
    const prisma = getPrisma();
    const budget = await prisma.budget.create({
      data: {
        name: body.name,
        scope: body.scope,
        targetId: body.scope === 'global' ? null : (body.targetId ?? null),
        limitUsd: body.limitUsd,
        period: body.period,
      },
    });
    return { ok: true, budget };
  });

  app.patch('/admin/budgets/:id', async (req) => {
    requireAdmin(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z
      .object({
        name: z.string().min(1).max(80).optional(),
        limitUsd: z.number().positive().optional(),
        period: z.enum(PERIODS).optional(),
        enabled: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    const prisma = getPrisma();
    const existing = await prisma.budget.findUnique({ where: { id } });
    if (!existing) throw new FreeLLMError('not_found', `预算 ${id} 不存在`);
    const budget = await prisma.budget.update({ where: { id }, data: body });
    return { ok: true, budget };
  });

  app.delete('/admin/budgets/:id', async (req) => {
    requireAdmin(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const prisma = getPrisma();
    const existing = await prisma.budget.findUnique({ where: { id } });
    if (!existing) throw new FreeLLMError('not_found', `预算 ${id} 不存在`);
    await prisma.budget.delete({ where: { id } });
    return { ok: true, deleted: id };
  });
};

export default plugin;
