/**
 * 虚拟密钥用量周报推送服务（Tick 41 v1.7.13.0 引入）。
 *
 * 联动 Tick 26 webhook + Tick 38 月报 + Tick 39 vk alert，每周一发布上周汇总：
 *   - 全局总览：本周 totalRequests / totalCost / activeVks 数 / 触发预警 VK 数
 *   - Top 5 用量 VK：按 cost 降序，含 requests / tokens
 *   - 触发预警的 VK 名单（resolved/unresolved 比例）
 *
 * 持久化：通过 Setting 表存 `vk_weekly_report.lastSentAt`，cron 每小时检查
 * "现在是 UTC 周一 0-12 点 + 距上次 ≥ 6 天" 才真正发送，避免重发。
 *
 * 推送：emit `vk:weekly_report` 事件 → Tick 26 webhook dispatcher 自动出站投递
 * 给订阅了该 topic 的 URL（运维可在邮件/Slack/PagerDuty 端收到周报）。
 */
import type { PrismaClient } from '@prisma/client';
import { globalEventBus } from './event-bus.js';

const SETTING_KEY = 'vk_weekly_report.lastSentAt';
/** UTC 周一上午 12 点前为发送窗口（晚于则等下周）。 */
const SEND_WINDOW_END_HOUR_UTC = 12;
/** 距上次发送 ≥ 6 天才再发（防同一周重复）。 */
const MIN_INTERVAL_DAYS = 6;

export interface WeeklyReportTopVk {
  virtualKeyId: string;
  label: string;
  requests: number;
  totalTokens: number;
  costUsd: number;
}

export interface WeeklyReportAlerted {
  virtualKeyId: string;
  count: number;
}

export interface VkWeeklyReport {
  windowStart: string;
  windowEnd: string;
  totals: {
    requests: number;
    successful: number;
    failed: number;
    totalTokens: number;
    costUsd: number;
    activeVks: number;
    alertedVks: number;
  };
  topVks: WeeklyReportTopVk[];
  alertedVkSummary: WeeklyReportAlerted[];
  generatedAt: string;
}

