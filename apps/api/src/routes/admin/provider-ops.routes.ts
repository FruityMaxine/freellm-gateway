/**
 * GET /admin/provider-ops —— Provider 运营中心快照（组 6 Tick 3 v1.17.0.0）。
 * 余额耗尽排序 + byDay 请求/错误趋势 + SLA uptime。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import { ProviderOpsService } from '../../services/provider-ops.service.js';
import { requireAdmin } from '../../plugins/admin-auth.js';

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/provider-ops', async (req) => {
    requireAdmin(req);
    const q = z.object({ days: z.coerce.number().int().min(1).max(90).optional() }).parse(req.query);
    const svc = new ProviderOpsService(getPrisma(), app.registry);
    return svc.snapshot(q.days ?? 7);
  });
};

export default plugin;
