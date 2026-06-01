/**
 * Provider 运营中心聚合 service（组 6 Tick 3 v1.17.0.0）。
 *
 * 区别于 Providers.tsx 的逐 provider 实时快照——本 service 提供**全 provider 运营视角 +
 * 历史趋势**（Providers.tsx 全无的新数据流）：
 *   1. 余额耗尽优先级排序（estimatedDaysRemaining 升序，谁先没钱置顶）
 *   2. byDay 请求/错误历史趋势（窗口内分桶，复用 metrics-timeseries 的 JS 分桶思路）
 *   3. SLA uptime%（HealthCheck byProvider 24h/7d 在线率）
 */
import type { PrismaClient } from '@prisma/client';
import type { ProviderRegistry } from '@freellm/provider-core';
import { BalanceTrackerService } from './balance-tracker.service.js';

const DAY_MS = 86_400_000;

export interface ProviderOpsRow {
  slug: string;
  name: string;
  balanceRemaining: number | null;
  burnRateUsdPerDay: number | null;
  estimatedDaysRemaining: number | null;
  sla24h: number;
  sla7d: number;
  error24h: number;
  requests: number;
}

export interface ProviderOpsTrendPoint {
  day: string;
  requests: number;
  errors: number;
}

export interface ProviderOpsSnapshot {
  providers: ProviderOpsRow[];
  trend: ProviderOpsTrendPoint[];
  windowDays: number;
  generatedAt: string;
}

export class ProviderOpsService {
  constructor(
    private prisma: PrismaClient,
    private registry: ProviderRegistry,
  ) {}

  /** 某 provider 最近 N 天的 health check 在线率（%）。无探测记录视为 100。 */
  private async uptime(providerId: string, days: number): Promise<number> {
    const since = new Date(Date.now() - days * DAY_MS);
    const total = await this.prisma.healthCheck.count({
      where: { providerId, scope: 'provider', takenAt: { gte: since } },
    });
    if (total === 0) return 100;
    const ok = await this.prisma.healthCheck.count({
      where: { providerId, scope: 'provider', ok: true, takenAt: { gte: since } },
    });
    return Math.round((ok / total) * 10000) / 100;
  }

  async snapshot(days = 7): Promise<ProviderOpsSnapshot> {
    const provs = await this.prisma.provider.findMany({
      where: { enabled: true },
      select: { id: true, slug: true, name: true },
    });
    const since = new Date(Date.now() - days * DAY_MS);
    const since24h = new Date(Date.now() - DAY_MS);
    const tracker = new BalanceTrackerService(this.prisma, this.registry);

    const rows: ProviderOpsRow[] = await Promise.all(
      provs.map(async (p): Promise<ProviderOpsRow> => {
        let balanceRemaining: number | null = null;
        let burnRateUsdPerDay: number | null = null;
        let estimatedDaysRemaining: number | null = null;
        try {
          const f = await tracker.forecast(p.slug);
          balanceRemaining = f.balanceRemaining;
          burnRateUsdPerDay = f.burnRateUsdPerDay;
          estimatedDaysRemaining = f.estimatedDaysRemaining;
        } catch {
          /* forecast 失败（provider 不支持余额）保持 null */
        }
        const [sla24h, sla7d, error24h, requests] = await Promise.all([
          this.uptime(p.id, 1),
          this.uptime(p.id, 7),
          this.prisma.errorEvent.count({ where: { providerId: p.id, createdAt: { gte: since24h } } }),
          this.prisma.requestLog.count({ where: { upstreamProvider: p.slug, startedAt: { gte: since } } }),
        ]);
        return {
          slug: p.slug,
          name: p.name,
          balanceRemaining,
          burnRateUsdPerDay,
          estimatedDaysRemaining,
          sla24h,
          sla7d,
          error24h,
          requests,
        };
      }),
    );
    // 余额耗尽优先级排序：estimatedDaysRemaining 升序，null（无法预测）置底。
    rows.sort(
      (a, b) => (a.estimatedDaysRemaining ?? Infinity) - (b.estimatedDaysRemaining ?? Infinity),
    );

    // byDay 趋势（请求量 + 错误数），先建满 days 个空桶再累加，保证趋势连续。
    const [logs, errs] = await Promise.all([
      this.prisma.requestLog.findMany({ where: { startedAt: { gte: since } }, select: { startedAt: true } }),
      this.prisma.errorEvent.findMany({
        where: { createdAt: { gte: since }, providerId: { not: null } },
        select: { createdAt: true },
      }),
    ]);
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const byDay = new Map<string, { requests: number; errors: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * DAY_MS).toISOString().slice(0, 10);
      byDay.set(d, { requests: 0, errors: 0 });
    }
    for (const l of logs) {
      const g = byDay.get(l.startedAt.toISOString().slice(0, 10));
      if (g) g.requests += 1;
    }
    for (const e of errs) {
      const g = byDay.get(e.createdAt.toISOString().slice(0, 10));
      if (g) g.errors += 1;
    }
    const trend: ProviderOpsTrendPoint[] = Array.from(byDay.entries()).map(([day, g]) => ({
      day,
      requests: g.requests,
      errors: g.errors,
    }));

    return { providers: rows, trend, windowDays: days, generatedAt: new Date().toISOString() };
  }
}
