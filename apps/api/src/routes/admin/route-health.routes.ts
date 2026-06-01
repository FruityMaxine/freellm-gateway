/**
 * GET /admin/route-health —— 路由健康看板三源聚合快照（组 5 Tick 3 v1.13.0.0）。
 * cooldowns（倒计时）+ top 模型 9 维评分 + provider 健康时间线，一次拉齐。
 */
import type { FastifyPluginAsync } from 'fastify';
import { getPrisma } from '../../lib/prisma.js';
import { RouteHealthService } from '../../services/route-health.service.js';
import { requireAdmin } from '../../plugins/admin-auth.js';

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/route-health', async (req) => {
    requireAdmin(req);
    const svc = new RouteHealthService(getPrisma());
    return svc.snapshot();
  });
};

export default plugin;
