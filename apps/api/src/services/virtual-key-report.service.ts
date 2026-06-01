/**
 * 虚拟密钥月度报告服务（Tick 38 v1.7.10.0 引入）。
 *
 * 联动 Tick 30 RequestLog.estimatedCostUsd + Tick 33 VK cost — 把零散字段聚合成
 * 一份完整月度账单：总量 / 成本 / token / 延迟分位 / 失败分布 / 日桶趋势 / 模型 top。
 *
 * 输入：vkId + year + month（1-12）；输出固定 32 日历桶（按当月实际天数）。
 * JSON 端点供 Web 渲染；CSV 端点供 Excel / 离线归档。
 */
import type { PrismaClient } from '@prisma/client';

export interface MonthlyReportDailyBucket {
  day: number; // 1-31
  requests: number;
  successful: number;
  failed: number;
  totalTokens: number;
  costUsd: number;
  avgLatencyMs: number;
}

export interface MonthlyReportTopModel {
  upstreamProvider: string;
  upstreamModel: string;
  requests: number;
  costUsd: number;
  totalTokens: number;
}

export interface MonthlyReportErrorBreakdown {
  errorKind: string;
  count: number;
}

export interface VirtualKeyMonthlyReport {
  virtualKeyId: string;
  year: number;
  month: number; // 1-12
  windowStart: string; // ISO
  windowEnd: string;
  daysInMonth: number;
  totals: {
    requests: number;
    successful: number;
    failed: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
  };
  dailyBreakdown: MonthlyReportDailyBucket[];
  topModels: MonthlyReportTopModel[];
  errorBreakdown: MonthlyReportErrorBreakdown[];
  generatedAt: string;
}

export class VirtualKeyReportService {
  constructor(private readonly prisma: PrismaClient) {}

