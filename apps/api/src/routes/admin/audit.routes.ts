/**
 * Admin: 操作审计日志查询端点（Tick 29 v1.7.1.0）。
 *
 * GET /admin/audit?userId=&username=&action=&resourceType=&resourceId=&since=&until=&limit=&offset=
 *   → { data: AdminAuditLog[], total: number }
 *
 * 审计本身的读操作不入审计（onResponse hook 只记 POST/PATCH/PUT/DELETE）。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AdminAuditService } from '../../services/admin-audit.service.js';
import { AdminAuditAggregateService } from '../../services/admin-audit-aggregate.service.js';
import { getPrisma } from '../../lib/prisma.js';

const querySchema = z.object({
  userId: z.string().optional(),
  username: z.string().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/audit', async (req) => {
    const q = querySchema.parse(req.query);
    const svc = new AdminAuditService(getPrisma());
    const result = await svc.list({
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.username ? { username: q.username } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.resourceType ? { resourceType: q.resourceType } : {}),
      ...(q.resourceId ? { resourceId: q.resourceId } : {}),
      ...(q.since ? { since: new Date(q.since) } : {}),
      ...(q.until ? { until: new Date(q.until) } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
      ...(q.offset !== undefined ? { offset: q.offset } : {}),
    });
    return result;
  });

  // 列出已知 action / resourceType 枚举值，用于前端筛选下拉。
  app.get('/admin/audit/facets', async () => {
    const prisma = getPrisma();
    const [actions, resources] = await Promise.all([
      prisma.adminAuditLog.findMany({
        distinct: ['action'],
        select: { action: true },
        orderBy: { action: 'asc' },
      }),
      prisma.adminAuditLog.findMany({
        distinct: ['resourceType'],
        select: { resourceType: true },
        orderBy: { resourceType: 'asc' },
      }),
    ]);
    return {
      actions: actions.map((a) => a.action),
      resourceTypes: resources.map((r) => r.resourceType),
    };
  });

  // Tick 43 v1.7.15.0：审计反向聚合统计
  app.get('/admin/audit/stats', async (req) => {
    const q = z
      .object({
        dimension: z.enum(['user', 'resource', 'action', 'day']).default('user'),
        since: z.string().datetime().optional(),
        until: z.string().datetime().optional(),
        topN: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(req.query);
    const svc = new AdminAuditAggregateService(getPrisma());
    return svc.stats(q.dimension, {
      ...(q.since ? { since: new Date(q.since) } : {}),
      ...(q.until ? { until: new Date(q.until) } : {}),
      ...(q.topN ? { topN: q.topN } : {}),
    });
  });
};

export default plugin;
