/**
 * 告警规则引擎（组 6 Tick 2 v1.16.0.0）。
 *
 * 用户自定义 metric/operator/threshold 规则；cron 周期 evaluate，命中则：
 *   1. 写一条 ErrorEvent（kind=`alert_rule:<name>`，进 alerts-center 统一视图）
 *   2. notifyWebhook 时 emit `alert.rule.triggered`（webhook-dispatcher 出站投递）
 */
import type { PrismaClient } from '@prisma/client';
import { globalEventBus } from './event-bus.js';
import { BudgetService } from './budget.service.js';
import { NotifyChannelService } from './notify-channel.service.js';

const DAY_MS = 86_400_000;

/** metric 计算器：返回当前 metric 的数值。新增 metric 在此加一行。 */
const METRICS: Record<string, (prisma: PrismaClient) => Promise<number>> = {
  // 最近 24h 未解决 ErrorEvent 总数
  error_count_24h: (prisma) =>
    prisma.errorEvent.count({
      where: { createdAt: { gte: new Date(Date.now() - DAY_MS) }, resolvedAt: null },
    }),
  // 最近 24h webhook 投递失败数
  webhook_failures_24h: (prisma) =>
    prisma.errorEvent.count({
      where: { kind: 'webhook_delivery_failed', createdAt: { gte: new Date(Date.now() - DAY_MS) } },
    }),
  // 当前活跃熔断（cooldown）数
  active_cooldowns: (prisma) =>
    prisma.cooldown.count({ where: { resolvedAt: null, expiresAt: { gt: new Date() } } }),
  // 启用中的虚拟密钥数
  enabled_vk_count: (prisma) => prisma.virtualKey.count({ where: { enabled: true } }),
  // 最近 24h 请求错误率（%）
  request_error_rate_24h: async (prisma) => {
    const since = new Date(Date.now() - DAY_MS);
    const total = await prisma.requestLog.count({ where: { startedAt: { gte: since } } });
    if (total === 0) return 0;
    const failed = await prisma.requestLog.count({
      where: { startedAt: { gte: since }, status: { gte: 400 } },
    });
    return Math.round((failed / total) * 10000) / 100;
  },
  // 所有 enabled 成本预算中的最高使用率（%）—— 接入成本预算告警（组 7 Tick 5）
  budget_max_usage_pct: (prisma) => new BudgetService(prisma).maxUsagePct(),
};

export const ALERT_METRICS = Object.keys(METRICS);
export const ALERT_OPERATORS = ['gt', 'gte', 'lt', 'lte'] as const;

function compareOp(value: number, op: string, threshold: number): boolean {
  switch (op) {
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
    default:
      return false;
  }
}

export interface CreateAlertRuleInput {
  name: string;
  metric: string;
  operator: string;
  threshold: number;
  severity?: string;
  enabled?: boolean;
  notifyWebhook?: boolean;
}

export class AlertRuleService {
  constructor(private prisma: PrismaClient) {}

  list() {
    return this.prisma.alertRule.findMany({ orderBy: { createdAt: 'desc' } });
  }

  create(input: CreateAlertRuleInput) {
    return this.prisma.alertRule.create({
      data: {
        name: input.name,
        metric: input.metric,
        operator: input.operator,
        threshold: input.threshold,
        severity: input.severity ?? 'warn',
        enabled: input.enabled ?? true,
        notifyWebhook: input.notifyWebhook ?? true,
      },
    });
  }

  update(id: string, patch: Partial<CreateAlertRuleInput>) {
    return this.prisma.alertRule.update({ where: { id }, data: patch });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.alertRule.delete({ where: { id } });
  }

  /** 评估所有 enabled 规则。命中→写 ErrorEvent + emit webhook + 更新 lastTriggeredAt/lastValue。 */
  async evaluate(): Promise<{ evaluated: number; triggered: number }> {
    const rules = await this.prisma.alertRule.findMany({ where: { enabled: true } });
    let triggered = 0;
    for (const rule of rules) {
      const calc = METRICS[rule.metric];
      if (!calc) continue;
      const value = await calc(this.prisma);
      const hit = compareOp(value, rule.operator, rule.threshold);
      if (hit) {
        await this.prisma.errorEvent.create({
          data: {
            kind: `alert_rule:${rule.name}`,
            severity: rule.severity,
            message: `告警规则「${rule.name}」命中：${rule.metric}=${value} ${rule.operator} ${rule.threshold}`,
            detailsJson: JSON.stringify({
              ruleId: rule.id,
              metric: rule.metric,
              value,
              operator: rule.operator,
              threshold: rule.threshold,
            }),
          },
        });
        if (rule.notifyWebhook) {
          await globalEventBus.emit('alert.rule.triggered', {
            rule: rule.name,
            metric: rule.metric,
            value,
            operator: rule.operator,
            threshold: rule.threshold,
            severity: rule.severity,
          });
        }
        // 组 8 Tick 5：分发到 enabled 通知渠道（email/slack/webhook），失败不阻断告警主流程。
        try {
          await new NotifyChannelService(this.prisma).dispatchAll(
            `[${rule.severity}] FreeLLM 告警：${rule.name}`,
            `${rule.metric}=${value} ${rule.operator} ${rule.threshold}`,
          );
        } catch (e) {
          // 不静默吞错：渠道分发失败记日志（不阻断告警主流程）。
          console.warn('[alert] NotifyChannel dispatchAll 失败:', (e as Error).message);
        }
        await this.prisma.alertRule.update({
          where: { id: rule.id },
          data: { lastTriggeredAt: new Date(), lastValue: value },
        });
        triggered += 1;
      } else {
        await this.prisma.alertRule.update({ where: { id: rule.id }, data: { lastValue: value } });
      }
    }
    return { evaluated: rules.length, triggered };
  }
}
