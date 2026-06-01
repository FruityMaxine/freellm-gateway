/**
 * 模型自动黑名单服务（Tick 34 v1.7.6.0 引入）。
 *
 * 周期 (cron 默认 15 分钟) 扫所有 active model + 近 24h request_logs，
 * 满足触发条件 → 设 Model.manualOverride='force_disabled' + 写 ErrorEvent + emit
 * 'model:auto_blacklisted' 事件供 Webhook / SSE 接力。
 *
 * 触发条件（任一）：
 *   - 24h 内成功率 < `minSuccessRate` (默认 0.50) AND 样本量 ≥ `minSampleSize` (默认 10)
 *   - 最近 `consecutiveFailureWindow` (默认 5) 次连续全失败（status >= 400 / errorKind != null）
 *
 * 跳过条件：
 *   - `whitelisted = true`（管理员明示白名单，绝不动）
 *   - `manualOverride = 'force_enabled'`（管理员强开，cron 不可推翻）
 *   - 模型已是 `blacklisted=true` OR `manualOverride='force_disabled'`（无需重复）
 *
 * 防误判：服务幂等 — 已被自动黑过的模型不重复 emit 事件；解黑由管理员手动操作。
 */
import type { PrismaClient } from '@prisma/client';
import { globalEventBus } from './event-bus.js';

export interface AutoBlacklistOptions {
  minSuccessRate?: number;          // 默认 0.50（24h 成功率阈值）
  minSampleSize?: number;            // 默认 10（24h 样本下限）
  consecutiveFailureWindow?: number; // 默认 5（连续失败数）
  /** 评估窗口（毫秒），默认 24 小时。 */
  windowMs?: number;
}

export interface AutoBlacklistResult {
  modelId: string;
  upstreamId: string;
  reason: 'low_success_rate' | 'consecutive_failures';
  successRate: number | null;
  sampleSize: number;
  consecutiveFailures: number;
}

export interface EvaluateReport {
  evaluated: number;
  blacklisted: AutoBlacklistResult[];
  skippedWhitelisted: number;
  skippedForceEnabled: number;
  skippedAlreadyDisabled: number;
  generatedAt: string;
}

export class ModelAutoBlacklistService {
  private readonly opts: Required<AutoBlacklistOptions>;

  constructor(
    private readonly prisma: PrismaClient,
    opts: AutoBlacklistOptions = {},
  ) {
    this.opts = {
      minSuccessRate: opts.minSuccessRate ?? 0.5,
      minSampleSize: opts.minSampleSize ?? 10,
      consecutiveFailureWindow: opts.consecutiveFailureWindow ?? 5,
      windowMs: opts.windowMs ?? 24 * 60 * 60_000,
    };
  }

