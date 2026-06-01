/**
 * Tick 48 v1.7.20.0 集成测试 — 请求重试/退避策略：
 *  - RetryPolicyService getPolicy() 默认 + setPolicy() 部分字段 + 校验
 *  - computeBaseBackoff 指数增长 + cap
 *  - computeBackoff jitter 在区间内
 *  - shouldRetry 白名单覆盖逻辑
 *  - GET / PATCH / GET preview 三端点 + 401
 *  - PATCH 校验失败 → 400
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { hashPassword } from '../src/services/admin-user.service.js';
import {
  RetryPolicyService,
  DEFAULT_RETRY_POLICY,
  computeBaseBackoff,
  computeBackoff,
  shouldRetry,
} from '../src/services/retry-policy.service.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick48-test.db`
    : `${process.cwd()}/data/freellm-tick48-test.db`,
);

let prisma: PrismaClient;
let app: FastifyInstance;
let sessionCookie: string;

async function loginAdmin(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/admin/auth/login',
    payload: { username: 'admin', password: 'correct-horse-battery-staple' },
  });
  const setCookie = res.headers['set-cookie'];
  const cookieRaw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return String(cookieRaw ?? '').split(';')[0]!;
}

beforeAll(async () => {
  for (const ext of ['', '-journal', '-wal', '-shm']) {
    const p = `${TEST_DB}${ext}`;
    if (existsSync(p)) rmSync(p);
  }
  mkdirSync('./data', { recursive: true });
  execSync(
    `DATABASE_URL="file:${TEST_DB}" npx prisma db push --schema prisma/schema.prisma --skip-generate --accept-data-loss`,
    {
      cwd: process.cwd().endsWith('/apps/api') ? `${process.cwd()}/../..` : process.cwd(),
      stdio: 'pipe',
    },
  );
  process.env.DATABASE_URL = `file:${TEST_DB}`;
  _setConfigForTests({
    version: '1.7.20.0',
    env: {
      FREELLM_API_HOST: '127.0.0.1',
      FREELLM_API_PORT: 0,
      FREELLM_API_BASE_URL: 'http://127.0.0.1:3001',
      FREELLM_WEB_ORIGIN: 'http://127.0.0.1:5173',
      FREELLM_NODE_ENV: 'test',
      FREELLM_LOG_LEVEL: 'error',
      DATABASE_URL: `file:${TEST_DB}`,
      FREELLM_MASTER_KEY: 'test-master-key-32-bytes-for-vitest-only',
      FREELLM_SESSION_SECRET: 'test-session-secret-32-bytes-for-vitest-only',
      FREELLM_ADMIN_USERNAME: 'admin',
      FREELLM_ADMIN_PASSWORD: 'correct-horse-battery-staple',
      FREELLM_OPENROUTER_API_KEY: '',
      FREELLM_OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
      FREELLM_OPENAI_API_KEY: '',
      FREELLM_OPENAI_BASE_URL: 'https://api.openai.com/v1',
      FREELLM_ANTHROPIC_API_KEY: '',
      FREELLM_ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      FREELLM_DEEPSEEK_API_KEY: '',
      FREELLM_DEEPSEEK_BASE_URL: 'https://api.deepseek.com/v1',
      FREELLM_GOOGLE_API_KEY: '',
      FREELLM_GOOGLE_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',
      FREELLM_MODEL_DISCOVERY_INTERVAL_MIN: 30,
      FREELLM_PROVIDER_HEALTH_INTERVAL_MIN: 5,
      FREELLM_MODEL_AUTO_BLACKLIST_INTERVAL_MIN: 15,
      FREELLM_PROVIDER_BALANCE_CHECK_INTERVAL_MIN: 240,
      FREELLM_VK_USAGE_ALERT_INTERVAL_MIN: 60,
      FREELLM_RETENTION_PURGE_INTERVAL_MIN: 24 * 60,
      FREELLM_MAX_ROUTE_ATTEMPTS: 4,
      FREELLM_REQUEST_TIMEOUT_MS: 60000,
      FREELLM_ALLOW_PAID_FALLBACK: false,
      FREELLM_LOG_PROMPT_DIGEST: true,
      FREELLM_LOG_FULL_PROMPT: false,
      FREELLM_MOCK_PROVIDERS_ENABLED: false,
    },
  });
  prisma = new PrismaClient({ datasources: { db: { url: `file:${TEST_DB}` } } });
  await prisma.adminUser.create({
    data: { username: 'admin', passwordHash: hashPassword('correct-horse-battery-staple') },
  });
  const built = await buildApp();
  app = built.app;
  await app.ready();
  sessionCookie = await loginAdmin();
});

afterAll(async () => {
  app.cron.stopAll();
  await app.close();
  await prisma.$disconnect();
});

describe('Tick 48 — RetryPolicy service 单元', () => {
  it('getPolicy() Setting 缺失时返回 DEFAULT', async () => {
    await prisma.setting.deleteMany({ where: { key: 'routing.retryPolicy' } });
    const svc = new RetryPolicyService(prisma);
    const p = await svc.getPolicy();
    expect(p.maxAttempts).toBe(DEFAULT_RETRY_POLICY.maxAttempts);
    expect(p.initialBackoffMs).toBe(DEFAULT_RETRY_POLICY.initialBackoffMs);
    expect(p.maxBackoffMs).toBe(DEFAULT_RETRY_POLICY.maxBackoffMs);
    expect(p.jitterRatio).toBe(DEFAULT_RETRY_POLICY.jitterRatio);
    expect(p.retryOnStatusCodes).toEqual([]);
    expect(p.retryOnErrorKinds).toEqual([]);
  });

  it('setPolicy() 部分字段 merge + 持久化', async () => {
    const svc = new RetryPolicyService(prisma);
    const updated = await svc.setPolicy({
      maxAttempts: 6,
      initialBackoffMs: 500,
      retryOnStatusCodes: [429, 503],
    });
    expect(updated.maxAttempts).toBe(6);
    expect(updated.initialBackoffMs).toBe(500);
    expect(updated.retryOnStatusCodes).toEqual([429, 503]);
    // 未传字段保留默认
    expect(updated.jitterRatio).toBe(DEFAULT_RETRY_POLICY.jitterRatio);
    // 持久化 OK
    const reloaded = await svc.getPolicy();
    expect(reloaded).toEqual(updated);
  });

  it('setPolicy() initialBackoff > maxBackoff → 抛 bad_request', async () => {
    const svc = new RetryPolicyService(prisma);
    await expect(svc.setPolicy({ initialBackoffMs: 9000, maxBackoffMs: 3000 })).rejects.toThrow(
      /initialBackoffMs.*不能大于/,
    );
  });

  it('setPolicy() maxAttempts 越界 → 抛 bad_request', async () => {
    const svc = new RetryPolicyService(prisma);
    await expect(svc.setPolicy({ maxAttempts: 99 })).rejects.toThrow(/maxAttempts/);
    await expect(svc.setPolicy({ maxAttempts: 0 })).rejects.toThrow(/maxAttempts/);
  });

  it('JSON 损坏退回 DEFAULT 而不是抛错', async () => {
    await prisma.setting.upsert({
      where: { key: 'routing.retryPolicy' },
      update: { value: '{{not json}}' },
      create: { key: 'routing.retryPolicy', value: '{{not json}}' },
    });
    const svc = new RetryPolicyService(prisma);
    const p = await svc.getPolicy();
    expect(p).toEqual(DEFAULT_RETRY_POLICY);
  });
});

describe('Tick 48 — backoff 数学函数', () => {
  it('computeBaseBackoff 指数增长 + cap', () => {
    const policy = {
      ...DEFAULT_RETRY_POLICY,
      initialBackoffMs: 200,
      maxBackoffMs: 5000,
    };
    expect(computeBaseBackoff(1, policy)).toBe(200); // 200 * 2^0
    expect(computeBaseBackoff(2, policy)).toBe(400); // 200 * 2^1
    expect(computeBaseBackoff(3, policy)).toBe(800); // 200 * 2^2
    expect(computeBaseBackoff(4, policy)).toBe(1600);
    expect(computeBaseBackoff(5, policy)).toBe(3200);
    expect(computeBaseBackoff(6, policy)).toBe(5000); // cap 触发
    expect(computeBaseBackoff(10, policy)).toBe(5000); // 远期仍 cap
  });

  it('computeBackoff jitter 落在 ±jitter 区间', () => {
    const policy = {
      ...DEFAULT_RETRY_POLICY,
      initialBackoffMs: 1000,
      maxBackoffMs: 1000,
      jitterRatio: 0.3,
    };
    // 重复 50 次, 全部应在 [700, 1300] 区间内
    for (let i = 0; i < 50; i += 1) {
      const v = computeBackoff(1, policy);
      expect(v).toBeGreaterThanOrEqual(700);
      expect(v).toBeLessThanOrEqual(1300);
    }
  });

  it('jitterRatio=0 时 computeBackoff === base', () => {
    const policy = { ...DEFAULT_RETRY_POLICY, initialBackoffMs: 300, jitterRatio: 0 };
    expect(computeBackoff(1, policy)).toBe(300);
    expect(computeBackoff(2, policy)).toBe(600);
  });

  it('shouldRetry 空白名单 → 走 defaultRetriable', () => {
    const p = { ...DEFAULT_RETRY_POLICY };
    expect(shouldRetry(p, { status: 500, kind: 'provider_unavailable', defaultRetriable: true })).toBe(true);
    expect(shouldRetry(p, { status: 400, kind: 'bad_request', defaultRetriable: false })).toBe(false);
  });

  it('shouldRetry status 白名单覆盖 defaultRetriable=false', () => {
    const p = { ...DEFAULT_RETRY_POLICY, retryOnStatusCodes: [429, 503] };
    // defaultRetriable=false 但 status 命中 → 仍重试
    expect(shouldRetry(p, { status: 429, kind: 'rate_limited', defaultRetriable: false })).toBe(true);
    expect(shouldRetry(p, { status: 503, kind: 'unknown', defaultRetriable: false })).toBe(true);
    // 不在白名单
    expect(shouldRetry(p, { status: 500, kind: 'provider_unavailable', defaultRetriable: false })).toBe(false);
  });

  it('shouldRetry kind 白名单同样覆盖', () => {
    const p = { ...DEFAULT_RETRY_POLICY, retryOnErrorKinds: ['rate_limited', 'timeout'] };
    expect(shouldRetry(p, { status: 200, kind: 'timeout', defaultRetriable: false })).toBe(true);
    expect(shouldRetry(p, { status: 200, kind: 'bad_request', defaultRetriable: false })).toBe(false);
  });
});

describe('Tick 48 — /admin/settings/retry-policy 端点', () => {
  it('GET → 200 + 当前策略', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/settings/retry-policy',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.maxAttempts).toBe('number');
    expect(typeof body.initialBackoffMs).toBe('number');
    expect(typeof body.jitterRatio).toBe('number');
    expect(Array.isArray(body.retryOnStatusCodes)).toBe(true);
  });

  it('PATCH 部分字段 → 200 + merge', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/settings/retry-policy',
      headers: { cookie: sessionCookie },
      payload: { maxAttempts: 7, jitterRatio: 0.2 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.maxAttempts).toBe(7);
    expect(body.jitterRatio).toBe(0.2);
  });

  it('PATCH 非法字段 → 4xx/5xx 错误', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/settings/retry-policy',
      headers: { cookie: sessionCookie },
      payload: { maxAttempts: 999 }, // > 10 上限
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('GET preview → 含 baseMs + withJitter 区间', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/settings/retry-policy/preview?maxAttempts=4',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(4);
    expect(body.data).toHaveLength(4);
    for (const p of body.data) {
      expect(typeof p.baseMs).toBe('number');
      expect(p.withJitterMinMs).toBeLessThanOrEqual(p.baseMs);
      expect(p.withJitterMaxMs).toBeGreaterThanOrEqual(p.baseMs);
    }
  });

  it('未登录 → GET 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/settings/retry-policy' });
    expect(res.statusCode).toBe(401);
  });

  it('未登录 → PATCH 401', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/settings/retry-policy',
      payload: { maxAttempts: 5 },
    });
    expect(res.statusCode).toBe(401);
  });
});
