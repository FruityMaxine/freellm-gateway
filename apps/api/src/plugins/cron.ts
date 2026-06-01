/**
 * Lightweight cron-ish scheduler. We don't pull in node-cron / @fastify/schedule
 * because all we need is a steady periodic tick on a single timer. The plugin
 * exposes a tiny `register` API so other services (Tick 4 score-updater, …)
 * can subscribe later.
 */
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { getConfig } from '../config.js';
import { getPrisma } from '../lib/prisma.js';
import { ModelDiscoveryService } from '../services/model-discovery.service.js';
import { ProviderHealthService } from '../services/provider-health.service.js';
import { ModelAutoBlacklistService } from '../services/model-auto-blacklist.service.js';
import { ProviderBalanceCheckService } from '../services/provider-balance-check.service.js';
import { VkUsageAlertService } from '../services/vk-usage-alert.service.js';
import { VkUsageWeeklyReportService } from '../services/vk-usage-weekly-report.service.js';
import { RetentionPolicyService } from '../services/retention-policy.service.js';
import { UsageAggregateService } from '../services/usage-aggregate.service.js';
import { AlertRuleService } from '../services/alert-rule.service.js';
import { globalEventBus } from '../services/event-bus.js';

// Tick 47 v1.7.19.0：cron 状态追踪，让 Web Dashboard 能看到每个 job
// 上次跑时间 / 上次错误 / 上次耗时 / 成功失败计数。
export interface CronJobStatus {
  name: string;
  everyMs: number;
  registeredAt: string;
  lastRunAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  lastErrorAt: string | null;
  successCount: number;
  failureCount: number;
}

const cronRegistry = new Map<string, CronJobStatus>();

export function getCronRegistry(): CronJobStatus[] {
  return Array.from(cronRegistry.values());
}

declare module 'fastify' {
  interface FastifyInstance {
    cron: {
      schedule: (name: string, everyMs: number, task: () => Promise<void> | void) => void;
      stopAll: () => void;
      list: () => CronJobStatus[];
    };
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  const { env } = getConfig();
  const timers = new Map<string, NodeJS.Timeout>();

  const cron = {
    schedule: (name: string, everyMs: number, task: () => Promise<void> | void) => {
      if (timers.has(name)) clearInterval(timers.get(name)!);
      cronRegistry.set(name, {
        name,
        everyMs,
        registeredAt: new Date().toISOString(),
        lastRunAt: null,
        lastFinishedAt: null,
        lastDurationMs: null,
        lastError: null,
        lastErrorAt: null,
        successCount: 0,
        failureCount: 0,
      });
      const wrapped = async () => {
        const status = cronRegistry.get(name);
        if (!status) return;
        const startedAt = Date.now();
        status.lastRunAt = new Date(startedAt).toISOString();
        try {
          await task();
          const finishedAt = Date.now();
          status.lastFinishedAt = new Date(finishedAt).toISOString();
          status.lastDurationMs = finishedAt - startedAt;
          status.successCount += 1;
        } catch (err) {
          const finishedAt = Date.now();
          status.lastFinishedAt = new Date(finishedAt).toISOString();
          status.lastDurationMs = finishedAt - startedAt;
          status.lastError = (err as Error).message;
          status.lastErrorAt = status.lastFinishedAt;
          status.failureCount += 1;
          app.log.error({ err, cron: name }, 'cron task failed');
        }
      };
      const handle = setInterval(() => {
        void wrapped();
      }, everyMs);
      handle.unref?.();
      timers.set(name, handle);
      app.log.info({ cron: name, everyMs }, 'cron scheduled');
    },
    stopAll: () => {
      for (const [name, handle] of timers) {
        clearInterval(handle);
        app.log.info({ cron: name }, 'cron stopped');
      }
      timers.clear();
    },
    list: () => Array.from(cronRegistry.values()),
  };
  app.decorate('cron', cron);
  app.addHook('onClose', async () => cron.stopAll());

