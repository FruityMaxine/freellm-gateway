/**
 * 成本预算服务（组 7 Tick 5 v1.23.0.0）。
 *
 * 按 period 窗口聚合 RequestLog.estimatedCostUsd 计算预算已用额度，
 * 复用 cost-analytics 的 estimatedCostUsd 成本核算。scope 决定聚合范围：
 *   - global → 全量请求
 *   - vk     → 指定 virtualKeyId 的请求
 *   - model  → 指定 upstreamModel 的请求
 * 时间字段用 RequestLog.startedAt（非 createdAt）。
 */
import type { PrismaClient } from '@prisma/client';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const PERIOD_MS: Record<string, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: MONTH_MS,
};

export interface BudgetLike {
  scope: string;
  targetId: string | null;
  limitUsd: number;
  period: string;
}

export interface BudgetSpend {
  spent: number;
  limit: number;
  pct: number;
  remaining: number;
}

export class BudgetService {
  constructor(private prisma: PrismaClient) {}

  async computeSpend(budget: BudgetLike): Promise<BudgetSpend> {
    const windowMs = PERIOD_MS[budget.period] ?? MONTH_MS;
    const since = new Date(Date.now() - windowMs);
    const where = {
      startedAt: { gte: since },
      estimatedCostUsd: { not: null },
      ...(budget.scope === 'vk' && budget.targetId ? { virtualKeyId: budget.targetId } : {}),
      ...(budget.scope === 'model' && budget.targetId ? { upstreamModel: budget.targetId } : {}),
    };
    const agg = await this.prisma.requestLog.aggregate({
      where,
      _sum: { estimatedCostUsd: true },
    });
    const spent = agg._sum.estimatedCostUsd ?? 0;
    const limit = budget.limitUsd;
    const pct = limit > 0 ? Math.round((spent / limit) * 10000) / 100 : 0;
    return { spent, limit, pct, remaining: Math.max(0, limit - spent) };
  }

  async listWithSpend() {
    const budgets = await this.prisma.budget.findMany({ orderBy: { createdAt: 'desc' } });
    return Promise.all(
      budgets.map(async (b) => ({ ...b, ...(await this.computeSpend(b)) })),
    );
  }

  /** 所有 enabled 预算中的最高使用率（%），供 alert-rule metric。无预算返 0。 */
  async maxUsagePct(): Promise<number> {
    const budgets = await this.prisma.budget.findMany({ where: { enabled: true } });
    let max = 0;
    for (const b of budgets) {
      const { pct } = await this.computeSpend(b);
      if (pct > max) max = pct;
    }
    return max;
  }
}
