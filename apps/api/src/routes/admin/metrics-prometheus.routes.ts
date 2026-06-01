/**
 * GET /admin/metrics/prometheus —— Prometheus exposition v0 文本格式（Tick 18 v1.2.0.0 引入）。
 *
 * 用法：在 prometheus.yml 中加 scrape job 指向 `:28000/admin/metrics/prometheus`
 * （注意 Caddy 守门 token 仍生效，需在 scrape config 中带 cookie 或 query token）。
 *
 * 输出形态（OpenMetrics 兼容子集）：
 *   # HELP freellm_requests_today_total 24 小时内总请求数
 *   # TYPE freellm_requests_today_total counter
 *   freellm_requests_today_total 1234
 *
 *   # HELP freellm_success_rate_percent 24 小时内请求成功率（%）
 *   # TYPE freellm_success_rate_percent gauge
 *   freellm_success_rate_percent 98.7
 *
 *   # HELP freellm_provider_status 上游 provider 状态码（1=active 0.5=degraded 0.3=rate_limited 0=disabled）
 *   # TYPE freellm_provider_status gauge
 *   freellm_provider_status{slug="openrouter"} 1
 *   freellm_provider_status{slug="openai"} 0.5
 *
 * 数据源直接复用 metrics-cache（5 秒 TTL），避免高频抓取击穿 Prisma。
 */
import type { FastifyPluginAsync } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { getPrisma } from '../../lib/prisma.js';
import { createTtlCache } from '../../lib/ttl-cache.js';

interface PromMetricsSnapshot {
  requestsToday: number;
  successesToday: number;
  rateLimitedToday: number;
  avgLatencyMs: number;
  activeFreeModels: number;
  paidModels: number;
  totalModels: number;
  cooldownsActive: number;
  virtualKeys: number;
  providers: Array<{ slug: string; status: string }>;
  generatedAt: string;
}

async function buildPromSnapshot(prisma: PrismaClient): Promise<PromMetricsSnapshot> {
  const since24h = new Date(Date.now() - 24 * 60 * 60_000);
  const now = new Date();
  const [
    requestsToday,
    successesToday,
    rateLimitedToday,
    activeFreeModels,
    paidModels,
    totalModels,
    cooldownsActive,
    virtualKeys,
    providers,
    latencyRows,
  ] = await Promise.all([
    prisma.requestLog.count({ where: { startedAt: { gte: since24h } } }),
    prisma.requestLog.count({ where: { startedAt: { gte: since24h }, status: { lt: 400 } } }),
    prisma.requestLog.count({ where: { startedAt: { gte: since24h }, errorKind: 'rate_limited' } }),
    prisma.model.count({ where: { isFree: true, status: 'active' } }),
    prisma.model.count({ where: { isFree: false, status: { notIn: ['removed', 'disabled'] } } }),
    prisma.model.count({ where: { status: { notIn: ['removed'] } } }),
    prisma.cooldown.count({ where: { expiresAt: { gte: now } } }),
    prisma.virtualKey.count({ where: { enabled: true, revokedAt: null } }),
    prisma.provider.findMany({ select: { slug: true, status: true } }),
    prisma.requestLog.findMany({
      where: { startedAt: { gte: since24h }, durationMs: { not: null } },
      select: { durationMs: true },
      take: 5000,
    }),
  ]);

  const avgLatencyMs =
    latencyRows.length === 0
      ? 0
      : Math.round(latencyRows.reduce((acc, r) => acc + (r.durationMs ?? 0), 0) / latencyRows.length);

  return {
    requestsToday,
    successesToday,
    rateLimitedToday,
    avgLatencyMs,
    activeFreeModels,
    paidModels,
    totalModels,
    cooldownsActive,
    virtualKeys,
    providers,
    generatedAt: now.toISOString(),
  };
}

const snapshotCache = createTtlCache<PromMetricsSnapshot>({
  name: 'prom-metrics-snapshot',
  ttlMs: 5_000,
  loader: () => buildPromSnapshot(getPrisma()),
});

export function invalidatePromMetricsCache(): void {
  snapshotCache.invalidate();
}

const PROVIDER_STATUS_NUM: Record<string, number> = {
  active: 1,
  degraded: 0.5,
  rate_limited: 0.3,
  disabled: 0,
};

function escapeLabel(value: string): string {
  // Prom label value 必须转义反斜杠 / 双引号 / 换行。
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function renderPrometheusText(snap: PromMetricsSnapshot): string {
  const lines: string[] = [];

  lines.push('# HELP freellm_requests_today_total 24 小时内总请求数');
  lines.push('# TYPE freellm_requests_today_total counter');
  lines.push(`freellm_requests_today_total ${snap.requestsToday}`);
  lines.push('');

  lines.push('# HELP freellm_requests_successes_today_total 24 小时内成功请求数（HTTP <400）');
  lines.push('# TYPE freellm_requests_successes_today_total counter');
  lines.push(`freellm_requests_successes_today_total ${snap.successesToday}`);
  lines.push('');

  lines.push('# HELP freellm_requests_rate_limited_today_total 24 小时内 429 / rate_limited 错误数');
  lines.push('# TYPE freellm_requests_rate_limited_today_total counter');
  lines.push(`freellm_requests_rate_limited_today_total ${snap.rateLimitedToday}`);
  lines.push('');

  lines.push('# HELP freellm_request_avg_latency_milliseconds 24 小时内平均响应耗时（毫秒）');
  lines.push('# TYPE freellm_request_avg_latency_milliseconds gauge');
  lines.push(`freellm_request_avg_latency_milliseconds ${snap.avgLatencyMs}`);
  lines.push('');

  lines.push('# HELP freellm_models_active_free 当前活跃的免费模型数');
  lines.push('# TYPE freellm_models_active_free gauge');
  lines.push(`freellm_models_active_free ${snap.activeFreeModels}`);
  lines.push('');

  lines.push('# HELP freellm_models_paid 付费模型数（未下线）');
  lines.push('# TYPE freellm_models_paid gauge');
  lines.push(`freellm_models_paid ${snap.paidModels}`);
  lines.push('');

  lines.push('# HELP freellm_models_total 全部模型数（不含 removed）');
  lines.push('# TYPE freellm_models_total gauge');
  lines.push(`freellm_models_total ${snap.totalModels}`);
  lines.push('');

  lines.push('# HELP freellm_cooldowns_active 当前生效的冷却记录数');
  lines.push('# TYPE freellm_cooldowns_active gauge');
  lines.push(`freellm_cooldowns_active ${snap.cooldownsActive}`);
  lines.push('');

  lines.push('# HELP freellm_virtual_keys_active 启用中且未吊销的虚拟密钥数');
  lines.push('# TYPE freellm_virtual_keys_active gauge');
  lines.push(`freellm_virtual_keys_active ${snap.virtualKeys}`);
  lines.push('');

  lines.push('# HELP freellm_provider_status 上游 provider 状态（1=active 0.5=degraded 0.3=rate_limited 0=disabled）');
  lines.push('# TYPE freellm_provider_status gauge');
  for (const p of snap.providers) {
    const value = PROVIDER_STATUS_NUM[p.status] ?? 0;
    lines.push(`freellm_provider_status{slug="${escapeLabel(p.slug)}",status="${escapeLabel(p.status)}"} ${value}`);
  }
  lines.push('');

  return lines.join('\n');
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/metrics/prometheus', async (_req, reply) => {
    const snap = await snapshotCache.get();
    const body = renderPrometheusText(snap);
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return body;
  });
};

export default plugin;
