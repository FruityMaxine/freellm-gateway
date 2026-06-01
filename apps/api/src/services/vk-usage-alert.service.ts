/**
 * 虚拟密钥用量预警服务（Tick 39 v1.7.11.0 引入）。
 *
 * 现有 VK 限额 (`maxRequestsPerDay` / `maxTokensPerDay`) 只在中间件层硬阻断，
 * 没有"接近阈值时预警"机制。本服务由 cron 周期触发：
 *   1. 列出所有已启用且设置了 daily limit 的 VK
 *   2. 比对今日 request_logs 计数 / token 总和 vs 限额 × thresholdPct (默认 0.8)
 *   3. 命中 → 写 ErrorEvent (kind='vk_usage_alert', severity='warn') + emit
 *      `vk:usage_alert` 事件供 Tick 26 webhook dispatcher 自动出站投递
 *   4. 24 小时内同一 VK + metric 组合不重复告警 (内存 alertCache)
 *
 * 提供 `getUsageSnapshot(vkId)` 给 Web 端按 VK 拉今日实时进度条。
 */
import type { PrismaClient } from '@prisma/client';
import { globalEventBus } from './event-bus.js';

export interface VkUsageSnapshot {
  virtualKeyId: string;
  label: string;
  enabled: boolean;
  requestsToday: number;
  tokensToday: number;
  maxRequestsPerDay: number | null;
  maxTokensPerDay: number | null;
  /** 0-1 之间，请求计数使用率；limit 为 null 时为 null。 */
  requestUsagePct: number | null;
  tokenUsagePct: number | null;
  /** 任一指标 ≥ thresholdPct 时为 true。 */
  approachingLimit: boolean;
}

export interface VkUsageAlertEvent {
  virtualKeyId: string;
  label: string;
  metric: 'requests' | 'tokens';
  consumed: number;
  limit: number;
  usagePct: number;
  threshold: number;
  triggeredAt: string;
}

export interface AlertCycleReport {
  scanned: number;
  alertedVks: VkUsageAlertEvent[];
  generatedAt: string;
}

export interface VkUsageAlertOptions {
  /** 阈值百分比（0-1），默认 0.8（80%）。 */
  thresholdPct?: number;
  /** 同 (vkId, metric) 重复告警冷却时间（毫秒），默认 24 小时。 */
  alertCooldownMs?: number;
}

/** alertCache 是模块级单例，让 cron 跨调用共享状态（同 VK + metric 24h 内不重复 emit）。 */
const alertCache = new Map<string, number>(); // key: `${vkId}:${metric}` → 上次告警时间戳

export class VkUsageAlertService {
  private readonly opts: Required<VkUsageAlertOptions>;

  constructor(
    private readonly prisma: PrismaClient,
    opts: VkUsageAlertOptions = {},
  ) {
    this.opts = {
      thresholdPct: opts.thresholdPct ?? 0.8,
      alertCooldownMs: opts.alertCooldownMs ?? 24 * 60 * 60_000,
    };
  }

  /** 仅测试用：清空告警缓存。 */
  _resetAlertCache(): void {
    alertCache.clear();
  }

  /**
   * 算单 VK 今日（最近 24h）的用量快照。
   * limit 为 null → usagePct 为 null（无限额）。
   */
  async getUsageSnapshot(virtualKeyId: string): Promise<VkUsageSnapshot | null> {
    const vk = await this.prisma.virtualKey.findUnique({ where: { id: virtualKeyId } });
    if (!vk) return null;
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const agg = await this.prisma.requestLog.aggregate({
      where: { virtualKeyId, startedAt: { gte: since } },
      _sum: { totalTokens: true },
      _count: { _all: true },
    });
    const requestsToday = agg._count._all;
    const tokensToday = agg._sum.totalTokens ?? 0;
    const requestUsagePct =
      vk.maxRequestsPerDay !== null && vk.maxRequestsPerDay > 0
        ? Math.min(1, requestsToday / vk.maxRequestsPerDay)
        : null;
    const tokenUsagePct =
      vk.maxTokensPerDay !== null && vk.maxTokensPerDay > 0
        ? Math.min(1, tokensToday / vk.maxTokensPerDay)
        : null;
    const approachingLimit =
      (requestUsagePct !== null && requestUsagePct >= this.opts.thresholdPct) ||
      (tokenUsagePct !== null && tokenUsagePct >= this.opts.thresholdPct);
    return {
      virtualKeyId: vk.id,
      label: vk.label,
      enabled: vk.enabled,
      requestsToday,
      tokensToday,
      maxRequestsPerDay: vk.maxRequestsPerDay,
      maxTokensPerDay: vk.maxTokensPerDay,
      requestUsagePct,
      tokenUsagePct,
      approachingLimit,
    };
  }

