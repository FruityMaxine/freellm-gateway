/**
 * 虚拟密钥级成本统计（Tick 33 v1.7.5.0 引入）。
 *
 * 联动 Tick 30 RequestLog.estimatedCostUsd —— 按 virtualKeyId 切片聚合：
 *   - totalCostUsd：窗口内累计估算 USD
 *   - totalRequests：窗口内请求总数
 *   - topModels：按 cost 降序的 top N 模型（默认 5），便于定位"哪个模型烧 VK 最多"
 *
 * 设计：单端点查询每 5 秒 TTL 缓存（与全局 metrics 一致）；按 (vkId, days) 组合缓存键。
 */
import type { PrismaClient } from '@prisma/client';

export interface VirtualKeyCostTopModel {
  upstreamProvider: string;
  upstreamModel: string;
  costUsd: number;
  requests: number;
}

export interface VirtualKeyCostPayload {
  virtualKeyId: string;
  windowDays: number;
  totalCostUsd: number;
  totalRequests: number;
  successfulRequests: number;
  /** 仅含 estimatedCostUsd != null 的请求；free models 不计入 */
  billableRequests: number;
  topModels: VirtualKeyCostTopModel[];
  generatedAt: string;
}

export class VirtualKeyCostService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * 算指定 VK 在过去 N 天内的成本与 top 模型。
   * 不校验 VK 是否存在 — 调用方（route）负责，service 只看 logs。
   */
  async compute(virtualKeyId: string, windowDays = 7, topModelLimit = 5): Promise<VirtualKeyCostPayload> {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60_000);
    const [costAgg, total, success, topRows] = await Promise.all([
      this.prisma.requestLog.aggregate({
        where: {
          virtualKeyId,
          startedAt: { gte: since },
          estimatedCostUsd: { not: null },
        },
        _sum: { estimatedCostUsd: true },
        _count: { _all: true },
      }),
      this.prisma.requestLog.count({
        where: { virtualKeyId, startedAt: { gte: since } },
      }),
      this.prisma.requestLog.count({
        where: { virtualKeyId, startedAt: { gte: since }, status: { lt: 400 } },
      }),
      this.prisma.requestLog.groupBy({
        by: ['upstreamModel', 'upstreamProvider'],
        where: {
          virtualKeyId,
          startedAt: { gte: since },
          estimatedCostUsd: { not: null },
        },
        _sum: { estimatedCostUsd: true },
        _count: { _all: true },
        orderBy: { _sum: { estimatedCostUsd: 'desc' } },
        take: Math.min(topModelLimit, 20),
      }),
    ]);

    return {
      virtualKeyId,
      windowDays,
      totalCostUsd: round6(costAgg._sum.estimatedCostUsd ?? 0),
      totalRequests: total,
      successfulRequests: success,
      billableRequests: costAgg._count._all,
      topModels: topRows
        .filter((r) => r.upstreamModel && r.upstreamProvider)
        .map((r) => ({
          upstreamProvider: r.upstreamProvider ?? 'unknown',
          upstreamModel: r.upstreamModel ?? 'unknown',
          costUsd: round6(r._sum.estimatedCostUsd ?? 0),
          requests: r._count._all,
        })),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * 批量：列出所有 VK 在过去 N 天的总 cost + total 请求，按 cost 降序。
   * 用于 VirtualKeys 列表的 "成本" 列一次性拉完。
   */
  async listAllCosts(windowDays = 7): Promise<
    Array<{ virtualKeyId: string; costUsd: number; requests: number }>
  > {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60_000);
    const rows = await this.prisma.requestLog.groupBy({
      by: ['virtualKeyId'],
      where: {
        virtualKeyId: { not: null },
        startedAt: { gte: since },
      },
      _sum: { estimatedCostUsd: true },
      _count: { _all: true },
      orderBy: { _sum: { estimatedCostUsd: 'desc' } },
    });
    return rows
      .filter((r) => r.virtualKeyId)
      .map((r) => ({
        virtualKeyId: r.virtualKeyId!,
        costUsd: round6(r._sum.estimatedCostUsd ?? 0),
        requests: r._count._all,
      }));
  }
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
