/**
 * Provider 余额周期检查服务（Tick 37 v1.7.9.0 引入）。
 *
 * 把 Tick 28 `BalanceTrackerService.forecast` 从 "被动按需调用" 升级为 "cron 主动周期扫"。
 * 流程：
 *   1. 列出 registry 中所有 provider
 *   2. 对每个 provider 调 `BalanceTrackerService.forecast`（命中 5 分钟缓存即可）
 *   3. 命中低余额（forecast.alerted=true）→ 写一条 ErrorEvent (kind='balance_low', severity='warn')
 *      同时 BalanceTrackerService 已经 emit 了 `provider:balance_low` 事件，
 *      Tick 26 webhook dispatcher 会自动出站投递到订阅了该 topic 的 URL
 *   4. cron 跑完 emit `provider:balance_check_cycle` 汇总事件供 SSE 推到 Dashboard
 *
 * 24h 防重复：BalanceTrackerService 已有 alertCache 24h 内不重复 emit，
 * 因此 cron 即使每 4 小时跑一次，同一 provider 在 24h 内最多一次 ErrorEvent。
 */
import type { PrismaClient } from '@prisma/client';
import type { ProviderRegistry } from '@freellm/provider-core';
import { BalanceTrackerService, type ForecastResult } from './balance-tracker.service.js';
import { globalEventBus } from './event-bus.js';

export interface BalanceCheckCycleResult {
  total: number;
  alerted: number;
  forecasts: Array<{
    providerSlug: string;
    balanceRemaining: number | null;
    estimatedDaysRemaining: number | null;
    alerted: boolean;
  }>;
  generatedAt: string;
}

export class ProviderBalanceCheckService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: ProviderRegistry,
  ) {}

  async checkAll(): Promise<BalanceCheckCycleResult> {
    const providers = this.registry.list();
    const tracker = new BalanceTrackerService(this.prisma, this.registry);
    const forecasts: BalanceCheckCycleResult['forecasts'] = [];
    let alertedCount = 0;

    for (const provider of providers) {
      let forecast: ForecastResult | null = null;
      try {
        forecast = await tracker.forecast(provider.slug);
      } catch (err) {
        console.warn(
          `[provider-balance-check] ${provider.slug} forecast 失败：`,
          (err as Error).message,
        );
        continue;
      }

      forecasts.push({
        providerSlug: forecast.providerSlug,
        balanceRemaining: forecast.balanceRemaining,
        estimatedDaysRemaining: forecast.estimatedDaysRemaining,
        alerted: forecast.alerted,
      });

      if (forecast.alerted) {
        alertedCount += 1;
        // 把告警落库到 ErrorEvent（便于 Web "余额预警" 区反查 + 长期审计）
        try {
          const dbProvider = await this.prisma.provider.findUnique({
            where: { slug: forecast.providerSlug },
            select: { id: true },
          });
          await this.prisma.errorEvent.create({
            data: {
              kind: 'balance_low',
              severity: 'warn',
              providerId: dbProvider?.id ?? null,
              message: `上游 ${forecast.providerSlug} 余额预警：估算剩余 ${forecast.estimatedDaysRemaining} 天 < 阈值 ${forecast.alertThresholdDays} 天`,
              detailsJson: JSON.stringify({
                balanceRemaining: forecast.balanceRemaining,
                burnRateTokensPerDay: forecast.burnRateTokensPerDay,
                burnRateUsdPerDay: forecast.burnRateUsdPerDay,
                estimatedDaysRemaining: forecast.estimatedDaysRemaining,
                threshold: forecast.alertThresholdDays,
              }),
            },
          });
        } catch (err) {
          console.warn(
            '[provider-balance-check] 写 ErrorEvent 失败：',
            (err as Error).message,
          );
        }
      }
    }

    const result: BalanceCheckCycleResult = {
      total: providers.length,
      alerted: alertedCount,
      forecasts,
      generatedAt: new Date().toISOString(),
    };

    try {
      await globalEventBus.emit('provider:balance_check_cycle', result);
    } catch {
      /* 静默 */
    }

    return result;
  }

  /** 查近 N 条 balance_low 告警，按 createdAt 倒序。 */
  async listRecentAlerts(limit = 20): Promise<
    Array<{
      providerId: string | null;
      providerSlug: string | null;
      message: string;
      detailsJson: string | null;
      createdAt: Date;
      resolvedAt: Date | null;
    }>
  > {
    const rows = await this.prisma.errorEvent.findMany({
      where: { kind: 'balance_low' },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      include: { provider: { select: { slug: true } } },
    });
    return rows.map((r) => ({
      providerId: r.providerId,
      providerSlug: r.provider?.slug ?? null,
      message: r.message,
      detailsJson: r.detailsJson,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
    }));
  }
}