export class VkUsageWeeklyReportService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * 计算"上周"窗口（windowEnd 时刻起回溯 7 天）。
   * 默认 windowEnd = 当前；测试可注入。
   */
  async generate(now: Date = new Date()): Promise<VkWeeklyReport> {
    const windowEnd = now;
    const windowStart = new Date(windowEnd.getTime() - 7 * 24 * 60 * 60_000);

    const [totalsAgg, successCount, costAgg, vkAgg, activeVkCount, alertEvents] = await Promise.all(
      [
        this.prisma.requestLog.aggregate({
          where: { startedAt: { gte: windowStart, lte: windowEnd } },
          _count: { _all: true },
          _sum: { totalTokens: true },
        }),
        this.prisma.requestLog.count({
          where: { startedAt: { gte: windowStart, lte: windowEnd }, status: { lt: 400 } },
        }),
        this.prisma.requestLog.aggregate({
          where: {
            startedAt: { gte: windowStart, lte: windowEnd },
            estimatedCostUsd: { not: null },
          },
          _sum: { estimatedCostUsd: true },
        }),
        this.prisma.requestLog.groupBy({
          by: ['virtualKeyId'],
          where: { startedAt: { gte: windowStart, lte: windowEnd }, virtualKeyId: { not: null } },
          _count: { _all: true },
          _sum: { totalTokens: true, estimatedCostUsd: true },
        }),
        this.prisma.virtualKey.count({ where: { enabled: true, revokedAt: null } }),
        this.prisma.errorEvent.findMany({
          where: {
            kind: 'vk_usage_alert',
            createdAt: { gte: windowStart, lte: windowEnd },
          },
          select: { detailsJson: true },
        }),
      ],
    );

    // 从 ErrorEvent detailsJson 抽取 virtualKeyId 计数
    const alertedCounts = new Map<string, number>();
    for (const ev of alertEvents) {
      if (!ev.detailsJson) continue;
      try {
        const obj = JSON.parse(ev.detailsJson) as { virtualKeyId?: string };
        if (obj.virtualKeyId) {
          alertedCounts.set(obj.virtualKeyId, (alertedCounts.get(obj.virtualKeyId) ?? 0) + 1);
        }
      } catch {
        /* ignore */
      }
    }

    // top VK by cost：先把 vkAgg 排序，再批量查 label
    const topAgg = [...vkAgg]
      .filter((v) => v.virtualKeyId)
      .map((v) => ({
        virtualKeyId: v.virtualKeyId!,
        requests: v._count._all,
        totalTokens: v._sum.totalTokens ?? 0,
        costUsd: roundUsd(v._sum.estimatedCostUsd ?? 0),
      }))
      .sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests)
      .slice(0, 5);

    const topIds = topAgg.map((a) => a.virtualKeyId);
    const vkRows =
      topIds.length === 0
        ? []
        : await this.prisma.virtualKey.findMany({
            where: { id: { in: topIds } },
            select: { id: true, label: true },
          });
    const labelById = new Map(vkRows.map((r) => [r.id, r.label]));

    return {
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      totals: {
        requests: totalsAgg._count._all,
        successful: successCount,
        failed: totalsAgg._count._all - successCount,
        totalTokens: totalsAgg._sum.totalTokens ?? 0,
        costUsd: roundUsd(costAgg._sum.estimatedCostUsd ?? 0),
        activeVks: activeVkCount,
        alertedVks: alertedCounts.size,
      },
      topVks: topAgg.map((a) => ({
        virtualKeyId: a.virtualKeyId,
        label: labelById.get(a.virtualKeyId) ?? 'unknown',
        requests: a.requests,
        totalTokens: a.totalTokens,
        costUsd: a.costUsd,
      })),
      alertedVkSummary: Array.from(alertedCounts.entries())
        .map(([virtualKeyId, count]) => ({ virtualKeyId, count }))
        .sort((a, b) => b.count - a.count),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * cron 入口：判断"是否到了周一发送窗口 + 上次发送 ≥6 天" 才真正生成 + emit。
   * 返回 { sent: boolean, reason } 便于 cron 日志。
   */
  async maybeSendWeekly(now: Date = new Date()): Promise<{
    sent: boolean;
    reason: 'sent' | 'not-monday' | 'too-soon' | 'window-closed';
    report?: VkWeeklyReport;
  }> {
    const dow = now.getUTCDay(); // 0=Sun, 1=Mon, ...
    if (dow !== 1) {
      return { sent: false, reason: 'not-monday' };
    }
    if (now.getUTCHours() >= SEND_WINDOW_END_HOUR_UTC) {
      return { sent: false, reason: 'window-closed' };
    }

    const lastSent = await this.getLastSentAt();
    if (lastSent && now.getTime() - lastSent.getTime() < MIN_INTERVAL_DAYS * 24 * 60 * 60_000) {
      return { sent: false, reason: 'too-soon' };
    }

    const report = await this.generate(now);
    await this.setLastSentAt(now);
    try {
      await globalEventBus.emit('vk:weekly_report', report);
    } catch (err) {
      console.warn('[vk-weekly-report] emit 失败：', (err as Error).message);
    }
    return { sent: true, reason: 'sent', report };
  }

  /** 强制发送一次（端点手动触发用），无视周一/冷却限制。 */
  async forceSend(now: Date = new Date()): Promise<VkWeeklyReport> {
    const report = await this.generate(now);
    await this.setLastSentAt(now);
    try {
      await globalEventBus.emit('vk:weekly_report', report);
    } catch (err) {
      console.warn('[vk-weekly-report] forceSend emit 失败：', (err as Error).message);
    }
    return report;
  }

  async getLastSentAt(): Promise<Date | null> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.value) as { at?: string };
      return parsed.at ? new Date(parsed.at) : null;
    } catch {
      return null;
    }
  }

  private async setLastSentAt(at: Date): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key: SETTING_KEY },
      create: {
        key: SETTING_KEY,
        value: JSON.stringify({ at: at.toISOString() }),
        category: 'cron',
      },
      update: { value: JSON.stringify({ at: at.toISOString() }) },
    });
  }
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
