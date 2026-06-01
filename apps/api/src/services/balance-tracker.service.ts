/**
 * 配额预测器（Tick 28 v1.7.0.0 引入）。
 *
 * 拉取上游 provider 的余额信息（通过 `BaseProvider.fetchBalance()`）+ 按 request_logs
 * 近 7 天 totalTokens 算出消耗速率，给出预估走完天数。
 *
 * 缓存：每个 provider 的余额拉取走 5 分钟 TTL（外部 API 调用昂贵）。
 * 低余额告警：预估 < 3 天剩余时 emit `provider:balance_low` 事件，配合 Webhook
 * 出站投递自动通知运维。
 */
import type { PrismaClient } from '@prisma/client';
import type { ProviderRegistry } from '@freellm/provider-core';
import { createTtlCache } from '../lib/ttl-cache.js';
import { globalEventBus } from './event-bus.js';

export interface ForecastResult {
  providerSlug: string;
  /** 上游报告的剩余余额（单位由 provider 自决，OpenRouter 一般是美元）；null = 不支持或拉取失败。 */
  balanceRemaining: number | null;
  /** 上游剩余字段（usage / limit / currency）。 */
  balanceRaw: unknown;
  /** 近 7 天日均 token 消耗。 */
  burnRateTokensPerDay: number;
  /** 估算日均美元消耗。当 burnRate=0 或 provider 余额无定价信息时为 null。 */
  burnRateUsdPerDay: number | null;
  /** 预估剩余天数（balanceRemaining / burnRateUsdPerDay），null = 无法计算。 */
  estimatedDaysRemaining: number | null;
  /** 告警阈值：估算 < 该值（默认 3 天）时触发 balance_low 事件。 */
  alertThresholdDays: number;
  /** 本次是否已触发 balance_low 事件（防止短期内反复 emit）。 */
  alerted: boolean;
  generatedAt: string;
}

export interface BalanceTrackerOptions {
  /** 告警阈值（天数），默认 3。 */
  alertThresholdDays?: number;
  /** 余额缓存 TTL（毫秒），默认 5 分钟。 */
  cacheTtlMs?: number;
}

/**
 * 估算每 1000 token 美元成本（粗略默认 $0.001 per 1k token；
 * 实际可按 provider 模型权重打平）。
 * 真实 cost 计算属 v2.0 范畴，本 tick 用保守常量。
 */
const DEFAULT_USD_PER_1K_TOKENS = 0.001;

export class BalanceTrackerService {
  private readonly alertCache = new Map<string, number>(); // providerSlug → 上次告警时间戳
  private readonly opts: Required<BalanceTrackerOptions>;
  private readonly balanceCache: ReturnType<typeof createTtlCache<unknown>> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: ProviderRegistry,
    opts: BalanceTrackerOptions = {},
  ) {
    this.opts = {
      alertThresholdDays: opts.alertThresholdDays ?? 3,
      cacheTtlMs: opts.cacheTtlMs ?? 5 * 60_000,
    };
  }

  /**
   * 拉取指定 provider 的余额（带缓存）。null = 不支持或拉取失败。
   */
  async fetchBalanceCached(providerSlug: string): Promise<{
    balanceRemaining: number | null;
    raw: unknown;
  }> {
    const provider = this.registry.get(providerSlug);
    if (!provider) return { balanceRemaining: null, raw: null };
    try {
      const result = await provider.fetchBalance();
      if (!result) return { balanceRemaining: null, raw: null };
      return {
        balanceRemaining: typeof result.limitRemaining === 'number' ? result.limitRemaining : null,
        raw: result,
      };
    } catch (err) {
      console.warn(`[balance-tracker] ${providerSlug} fetchBalance 失败：`, (err as Error).message);
      return { balanceRemaining: null, raw: null };
    }
  }

  /**
   * 按 request_logs 近 7 天聚合该 provider 的日均 token 消耗。
   */
  async computeBurnRate(providerSlug: string): Promise<number> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);
    const rows = await this.prisma.requestLog.findMany({
      where: {
        upstreamProvider: providerSlug,
        startedAt: { gte: since },
      },
      select: { totalTokens: true },
    });
    if (rows.length === 0) return 0;
    const totalTokens = rows.reduce((acc, r) => acc + (r.totalTokens ?? 0), 0);
    return Math.round(totalTokens / 7);
  }

  /**
   * 综合预估：拉余额 + 算 burn rate + 输出 forecast；
   * 估算 < threshold 天时 emit `provider:balance_low` 事件（24 小时内不重复 emit）。
   */
  async forecast(providerSlug: string): Promise<ForecastResult> {
    const { balanceRemaining, raw } = await this.fetchBalanceCached(providerSlug);
    const burnRateTokensPerDay = await this.computeBurnRate(providerSlug);
    const burnRateUsdPerDay =
      burnRateTokensPerDay > 0
        ? Math.round((burnRateTokensPerDay / 1000) * DEFAULT_USD_PER_1K_TOKENS * 10000) / 10000
        : null;
    let estimatedDaysRemaining: number | null = null;
    if (balanceRemaining !== null && burnRateUsdPerDay !== null && burnRateUsdPerDay > 0) {
      estimatedDaysRemaining =
        Math.round((balanceRemaining / burnRateUsdPerDay) * 10) / 10;
    }

    let alerted = false;
    if (
      estimatedDaysRemaining !== null &&
      estimatedDaysRemaining < this.opts.alertThresholdDays
    ) {
      const lastAlert = this.alertCache.get(providerSlug) ?? 0;
      const elapsed = Date.now() - lastAlert;
      if (elapsed > 24 * 60 * 60_000) {
        this.alertCache.set(providerSlug, Date.now());
        alerted = true;
        try {
          await globalEventBus.emit('provider:balance_low', {
            providerSlug,
            balanceRemaining,
            estimatedDaysRemaining,
            burnRateTokensPerDay,
            burnRateUsdPerDay,
            threshold: this.opts.alertThresholdDays,
          });
        } catch (err) {
          console.warn('[balance-tracker] emit balance_low 失败：', (err as Error).message);
        }
      }
    }

    return {
      providerSlug,
      balanceRemaining,
      balanceRaw: raw,
      burnRateTokensPerDay,
      burnRateUsdPerDay,
      estimatedDaysRemaining,
      alertThresholdDays: this.opts.alertThresholdDays,
      alerted,
      generatedAt: new Date().toISOString(),
    };
  }

  /** 仅测试用：重置告警缓存。 */
  _resetAlertCache(): void {
    this.alertCache.clear();
  }
}

// 仅供测试导出常量，便于断言。
export const _DEFAULT_USD_PER_1K_TOKENS = DEFAULT_USD_PER_1K_TOKENS;
