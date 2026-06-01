/**
 * Bearer token (`fllm_live_…` / `fllm_test_…`) auth for `/v1/*` routes.
 *
 * Resolves the calling virtual key, enforces enabled/expired/RPM/daily/token
 * limits in-memory (a Redis-backed limiter lands in a later tick), and
 * decorates the request with `request.virtualKey` for downstream handlers.
 */
import fp from 'fastify-plugin';
import type { FastifyPluginCallback } from 'fastify';
import { FreeLLMError, type VirtualKeyPermissions } from '@freellm/shared';
import { VirtualKeyService, rowPermissions } from '../services/virtual-key.service.js';
import { getPrisma } from '../lib/prisma.js';
import { enforceOrgRpmAsync } from '../lib/per-org-limit.js';
import { enforceDemoDailyRequests, peekDemoDailyTokens } from '../lib/demo-limit.js';

// 虚拟密钥严格格式：fllm_(live|test)_<64 hex chars>，全长 74。
// 任何不匹配此模式的 Bearer 会在数据库查询前被快速拒绝（Tick 16）。
const VIRTUAL_KEY_PATTERN = /^fllm_(live|test)_[0-9a-f]{64}$/;

declare module 'fastify' {
  interface FastifyRequest {
    virtualKey?: {
      id: string;
      label: string;
      environment: string;
      permissions: VirtualKeyPermissions;
      // Tick 20 v1.3.1.0：rate limit / metrics 切片用的租户解析（VK → Project → Org）。
      projectId?: string | null;
      organizationId?: string | null;
      // Tick 23 v1.5.0.0：是否为 Playground demo 密钥（下游可据此做额外限制）。
      isDemo?: boolean;
    };
  }
}

// In-process sliding window for per-key RPM. Map<keyId, {windowStart, count}>
const rpmBuckets = new Map<string, { windowStart: number; count: number }>();
// In-process per-day token + request counters. Tick 17 加 embeddings 计数。
const dayBuckets = new Map<
  string,
  { day: string; requests: number; tokens: number; embeddings: number }
