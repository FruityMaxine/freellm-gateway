/**
 * Admin: 告警中心端点（Tick 40 v1.7.12.0）。
 *
 * 端点：
 *   GET   /admin/alerts?kind=&severity=&resolved=&limit=&offset=  全部告警筛选 + 分页
 *   GET   /admin/alerts/stats                                      按 kind / severity 分组统计 + totalUnresolved
 *   POST  /admin/alerts/:id/resolve                                标记 resolvedAt
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AlertsCenterService } from '../../services/alerts-center.service.js';
import { getPrisma } from '../../lib/prisma.js';

const listQuery = z.object({
  kind: z.string().optional(),
  severity: z.enum(['info', 'warn', 'error', 'critical']).optional(),
  resolved: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/alerts', async (req) => {
    const q = listQuery.parse(req.query ?? {});
    const svc = new AlertsCenterService(getPrisma());
    return svc.list({
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.resolved !== undefined ? { resolved: q.resolved } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
      ...(q.offset !== undefined ? { offset: q.offset } : {}),
    });
  });

  app.get('/admin/alerts/stats', async () => {
    const svc = new AlertsCenterService(getPrisma());
    return svc.stats();
  });

  app.post('/admin/alerts/:id/resolve', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const svc = new AlertsCenterService(getPrisma());
    return svc.resolve(params.id);
  });
};

export default plugin;
