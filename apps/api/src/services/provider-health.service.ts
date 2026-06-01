/**
 * 上游 Provider 健康检查服务（Tick 31 v1.7.3.0 引入）。
 *
 * 当前 Provider.status 字段在 discovery 期间静态写入后从不主动验证；
 * 实际生产环境上游随时可能 429 / down / auth 失效，未主动 probe 等于裸奔。
 * 本服务由 cron 周期性触发，对每个 registry 注册的 provider 调 BaseProvider.checkHealth()：
 *   - 写一条 HealthCheck 记录（已有表，仅复用）
 *   - 更新 Provider.lastHealthAt / lastSuccessAt / lastErrorAt / lastErrorMessage / status / errorCount24h
 *   - 失败 → 写一条 Cooldown（scope=provider，默认 5 分钟 backoff），让 routing engine 自动避开
 *   - emit `provider:health_check` 事件供 SSE 推到前端
 *
 * 单次检查超时 10s（避免一个 provider 阻塞全部）；并发 checkAll 时所有 provider 并行 probe。
 */
import type { PrismaClient } from '@prisma/client';
import type { ProviderRegistry, ProviderHealthReport } from '@freellm/provider-core';
import { globalEventBus } from './event-bus.js';

export interface ProviderHealthCheckResult {
  providerSlug: string;
  ok: boolean;
  status: ProviderHealthReport['status'];
  latencyMs: number | null;
  message: string | null;
  errorKind: string | null;
  takenAt: string;
}

export interface ProviderHealthOptions {
  /** 单次 probe 超时（默认 10 秒）。 */
  perCheckTimeoutMs?: number;
  /** 失败时 Cooldown 持续时间（默认 5 分钟）。 */
  failureCooldownMs?: number;
}

export class ProviderHealthService {
  private readonly opts: Required<ProviderHealthOptions>;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: ProviderRegistry,
    opts: ProviderHealthOptions = {},
  ) {
    this.opts = {
      perCheckTimeoutMs: opts.perCheckTimeoutMs ?? 10_000,
      failureCooldownMs: opts.failureCooldownMs ?? 5 * 60_000,
    };
  }

  /**
   * 检查单个 provider。registry 找不到 → 抛错（让上层翻 404）。
   * checkHealth 自身抛错或超时 → 视为 ok=false + errorKind=upstream_error。
   */
  async checkOne(providerSlug: string): Promise<ProviderHealthCheckResult> {
    const provider = this.registry.get(providerSlug);
    if (!provider) {
      throw new Error(`provider ${providerSlug} 未在 registry 注册`);
    }
    const startedAt = Date.now();
    let report: ProviderHealthReport;
    try {
      report = await withTimeout(provider.checkHealth(), this.opts.perCheckTimeoutMs);
    } catch (err) {
      report = {
        ok: false,
        status: 'degraded',
        message: (err as Error).message,
      };
    }
    const latencyMs = Date.now() - startedAt;
    const takenAt = new Date();
    const errorKind = report.ok ? null : classifyError(report.message);

    // 1) 写 HealthCheck 记录
    const dbProvider = await this.prisma.provider.findUnique({ where: { slug: providerSlug } });
    if (dbProvider) {
      await this.prisma.healthCheck.create({
        data: {
          scope: 'provider',
          providerId: dbProvider.id,
          ok: report.ok,
          latencyMs: report.latencyMs ?? latencyMs,
          errorKind: errorKind,
          errorMessage: report.ok ? null : (report.message ?? null),
          detailsJson: report.detail ? JSON.stringify(report.detail) : null,
          takenAt,
        },
      });

      // 2) 更新 Provider 状态字段
      const update: Record<string, unknown> = {
        lastHealthAt: takenAt,
        status: report.status,
      };
      if (report.ok) {
        update.lastSuccessAt = takenAt;
        // 成功一次就重置 24h 错误计数（粗粒度但够用，精确需另存 sliding window）
        update.errorCount24h = 0;
      } else {
        update.lastErrorAt = takenAt;
        update.lastErrorMessage = report.message ?? errorKind ?? 'unknown';
        update.errorCount24h = (dbProvider.errorCount24h ?? 0) + 1;
      }
      await this.prisma.provider.update({ where: { id: dbProvider.id }, data: update });

      // 3) 失败 → 写 Cooldown（仅当当前没有未过期的 provider cooldown 时）
      if (!report.ok) {
        const existing = await this.prisma.cooldown.findFirst({
          where: {
            scope: 'provider',
            providerId: dbProvider.id,
            expiresAt: { gte: takenAt },
            resolvedAt: null,
          },
        });
        if (!existing) {
          await this.prisma.cooldown.create({
            data: {
              scope: 'provider',
              providerId: dbProvider.id,
              reason: errorKind ?? 'health_check_failed',
              backoffMs: this.opts.failureCooldownMs,
              expiresAt: new Date(takenAt.getTime() + this.opts.failureCooldownMs),
            },
          });
        }
      }
    }

    const result: ProviderHealthCheckResult = {
      providerSlug,
      ok: report.ok,
      status: report.status,
      latencyMs: report.latencyMs ?? latencyMs,
      message: report.message ?? null,
      errorKind,
      takenAt: takenAt.toISOString(),
    };

    // 4) 推到事件总线（SSE / Webhook 自动接力）
    try {
      await globalEventBus.emit('provider:health_check', result);
    } catch {
      /* 静默 */
    }

    return result;
  }

  /**
   * 并发检查所有 registry 中注册的 provider。
   * 单 provider 失败不影响其它 — 全部 Promise.allSettled。
   */
  async checkAll(): Promise<ProviderHealthCheckResult[]> {
    const providers = this.registry.list();
    const results = await Promise.allSettled(providers.map((p) => this.checkOne(p.slug)));
    return results
      .map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        return {
          providerSlug: providers[i]!.slug,
          ok: false,
          status: 'degraded' as const,
          latencyMs: null,
          message: (r.reason as Error).message,
          errorKind: 'internal',
          takenAt: new Date().toISOString(),
        };
      });
  }

  /**
   * 取某 provider 的近 N 条历史记录。
   */
  async history(providerSlug: string, limit = 50): Promise<
    Array<{
      ok: boolean;
      latencyMs: number | null;
      errorKind: string | null;
      errorMessage: string | null;
      takenAt: Date;
    }>
  > {
    const provider = await this.prisma.provider.findUnique({ where: { slug: providerSlug } });
    if (!provider) return [];
    const rows = await this.prisma.healthCheck.findMany({
      where: { scope: 'provider', providerId: provider.id },
      orderBy: { takenAt: 'desc' },
      take: Math.min(limit, 200),
      select: { ok: true, latencyMs: true, errorKind: true, errorMessage: true, takenAt: true },
    });
    return rows;
  }
}

/** 把错误消息归类到几个标准 kind。 */
export function classifyError(msg: string | undefined | null): string {
  if (!msg) return 'unknown';
  const lower = msg.toLowerCase();
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('etimedout'))
    return 'timeout';
  if (lower.includes('429') || lower.includes('rate limit')) return 'rate_limited';
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauth')) return 'auth';
  if (lower.includes('502') || lower.includes('503') || lower.includes('504')) return 'upstream_5xx';
  if (lower.includes('econnrefused') || lower.includes('enotfound')) return 'network';
  return 'upstream_error';
}

/** Promise + 超时。 */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`health-check timeout after ${ms}ms`)), ms),
    ),
  ]);
}