>();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function enforceRpm(keyId: string, limit: number | null | undefined): boolean {
  if (!limit) return true;
  const now = Date.now();
  const bucket = rpmBuckets.get(keyId);
  if (!bucket || now - bucket.windowStart > 60_000) {
    rpmBuckets.set(keyId, { windowStart: now, count: 1 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

function enforceDailyRequests(keyId: string, limit: number | null | undefined): boolean {
  if (!limit) return true;
  const day = todayKey();
  const bucket = dayBuckets.get(keyId);
  if (!bucket || bucket.day !== day) {
    dayBuckets.set(keyId, { day, requests: 1, tokens: 0, embeddings: 0 });
    return true;
  }
  if (bucket.requests >= limit) return false;
  bucket.requests += 1;
  return true;
}

export function recordTokenUsage(keyId: string, tokens: number): void {
  const day = todayKey();
  const bucket = dayBuckets.get(keyId);
  if (!bucket || bucket.day !== day) {
    dayBuckets.set(keyId, { day, requests: 0, tokens, embeddings: 0 });
    return;
  }
  bucket.tokens += tokens;
}

export function enforceDailyTokens(keyId: string, limit: number | null | undefined): boolean {
  if (!limit) return true;
  const day = todayKey();
  const bucket = dayBuckets.get(keyId);
  if (!bucket || bucket.day !== day) return true;
  return bucket.tokens < limit;
}

/**
 * Tick 17 v1.1.0.0：日 embeddings 调用限额。
 * limit null/0 视为无限制。命中即 true 并消费 +1。
 */
export function enforceDailyEmbeddings(keyId: string, limit: number | null | undefined): boolean {
  if (!limit) return true;
  const day = todayKey();
  const bucket = dayBuckets.get(keyId);
  if (!bucket || bucket.day !== day) {
    dayBuckets.set(keyId, { day, requests: 0, tokens: 0, embeddings: 1 });
    return true;
  }
  if (bucket.embeddings >= limit) return false;
  bucket.embeddings += 1;
  return true;
}

const plugin: FastifyPluginCallback = (app, _opts, done) => {
  const svc = new VirtualKeyService(getPrisma());

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/v1/')) return;

    const auth = req.headers['authorization'];
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new FreeLLMError('unauthorized', '缺少 Bearer 令牌', {
        context: { requestId: req.requestId },
      });
    }
    const secret = auth.slice('Bearer '.length).trim();
    // Tick 16 v1.0.1.0：fail-fast 格式校验 —— 明显畸形的 Bearer 直接拒，不打 DB。
    // 防扫描器 / 暴力枚举对 sha256 + 数据库的无效压力，并让正常 401 路径更快。
    // 合法 secret 严格满足：fllm_(live|test)_<64 hex>，全长 74。
    if (!VIRTUAL_KEY_PATTERN.test(secret)) {
      throw new FreeLLMError('unauthorized', 'API 密钥无效', {
        context: { requestId: req.requestId },
      });
    }
    const row = await svc.resolveBySecretWithTenancy(secret);
    if (!row) {
      throw new FreeLLMError('unauthorized', 'API 密钥无效', {
        context: { requestId: req.requestId },
      });
    }
    if (!row.enabled || row.revokedAt) {
      throw new FreeLLMError('forbidden', 'API 密钥已禁用', {
        context: { requestId: req.requestId },
      });
    }
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      throw new FreeLLMError('forbidden', 'API 密钥已过期', {
        context: { requestId: req.requestId },
      });
    }
    const permissions = rowPermissions(row);
    if (!enforceRpm(row.id, permissions.maxRequestsPerMinute)) {
      throw new FreeLLMError('rate_limited', '虚拟密钥 RPM 超限', {
        context: { requestId: req.requestId, retryAfterSeconds: 60 },
      });
    }
    if (!enforceDailyRequests(row.id, permissions.maxRequestsPerDay)) {
      throw new FreeLLMError('rate_limited', '虚拟密钥日请求额度已用尽', {
        context: { requestId: req.requestId },
      });
    }
    if (!enforceDailyTokens(row.id, permissions.maxTokensPerDay)) {
      throw new FreeLLMError('rate_limited', '虚拟密钥日 Token 额度已用尽', {
        context: { requestId: req.requestId },
      });
    }

    // Tick 20 v1.3.1.0：组织级 RPM 限额（VK 归属 Project → Project 归属 Organization → 读 rpmLimit）。
    // Tick 22 v1.4.1.0：切走 KV 抽象接口，多实例时通过 Redis 共享 RPM 窗口。
    const projectId = row.project?.id ?? null;
    const organizationId = row.project?.organization?.id ?? null;
    const orgRpmLimit = row.project?.organization?.rpmLimit ?? null;
    if (organizationId && !(await enforceOrgRpmAsync(organizationId, orgRpmLimit))) {
      throw new FreeLLMError('rate_limited', '组织 RPM 超限', {
        context: { requestId: req.requestId, retryAfterSeconds: 60 },
      });
    }

    // Tick 23 v1.5.0.0：Playground demo 密钥独立日额度（15 请求 / 1000 token 每天）。
    // 该额度独立于普通 VK 的 maxRequestsPerDay / maxTokensPerDay，比正常额度紧很多。
    if (row.isDemo) {
      if (!(await enforceDemoDailyRequests(row.id))) {
        throw new FreeLLMError('rate_limited', 'Playground 试用额度已用尽，请稍后再来或注册管理员账号申请密钥', {
          context: { requestId: req.requestId },
        });
      }
      const remainingTokens = await peekDemoDailyTokens(row.id);
      if (remainingTokens <= 0) {
        throw new FreeLLMError('rate_limited', 'Playground 试用 Token 额度已用尽', {
          context: { requestId: req.requestId },
        });
      }
    }

    req.virtualKey = {
      id: row.id,
      label: row.label,
      environment: row.environment,
      permissions,
      isDemo: row.isDemo === true,
      projectId,
      organizationId,
    };
    void reply;
  });

  done();
};

export default fp(plugin, { name: 'virtual-key-auth' });

// Exposed for tests
export function _resetAuthBuckets(): void {
  rpmBuckets.clear();
  dayBuckets.clear();
}
