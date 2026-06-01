/**
 * 数据保留策略服务（Tick 46 v1.7.18.0 引入）。
 *
 * 把 Tick 29 AdminAuditService.purgeOlderThan + Tick 36 PlaygroundSessionService.purgeOlderThan
 * 串成统一的 daily-purge cron 入口，保留天数从 `Setting` 表读取（key=retention.policy）。
 *
 * 默认配置：
 *   - adminAuditRetentionDays   90 天
 *   - playgroundSessionRetentionDays  30 天
 *   - errorEventRetentionDays   180 天（resolved 才清，未解决永不清）
 *
 * 每个 retention 配置 0 = 永不清；负数视为 0；上限 3650 天（10 年）。
 */
import type { PrismaClient } from '@prisma/client';
import { FreeLLMError } from '@freellm/shared';
import { AdminAuditService } from './admin-audit.service.js';
import { PlaygroundSessionService } from './playground-session.service.js';

const SETTING_KEY = 'retention.policy';
const MAX_RETENTION_DAYS = 3650;

export interface RetentionPolicy {
  adminAuditRetentionDays: number;
  playgroundSessionRetentionDays: number;
  errorEventRetentionDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  adminAuditRetentionDays: 90,
  playgroundSessionRetentionDays: 30,
  errorEventRetentionDays: 180,
};

export interface PurgeReport {
  policy: RetentionPolicy;
  auditPurged: number;
  playgroundSessionsPurged: number;
  errorEventsPurged: number;
  generatedAt: string;
}

export class RetentionPolicyService {
  constructor(private readonly prisma: PrismaClient) {}

  /** 读策略；缺失/不合法 → 用 DEFAULT 兜底。 */
  async getPolicy(): Promise<RetentionPolicy> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return { ...DEFAULT_RETENTION };
    try {
      const parsed = JSON.parse(row.value) as Partial<RetentionPolicy>;
      return {
        adminAuditRetentionDays: normalizeDays(
          parsed.adminAuditRetentionDays,
          DEFAULT_RETENTION.adminAuditRetentionDays,
        ),
        playgroundSessionRetentionDays: normalizeDays(
          parsed.playgroundSessionRetentionDays,
          DEFAULT_RETENTION.playgroundSessionRetentionDays,
        ),
        errorEventRetentionDays: normalizeDays(
          parsed.errorEventRetentionDays,
          DEFAULT_RETENTION.errorEventRetentionDays,
        ),
      };
    } catch {
      return { ...DEFAULT_RETENTION };
    }
  }

  async setPolicy(input: Partial<RetentionPolicy>): Promise<RetentionPolicy> {
    const current = await this.getPolicy();
    const next: RetentionPolicy = {
      adminAuditRetentionDays:
        input.adminAuditRetentionDays !== undefined
          ? validateDays(input.adminAuditRetentionDays)
          : current.adminAuditRetentionDays,
      playgroundSessionRetentionDays:
        input.playgroundSessionRetentionDays !== undefined
          ? validateDays(input.playgroundSessionRetentionDays)
          : current.playgroundSessionRetentionDays,
      errorEventRetentionDays:
        input.errorEventRetentionDays !== undefined
          ? validateDays(input.errorEventRetentionDays)
          : current.errorEventRetentionDays,
    };
    await this.prisma.setting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: JSON.stringify(next), category: 'retention' },
      update: { value: JSON.stringify(next) },
    });
    return next;
  }

  /** 执行清扫：对每个域调用各自的 purgeOlderThan。retention=0 时跳过该域。 */
  async runPurge(): Promise<PurgeReport> {
    const policy = await this.getPolicy();
    let auditPurged = 0;
    let playgroundSessionsPurged = 0;
    let errorEventsPurged = 0;

    if (policy.adminAuditRetentionDays > 0) {
      const svc = new AdminAuditService(this.prisma);
      try {
        auditPurged = await svc.purgeOlderThan(policy.adminAuditRetentionDays);
      } catch (err) {
        console.warn('[retention] audit purge 失败：', (err as Error).message);
      }
    }
    if (policy.playgroundSessionRetentionDays > 0) {
      const svc = new PlaygroundSessionService(this.prisma);
      try {
        playgroundSessionsPurged = await svc.purgeOlderThan(
          policy.playgroundSessionRetentionDays,
        );
      } catch (err) {
        console.warn('[retention] playground session purge 失败：', (err as Error).message);
      }
    }
    if (policy.errorEventRetentionDays > 0) {
      try {
        const cutoff = new Date(
          Date.now() - policy.errorEventRetentionDays * 24 * 60 * 60_000,
        );
        // 仅清已解决的 error events；未解决永不清（避免吞掉运维忘看的告警）
        const result = await this.prisma.errorEvent.deleteMany({
          where: { resolvedAt: { not: null, lt: cutoff } },
        });
        errorEventsPurged = result.count;
      } catch (err) {
        console.warn('[retention] error events purge 失败：', (err as Error).message);
      }
    }

    return {
      policy,
      auditPurged,
      playgroundSessionsPurged,
      errorEventsPurged,
      generatedAt: new Date().toISOString(),
    };
  }
}

/** 把 unknown 安全规整成 0..MAX 区间整数；非数 fallback 用 defaultDays。 */
function normalizeDays(value: unknown, defaultDays: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultDays;
  const intVal = Math.floor(value);
  if (intVal < 0) return 0;
  if (intVal > MAX_RETENTION_DAYS) return MAX_RETENTION_DAYS;
  return intVal;
}

function validateDays(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new FreeLLMError('bad_request', 'retention days 必须是数字');
  }
  const intVal = Math.floor(value);
  if (intVal < 0) {
    throw new FreeLLMError('bad_request', 'retention days 不可为负');
  }
  if (intVal > MAX_RETENTION_DAYS) {
    throw new FreeLLMError(
      'bad_request',
      `retention days 不可超过 ${MAX_RETENTION_DAYS} 天（10 年）`,
    );
  }
  return intVal;
}