  /**
   * 扫所有已启用且设了 daily limit 的 VK，超阈值时告警。
   * 24h 防重复 + 失败请求不污染计数（按 request_logs 全计）。
   */
  async checkAll(): Promise<AlertCycleReport> {
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const vks = await this.prisma.virtualKey.findMany({
      where: {
        enabled: true,
        revokedAt: null,
        OR: [{ maxRequestsPerDay: { not: null } }, { maxTokensPerDay: { not: null } }],
      },
      select: {
        id: true,
        label: true,
        maxRequestsPerDay: true,
        maxTokensPerDay: true,
      },
    });

    const alertedVks: VkUsageAlertEvent[] = [];
    for (const vk of vks) {
      const agg = await this.prisma.requestLog.aggregate({
        where: { virtualKeyId: vk.id, startedAt: { gte: since } },
        _sum: { totalTokens: true },
        _count: { _all: true },
      });
      const requestsToday = agg._count._all;
      const tokensToday = agg._sum.totalTokens ?? 0;

      if (
        vk.maxRequestsPerDay !== null &&
        vk.maxRequestsPerDay > 0 &&
        requestsToday / vk.maxRequestsPerDay >= this.opts.thresholdPct
      ) {
        const alert = await this.maybeEmit({
          virtualKeyId: vk.id,
          label: vk.label,
          metric: 'requests',
          consumed: requestsToday,
          limit: vk.maxRequestsPerDay,
        });
        if (alert) alertedVks.push(alert);
      }
      if (
        vk.maxTokensPerDay !== null &&
        vk.maxTokensPerDay > 0 &&
        tokensToday / vk.maxTokensPerDay >= this.opts.thresholdPct
      ) {
        const alert = await this.maybeEmit({
          virtualKeyId: vk.id,
          label: vk.label,
          metric: 'tokens',
          consumed: tokensToday,
          limit: vk.maxTokensPerDay,
        });
        if (alert) alertedVks.push(alert);
      }
    }

    return {
      scanned: vks.length,
      alertedVks,
      generatedAt: new Date().toISOString(),
    };
  }

  /** 列近 N 条 vk_usage_alert ErrorEvent。 */
  async listRecentAlerts(limit = 20): Promise<
    Array<{
      virtualKeyId: string | null;
      message: string;
      detailsJson: string | null;
      createdAt: Date;
      resolvedAt: Date | null;
    }>
  > {
    const rows = await this.prisma.errorEvent.findMany({
      where: { kind: 'vk_usage_alert' },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
    return rows.map((r) => {
      let vkId: string | null = null;
      if (r.detailsJson) {
        try {
          const obj = JSON.parse(r.detailsJson) as { virtualKeyId?: string };
          vkId = obj.virtualKeyId ?? null;
        } catch {
          /* ignore */
        }
      }
      return {
        virtualKeyId: vkId,
        message: r.message,
        detailsJson: r.detailsJson,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
      };
    });
  }

  /** 真正写 ErrorEvent + emit + cache，命中冷却时返回 null。 */
  private async maybeEmit(input: {
    virtualKeyId: string;
    label: string;
    metric: 'requests' | 'tokens';
    consumed: number;
    limit: number;
  }): Promise<VkUsageAlertEvent | null> {
    const cacheKey = `${input.virtualKeyId}:${input.metric}`;
    const lastAlert = alertCache.get(cacheKey) ?? 0;
    if (Date.now() - lastAlert < this.opts.alertCooldownMs) return null;
    alertCache.set(cacheKey, Date.now());

    const usagePct = input.consumed / input.limit;
    const event: VkUsageAlertEvent = {
      virtualKeyId: input.virtualKeyId,
      label: input.label,
      metric: input.metric,
      consumed: input.consumed,
      limit: input.limit,
      usagePct: Math.round(usagePct * 1000) / 1000,
      threshold: this.opts.thresholdPct,
      triggeredAt: new Date().toISOString(),
    };

    const metricLabel = input.metric === 'requests' ? '请求' : 'Token';
    try {
      await this.prisma.errorEvent.create({
        data: {
          kind: 'vk_usage_alert',
          severity: 'warn',
          message: `VK ${input.label} ${metricLabel}用量 ${Math.round(usagePct * 100)}% / 限 ${input.limit}`,
          detailsJson: JSON.stringify(event),
        },
      });
    } catch (err) {
      console.warn('[vk-usage-alert] 写 ErrorEvent 失败：', (err as Error).message);
    }

    try {
      await globalEventBus.emit('vk:usage_alert', event);
    } catch {
      /* 静默 */
    }

    return event;
  }
}
