/**
 * Admin: 上游 provider 详情、配额预测与健康检查。
 *
 * 端点：
 *   GET  /admin/providers/:slug/forecast       → 余额 + 消耗速率 + 估算剩余天数 (Tick 28 v1.7.0.0)
 *   POST /admin/providers/:slug/health         → 手动触发健康检查 (Tick 31 v1.7.3.0)
 *   GET  /admin/providers/:slug/health/history → 最近 50 条 HealthCheck 记录 (Tick 31 v1.7.3.0)
 *
 * 现有 provider 列表仍由 /admin/metrics 提供（Web 端 useProviders 已对齐）。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { FreeLLMError } from '@freellm/shared';
import { getPrisma } from '../../lib/prisma.js';
import { getSecretStore } from '../../lib/secret-store-factory.js';
import { BalanceTrackerService } from '../../services/balance-tracker.service.js';
import { ProviderHealthService } from '../../services/provider-health.service.js';
import { ProviderBalanceCheckService } from '../../services/provider-balance-check.service.js';
import { ProviderAdminService } from '../../services/provider-admin.service.js';

const KIND_ENUM = z.enum([
  'openrouter',
  'openai',
  'anthropic',
  'deepseek',
  'google',
  'openai-compat',
  'mistral',
  'groq',
  'together',
  'moonshot',
  'qwen',
  'mock',
]);

const createBody = z.object({
  slug: z.string().min(2).max(41),
  kind: KIND_ENUM,
  name: z.string().min(1).max(80),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1).max(512).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  rpmLimit: z.number().int().min(0).max(1_000_000).nullable().optional(),
  dailyLimit: z.number().int().min(0).max(10_000_000).nullable().optional(),
  timeoutMs: z.number().int().min(1000).max(600_000).optional(),
  compatibleMode: z.enum(['openai', 'anthropic', 'google']).optional(),
  notes: z.string().max(500).nullable().optional(),
});

const updateBody = z.object({
  name: z.string().min(1).max(80).optional(),
  baseUrl: z.string().url().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  rpmLimit: z.number().int().min(0).max(1_000_000).nullable().optional(),
  dailyLimit: z.number().int().min(0).max(10_000_000).nullable().optional(),
  timeoutMs: z.number().int().min(1000).max(600_000).optional(),
  compatibleMode: z.enum(['openai', 'anthropic', 'google']).optional(),
  notes: z.string().max(500).nullable().optional(),
});

const rotateKeyBody = z.object({
  apiKey: z.string().min(1).max(512),
  label: z.string().max(80).optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/providers/:slug/forecast', async (req) => {
    const params = z.object({ slug: z.string().min(1) }).parse(req.params);
    const provider = app.registry.get(params.slug);
    if (!provider) {
      throw new FreeLLMError('not_found', `上游 ${params.slug} 未注册到 registry`);
    }
    const tracker = new BalanceTrackerService(getPrisma(), app.registry);
    return tracker.forecast(params.slug);
  });

  // Tick 31 v1.7.3.0：手动触发单 provider 健康检查。
  // POST 语义因为有副作用（写 HealthCheck + 可能写 Cooldown）。
  app.post('/admin/providers/:slug/health', async (req) => {
    const params = z.object({ slug: z.string().min(1) }).parse(req.params);
    const provider = app.registry.get(params.slug);
    if (!provider) {
      throw new FreeLLMError('not_found', `上游 ${params.slug} 未注册到 registry`);
    }
    const svc = new ProviderHealthService(getPrisma(), app.registry);
    return svc.checkOne(params.slug);
  });

  app.get('/admin/providers/:slug/health/history', async (req) => {
    const params = z.object({ slug: z.string().min(1) }).parse(req.params);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }).parse(
      req.query,
    );
    const svc = new ProviderHealthService(getPrisma(), app.registry);
    const data = await svc.history(params.slug, query.limit ?? 50);
    return { data, total: data.length };
  });

  // Tick 37 v1.7.9.0：手动触发余额周期检查（cron 也会定时跑）。
  app.post('/admin/providers/balance/check', async () => {
    const svc = new ProviderBalanceCheckService(getPrisma(), app.registry);
    return svc.checkAll();
  });

  // Tick 37 v1.7.9.0：近 N 条 balance_low ErrorEvent（按 createdAt 倒序）。
  app.get('/admin/providers/balance/alerts', async (req) => {
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(200).optional() })
      .parse(req.query);
    const svc = new ProviderBalanceCheckService(getPrisma(), app.registry);
    const data = await svc.listRecentAlerts(query.limit ?? 20);
    return { data, total: data.length };
  });

  // ===== Tick 54 v1.7.26.0：Provider 全量 CRUD =====

  app.get('/admin/providers', async () => {
    const svc = new ProviderAdminService(getPrisma(), app.registry, getSecretStore());
    const data = await svc.list();
    return { data, total: data.length };
  });

  app.post('/admin/providers', async (req) => {
    const body = createBody.parse(req.body);
    const svc = new ProviderAdminService(getPrisma(), app.registry, getSecretStore());
    const r = await svc.create(body);
    if ('error' in r) throw new FreeLLMError('bad_request', r.error);
    return { ok: true, id: r.id, slug: r.slug };
  });

  app.patch('/admin/providers/:slug', async (req) => {
    const params = z.object({ slug: z.string().min(1) }).parse(req.params);
    const body = updateBody.parse(req.body ?? {});
    const svc = new ProviderAdminService(getPrisma(), app.registry, getSecretStore());
    const ok = await svc.update(params.slug, body);
    if (!ok) throw new FreeLLMError('not_found', `provider ${params.slug} 不存在`);
    return { ok: true };
  });

  app.delete('/admin/providers/:slug', async (req) => {
    const params = z.object({ slug: z.string().min(1) }).parse(req.params);
    const svc = new ProviderAdminService(getPrisma(), app.registry, getSecretStore());
    const ok = await svc.delete(params.slug);
    if (!ok) throw new FreeLLMError('not_found', `provider ${params.slug} 不存在`);
    return { ok: true };
  });

  app.post('/admin/providers/:slug/key', async (req) => {
    const params = z.object({ slug: z.string().min(1) }).parse(req.params);
    const body = rotateKeyBody.parse(req.body ?? {});
    const svc = new ProviderAdminService(getPrisma(), app.registry, getSecretStore());
    const r = await svc.rotateApiKey(params.slug, body.apiKey, body.label);
    if ('error' in r) throw new FreeLLMError('bad_request', r.error);
    return { ok: true };
  });

  // Tick 31 v1.7.3.0：列出所有 provider 当前的健康信息（lastHealthAt + status + 最近错误）。
  // 主要供 Web 端 hook 一次性拉完所有 provider 的健康状态用。
  app.get('/admin/providers/health', async () => {
    const rows = await getPrisma().provider.findMany({
      select: {
        slug: true,
        name: true,
        status: true,
        lastHealthAt: true,
        lastSuccessAt: true,
        lastErrorAt: true,
        lastErrorMessage: true,
        errorCount24h: true,
      },
      orderBy: { priority: 'asc' },
    });
    return { data: rows };
  });
};

export default plugin;
