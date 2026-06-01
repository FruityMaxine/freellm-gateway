/**
 * /admin/usage/* —— UsageDaily 预聚合的手动触发 + 查询（组 4 Tick 4 v1.10.0.0 引入）。
 *
 * 聚合 cron 在 cron.ts 自动每小时跑 + 启动跑一次；这两个端点供管理后台手动重算
 * 与读取按日汇总（dashboard 历史趋势 / 报表）。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import { UsageAggregateService } from '../../services/usage-aggregate.service.js';
import { requireAdmin } from '../../plugins/admin-auth.js';

const plugin: FastifyPluginAsync = async (app) => {
  // 手动触发聚合（默认最近 2 天）。
  app.post('/admin/usage/aggregate', async (req) => {
    requireAdmin(req); // 组 4 Tick 5 P1：双保险（ADMIN_ONLY_PREFIXES 已挡，handler 再校验 defense-in-depth）
    const body = z
      .object({ days: z.coerce.number().int().min(1).max(90).optional() })
      .parse(req.body ?? {});
    const svc = new UsageAggregateService(getPrisma());
    const aggregated = await svc.aggregateRecent(body.days ?? 2);
    return { ok: true, aggregated };
  });

  // 查询最近 N 天 usage_daily 按日汇总（跨 VK 合并）。
  app.get('/admin/usage/daily', async (req) => {
    requireAdmin(req);
    const query = z
      .object({ days: z.coerce.number().int().min(1).max(365).optional() })
      .parse(req.query);
    const svc = new UsageAggregateService(getPrisma());
    const data = await svc.recentDaily(query.days ?? 30);
    return { data, total: data.length };
  });

  // 组 5 Tick 2：per-VK 用量排行（Top-N）。
  app.get('/admin/usage/per-vk', async (req) => {
    requireAdmin(req);
    const query = z
      .object({
        days: z.coerce.number().int().min(1).max(365).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(req.query);
    const svc = new UsageAggregateService(getPrisma());
    const data = await svc.perVkDaily(query.days ?? 30, query.limit ?? 20);
    return { data, total: data.length };
  });

  // 组 5 Tick 2：用量数据导出（CSV / JSON，浏览器触发下载）。
  app.get('/admin/usage/export', async (req, reply) => {
    requireAdmin(req);
    const query = z
      .object({
        days: z.coerce.number().int().min(1).max(365).optional(),
        format: z.enum(['csv', 'json']).optional(),
      })
      .parse(req.query);
    const svc = new UsageAggregateService(getPrisma());
    const days = query.days ?? 30;
    const daily = await svc.recentDaily(days);
    if ((query.format ?? 'json') === 'csv') {
      const header = 'day,requests,successes,failures,totalTokens';
      const lines = daily.map(
        (d) => `${d.day},${d.requests},${d.successes},${d.failures},${d.totalTokens}`,
      );
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="freellm-usage-${days}d.csv"`);
      return [header, ...lines].join('\n');
    }
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="freellm-usage-${days}d.json"`);
    return { days, data: daily };
  });
};

export default plugin;
