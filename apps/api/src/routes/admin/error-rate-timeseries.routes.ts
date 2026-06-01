/**
 * Admin: 错误率时间序列端点（Tick 49 v1.7.21.0）。
 *
 * GET /admin/metrics/error-rate-timeseries?window=1h|24h|7d
 *   → { window, bucketMs, buckets: [{ t, total, status2xx/4xx/5xx, errorRate, ... }],
 *       summary: { total, ..., errorRate, clientErrorRate, serverErrorRate } }
 *
 * 5 秒 TTL 缓存，与 /admin/metrics/timeseries 一致。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import {
  ErrorRateTimeseriesService,
  type ErrorRateWindow,
  type ErrorRatePayload,
} from '../../services/error-rate-timeseries.service.js';

const querySchema = z.object({
  window: z.enum(['1h', '24h', '7d']).default('24h'),
});

interface CacheEntry {
  value: ErrorRatePayload;
  expiresAt: number;
}
const CACHE_TTL_MS = 5_000;
const cache = new Map<ErrorRateWindow, CacheEntry>();

export function invalidateErrorRateCache(): void {
  cache.clear();
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/metrics/error-rate-timeseries', async (req) => {
    const { window } = querySchema.parse(req.query);
    const now = Date.now();
    const hit = cache.get(window);
    if (hit && hit.expiresAt > now) return hit.value;
    const svc = new ErrorRateTimeseriesService(getPrisma());
    const payload = await svc.build(window);
    cache.set(window, { value: payload, expiresAt: now + CACHE_TTL_MS });
    return payload;
  });
};

export default plugin;
