/**
 * UsageDaily 预聚合 service（组 4 Tick 4 v1.10.0.0 引入）。
 *
 * request_logs 是请求明细（会被 retention purge 清理），usage_daily 是按 (day × virtualKey)
 * 维度的长期预聚合表，供历史趋势高效查询 + 明细被清后仍保留统计。
 * 此前 51+ tick 里 usage_daily 表存在但**从未有写入逻辑**（dashboard 一直走 request_logs
 * 实时 sum），本 service 补上聚合，让长期用量统计真实落库。
 */
import type { PrismaClient } from '@prisma/client';

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

interface Agg {
  requests: number;
  successes: number;
  failures: number;
  rateLimits: number;
  promptTokens: bigint;
  completionTokens: bigint;
  totalTokens: bigint;
  latencySum: number;
  latencyCount: number;
}

function emptyAgg(): Agg {
  return {
    requests: 0,
    successes: 0,
    failures: 0,
    rateLimits: 0,
    promptTokens: 0n,
    completionTokens: 0n,
    totalTokens: 0n,
    latencySum: 0,
    latencyCount: 0,
  };
}

export class UsageAggregateService {
  constructor(private prisma: PrismaClient) {}

  /**
   * 幂等聚合指定 UTC 日：先删当天 usage_daily 行，再按 virtualKey 重建。
   * 用 deleteMany + createMany 而非 upsert，因 unique 含可空 providerId/modelId，
   * SQLite NULL != NULL 会让 upsert 不幂等。
   */
  async aggregateDay(day: Date): Promise<{ day: string; groups: number; requests: number }> {
    const start = utcMidnight(day);
    const end = new Date(start.getTime() + 86_400_000);
    const logs = await this.prisma.requestLog.findMany({
      where: { startedAt: { gte: start, lt: end } },
      select: {
        virtualKeyId: true,
        status: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        durationMs: true,
      },
    });

    const map = new Map<string, Agg>();
    for (const l of logs) {
      const key = l.virtualKeyId ?? '__anon__';
      const g = map.get(key) ?? emptyAgg();
      g.requests += 1;
      if (l.status != null && l.status >= 200 && l.status < 400) g.successes += 1;
      else g.failures += 1;
      if (l.status === 429) g.rateLimits += 1;
      g.promptTokens += BigInt(l.promptTokens ?? 0);
      g.completionTokens += BigInt(l.completionTokens ?? 0);
      g.totalTokens += BigInt(l.totalTokens ?? 0);
      if (l.durationMs != null) {
        g.latencySum += l.durationMs;
        g.latencyCount += 1;
      }
      map.set(key, g);
    }

    // 组 4 Tick 5 P1 修复：delete + create 包进事务，避免崩在中间导致当天 usage_daily
    // 被清空且未重建（明细已被 retention 清理则永久丢失）。SQLite 单写锁 + 事务亦防并发交错。
    const dayRows = Array.from(map.entries()).map(([key, g]) => ({
      day: start,
      virtualKeyId: key === '__anon__' ? null : key,
      requests: g.requests,
      successes: g.successes,
      failures: g.failures,
      rateLimits: g.rateLimits,
      promptTokens: g.promptTokens,
      completionTokens: g.completionTokens,
      totalTokens: g.totalTokens,
      avgLatencyMs: g.latencyCount > 0 ? Math.round(g.latencySum / g.latencyCount) : null,
    }));
    await this.prisma.$transaction([
      this.prisma.usageDaily.deleteMany({ where: { day: start } }),
      ...(dayRows.length > 0 ? [this.prisma.usageDaily.createMany({ data: dayRows })] : []),
    ]);
    return { day: start.toISOString().slice(0, 10), groups: map.size, requests: logs.length };
  }

