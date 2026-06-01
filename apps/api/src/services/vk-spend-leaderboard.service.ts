/**
 * 虚拟密钥成本排行榜服务（Tick 51 v1.7.23.0 引入）。
 *
 * 在 Tick 33 VirtualKeyCostService.listAllCosts() 之上做"看板友好"包装：
 *   - 支持三档时间窗口（day / week / month）
 *   - join VirtualKey 表带出 label / prefix / environment / enabled
 *   - 派生 avgCostPerReq / successRate / shareOfTotal
 *   - 顶部 summary 给出窗口总 cost + 排行外其他 VK 的总占比
 *   - topN 上限 50（防误传 1000 卡死前端）
 *
 * 用途：VirtualKeys 页顶部"本月烧钱前 10"卡片，让管理员一眼看出哪些 key 异常活跃。
 *
 * 缓存：endpoint 层做 5s TTL（与其他 leaderboard 类端点一致），本 service 纯计算。
 */
import type { PrismaClient } from '@prisma/client';

export type LeaderboardScope = 'day' | 'week' | 'month';

const SCOPE_DAYS: Record<LeaderboardScope, number> = {
  day: 1,
  week: 7,
  month: 30,
};

const MAX_LIMIT = 50;

export interface VkSpendLeaderboardRow {
  virtualKeyId: string;
  label: string;
  prefix: string;
  environment: string;
  enabled: boolean;
  costUsd: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgCostPerReqUsd: number;
  successRate: number;
  shareOfTotal: number;
}

export interface VkSpendLeaderboardPayload {
  scope: LeaderboardScope;
  windowDays: number;
  limit: number;
  totalVkCount: number;
  windowCostUsd: number;
  shownCostUsd: number;
  remainderCostUsd: number;
  remainderVkCount: number;
  rows: VkSpendLeaderboardRow[];
  generatedAt: string;
}

export class VkSpendLeaderboardService {
  constructor(private readonly prisma: PrismaClient) {}

  async build(scope: LeaderboardScope = 'month', limit = 10): Promise<VkSpendLeaderboardPayload> {
    const windowDays = SCOPE_DAYS[scope];
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60_000);
    const cappedLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);

    // 1. 按 VK 累加 cost / 请求 / 成功
    const aggRows = await this.prisma.requestLog.groupBy({
      by: ['virtualKeyId'],
      where: {
        virtualKeyId: { not: null },
        startedAt: { gte: since },
      },
      _sum: { estimatedCostUsd: true },
      _count: { _all: true },
      orderBy: { _sum: { estimatedCostUsd: 'desc' } },
    });

    // 2. 同窗口内每个 VK 的成功数（status < 400）
    const successAgg = await this.prisma.requestLog.groupBy({
      by: ['virtualKeyId'],
      where: {
        virtualKeyId: { not: null },
        startedAt: { gte: since },
        status: { lt: 400 },
      },
      _count: { _all: true },
    });
    const successByVk = new Map<string, number>();
    for (const r of successAgg) {
      if (r.virtualKeyId) successByVk.set(r.virtualKeyId, r._count._all);
    }

    // 3. 总 cost
    const windowCostUsd = round6(
      aggRows.reduce((acc, r) => acc + (r._sum.estimatedCostUsd ?? 0), 0),
    );

    // 4. 取 top N + 拉对应 VK 元数据
    const topAggRows = aggRows.slice(0, cappedLimit);
    const vkIds = topAggRows.map((r) => r.virtualKeyId!).filter(Boolean);
    const vkRows = vkIds.length
      ? await this.prisma.virtualKey.findMany({
          where: { id: { in: vkIds } },
          select: {
            id: true,
            label: true,
            prefix: true,
            environment: true,
            enabled: true,
          },
        })
      : [];
    const vkById = new Map(vkRows.map((v) => [v.id, v]));

    const rows: VkSpendLeaderboardRow[] = topAggRows.map((r) => {
      const vkId = r.virtualKeyId!;
      const cost = round6(r._sum.estimatedCostUsd ?? 0);
      const total = r._count._all;
      const success = successByVk.get(vkId) ?? 0;
      const vkMeta = vkById.get(vkId);
      return {
        virtualKeyId: vkId,
        label: vkMeta?.label ?? '(已删除)',
        prefix: vkMeta?.prefix ?? '',
        environment: vkMeta?.environment ?? 'unknown',
        enabled: vkMeta?.enabled ?? false,
        costUsd: cost,
        totalRequests: total,
        successfulRequests: success,
        failedRequests: Math.max(0, total - success),
        avgCostPerReqUsd: total > 0 ? round6(cost / total) : 0,
        successRate: total > 0 ? round4(success / total) : 0,
        shareOfTotal: windowCostUsd > 0 ? round4(cost / windowCostUsd) : 0,
      };
    });

    const shownCostUsd = round6(rows.reduce((acc, r) => acc + r.costUsd, 0));
    const remainderCostUsd = round6(Math.max(0, windowCostUsd - shownCostUsd));

    return {
      scope,
      windowDays,
      limit: cappedLimit,
      totalVkCount: aggRows.length,
      windowCostUsd,
      shownCostUsd,
      remainderCostUsd,
      remainderVkCount: Math.max(0, aggRows.length - rows.length),
      rows,
      generatedAt: new Date().toISOString(),
    };
  }
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
