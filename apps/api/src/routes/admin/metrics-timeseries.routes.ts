/**
 * Admin: Dashboard 时间序列端点（Tick 32 v1.7.4.0）。
 *
 * GET /admin/metrics/timeseries?window=1h|24h|7d
 *   → { window, bucketMs, buckets: [{ t, requests, success, failed, costUsd }] }
 *
 * 1h → 60 个 1 分钟桶 / 24h → 24 个 1 小时桶 / 7d → 7 个 1 天桶。
 * 5 秒 TTL 缓存（窗口分别独立）。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import {
  MetricsTimeseriesService,
  type TimeseriesWindow,
  type TimeseriesPayload,
} from '../../services/metrics-timeseries.service.js';

const querySchema = z.object({
  window: z.enum(['1h', '24h', '7d']).default('24h'),
});

interface CacheEntry {
  value: TimeseriesPayload;
  expiresAt: number;
}
const CACHE_TTL_MS = 5_000;
const cache = new Map<TimeseriesWindow, CacheEntry>();

export function invalidateTimeseriesCache(): void {
  cache.clear();
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/metrics/timeseries', async (req) => {
    const { window } = querySchema.parse(req.query);
    const now = Date.now();
    const hit = cache.get(window);
    if (hit && hit.expiresAt > now) return hit.value;
    const svc = new MetricsTimeseriesService(getPrisma());
    const payload = await svc.buildTimeseries(window);
    cache.set(window, { value: payload, expiresAt: now + CACHE_TTL_MS });
    return payload;
  });
};

export default plugin;
