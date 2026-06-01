/**
 * 请求重试/退避策略服务（Tick 48 v1.7.20.0 引入）。
 *
 * Tick 47 之前: 重试逻辑只受 env `FREELLM_MAX_ROUTE_ATTEMPTS` 控制，且
 *   attempt 之间无 sleep（仅切换下一候选模型）。本服务把它扩展为完整
 *   RetryPolicy + jittered exponential backoff，可通过 Web UI 在线调。
 *
 * 配置存 Setting 表 key=`routing.retryPolicy`；缺失时退回 DEFAULT。
 *
 * 字段语义：
 *   - maxAttempts            最大尝试数（覆盖 env 值；上限 10）
 *   - initialBackoffMs       第一次失败后等待的基础毫秒数
 *   - maxBackoffMs           退避上限（避免指数爆炸）
 *   - jitterRatio            ±jitter 抖动比例，0..1（避免群体重试同步）
 *   - retryOnStatusCodes     仅当上游返回这些 HTTP code 时才重试（空数组 = 用默认 isRetriableKind）
 *   - retryOnErrorKinds      仅当错误 kind 在此列表才重试（空数组 = 用默认 isRetriableKind）
 *
 * computeBackoff 算法：
 *   base = min(initialBackoffMs * 2^(attempt-1), maxBackoffMs)
 *   jitter = base * jitterRatio * (random * 2 - 1)     // 即 [-jitter, +jitter]
 *   return max(0, round(base + jitter))
 */
import type { PrismaClient } from '@prisma/client';
import { FreeLLMError } from '@freellm/shared';

const SETTING_KEY = 'routing.retryPolicy';
const MAX_ATTEMPTS_LIMIT = 10;
const MAX_BACKOFF_LIMIT = 60_000;

export interface RetryPolicy {
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  jitterRatio: number;
  retryOnStatusCodes: number[];
  retryOnErrorKinds: string[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  initialBackoffMs: 200,
  maxBackoffMs: 5_000,
  jitterRatio: 0.3,
  retryOnStatusCodes: [],
  retryOnErrorKinds: [],
};

export interface BackoffPreview {
  attempt: number;
  baseMs: number;
  withJitterMinMs: number;
  withJitterMaxMs: number;
  sampleMs: number;
}

export class RetryPolicyService {
  constructor(private readonly prisma: PrismaClient) {}

  async getPolicy(): Promise<RetryPolicy> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return { ...DEFAULT_RETRY_POLICY };
    try {
      const parsed = JSON.parse(row.value) as Partial<RetryPolicy>;
      return mergeWithDefaults(parsed);
    } catch {
      return { ...DEFAULT_RETRY_POLICY };
    }
  }

  async setPolicy(patch: Partial<RetryPolicy>): Promise<RetryPolicy> {
    validatePatch(patch);
    const current = await this.getPolicy();
    const merged = mergeWithDefaults({ ...current, ...patch });
    await this.prisma.setting.upsert({
      where: { key: SETTING_KEY },
      update: { value: JSON.stringify(merged) },
      create: { key: SETTING_KEY, value: JSON.stringify(merged) },
    });
    return merged;
  }

  /** 预览 1..N 次 attempt 的 backoff，供 UI 展示曲线。 */
  async previewBackoffs(maxAttempts?: number): Promise<BackoffPreview[]> {
    const policy = await this.getPolicy();
    const n = Math.min(Math.max(maxAttempts ?? policy.maxAttempts, 1), MAX_ATTEMPTS_LIMIT);
    const out: BackoffPreview[] = [];
    for (let i = 1; i <= n; i += 1) {
      const base = computeBaseBackoff(i, policy);
      const jitter = base * policy.jitterRatio;
      out.push({
        attempt: i,
        baseMs: base,
        withJitterMinMs: Math.max(0, Math.round(base - jitter)),
        withJitterMaxMs: Math.round(base + jitter),
        sampleMs: computeBackoff(i, policy),
      });
    }
    return out;
  }
}

/** 第 attempt 次失败后等待的基础 ms（未加 jitter）。attempt 从 1 起。 */
export function computeBaseBackoff(attempt: number, policy: RetryPolicy): number {
  if (attempt < 1) return 0;
  const grow = policy.initialBackoffMs * Math.pow(2, attempt - 1);
  return Math.min(grow, policy.maxBackoffMs);
}

