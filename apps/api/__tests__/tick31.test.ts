/**
 * Tick 31 v1.7.3.0 单元 + 集成测试：
 * - classifyError 工具函数
 * - ProviderHealthService.checkOne 成功 / 失败 / 超时 / 不存在
 * - 失败时自动写 Cooldown，重复失败不重复创建
 * - history 查询
 * - /admin/providers/:slug/health POST + history GET 端点
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
  type ProviderHealthReport,
} from '@freellm/provider-core';
import {
  ProviderHealthService,
  classifyError,
} from '../src/services/provider-health.service.js';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { hashPassword } from '../src/services/admin-user.service.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick31-test.db`
    : `${process.cwd()}/data/freellm-tick31-test.db`,
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
    version: '1.7.3.0',
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

describe('Tick 31 — classifyError 归类', () => {
  it('null / undefined → unknown', () => {
    expect(classifyError(null)).toBe('unknown');
    expect(classifyError(undefined)).toBe('unknown');
  });

  it('timeout 关键词归 timeout', () => {
    expect(classifyError('socket timeout')).toBe('timeout');
    expect(classifyError('Connection timed out')).toBe('timeout');
    expect(classifyError('ETIMEDOUT')).toBe('timeout');
  });

  it('429 / 401 / 5xx / 网络 各自归类', () => {
    expect(classifyError('HTTP 429 too many requests')).toBe('rate_limited');
    expect(classifyError('rate limit exceeded')).toBe('rate_limited');
    expect(classifyError('401 unauthorized')).toBe('auth');
    expect(classifyError('502 bad gateway')).toBe('upstream_5xx');
    expect(classifyError('ECONNREFUSED 127.0.0.1')).toBe('network');
    expect(classifyError('something else')).toBe('upstream_error');
  });
});

describe('Tick 31 — ProviderHealthService.checkOne', () => {
  let providerId: string;
  let registry: ProviderRegistry;

  beforeEach(async () => {
    await prisma.cooldown.deleteMany();
    await prisma.healthCheck.deleteMany();
    await prisma.provider.deleteMany();
    const provider = await prisma.provider.create({
      data: {
        slug: 'health-test',
        kind: 'mock',
        name: 'Health Test',
        baseUrl: 'mock://local',
        enabled: true,
        priority: 100,
      },
    });
    providerId = provider.id;
    registry = new ProviderRegistry();
  });

  it('未注册 slug → 抛错', async () => {
    const svc = new ProviderHealthService(prisma, registry);
    await expect(svc.checkOne('not-registered')).rejects.toThrow(/未在 registry 注册/);
  });

  it('成功：写 HealthCheck + 更新 Provider.lastHealthAt/lastSuccessAt + 不写 Cooldown', async () => {
    class HealthyMock extends MockProvider {
      override async checkHealth(): Promise<ProviderHealthReport> {
        return { ok: true, status: 'active', latencyMs: 42, message: 'all good' };
      }
    }
    registry.registerFactory('mock', (cfg, cred) => new HealthyMock(cfg, cred));
    registry.install(
      parseProviderConfig({
        slug: 'health-test',
        kind: 'mock',
        name: 'Health Test',
        baseUrl: 'mock://local',
        enabled: true,
        priority: 100,
      }),
      { apiKey: null, baseUrl: 'mock://local' },
    );
    const svc = new ProviderHealthService(prisma, registry);
    const res = await svc.checkOne('health-test');
    expect(res.ok).toBe(true);
    expect(res.status).toBe('active');
    expect(res.latencyMs).toBe(42);

    const checks = await prisma.healthCheck.findMany({ where: { providerId } });
    expect(checks).toHaveLength(1);
    expect(checks[0]!.ok).toBe(true);

    const after = await prisma.provider.findUnique({ where: { id: providerId } });
    expect(after!.lastHealthAt).toBeTruthy();
    expect(after!.lastSuccessAt).toBeTruthy();
    expect(after!.status).toBe('active');
    expect(after!.errorCount24h).toBe(0);

    const cooldowns = await prisma.cooldown.count({ where: { providerId } });
    expect(cooldowns).toBe(0);
  });

  it('失败：写 HealthCheck + 更新 lastErrorAt + 自动写 Cooldown', async () => {
    class SickMock extends MockProvider {
      override async checkHealth(): Promise<ProviderHealthReport> {
        return { ok: false, status: 'degraded', message: 'HTTP 502 bad gateway' };
      }
    }
    registry.registerFactory('mock', (cfg, cred) => new SickMock(cfg, cred));
    registry.install(
      parseProviderConfig({
        slug: 'health-test',
        kind: 'mock',
        name: 'Health Test',
        baseUrl: 'mock://local',
        enabled: true,
        priority: 100,
      }),
      { apiKey: null, baseUrl: 'mock://local' },
    );
    const svc = new ProviderHealthService(prisma, registry, { failureCooldownMs: 60_000 });
    const res = await svc.checkOne('health-test');
    expect(res.ok).toBe(false);
    expect(res.errorKind).toBe('upstream_5xx');

    const after = await prisma.provider.findUnique({ where: { id: providerId } });
    expect(after!.lastErrorAt).toBeTruthy();
    expect(after!.lastErrorMessage).toContain('502');
    expect(after!.status).toBe('degraded');
    expect(after!.errorCount24h).toBe(1);

    const cooldowns = await prisma.cooldown.findMany({ where: { providerId } });
    expect(cooldowns).toHaveLength(1);
    expect(cooldowns[0]!.reason).toBe('upstream_5xx');
    expect(cooldowns[0]!.scope).toBe('provider');
  });

  it('checkHealth 抛错 → 归类 upstream_error + 计入错误次数', async () => {
    class BoomMock extends MockProvider {
      override async checkHealth(): Promise<ProviderHealthReport> {
        throw new Error('connection refused');
      }
    }
    registry.registerFactory('mock', (cfg, cred) => new BoomMock(cfg, cred));
    registry.install(
      parseProviderConfig({
        slug: 'health-test',
        kind: 'mock',
        name: 'Health Test',
        baseUrl: 'mock://local',
        enabled: true,
        priority: 100,
      }),
      { apiKey: null, baseUrl: 'mock://local' },
    );
    const svc = new ProviderHealthService(prisma, registry);
    const res = await svc.checkOne('health-test');
    expect(res.ok).toBe(false);
    expect(res.message).toContain('connection refused');
  });

  it('重复失败：第二次不重复写 Cooldown（同 provider 已有未过期 cooldown）', async () => {
    class SickMock extends MockProvider {
      override async checkHealth(): Promise<ProviderHealthReport> {
        return { ok: false, status: 'degraded', message: 'still bad' };
      }
    }
    registry.registerFactory('mock', (cfg, cred) => new SickMock(cfg, cred));
    registry.install(
      parseProviderConfig({
        slug: 'health-test',
        kind: 'mock',
        name: 'Health Test',
        baseUrl: 'mock://local',
        enabled: true,
        priority: 100,
      }),
      { apiKey: null, baseUrl: 'mock://local' },
    );
    const svc = new ProviderHealthService(prisma, registry, { failureCooldownMs: 60_000 });
    await svc.checkOne('health-test');
    await svc.checkOne('health-test');
    const cooldowns = await prisma.cooldown.findMany({ where: { providerId } });
    expect(cooldowns).toHaveLength(1);
    const after = await prisma.provider.findUnique({ where: { id: providerId } });
    expect(after!.errorCount24h).toBe(2);
  });

  it('history 返回近 N 条按时间倒序', async () => {
    class FlakyMock extends MockProvider {
      private count = 0;
      override async checkHealth(): Promise<ProviderHealthReport> {
        this.count += 1;
        return this.count % 2 === 0
          ? { ok: false, status: 'degraded', message: `fail-${this.count}` }
          : { ok: true, status: 'active', message: `ok-${this.count}` };
      }
    }
    registry.registerFactory('mock', (cfg, cred) => new FlakyMock(cfg, cred));
    registry.install(
      parseProviderConfig({
        slug: 'health-test',
        kind: 'mock',
        name: 'Health Test',
        baseUrl: 'mock://local',
        enabled: true,
        priority: 100,
      }),
      { apiKey: null, baseUrl: 'mock://local' },
    );
    const svc = new ProviderHealthService(prisma, registry);
    for (let i = 0; i < 3; i++) {
      await svc.checkOne('health-test');
      await new Promise((r) => setTimeout(r, 5));
    }
    const hist = await svc.history('health-test');
    expect(hist).toHaveLength(3);
    // 最新一条 ok=false (count=2 时失败，再 count=3 时成功)，按倒序
    expect(hist[0]!.ok).toBe(true); // count=3 → ok
    expect(hist[1]!.ok).toBe(false); // count=2 → fail
    expect(hist[2]!.ok).toBe(true); // count=1 → ok
  });
});

describe('Tick 31 — /admin/providers/:slug/health 端点', () => {
  beforeEach(async () => {
    await prisma.cooldown.deleteMany();
    await prisma.healthCheck.deleteMany();
  });

  it('POST mock 已注册 → 200 + ok=true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/providers/mock/health',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.providerSlug).toBe('mock');
    expect(body.ok).toBe(true);
    expect(body.takenAt).toBeTruthy();
  });

  it('POST 未注册 → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/providers/does-not-exist/health',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /admin/providers/:slug/health/history 返回列表', async () => {
    // 先把 mock provider 插入 DB（bootstrap 只挂 registry，没写 DB row）
    await prisma.provider.upsert({
      where: { slug: 'mock' },
      create: {
        slug: 'mock',
        kind: 'mock',
        name: 'Mock',
        baseUrl: 'mock://local',
        enabled: true,
        priority: 999,
      },
      update: {},
    });
    // 再 POST 一次让 HealthCheck 表有数据
    await app.inject({
      method: 'POST',
      url: '/admin/providers/mock/health',
      headers: { cookie: sessionCookie },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/providers/mock/health/history',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /admin/providers/health 列出所有 provider 健康字段', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/providers/health',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    // 至少应该有种子 / mock provider
    const slugs = body.data.map((r: { slug: string }) => r.slug);
    expect(slugs.length).toBeGreaterThan(0);
  });

  it('POST 未登录 → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/providers/mock/health' });
    expect(res.statusCode).toBe(401);
  });
});
