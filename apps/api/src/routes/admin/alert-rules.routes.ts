/**
 * /admin/alert-rules —— 告警规则 CRUD + 手动评估（组 6 Tick 2 v1.16.0.0）。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import {
  AlertRuleService,
  ALERT_METRICS,
  ALERT_OPERATORS,
} from '../../services/alert-rule.service.js';
import { requireAdmin } from '../../plugins/admin-auth.js';

const createBody = z.object({
  name: z.string().min(1).max(80),
  metric: z.enum(ALERT_METRICS as [string, ...string[]]),
  operator: z.enum(ALERT_OPERATORS),
  threshold: z.number(),
  severity: z.enum(['info', 'warn', 'error', 'critical']).optional(),
  enabled: z.boolean().optional(),
  notifyWebhook: z.boolean().optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/alert-rules', async (req) => {
    requireAdmin(req);
    const svc = new AlertRuleService(getPrisma());
    const data = await svc.list();
    return { data, total: data.length, metrics: ALERT_METRICS, operators: ALERT_OPERATORS };
  });

  app.post('/admin/alert-rules', async (req) => {
    requireAdmin(req);
    const body = createBody.parse(req.body);
    const svc = new AlertRuleService(getPrisma());
    const rule = await svc.create(body);
    return { ok: true, rule };
  });

  app.patch('/admin/alert-rules/:id', async (req) => {
    requireAdmin(req);
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = createBody.partial().parse(req.body ?? {});
    const svc = new AlertRuleService(getPrisma());
    const rule = await svc.update(params.id, body);
    return { ok: true, rule };
  });

  app.delete('/admin/alert-rules/:id', async (req) => {
    requireAdmin(req);
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const svc = new AlertRuleService(getPrisma());
    await svc.delete(params.id);
    return { ok: true };
  });

  // 手动触发一次评估（测试 / 即时验证用）。
  app.post('/admin/alert-rules/evaluate', async (req) => {
    requireAdmin(req);
    const svc = new AlertRuleService(getPrisma());
    const result = await svc.evaluate();
    return { ok: true, result };
  });
};

export default plugin;
