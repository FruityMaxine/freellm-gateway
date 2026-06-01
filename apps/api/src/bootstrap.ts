/**
 * Build and return a configured Fastify instance.
 *
 * Split from `server.ts` so tests can import the app without binding a port.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import reqid from './plugins/reqid.js';
import security from './plugins/security.js';
import cors from './plugins/cors.js';
import ratelimit from './plugins/ratelimit.js';
import errors from './plugins/errors.js';
import health from './plugins/health.js';
import cron from './plugins/cron.js';
import { buildLoggerOptions } from './lib/logger.js';
import { ProviderRegistry, MockProvider, parseProviderConfig } from '@freellm/provider-core';
import { getConfig } from './config.js';
import { getSecretStore } from './lib/secret-store-factory.js';
import adminModelsRoutes from './routes/admin/models.routes.js';
import adminRoutingRoutes from './routes/admin/routing.routes.js';
import adminAuthRoutes from './routes/admin/auth.routes.js';
import adminVirtualKeysRoutes from './routes/admin/virtual-keys.routes.js';
import adminLogsRoutes from './routes/admin/logs.routes.js';
import adminMetricsRoutes from './routes/admin/metrics.routes.js';
import adminMetricsTimeseriesRoutes from './routes/admin/metrics-timeseries.routes.js';
import adminSettingsRoutes from './routes/admin/settings.routes.js';
import adminTestChatRoutes from './routes/admin/test-chat.routes.js';
import v1ChatCompletionsRoutes from './routes/v1/chat-completions.routes.js';
import v1EmbeddingsRoutes from './routes/v1/embeddings.routes.js';
import v1ModelsRoutes from './routes/v1/models.routes.js';
import v1KeyRoutes from './routes/v1/key.routes.js';
import v1UsageRoutes from './routes/v1/usage.routes.js';
import adminEventsRoutes from './routes/admin/events.routes.js';
import adminMetricsPrometheusRoutes from './routes/admin/metrics-prometheus.routes.js';
import adminOrganizationsRoutes from './routes/admin/organizations.routes.js';
import adminWebhooksRoutes from './routes/admin/webhooks.routes.js';
import adminProvidersRoutes from './routes/admin/providers.routes.js';
import adminAuditRoutes from './routes/admin/audit.routes.js';
import adminAlertsRoutes from './routes/admin/alerts.routes.js';
import adminCronStatusRoutes from './routes/admin/cron-status.routes.js';
import adminErrorRateTimeseriesRoutes from './routes/admin/error-rate-timeseries.routes.js';
import adminSystemHealthRoutes from './routes/admin/system-health.routes.js';
import adminUsersRoutes from './routes/admin/users.routes.js';
import adminUsageDailyRoutes from './routes/admin/usage-daily.routes.js';
import adminRouteHealthRoutes from './routes/admin/route-health.routes.js';
import adminCostAnalyticsRoutes from './routes/admin/cost-analytics.routes.js';
import adminAlertRulesRoutes from './routes/admin/alert-rules.routes.js';
import adminProviderOpsRoutes from './routes/admin/provider-ops.routes.js';
import adminModelCompareRoutes from './routes/admin/model-compare.routes.js';
import adminRoutingPolicyEditorRoutes from './routes/admin/routing-policy-editor.routes.js';
import adminRoutingPoliciesCrudRoutes from './routes/admin/routing-policies-crud.routes.js';
import adminModelCapabilityMatrixRoutes from './routes/admin/model-capability-matrix.routes.js';
import adminBatchTestRoutes from './routes/admin/batch-test.routes.js';
import adminBudgetsRoutes from './routes/admin/budgets.routes.js';
import adminRouteFailureAnalysisRoutes from './routes/admin/route-failure-analysis.routes.js';
import adminModelSnapshotsRoutes from './routes/admin/model-snapshots.routes.js';
import adminOrgCostRoutes from './routes/admin/org-cost.routes.js';
import adminNotifyChannelsRoutes from './routes/admin/notify-channels.routes.js';
import adminAudit from './plugins/admin-audit.js';
import publicDemoKeyRoutes from './routes/public/demo-key.routes.js';
import publicPlaygroundSessionsRoutes from './routes/public/playground-sessions.routes.js';
import publicPlaygroundPresetsRoutes from './routes/public/playground-presets.routes.js';
import virtualKeyAuth from './plugins/virtual-key-auth.js';
import adminAuth from './plugins/admin-auth.js';
import { ProviderInstaller } from './services/provider-installer.service.js';
import { getPrisma } from './lib/prisma.js';

export interface BuiltApp {
  app: FastifyInstance;
  registry: ProviderRegistry;
}

export async function buildApp(): Promise<BuiltApp> {
  const cfg = getConfig();
  const app = Fastify({
    logger: buildLoggerOptions() as never,
    disableRequestLogging: false,
    trustProxy: true,
    bodyLimit: 8 * 1024 * 1024, // 8 MB — chat payloads with embedded images can be large
  });

  // plugins — order matters: reqid first so all subsequent logs carry the id
  await app.register(reqid);
  await app.register(security);
  await app.register(cors);
  await app.register(ratelimit);
  await app.register(errors);
  await app.register(health);

  // Provider registry — `mock` is always present so the API can respond to
  // `/v1/chat/completions` even with no real upstream key. `openrouter` and
  // any other DB-defined providers are wired by ProviderInstaller below.
  const registry = new ProviderRegistry();
  if (cfg.env.FREELLM_MOCK_PROVIDERS_ENABLED) {
    registry.install(
      parseProviderConfig({
        slug: 'mock',
        kind: 'mock',
        name: 'Mock Provider',
        baseUrl: 'mock://local',
        enabled: true,
        priority: 999,
      }),
      { apiKey: null, baseUrl: 'mock://local' },
    );
    app.log.info({ provider: 'mock' }, 'mock provider registered');
  }

  // Decorate so routes can reach the registry without importing globals.
  app.decorate('registry', registry);
  // satisfy TS
  void MockProvider;

  // Wire DB-defined providers (openrouter, custom-openai-compat, …) into the registry.
  try {
    const installer = new ProviderInstaller(getPrisma(), registry, getSecretStore());
    const report = await installer.installFromDatabase();
    if (report.installed.length || report.skipped.length) {
      app.log.info(
        { installed: report.installed, skipped: report.skipped },
        'providers installed from DB',
      );
    }
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, 'provider installer skipped (likely no DB yet)');
  }

  // 组 4 Tick 5 P2：启动自检 DB 残留 plain: 明文 upstream key（加密降级遗留），有则醒目告警
  // 提示运维跑 scripts/migrate-upstream-keys.ts 加密。明文 key 静态落盘 = 后门。
  try {
    const plainCount = await getPrisma().upstreamKey.count({
      where: { cipherText: { startsWith: 'plain:' } },
    });
    if (plainCount > 0) {
      app.log.warn(
        { plainCount },
        'upstream_keys 残留 plain: 明文 key，请跑 scripts/migrate-upstream-keys.ts 加密（明文落盘风险）',
      );
    }
  } catch {
    /* DB 未就绪，忽略 */
  }

  // Cron plugin needs the registry decorator to exist, so register after.
  await app.register(cron);

  // Tick 22 v1.4.1.0：多实例部署且 FREELLM_REDIS_URL 已设时，
  // 把 globalEventBus 挂接到 Redis Pub/Sub，实现跨实例事件广播。
  // 单实例 / Redis 不可用时静默回落，行为与挂接前完全等价。
  try {
    const { attachRedisPubSub } = await import('./services/event-bus-redis.js');
    const { globalEventBus } = await import('./services/event-bus.js');
    const { attached } = attachRedisPubSub(globalEventBus);
    if (attached) {
      app.log.info('event-bus-redis: 跨实例广播已启用');
    }
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, 'event-bus-redis 挂接异常，回落单实例');
  }

  // Tick 26 v1.6.1.0：启动 webhook dispatcher 监听 EventBus，
  // 命中订阅 topic 时 fire-and-forget 出站 POST + HMAC 签名 + 指数退避重试。
  try {
    const { WebhookDispatcherService } = await import('./services/webhook-dispatcher.service.js');
    const { globalEventBus } = await import('./services/event-bus.js');
    const dispatcher = new WebhookDispatcherService(getPrisma(), globalEventBus);
    dispatcher.attach();
    app.log.info('webhook-dispatcher: 出站投递监听已启动');
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, 'webhook-dispatcher 挂接异常，跳过出站投递');
  }

  // Auth gates — virtual-key for /v1/*, admin-session for /admin/* (except login/logout).
  await app.register(virtualKeyAuth);
  await app.register(adminAuth);
  // Tick 29 v1.7.1.0：审计 hook 必须在 adminAuth 之后注册，
  // 这样 onResponse 钩子能读到 req.adminSession（adminAuth 在 onRequest 阶段填入）。
  await app.register(adminAudit);

  // /v1/* OpenAI-compatible routes (downstream-facing).
  await app.register(v1ChatCompletionsRoutes);
  await app.register(v1EmbeddingsRoutes);
  await app.register(v1ModelsRoutes);
  await app.register(v1KeyRoutes);
  await app.register(v1UsageRoutes);

  // /admin/* routes.
  await app.register(adminAuthRoutes);
  await app.register(adminModelsRoutes);
  await app.register(adminRoutingRoutes);
  await app.register(adminVirtualKeysRoutes);
  await app.register(adminLogsRoutes);
  await app.register(adminMetricsRoutes);
  await app.register(adminMetricsTimeseriesRoutes);
  await app.register(adminMetricsPrometheusRoutes);
  await app.register(adminSettingsRoutes);
  await app.register(adminTestChatRoutes);
  await app.register(adminEventsRoutes);
  await app.register(adminOrganizationsRoutes);
  await app.register(adminWebhooksRoutes);
  await app.register(adminProvidersRoutes);
  await app.register(adminAuditRoutes);
  await app.register(adminAlertsRoutes);
  await app.register(adminCronStatusRoutes);
  await app.register(adminErrorRateTimeseriesRoutes);
  await app.register(adminSystemHealthRoutes);
  await app.register(adminUsersRoutes);
  await app.register(adminUsageDailyRoutes);
  await app.register(adminRouteHealthRoutes);
  await app.register(adminCostAnalyticsRoutes);
  await app.register(adminAlertRulesRoutes);
  await app.register(adminProviderOpsRoutes);
  await app.register(adminModelCompareRoutes);
  await app.register(adminRoutingPolicyEditorRoutes);
  await app.register(adminRoutingPoliciesCrudRoutes);
  await app.register(adminModelCapabilityMatrixRoutes);
  await app.register(adminBatchTestRoutes);
  await app.register(adminBudgetsRoutes);
  await app.register(adminRouteFailureAnalysisRoutes);
  await app.register(adminModelSnapshotsRoutes);
  await app.register(adminOrgCostRoutes);
  await app.register(adminNotifyChannelsRoutes);

  // /public/* —— 公开路由（不走 admin/v1 鉴权链）。Tick 23 v1.5.0.0 加入。
  await app.register(publicDemoKeyRoutes);
  await app.register(publicPlaygroundSessionsRoutes);
  await app.register(publicPlaygroundPresetsRoutes);

  return { app, registry };
}

declare module 'fastify' {
  interface FastifyInstance {
    registry: ProviderRegistry;
  }
}
