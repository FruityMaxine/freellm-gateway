/**
 * 管理员告警中心服务（Tick 40 v1.7.12.0 引入）。
 *
 * 把 Tick 31/34/37/39 四大零散告警源（全部已落库到 ErrorEvent 表）聚合到一个统一视图：
 *   - kind='balance_low'        (Tick 37 provider 余额预警)
 *   - kind='vk_usage_alert'     (Tick 39 VK 用量预警)
 *   - kind='model_change'       (Tick 34 模型自动黑名单)
 *   - kind='provider_outage' / 'auth_failure' / '429_storm' / 'content_filter' / 'unknown'（路由层失败事件）
 *
 * 支持：
 *   - 按 kind / severity / resolved 筛选 + 分页
 *   - 解决标记（POST resolve → resolvedAt 落库）
 *   - 统计：按 kind 分组 + 未解决总数
 */
import type { PrismaClient, ErrorEvent } from '@prisma/client';
import { FreeLLMError } from '@freellm/shared';

/** 告警中心识别的 kind 全集（≥ Tick 31/34/37/39 + 路由失败常见 kind）。 */
export const ALERT_KINDS = [
  'balance_low',
  'vk_usage_alert',
  'model_change',
  'provider_outage',
  'auth_failure',
  '429_storm',
  'content_filter',
  'unknown',
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

export interface AlertRow {
  id: string;
  kind: string;
  severity: string;
  providerId: string | null;
  providerSlug: string | null;
  modelId: string | null;
  message: string;
  detailsJson: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface AlertsListFilter {
  kind?: string;
  severity?: 'info' | 'warn' | 'error' | 'critical';
  resolved?: boolean;
  limit?: number;
  offset?: number;
}

export interface AlertsStats {
  totalUnresolved: number;
  byKind: Array<{ kind: string; unresolved: number; total: number }>;
  bySeverity: Array<{ severity: string; unresolved: number; total: number }>;
  generatedAt: string;
}

export class AlertsCenterService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(filter: AlertsListFilter = {}): Promise<{ data: AlertRow[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (filter.kind) where.kind = filter.kind;
    if (filter.severity) where.severity = filter.severity;
    if (filter.resolved === true) where.resolvedAt = { not: null };
    if (filter.resolved === false) where.resolvedAt = null;

    const limit = Math.min(filter.limit ?? 50, 500);
    const offset = filter.offset ?? 0;

    const [rows, total] = await Promise.all([
      this.prisma.errorEvent.findMany({
        where,
        include: { provider: { select: { slug: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.errorEvent.count({ where }),
    ]);
    return {
      data: rows.map((r) => serialize(r)),
      total,
    };
  }

  async resolve(id: string): Promise<AlertRow> {
    const existing = await this.prisma.errorEvent.findUnique({
      where: { id },
      include: { provider: { select: { slug: true } } },
    });
    if (!existing) {
      throw new FreeLLMError('not_found', `告警 ${id} 不存在`);
    }
    if (existing.resolvedAt) {
      return serialize(existing);
    }
    const updated = await this.prisma.errorEvent.update({
      where: { id },
      data: { resolvedAt: new Date() },
      include: { provider: { select: { slug: true } } },
    });
    return serialize(updated);
  }

  async stats(): Promise<AlertsStats> {
    const [byKindUnresolved, byKindTotal, bySeverityUnresolved, bySeverityTotal, totalUnresolved] =
      await Promise.all([
        this.prisma.errorEvent.groupBy({
          by: ['kind'],
          where: { resolvedAt: null },
          _count: { _all: true },
        }),
        this.prisma.errorEvent.groupBy({
          by: ['kind'],
          _count: { _all: true },
        }),
        this.prisma.errorEvent.groupBy({
          by: ['severity'],
          where: { resolvedAt: null },
          _count: { _all: true },
        }),
        this.prisma.errorEvent.groupBy({
          by: ['severity'],
          _count: { _all: true },
        }),
        this.prisma.errorEvent.count({ where: { resolvedAt: null } }),
      ]);

    const unresolvedByKind = new Map(byKindUnresolved.map((r) => [r.kind, r._count._all]));
    const unresolvedBySeverity = new Map(
      bySeverityUnresolved.map((r) => [r.severity, r._count._all]),
    );

    return {
      totalUnresolved,
      byKind: byKindTotal
        .map((r) => ({
          kind: r.kind,
          unresolved: unresolvedByKind.get(r.kind) ?? 0,
          total: r._count._all,
        }))
        .sort((a, b) => b.unresolved - a.unresolved || b.total - a.total),
      bySeverity: bySeverityTotal
        .map((r) => ({
          severity: r.severity,
          unresolved: unresolvedBySeverity.get(r.severity) ?? 0,
          total: r._count._all,
        }))
        .sort((a, b) => b.unresolved - a.unresolved),
      generatedAt: new Date().toISOString(),
    };
  }
}

function serialize(row: ErrorEvent & { provider?: { slug: string } | null }): AlertRow {
  return {
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    providerId: row.providerId,
    providerSlug: row.provider?.slug ?? null,
    modelId: row.modelId,
    message: row.message,
    detailsJson: row.detailsJson,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}
