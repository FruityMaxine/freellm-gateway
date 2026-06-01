/**
 * Admin: /admin/system/health 全链路自检（Tick 50 v1.7.22.0）。
 *
 * 单次响应返回 DB / Redis / 所有 provider 健康度汇总，
 * 5 秒 TTL 缓存（防止 dashboard 高频刷新打到 DB + Redis）。
 */
import type { FastifyPluginAsync } from 'fastify';
import { getPrisma } from '../../lib/prisma.js';
import {
  SystemHealthService,
  type SystemHealthReport,
} from '../../services/system-health.service.js';

interface CacheEntry {
  value: SystemHealthReport;
  expiresAt: number;
}
const CACHE_TTL_MS = 5_000;
let cache: CacheEntry | null = null;

export function invalidateSystemHealthCache(): void {
  cache = null;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/system/health', async () => {
    const now = Date.now();
    if (cache && cache.expiresAt > now) return cache.value;
    const svc = new SystemHealthService(getPrisma(), app.registry);
    const report = await svc.checkAll();
    cache = { value: report, expiresAt: now + CACHE_TTL_MS };
    return report;
  });
};

export default plugin;
