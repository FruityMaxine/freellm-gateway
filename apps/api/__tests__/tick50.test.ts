/**
 * Tick 50 v1.7.22.0 集成测试 — /admin/system/health 全链路自检：
 *  - deriveProviderStatus 多档输入 → 预期 status
 *  - deriveOverall 各维度组合 → 预期 overall
 *  - checkDb() DB 成功 + requests24h 反映 RequestLog
 *  - checkRedis() 未配置 → unknown / 配置无 ioredis → degraded
 *  - checkProviders() 反映 enabled provider + errorEvent 计数
 *  - GET /admin/system/health 端点 + 缓存 + 401
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { hashPassword } from '../src/services/admin-user.service.js';
import {
  SystemHealthService,
  deriveOverall,
  deriveProviderStatus,
} from '../src/services/system-health.service.js';
import { invalidateSystemHealthCache } from '../src/routes/admin/system-health.routes.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick50-test.db`
    : `${process.cwd()}/data/freellm-tick50-test.db`,
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
  // 确保 Redis 未配置（默认未配置场景）
  delete process.env.FREELLM_REDIS_URL;
  _setConfigForTests({
    version: '1.7.22.0',
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

beforeEach(() => {
  invalidateSystemHealthCache();
});

describe('Tick 50 — deriveProviderStatus / deriveOverall 单元', () => {
  it('未注册 → unhealthy', () => {
    expect(deriveProviderStatus('healthy', false, 0, 0)).toBe('unhealthy');
  });
  it('dbStatus down/disabled → unhealthy', () => {
    expect(deriveProviderStatus('down', true, 0, 0)).toBe('unhealthy');
    expect(deriveProviderStatus('disabled', true, 0, 0)).toBe('unhealthy');
  });
  it('unresolvedAlerts > 0 → degraded', () => {
    expect(deriveProviderStatus('healthy', true, 0, 3)).toBe('degraded');
  });
  it('errorCount24h > 10 → degraded', () => {
    expect(deriveProviderStatus('healthy', true, 11, 0)).toBe('degraded');
  });
  it('全好 → healthy', () => {
    expect(deriveProviderStatus('healthy', true, 0, 0)).toBe('healthy');
    expect(deriveProviderStatus(null, true, 0, 0)).toBe('healthy');
  });

  it('deriveOverall: db unhealthy 立刻 unhealthy', () => {
    expect(
      deriveOverall(
        { status: 'unhealthy', pingMs: null, requests24h: null },
        { status: 'healthy', configured: false, pingMs: null },
        [],
      ),
    ).toBe('unhealthy');
  });

  it('deriveOverall: provider unhealthy → degraded', () => {
    expect(
      deriveOverall(
        { status: 'healthy', pingMs: 1, requests24h: 0 },
        { status: 'unknown', configured: false, pingMs: null },
        [
          {
            slug: 'a',
            name: 'A',
            registered: true,
            status: 'unhealthy',
            dbStatus: 'down',
            lastSuccessAt: null,
            lastErrorAt: null,
            lastErrorMessage: null,
            errorCount24h: 0,
            unresolvedAlerts: 0,
          },
        ],
      ),
    ).toBe('degraded');
  });

  it('deriveOverall: 全 healthy → healthy', () => {
    expect(
      deriveOverall(
        { status: 'healthy', pingMs: 1, requests24h: 0 },
        { status: 'unknown', configured: false, pingMs: null },
        [],
      ),
    ).toBe('healthy');
  });
});

describe('Tick 50 — SystemHealthService.checkDb / checkRedis / checkProviders', () => {
  beforeEach(async () => {
    await prisma.requestLog.deleteMany({});
  });

  it('checkDb 成功 → healthy + ping + requests24h', async () => {
    await prisma.requestLog.createMany({
      data: [
        { requestId: 'req_h1', startedAt: new Date(Date.now() - 60_000), status: 200 },
        { requestId: 'req_h2', startedAt: new Date(Date.now() - 120_000), status: 503 },
      ],
    });
    const svc = new SystemHealthService(prisma, app.registry);
    const db = await svc.checkDb();
    expect(db.status).toBe('healthy');
    expect(db.pingMs).toBeGreaterThanOrEqual(0);
    expect(db.requests24h).toBe(2);
  });

  it('checkRedis 未配置 → unknown', async () => {
    delete process.env.FREELLM_REDIS_URL;
    const svc = new SystemHealthService(prisma, app.registry);
    const r = await svc.checkRedis();
    expect(r.status).toBe('unknown');
    expect(r.configured).toBe(false);
    expect(r.pingMs).toBeNull();
  });

  it('checkRedis 配置但 ioredis 未装 → degraded', async () => {
    // ioredis 在本仓库未列为常规依赖，require 应当失败
    process.env.FREELLM_REDIS_URL = 'redis://example:6379';
    const svc = new SystemHealthService(prisma, app.registry);
    const r = await svc.checkRedis();
    // 要么是 degraded（require 抛 MODULE_NOT_FOUND）要么是 unhealthy（require 成功但连接失败）
    expect(['degraded', 'unhealthy']).toContain(r.status);
    expect(r.configured).toBe(true);
    delete process.env.FREELLM_REDIS_URL;
  });

  it('checkProviders 反映 enabled provider + errorEvent 计数', async () => {
    await prisma.provider.deleteMany({});
    const p = await prisma.provider.create({
      data: {
        slug: 'tick50-provider',
        kind: 'custom-openai-compat',
        name: 'Tick 50 Test',
        baseUrl: 'https://example.com/v1',
        enabled: true,
        priority: 100,
        status: 'healthy',
      },
    });
    await prisma.errorEvent.createMany({
      data: [
        { kind: 'provider_outage', severity: 'warning', message: 'flap', providerId: p.id },
        { kind: 'provider_outage', severity: 'warning', message: 'flap', providerId: p.id },
      ],
    });
    const svc = new SystemHealthService(prisma, app.registry);
    const rows = await svc.checkProviders();
    const row = rows.find((r) => r.slug === 'tick50-provider')!;
    expect(row).toBeTruthy();
    expect(row.registered).toBe(false); // ProviderInstaller 没装 custom-openai-compat factory
    expect(row.errorCount24h).toBe(2);
    expect(row.unresolvedAlerts).toBe(2);
    expect(row.status).toBe('unhealthy'); // 未注册即 unhealthy
  });

  it('checkAll 返回完整结构 + overall', async () => {
    const svc = new SystemHealthService(prisma, app.registry);
    const r = await svc.checkAll();
    expect(r.generatedAt).toBeTruthy();
    expect(r.db).toBeTruthy();
    expect(r.redis).toBeTruthy();
    expect(Array.isArray(r.providers)).toBe(true);
    expect(['healthy', 'degraded', 'unhealthy', 'unknown']).toContain(r.overall);
  });
});

describe('Tick 50 — GET /admin/system/health 端点', () => {
  it('GET → 200 + overall + db + redis + providers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/system/health',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(['healthy', 'degraded', 'unhealthy', 'unknown']).toContain(body.overall);
    expect(body.db).toBeTruthy();
    expect(body.redis).toBeTruthy();
    expect(Array.isArray(body.providers)).toBe(true);
    expect(body.generatedAt).toBeTruthy();
  });

  it('未登录 → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/system/health' });
    expect(res.statusCode).toBe(401);
  });

  it('5s TTL 缓存 → 第二次 generatedAt 相同', async () => {
    const r1 = await app.inject({
      method: 'GET',
      url: '/admin/system/health',
      headers: { cookie: sessionCookie },
    });
    const r2 = await app.inject({
      method: 'GET',
      url: '/admin/system/health',
      headers: { cookie: sessionCookie },
    });
    expect(r1.json().generatedAt).toBe(r2.json().generatedAt);
  });
});