  /** 聚合最近 N 天（含今天）。cron 默认聚合最近 2 天（覆盖跨日边界的迟到日志）。 */
  async aggregateRecent(days = 2): Promise<Array<{ day: string; groups: number; requests: number }>> {
    const today = utcMidnight(new Date());
    const out: Array<{ day: string; groups: number; requests: number }> = [];
    for (let i = 0; i < days; i++) {
      out.push(await this.aggregateDay(new Date(today.getTime() - i * 86_400_000)));
    }
    return out;
  }

  /** 读取最近 N 天的 usage_daily 按日汇总（跨 VK 合并），供 dashboard / 报表。 */
  async recentDaily(
    days = 30,
  ): Promise<Array<{ day: string; requests: number; successes: number; failures: number; totalTokens: string }>> {
    const since = new Date(utcMidnight(new Date()).getTime() - (days - 1) * 86_400_000);
    const rows = await this.prisma.usageDaily.findMany({
      where: { day: { gte: since } },
      orderBy: { day: 'asc' },
    });
    const byDay = new Map<
      string,
      { requests: number; successes: number; failures: number; totalTokens: bigint }
    >();
    for (const r of rows) {
      const k = r.day.toISOString().slice(0, 10);
      const g = byDay.get(k) ?? { requests: 0, successes: 0, failures: 0, totalTokens: 0n };
      g.requests += r.requests;
      g.successes += r.successes;
      g.failures += r.failures;
      g.totalTokens += r.totalTokens;
      byDay.set(k, g);
    }
    return Array.from(byDay.entries()).map(([day, g]) => ({
      day,
      requests: g.requests,
      successes: g.successes,
      failures: g.failures,
      totalTokens: g.totalTokens.toString(),
    }));
  }

  /**
   * 按 virtualKey 聚合最近 N 天用量（跨日合并）+ VK label，按请求数倒序，供 Top-N 排行。
   * 组 5 Tick 2 v1.12.0.0 新增（recentDaily 只跨 VK 合并成每日一条，本方法保留 per-VK 维度）。
   */
  async perVkDaily(
    days = 30,
    limit = 20,
  ): Promise<
    Array<{
      virtualKeyId: string | null;
      label: string;
      requests: number;
      successes: number;
      failures: number;
      totalTokens: string;
      avgLatencyMs: number | null;
    }>
  > {
    const since = new Date(utcMidnight(new Date()).getTime() - (days - 1) * 86_400_000);
    const rows = await this.prisma.usageDaily.findMany({ where: { day: { gte: since } } });
    const byVk = new Map<
      string,
      { requests: number; successes: number; failures: number; totalTokens: bigint; latencySum: number; latencyDays: number }
    >();
    for (const r of rows) {
      const key = r.virtualKeyId ?? '__anon__';
      const g = byVk.get(key) ?? {
        requests: 0,
        successes: 0,
        failures: 0,
        totalTokens: 0n,
        latencySum: 0,
        latencyDays: 0,
      };
      g.requests += r.requests;
      g.successes += r.successes;
      g.failures += r.failures;
      g.totalTokens += r.totalTokens;
      if (r.avgLatencyMs != null) {
        g.latencySum += r.avgLatencyMs;
        g.latencyDays += 1;
      }
      byVk.set(key, g);
    }
    // 拉 VK label（匿名/demo 与已删除单独标注）。
    const ids = Array.from(byVk.keys()).filter((k) => k !== '__anon__');
    const vks = ids.length
      ? await this.prisma.virtualKey.findMany({ where: { id: { in: ids } }, select: { id: true, label: true } })
      : [];
    const labelMap = new Map(vks.map((v) => [v.id, v.label]));
    return Array.from(byVk.entries())
      .map(([key, g]) => ({
        virtualKeyId: key === '__anon__' ? null : key,
        label: key === '__anon__' ? '(匿名/demo)' : labelMap.get(key) ?? '(已删除)',
        requests: g.requests,
        successes: g.successes,
        failures: g.failures,
        totalTokens: g.totalTokens.toString(),
        avgLatencyMs: g.latencyDays > 0 ? Math.round(g.latencySum / g.latencyDays) : null,
      }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, limit);
  }
}
