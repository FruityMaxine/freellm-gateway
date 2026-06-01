/**
 * Tick 28 v1.7.0.0 单元 + 集成测试：
 * - BalanceTrackerService.fetchBalanceCached（registry 命中 / 未命中 / fetchBalance 异常）
 * - computeBurnRate（空 logs / 7 天聚合）
 * - forecast 综合输出 + 默认常量
 * - balance_low 事件触发 + 24h 防重复
 * - /admin/providers/:slug/forecast 端点契约（200 / 404）
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { ProviderRegistry, MockProvider, parseProviderConfig } from '@freellm/provider-core';
import type { BaseProvider, ProviderBalance } from '@freellm/provider-core';
import {
  BalanceTrackerService,
  _DEFAULT_USD_PER_1K_TOKENS,
} from '../src/services/balance-tracker.service.js';
import { EventBus } from '../src/services/event-bus.js';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { hashPassword } from '../src/services/admin-user.service.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick28-test.db`
    : `${process.cwd()}/data/freellm-tick28-test.db`,
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
    version: '1.7.0.0',
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
      FREELLM_MAX_ROUTE_ATTEMPTS: 4,
      FREELLM_REQUEST_TIMEOUT_MS: 60000,
      FREELLM_ALLOW_PAID_FALLBACK: false,
      FREELLM_LOG_PROMPT_DIGEST: true,
      FREELLM_LOG_FULL_PROMPT: false,
      FREELLM_MOCK_PROVIDERS_ENABLED: true,
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
  await app.close();
  await prisma.$disconnect();
});

describe('Tick 28 — 默认常量与 fetchBalanceCached', () => {
  it('_DEFAULT_USD_PER_1K_TOKENS = 0.001', () => {
    expect(_DEFAULT_USD_PER_1K_TOKENS).toBe(0.001);
  });

  it('未注册 slug → fetchBalanceCached 返回 null', async () => {
    const registry = new ProviderRegistry();
    const svc = new BalanceTrackerService(prisma, registry);
    const res = await svc.fetchBalanceCached('unknown-slug');
    expect(res.balanceRemaining).toBeNull();
    expect(res.raw).toBeNull();
  });

  it('provider.fetchBalance 返回 limitRemaining → 提取数值', async () => {
    const registry = new ProviderRegistry();
    class StubProvider extends MockProvider {
      override async fetchBalance(): Promise<ProviderBalance | null> {
        return {
          asOf: new Date().toISOString(),
          limitRemaining: 12.34,
          usage: 5.66,
          currency: 'USD',
          balanceRaw: { foo: 'bar' },
        };
      }
    }
    registry.registerFactory('mock', (cfg, cred) => new StubProvider(cfg, cred));
    registry.install(
      parseProviderConfig({
        slug: 'mock',
        kind: 'mock',
        name: 'Mock',
        baseUrl: 'mock://local',
        enabled: true,
        priority: 1,
      }),
      { apiKey: null, baseUrl: 'mock://local' },
    );
    const svc = new BalanceTrackerService(prisma, registry);
    const res = await svc.fetchBalanceCached('mock');
    expect(res.balanceRemaining).toBe(12.34);
    expect((res.raw as ProviderBalance).currency).toBe('USD');
  });

  it('provider.fetchBalance 抛错 → 返回 null（不冒泡）', async () => {
    const registry = new ProviderRegistry();
    class ThrowingProvider extends MockProvider {
      override async fetchBalance(): Promise<ProviderBalance | null> {
        throw new Error('upstream API exploded');
      }
    }
    registry.registerFactory('mock', (cfg, cred) => new ThrowingProvider(cfg, cred));
    registry.install(
      parseProviderConfig({
        slug: 'mock',
        kind: 'mock',
        name: 'Mock',
        baseUrl: 'mock://local',
        enabled: true,
        priority: 1,
      }),
      { apiKey: null, baseUrl: 'mock://local' },
    );
    const svc = new BalanceTrackerService(prisma, registry);
    const res = await svc.fetchBalanceCached('mock');
    expect(res.balanceRemaining).toBeNull();
  });
});

describe('Tick 28 — computeBurnRate 聚合', () => {
  beforeEach(async () => {
    await prisma.requestLog.deleteMany();
  });

  it('近 7 天 0 条记录 → burn rate = 0', async () => {
    const registry = new ProviderRegistry();
    const svc = new BalanceTrackerService(prisma, registry);
    expect(await svc.computeBurnRate('openrouter')).toBe(0);
  });

  it('近 7 天 7000 tokens → burn rate = 1000 tokens/day', async () => {
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      await prisma.requestLog.create({
        data: {
          requestId: `req-${i}`,
          upstreamProvider: 'openrouter',
          upstreamModel: 'openrouter/auto',
          startedAt: new Date(now.getTime() - i * 24 * 3600_000),
          durationMs: 100,
          promptTokens: 500,
          completionTokens: 500,
          totalTokens: 1000,
        },
      });
    }
    const registry = new ProviderRegistry();
    const svc = new BalanceTrackerService(prisma, registry);
    const rate = await svc.computeBurnRate('openrouter');
    expect(rate).toBe(1000);
  });

  it('超过 7 天前的日志不计入 burn rate', async () => {
    await prisma.requestLog.create({
      data: {
        requestId: 'req-old',
        upstreamProvider: 'openrouter',
        upstreamModel: 'x',
        startedAt: new Date(Date.now() - 10 * 24 * 3600_000),
        durationMs: 100,
        totalTokens: 999999,
      },
    });
    const registry = new ProviderRegistry();
    const svc = new BalanceTrackerService(prisma, registry);
    expect(await svc.computeBurnRate('openrouter')).toBe(0);
  });

  it('不同 provider 不混淆', async () => {
    await prisma.requestLog.create({
      data: {
        requestId: 'req-anthropic',
        upstreamProvider: 'anthropic',
        upstreamModel: 'claude',
        startedAt: new Date(),
        durationMs: 100,
        totalTokens: 70000,
      },
    });
    const registry = new ProviderRegistry();
    const svc = new BalanceTrackerService(prisma, registry);
    expect(await svc.computeBurnRate('openrouter')).toBe(0);
    expect(await svc.computeBurnRate('anthropic')).toBe(10000);
  });
});

describe('Tick 28 — forecast 综合输出 + balance_low 告警', () => {
  beforeEach(async () => {
    await prisma.requestLog.deleteMany();
  });

  function makeRegistryWithBalance(remaining: number | null): ProviderRegistry {
    const registry = new ProviderRegistry();
    class B extends MockProvider {
      override async fetchBalance(): Promise<ProviderBalance | null> {
        if (remaining === null) return null;
        return { asOf: new Date().toISOString(), limitRemaining: remaining };
      }
    }
    registry.registerFactory('mock', (cfg, cred) => new B(cfg, cred));
    registry.install(
      parseProviderConfig({
        slug: 'openrouter',
        kind: 'mock',
        name: 'Stub',
        baseUrl: 'mock://local',
        enabled: true,
        priority: 1,
      }),
      { apiKey: null, baseUrl: 'mock://local' },
    );
    return registry;
  }

  it('balance + burn rate → estimatedDaysRemaining 计算正确', async () => {
    // 7 天 7,000,000 tokens → burn rate 1,000,000 tokens/day → 1 USD/day
    for (let i = 0; i < 7; i++) {
      await prisma.requestLog.create({
        data: {
          requestId: `req-${i}`,
          upstreamProvider: 'openrouter',
          upstreamModel: 'x',
          startedAt: new Date(Date.now() - i * 24 * 3600_000),
          durationMs: 100,
          totalTokens: 1_000_000,
        },
      });
    }
    const registry = makeRegistryWithBalance(10);
    const svc = new BalanceTrackerService(prisma, registry, { alertThresholdDays: 3 });
    const res = await svc.forecast('openrouter');
    expect(res.balanceRemaining).toBe(10);
    expect(res.burnRateTokensPerDay).toBe(1_000_000);
    expect(res.burnRateUsdPerDay).toBe(1);
    expect(res.estimatedDaysRemaining).toBe(10);
    expect(res.alerted).toBe(false);
    expect(res.alertThresholdDays).toBe(3);
  });

  it('burn rate = 0 → estimatedDaysRemaining = null（无法估算）', async () => {
    const registry = makeRegistryWithBalance(10);
    const svc = new BalanceTrackerService(prisma, registry);
    const res = await svc.forecast('openrouter');
    expect(res.burnRateTokensPerDay).toBe(0);
    expect(res.estimatedDaysRemaining).toBeNull();
  });

  it('balance 不支持 → balanceRemaining/estimatedDaysRemaining 均为 null', async () => {
    const registry = makeRegistryWithBalance(null);
    const svc = new BalanceTrackerService(prisma, registry);
    const res = await svc.forecast('openrouter');
    expect(res.balanceRemaining).toBeNull();
    expect(res.estimatedDaysRemaining).toBeNull();
  });

  it('预估 < threshold → 触发 balance_low 事件 + alerted=true', async () => {
    // burn rate 1M tokens/day = 1 USD/day, balance 2 → 2 天 < threshold 3
    for (let i = 0; i < 7; i++) {
      await prisma.requestLog.create({
        data: {
          requestId: `r${i}`,
          upstreamProvider: 'openrouter',
          upstreamModel: 'x',
          startedAt: new Date(Date.now() - i * 24 * 3600_000),
          durationMs: 100,
          totalTokens: 1_000_000,
        },
      });
    }
    const registry = makeRegistryWithBalance(2);
    const svc = new BalanceTrackerService(prisma, registry, { alertThresholdDays: 3 });

    const res = await svc.forecast('openrouter');
    expect(res.estimatedDaysRemaining).toBe(2);
    expect(res.alerted).toBe(true);

    // 24h 内重复调用不再二次告警
    const res2 = await svc.forecast('openrouter');
    expect(res2.alerted).toBe(false);
  });
});

describe('Tick 28 — /admin/providers/:slug/forecast 端点契约', () => {
  beforeEach(async () => {
    await prisma.requestLog.deleteMany();
  });

  it('已注册 mock provider → 200 + 返回 ForecastResult shape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/providers/mock/forecast',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.providerSlug).toBe('mock');
    expect(body).toHaveProperty('balanceRemaining');
    expect(body).toHaveProperty('burnRateTokensPerDay');
    expect(body).toHaveProperty('burnRateUsdPerDay');
    expect(body).toHaveProperty('estimatedDaysRemaining');
    expect(body).toHaveProperty('alertThresholdDays');
    expect(body).toHaveProperty('generatedAt');
  });

  it('未注册 slug → 404 not_found', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/providers/does-not-exist/forecast',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('未登录 → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/providers/mock/forecast',
    });
    expect(res.statusCode).toBe(401);
  });
});

// 抑制未使用导入 lint
void EventBus;
type _Unused = BaseProvider;