  async buildMonthlyReport(
    virtualKeyId: string,
    year: number,
    month: number,
  ): Promise<VirtualKeyMonthlyReport> {
    if (month < 1 || month > 12) {
      throw new Error('month 必须在 1-12 范围内');
    }
    const windowStart = new Date(Date.UTC(year, month - 1, 1));
    const windowEnd = new Date(Date.UTC(year, month, 1));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    const logs = await this.prisma.requestLog.findMany({
      where: {
        virtualKeyId,
        startedAt: { gte: windowStart, lt: windowEnd },
      },
      select: {
        status: true,
        startedAt: true,
        durationMs: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        estimatedCostUsd: true,
        errorKind: true,
        upstreamProvider: true,
        upstreamModel: true,
      },
    });

    const buckets: MonthlyReportDailyBucket[] = Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1,
      requests: 0,
      successful: 0,
      failed: 0,
      totalTokens: 0,
      costUsd: 0,
      avgLatencyMs: 0,
    }));
    const bucketLatencySum: number[] = new Array(daysInMonth).fill(0);
    const bucketLatencyCount: number[] = new Array(daysInMonth).fill(0);

    let totalRequests = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    let totalTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalCost = 0;
    const latencies: number[] = [];
    const errorCounts = new Map<string, number>();
    const modelKey = (p: string | null, m: string | null) => `${p ?? '?'}\u0001${m ?? '?'}`;
    const modelAgg = new Map<
      string,
      { provider: string; model: string; requests: number; cost: number; tokens: number }
    >();

    for (const log of logs) {
      totalRequests += 1;
      const isFail = log.status === null || log.status >= 400 || log.errorKind !== null;
      if (isFail) {
        totalFailed += 1;
        const kind = log.errorKind ?? (log.status ? `http_${log.status}` : 'unknown');
        errorCounts.set(kind, (errorCounts.get(kind) ?? 0) + 1);
      } else {
        totalSuccessful += 1;
      }
      totalTokens += log.totalTokens;
      promptTokens += log.promptTokens;
      completionTokens += log.completionTokens;
      if (log.estimatedCostUsd !== null) totalCost += log.estimatedCostUsd;
      if (log.durationMs !== null) latencies.push(log.durationMs);

      const day = log.startedAt.getUTCDate();
      const bIdx = day - 1;
      if (bIdx >= 0 && bIdx < daysInMonth) {
        const b = buckets[bIdx]!;
        b.requests += 1;
        if (isFail) b.failed += 1;
        else b.successful += 1;
        b.totalTokens += log.totalTokens;
        if (log.estimatedCostUsd !== null) b.costUsd = roundUsd(b.costUsd + log.estimatedCostUsd);
        if (log.durationMs !== null) {
          bucketLatencySum[bIdx]! += log.durationMs;
          bucketLatencyCount[bIdx]! += 1;
        }
      }

      const key = modelKey(log.upstreamProvider, log.upstreamModel);
      const cur = modelAgg.get(key);
      if (cur) {
        cur.requests += 1;
        cur.cost = roundUsd(cur.cost + (log.estimatedCostUsd ?? 0));
        cur.tokens += log.totalTokens;
      } else {
        modelAgg.set(key, {
          provider: log.upstreamProvider ?? 'unknown',
          model: log.upstreamModel ?? 'unknown',
          requests: 1,
          cost: roundUsd(log.estimatedCostUsd ?? 0),
          tokens: log.totalTokens,
        });
      }
    }

    for (let i = 0; i < daysInMonth; i++) {
      if (bucketLatencyCount[i]! > 0) {
        buckets[i]!.avgLatencyMs = Math.round(bucketLatencySum[i]! / bucketLatencyCount[i]!);
      }
    }

    const avgLatencyMs =
      latencies.length === 0
        ? 0
        : Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    const p50LatencyMs = percentile(latencies, 0.5);
    const p95LatencyMs = percentile(latencies, 0.95);

    const topModels: MonthlyReportTopModel[] = Array.from(modelAgg.values())
      .sort((a, b) => b.cost - a.cost || b.requests - a.requests)
      .slice(0, 10)
      .map((m) => ({
        upstreamProvider: m.provider,
        upstreamModel: m.model,
        requests: m.requests,
        costUsd: m.cost,
        totalTokens: m.tokens,
      }));

    const errorBreakdown: MonthlyReportErrorBreakdown[] = Array.from(errorCounts.entries())
      .map(([errorKind, count]) => ({ errorKind, count }))
      .sort((a, b) => b.count - a.count);

    return {
      virtualKeyId,
      year,
      month,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      daysInMonth,
      totals: {
        requests: totalRequests,
        successful: totalSuccessful,
        failed: totalFailed,
        totalTokens,
        promptTokens,
        completionTokens,
        costUsd: roundUsd(totalCost),
        avgLatencyMs,
        p50LatencyMs,
        p95LatencyMs,
      },
      dailyBreakdown: buckets,
      topModels,
      errorBreakdown,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * 把 monthly report 渲染为 CSV 文本（含 totals 段 + 日桶 + topModels + errorBreakdown）。
   */
  formatAsCsv(report: VirtualKeyMonthlyReport): string {
    const lines: string[] = [];
    lines.push(`# VK Monthly Report`);
    lines.push(`# vkId: ${report.virtualKeyId}`);
    lines.push(`# month: ${report.year}-${String(report.month).padStart(2, '0')}`);
    lines.push(`# generatedAt: ${report.generatedAt}`);
    lines.push('');
    lines.push('## Totals');
    lines.push('metric,value');
    lines.push(`requests,${report.totals.requests}`);
    lines.push(`successful,${report.totals.successful}`);
    lines.push(`failed,${report.totals.failed}`);
    lines.push(`totalTokens,${report.totals.totalTokens}`);
    lines.push(`promptTokens,${report.totals.promptTokens}`);
    lines.push(`completionTokens,${report.totals.completionTokens}`);
    lines.push(`costUsd,${report.totals.costUsd}`);
    lines.push(`avgLatencyMs,${report.totals.avgLatencyMs}`);
    lines.push(`p50LatencyMs,${report.totals.p50LatencyMs}`);
    lines.push(`p95LatencyMs,${report.totals.p95LatencyMs}`);
    lines.push('');
    lines.push('## Daily Breakdown');
    lines.push('day,requests,successful,failed,totalTokens,costUsd,avgLatencyMs');
    for (const b of report.dailyBreakdown) {
      lines.push(
        `${b.day},${b.requests},${b.successful},${b.failed},${b.totalTokens},${b.costUsd},${b.avgLatencyMs}`,
      );
    }
    lines.push('');
    lines.push('## Top Models');
    lines.push('upstreamProvider,upstreamModel,requests,costUsd,totalTokens');
    for (const m of report.topModels) {
      lines.push(
        `${csvEsc(m.upstreamProvider)},${csvEsc(m.upstreamModel)},${m.requests},${m.costUsd},${m.totalTokens}`,
      );
    }
    lines.push('');
    lines.push('## Error Breakdown');
    lines.push('errorKind,count');
    for (const e of report.errorBreakdown) {
      lines.push(`${csvEsc(e.errorKind)},${e.count}`);
    }
    return lines.join('\n');
  }
}

/** 计算分位数（0 ≤ q ≤ 1）。空数组返回 0。 */
export function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx]!;
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function csvEsc(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
