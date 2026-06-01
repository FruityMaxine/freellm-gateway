/**
 * Tick 37 v1.7.9.0 单元 + 集成测试：
 * - ProviderBalanceCheckService.checkAll 周期扫 (无 provider / 部分 alerted / 全正常)
 * - alerted=true → 写一条 ErrorEvent kind=balance_low
 * - listRecentAlerts 查询近 N 条
 * - /admin/providers/balance/check POST + /alerts GET 端点契约
 * - 联动 BalanceTrackerService alertCache 24h 防重复
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import {
  ProviderRegistry,
  MockProvider,
  parseProviderConfig,
  type ProviderBalance,
} from '@freellm/provider-core';
import { ProviderBalanceCheckService } from '../src/services/provider-balance-check.service.js';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { hashPassword } from '../src/services/admin-user.service.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick37-test.db`
    : `${process.cwd()}/data/freellm-tick37-test.db`,
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
    version: '1.7.9.0',
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

/** 构造一个注入了"低余额 + 高 burn rate"的 mock provider 用 registry。 */
function makeAlertableRegistry(slug: string, balance: number): ProviderRegistry {
  const registry = new ProviderRegistry();
  class LowBalanceMock extends MockProvider {
    override async fetchBalance(): Promise<ProviderBalance | null> {
      return { asOf: new Date().toISOString(), limitRemaining: balance };
    }
  }
  registry.registerFactory('mock', (cfg, cred) => new LowBalanceMock(cfg, cred));
  registry.install(
    parseProviderConfig({
      slug,
      kind: 'mock',
      name: 'Alert Mock',
      baseUrl: 'mock://local',
      enabled: true,
      priority: 100,
    }),
    { apiKey: null, baseUrl: 'mock://local' },
  );
  return registry;
}

describe('Tick 37 — ProviderBalanceCheckService.checkAll', () => {
  beforeEach(async () => {
    await prisma.errorEvent.deleteMany();
    await prisma.requestLog.deleteMany();
    await prisma.provider.deleteMany();
  });

  it('registry 空 → total=0, alerted=0', async () => {
    const svc = new ProviderBalanceCheckService(prisma, new ProviderRegistry());
    const r = await svc.checkAll();
    expect(r.total).toBe(0);
    expect(r.alerted).toBe(0);
    expect(r.forecasts).toEqual([]);
  });

  it('低余额 + 高 burn rate → alerted=true 写 ErrorEvent', async () => {
    // 先准备 provider 行 + 7 天高 burn 日志
    const provider = await prisma.provider.create({
      data: {
        slug: 'low-bal',
        kind: 'mock',
        name: 'LowBal',
        baseUrl: 'mock://local',
        enabled: true,
        priority: 100,
      },
    });
    for (let i = 0; i < 7; i++) {
      await prisma.requestLog.create({
        data: {
          requestId: `lb-${i}`,
          upstreamProvider: 'low-bal',
          upstreamModel: 'm',
          status: 200,
          totalTokens: 1_000_000,
          startedAt: new Date(Date.now() - i * 24 * 3600_000),
        },
      });
    }
    const registry = makeAlertableRegistry('low-bal', 2); // balance=2 USD
    const svc = new ProviderBalanceCheckService(prisma, registry);
    const r = await svc.checkAll();
    expect(r.total).toBe(1);
    expect(r.alerted).toBe(1);
    expect(r.forecasts[0]!.providerSlug).toBe('low-bal');

    const ev = await prisma.errorEvent.findFirst({
      where: { kind: 'balance_low', providerId: provider.id },
    });
    expect(ev).toBeTruthy();
    expect(ev!.severity).toBe('warn');
    expect(ev!.message).toContain('low-bal');
  });

  it('balance 不支持 (null) → 不告警', async () => {
    await prisma.provider.create({
      data: {
        slug: 'no-bal',
        kind: 'mock',
        name: 'NoBal',
        baseUrl: 'mock://local',
        enabled: true,
        priority: 100,
      },
    });
    const registry = new ProviderRegistry();
    class NoBalMock extends MockProvider {
      override async fetchBalance(): Promise<ProviderBalance | null> {
        return null;
      }
    }
    registry.registerFactory('mock', (cfg, cred) => new NoBalMock(cfg, cred));
    registry.install(
      parseProviderConfig({
        slug: 'no-bal',
        kind: 'mock',
        name: 'NoBal',
        baseUrl: 'mock://local',
        enabled: true,
        priority: 100,
      }),
      { apiKey: null, baseUrl: 'mock://local' },
    );
    const svc = new ProviderBalanceCheckService(prisma, registry);
    const r = await svc.checkAll();
    expect(r.alerted).toBe(0);
  });

  it('listRecentAlerts 返回按 createdAt 倒序', async () => {
    const provider = await prisma.provider.create({
      data: {
        slug: 'lr-test',
        kind: 'mock',
        name: 'LR',
        baseUrl: 'mock://local',
        enabled: true,
        priority: 100,
      },
    });
    await prisma.errorEvent.createMany({
      data: [
        {
          kind: 'balance_low',
          severity: 'warn',
          providerId: provider.id,
          message: 'first',
          createdAt: new Date(Date.now() - 60_000),
        },
        {
          kind: 'balance_low',
          severity: 'warn',
          providerId: provider.id,
          message: 'second',
        },
      ],
    });
    const svc = new ProviderBalanceCheckService(prisma, new ProviderRegistry());
    const alerts = await svc.listRecentAlerts();
    expect(alerts).toHaveLength(2);
    expect(alerts[0]!.message).toBe('second');
    expect(alerts[0]!.providerSlug).toBe('lr-test');
  });
});

describe('Tick 37 — /admin/providers/balance/* 端点', () => {
  beforeEach(async () => {
    await prisma.errorEvent.deleteMany();
  });

  it('POST /admin/providers/balance/check → 200 + 报告', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/providers/balance/check',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.total).toBe('number');
    expect(typeof body.alerted).toBe('number');
    expect(Array.isArray(body.forecasts)).toBe(true);
  });

  it('GET /admin/providers/balance/alerts → 200 + 列表', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/providers/balance/alerts',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('POST 未登录 → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/providers/balance/check',
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET alerts ?limit=5 限制返回数量', async () => {
    for (let i = 0; i < 8; i++) {
      await prisma.errorEvent.create({
        data: { kind: 'balance_low', severity: 'warn', message: `m${i}` },
      });
    }
    const res = await app.inject({
      method: 'GET',
      url: '/admin/providers/balance/alerts?limit=5',
      headers: { cookie: sessionCookie },
    });
    const body = res.json();
    expect(body.data.length).toBe(5);
  });
});