/** 带 jitter 的实际 backoff（每次调用返回不同值）。 */
export function computeBackoff(attempt: number, policy: RetryPolicy): number {
  const base = computeBaseBackoff(attempt, policy);
  const jitter = base * policy.jitterRatio * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

/** 给定 status + kind，根据 policy 判定是否应重试。空白名单 = 走默认 isRetriableKind。 */
export function shouldRetry(
  policy: RetryPolicy,
  args: { status?: number | null; kind?: string | null; defaultRetriable: boolean },
): boolean {
  const hasStatusFilter = policy.retryOnStatusCodes.length > 0;
  const hasKindFilter = policy.retryOnErrorKinds.length > 0;
  if (!hasStatusFilter && !hasKindFilter) return args.defaultRetriable;
  const statusOk = hasStatusFilter && args.status != null && policy.retryOnStatusCodes.includes(args.status);
  const kindOk = hasKindFilter && args.kind != null && policy.retryOnErrorKinds.includes(args.kind);
  return statusOk || kindOk;
}

function mergeWithDefaults(p: Partial<RetryPolicy>): RetryPolicy {
  return {
    maxAttempts: normalizeInt(p.maxAttempts, DEFAULT_RETRY_POLICY.maxAttempts, 1, MAX_ATTEMPTS_LIMIT),
    initialBackoffMs: normalizeInt(p.initialBackoffMs, DEFAULT_RETRY_POLICY.initialBackoffMs, 0, MAX_BACKOFF_LIMIT),
    maxBackoffMs: normalizeInt(p.maxBackoffMs, DEFAULT_RETRY_POLICY.maxBackoffMs, 0, MAX_BACKOFF_LIMIT),
    jitterRatio: normalizeFloat(p.jitterRatio, DEFAULT_RETRY_POLICY.jitterRatio, 0, 1),
    retryOnStatusCodes: Array.isArray(p.retryOnStatusCodes)
      ? p.retryOnStatusCodes.filter((x) => Number.isInteger(x) && x >= 100 && x < 600).slice(0, 20)
      : [...DEFAULT_RETRY_POLICY.retryOnStatusCodes],
    retryOnErrorKinds: Array.isArray(p.retryOnErrorKinds)
      ? p.retryOnErrorKinds.filter((x) => typeof x === 'string' && x.length > 0 && x.length <= 64).slice(0, 20)
      : [...DEFAULT_RETRY_POLICY.retryOnErrorKinds],
  };
}

function validatePatch(p: Partial<RetryPolicy>): void {
  if (p.maxAttempts != null && (!Number.isInteger(p.maxAttempts) || p.maxAttempts < 1 || p.maxAttempts > MAX_ATTEMPTS_LIMIT)) {
    throw new FreeLLMError('bad_request', `maxAttempts 必须是 1..${MAX_ATTEMPTS_LIMIT} 的整数`);
  }
  if (p.initialBackoffMs != null && (!Number.isFinite(p.initialBackoffMs) || p.initialBackoffMs < 0 || p.initialBackoffMs > MAX_BACKOFF_LIMIT)) {
    throw new FreeLLMError('bad_request', `initialBackoffMs 必须在 0..${MAX_BACKOFF_LIMIT} 之间`);
  }
  if (p.maxBackoffMs != null && (!Number.isFinite(p.maxBackoffMs) || p.maxBackoffMs < 0 || p.maxBackoffMs > MAX_BACKOFF_LIMIT)) {
    throw new FreeLLMError('bad_request', `maxBackoffMs 必须在 0..${MAX_BACKOFF_LIMIT} 之间`);
  }
  if (
    p.initialBackoffMs != null &&
    p.maxBackoffMs != null &&
    p.initialBackoffMs > p.maxBackoffMs
  ) {
    throw new FreeLLMError('bad_request', 'initialBackoffMs 不能大于 maxBackoffMs');
  }
  if (p.jitterRatio != null && (!Number.isFinite(p.jitterRatio) || p.jitterRatio < 0 || p.jitterRatio > 1)) {
    throw new FreeLLMError('bad_request', 'jitterRatio 必须在 0..1 之间');
  }
  if (p.retryOnStatusCodes != null && !Array.isArray(p.retryOnStatusCodes)) {
    throw new FreeLLMError('bad_request', 'retryOnStatusCodes 必须是数组');
  }
  if (p.retryOnErrorKinds != null && !Array.isArray(p.retryOnErrorKinds)) {
    throw new FreeLLMError('bad_request', 'retryOnErrorKinds 必须是数组');
  }
}

function normalizeInt(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const i = Math.round(v);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function normalizeFloat(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}