  /**
   * 扫所有 active model，按规则评估并打 force_disabled。
   * 返回详细 report 供 cron 日志 / 端点。
   */
  async evaluateAll(): Promise<EvaluateReport> {
    const since = new Date(Date.now() - this.opts.windowMs);
    const models = await this.prisma.model.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        upstreamId: true,
        whitelisted: true,
        blacklisted: true,
        manualOverride: true,
      },
    });

    const report: EvaluateReport = {
      evaluated: 0,
      blacklisted: [],
      skippedWhitelisted: 0,
      skippedForceEnabled: 0,
      skippedAlreadyDisabled: 0,
      generatedAt: new Date().toISOString(),
    };

    for (const m of models) {
      // 跳过条件
      if (m.whitelisted) {
        report.skippedWhitelisted += 1;
        continue;
      }
      if (m.manualOverride === 'force_enabled') {
        report.skippedForceEnabled += 1;
        continue;
      }
      if (m.blacklisted || m.manualOverride === 'force_disabled') {
        report.skippedAlreadyDisabled += 1;
        continue;
      }

      report.evaluated += 1;

      // 拉该 model 近 24h 日志（按 upstreamModel 匹配）
      const logs = await this.prisma.requestLog.findMany({
        where: {
          upstreamModel: m.upstreamId,
          startedAt: { gte: since },
        },
        select: { status: true, errorKind: true, startedAt: true },
        orderBy: { startedAt: 'desc' },
        take: 500,
      });

      const evalRes = evaluateModelLogs(logs, this.opts);
      if (!evalRes.shouldBlacklist) continue;

      // 写 force_disabled + 记 ErrorEvent + emit 事件
      await this.prisma.model.update({
        where: { id: m.id },
        data: {
          manualOverride: 'force_disabled',
          notes: `auto-blacklisted: ${evalRes.reason} (success=${evalRes.successRate}, samples=${evalRes.sampleSize}, consecFail=${evalRes.consecutiveFailures})`,
        },
      });

      await this.prisma.errorEvent.create({
        data: {
          kind: 'model_change',
          severity: 'warn',
          modelId: m.id,
          message: `模型 ${m.upstreamId} 已自动加入黑名单（${evalRes.reason}）`,
          detailsJson: JSON.stringify({
            reason: evalRes.reason,
            successRate: evalRes.successRate,
            sampleSize: evalRes.sampleSize,
            consecutiveFailures: evalRes.consecutiveFailures,
          }),
        },
      });

      const result: AutoBlacklistResult = {
        modelId: m.id,
        upstreamId: m.upstreamId,
        reason: evalRes.reason!,
        successRate: evalRes.successRate,
        sampleSize: evalRes.sampleSize,
        consecutiveFailures: evalRes.consecutiveFailures,
      };
      report.blacklisted.push(result);

      try {
        await globalEventBus.emit('model:auto_blacklisted', result);
      } catch {
        /* 静默 */
      }
    }

    return report;
  }

  /**
   * 拉最近 N 个被自动黑名单的模型（用于 Web 端展示）。
   * 通过 ErrorEvent (kind=model_change + message 以 "auto-blacklisted" 开头) 反查。
   */
  async listRecentlyAutoBlacklisted(limit = 20): Promise<
    Array<{
      modelId: string;
      upstreamId: string;
      reason: string;
      createdAt: Date;
      detailsJson: string | null;
    }>
  > {
    const events = await this.prisma.errorEvent.findMany({
      where: {
        kind: 'model_change',
        message: { startsWith: '模型 ' },
        modelId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      select: { modelId: true, message: true, detailsJson: true, createdAt: true },
    });
    if (events.length === 0) return [];
    const modelIds = events
      .map((e) => e.modelId)
      .filter((id): id is string => id !== null);
    const models = await this.prisma.model.findMany({
      where: { id: { in: modelIds } },
      select: { id: true, upstreamId: true },
    });
    const upstreamById = new Map(models.map((m) => [m.id, m.upstreamId]));
    return events.map((e) => ({
      modelId: e.modelId ?? '',
      upstreamId: upstreamById.get(e.modelId ?? '') ?? 'unknown',
      reason: extractReason(e.detailsJson),
      createdAt: e.createdAt,
      detailsJson: e.detailsJson,
    }));
  }
}

interface ModelEvalResult {
  shouldBlacklist: boolean;
  reason: AutoBlacklistResult['reason'] | null;
  successRate: number | null;
  sampleSize: number;
  consecutiveFailures: number;
}

/** 纯函数：给定 logs + opts，判断模型是否应该黑名单。 */
export function evaluateModelLogs(
  logs: Array<{ status: number | null; errorKind: string | null }>,
  opts: Required<AutoBlacklistOptions>,
): ModelEvalResult {
  const sampleSize = logs.length;
  let successCount = 0;
  let consecutiveFailures = 0;
  let consecutiveStreakBroken = false;
  for (const log of logs) {
    const isFailure = log.status === null || log.status >= 400 || log.errorKind !== null;
    if (!isFailure) successCount += 1;
    if (!consecutiveStreakBroken) {
      if (isFailure) {
        consecutiveFailures += 1;
      } else {
        consecutiveStreakBroken = true;
      }
    }
  }
  const successRate = sampleSize > 0 ? successCount / sampleSize : null;

  if (consecutiveFailures >= opts.consecutiveFailureWindow) {
    return {
      shouldBlacklist: true,
      reason: 'consecutive_failures',
      successRate,
      sampleSize,
      consecutiveFailures,
    };
  }
  if (
    successRate !== null &&
    sampleSize >= opts.minSampleSize &&
    successRate < opts.minSuccessRate
  ) {
    return {
      shouldBlacklist: true,
      reason: 'low_success_rate',
      successRate,
      sampleSize,
      consecutiveFailures,
    };
  }
  return {
    shouldBlacklist: false,
    reason: null,
    successRate,
    sampleSize,
    consecutiveFailures,
  };
}

function extractReason(detailsJson: string | null): string {
  if (!detailsJson) return 'unknown';
  try {
    const obj = JSON.parse(detailsJson) as { reason?: string };
    return obj.reason ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
