/**
 * Admin: cron 调度状态端点（Tick 47 v1.7.19.0）。
 *
 * GET /admin/cron/status → 列出所有已注册 cron job 的 lastRunAt / lastError /
 *   lastDurationMs / successCount / failureCount，让运维看到调度健康度。
 */
import type { FastifyPluginAsync } from 'fastify';
import { getCronRegistry } from '../../plugins/cron.js';

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/cron/status', async () => {
    const jobs = getCronRegistry();
    const now = Date.now();
    return {
      data: jobs.map((j) => ({
        ...j,
        // 派生字段：距上次运行的毫秒数 + 是否过期未运行（> 2 × everyMs 视为 stale）
        sinceLastRunMs: j.lastRunAt ? now - new Date(j.lastRunAt).getTime() : null,
        stale: j.lastRunAt ? now - new Date(j.lastRunAt).getTime() > j.everyMs * 2 : true,
      })),
      total: jobs.length,
      generatedAt: new Date().toISOString(),
    };
  });
};

export default plugin;