  // Discovery cron — only schedule if mock or real upstream is enabled.
  if (env.FREELLM_NODE_ENV !== 'test') {
    const intervalMin = Math.max(1, env.FREELLM_MODEL_DISCOVERY_INTERVAL_MIN);
    const everyMs = intervalMin * 60_000;
    cron.schedule('model-discovery', everyMs, async () => {
      const svc = new ModelDiscoveryService({
        prisma: getPrisma(),
        registry: app.registry,
        events: globalEventBus,
      });
      const reports = await svc.refreshAll();
      app.log.info(
        { reports: reports.map((r) => ({ slug: r.providerSlug, ok: r.ok, n: r.discovered, evs: r.events.length })) },
        'discovery cycle complete',
      );
    });

    // Tick 31 v1.7.3.0：Provider 健康检查 cron（每 5 分钟，可由 env 调整）。
    // 失败 → 自动写 Cooldown 让 routing 避开；成功 → 重置 errorCount24h。
    const healthEveryMs = (env.FREELLM_PROVIDER_HEALTH_INTERVAL_MIN ?? 5) * 60_000;
    cron.schedule('provider-health', healthEveryMs, async () => {
      const svc = new ProviderHealthService(getPrisma(), app.registry);
      const results = await svc.checkAll();
      app.log.info(
        {
          checks: results.map((r) => ({ slug: r.providerSlug, ok: r.ok, latency: r.latencyMs })),
        },
        'provider health cycle complete',
      );
    });

    // Tick 37 v1.7.9.0：Provider 余额周期检查 cron（默认每 4 小时跑一次）。
    // 配合 Tick 28 alertCache 24h 防重复 + Tick 26 webhook dispatcher 自动出站。
    const balanceCheckEveryMs =
      (env.FREELLM_PROVIDER_BALANCE_CHECK_INTERVAL_MIN ?? 240) * 60_000;
    cron.schedule('provider-balance-check', balanceCheckEveryMs, async () => {
      const svc = new ProviderBalanceCheckService(getPrisma(), app.registry);
      const result = await svc.checkAll();
      if (result.alerted > 0) {
        app.log.warn(
          { alerted: result.alerted, total: result.total },
          'provider balance check: 触发低余额告警',
        );
      } else {
        app.log.info(
          { total: result.total },
          'provider balance check cycle complete',
        );
      }
    });

    // Tick 46 v1.7.18.0：数据保留清扫 cron（默认 24 小时一次）。
    // 按 Setting key=retention.policy 配置的天数清 AdminAuditLog / PlaygroundSession /
    // 已解决 ErrorEvent。未解决 ErrorEvent 永不清。
    const retentionEveryMs =
      (env.FREELLM_RETENTION_PURGE_INTERVAL_MIN ?? 24 * 60) * 60_000;
    cron.schedule('retention-purge', retentionEveryMs, async () => {
      const svc = new RetentionPolicyService(getPrisma());
      const r = await svc.runPurge();
      const totalPurged =
        r.auditPurged + r.playgroundSessionsPurged + r.errorEventsPurged;
      if (totalPurged > 0) {
        app.log.info(
          {
            audit: r.auditPurged,
            sessions: r.playgroundSessionsPurged,
            errors: r.errorEventsPurged,
            policy: r.policy,
          },
          'retention purge cycle: 已清理过期数据',
        );
      } else {
        app.log.info({ policy: r.policy }, 'retention purge cycle: 无过期数据');
      }
    });

    // 组 4 Tick 4 v1.10.0.0：UsageDaily 预聚合 cron（默认每小时）。
    // request_logs → usage_daily 按 (day×VK) 聚合，供历史趋势 + 明细被 retention 清理后仍保留统计。
    // 此前 usage_daily 表从未有写入逻辑，本 cron 补上。
    const usageAggSvc = new UsageAggregateService(getPrisma());
    cron.schedule('usage-aggregate', 60 * 60_000, async () => {
      const days = await usageAggSvc.aggregateRecent(2);
      app.log.info({ days }, 'usage-daily aggregate cycle complete');
    });
    // 启动时立即聚合一次，dashboard / 报表无需等首个 interval 才有数据。
    void usageAggSvc.aggregateRecent(2).catch((err) =>
      // 传完整 err 对象（保留 stack），与周期 cron wrapper 的 error 日志风格一致（组 4 Tick 5）。
      app.log.warn({ err }, 'initial usage aggregate failed'),
    );

    // 组 6 Tick 2 v1.16.0.0：告警规则评估 cron（每 5 分钟）。命中规则写 ErrorEvent + emit webhook。
    cron.schedule('alert-rule-eval', 5 * 60_000, async () => {
      const r = await new AlertRuleService(getPrisma()).evaluate();
      if (r.triggered > 0) {
        app.log.warn({ evaluated: r.evaluated, triggered: r.triggered }, 'alert rules triggered');
      }
    });

    // Tick 41 v1.7.13.0：VK 用量周报 cron（每小时检查，只在 UTC 周一 0-12 点
    // + 距上次发送 ≥ 6 天时真正发送）。emit 'vk:weekly_report' 让 webhook 出站。
    cron.schedule('vk-weekly-report', 60 * 60_000, async () => {
      const svc = new VkUsageWeeklyReportService(getPrisma());
      const r = await svc.maybeSendWeekly();
      if (r.sent) {
        app.log.info(
          { totals: r.report?.totals, top: r.report?.topVks.map((v) => v.label) },
          'vk weekly report sent',
        );
      } else {
        app.log.debug({ reason: r.reason }, 'vk weekly report skipped');
      }
    });

    // Tick 39 v1.7.11.0：VK 用量预警 cron（默认每 1 小时跑）。
    // 扫所有已启用且设了 daily limit 的 VK，超 80% 阈值时告警；24h 防重复。
    const vkAlertEveryMs = (env.FREELLM_VK_USAGE_ALERT_INTERVAL_MIN ?? 60) * 60_000;
    cron.schedule('vk-usage-alert', vkAlertEveryMs, async () => {
      const svc = new VkUsageAlertService(getPrisma());
      const report = await svc.checkAll();
      if (report.alertedVks.length > 0) {
        app.log.warn(
          { alertedVks: report.alertedVks.map((a) => `${a.label}:${a.metric}`), scanned: report.scanned },
          'vk usage alert cycle: 触发预警',
        );
      } else {
        app.log.info(
          { scanned: report.scanned },
          'vk usage alert cycle complete',
        );
      }
    });

    // Tick 34 v1.7.6.0：模型自动黑名单 cron（每 15 分钟，可由 env 调整）。
    // 扫所有 active model + 近 24h 日志，连续 5 次失败 OR 24h 成功率 < 50% (≥10 样本) → force_disabled。
    // whitelisted / force_enabled 模型跳过。
    const autoBlackEveryMs =
      (env.FREELLM_MODEL_AUTO_BLACKLIST_INTERVAL_MIN ?? 15) * 60_000;
    cron.schedule('model-auto-blacklist', autoBlackEveryMs, async () => {
      const svc = new ModelAutoBlacklistService(getPrisma());
      const report = await svc.evaluateAll();
      if (report.blacklisted.length > 0) {
        app.log.warn(
          { blacklisted: report.blacklisted.map((b) => b.upstreamId), evaluated: report.evaluated },
          'model auto-blacklist cycle: 加入黑名单',
        );
      } else {
        app.log.info(
          { evaluated: report.evaluated, skipped: report.skippedWhitelisted + report.skippedForceEnabled + report.skippedAlreadyDisabled },
          'model auto-blacklist cycle complete',
        );
      }
    });
  }
};

export default fp(plugin, { name: 'cron' });
