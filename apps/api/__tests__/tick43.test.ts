/**
 * Tick 43 v1.7.15.0 单元 + 集成测试：
 * - AdminAuditAggregateService.stats 四维度 (user/resource/action/day)
 * - 失败率计算 + topN 裁剪 + 按 total 降序
 * - day 维度 JS 端 bucket + 空桶填充
 * - GET /admin/audit/stats?dimension= 端点契约
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { AdminAuditAggregateService } from '../src/services/admin-audit-aggregate.service.js';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { hashPassword } from '../src/services/admin-user.service.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick43-test.db`
    : `${process.cwd()}/data/freellm-tick43-test.db`,
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

async function seedAudit(opts: {
  username?: string;
  action?: string;
  resourceType?: string;
  status?: number;
  at?: Date;
}): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      username: opts.username ?? 'admin',
      action: opts.action ?? 'create',
      resourceType: opts.resourceType ?? 'virtual_key',
      method: 'POST',
      path: '/admin/test',
      status: opts.status ?? 200,
      createdAt: opts.at ?? new Date(),
    },
  });
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
    version: '1.7.15.0',
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
  await app.close();
  await prisma.$disconnect();
});

describe('Tick 43 — stats by user / resource / action', () => {
  beforeEach(async () => {
    await prisma.adminAuditLog.deleteMany();
  });

  it('空表 → totalEvents=0 + buckets=[]', async () => {
    const svc = new AdminAuditAggregateService(prisma);
    const r = await svc.stats('user');
    expect(r.totalEvents).toBe(0);
    expect(r.buckets).toEqual([]);
  });

  it('按 user 分组 + 按 total 降序 + 失败率', async () => {
    await seedAudit({ username: 'alice', status: 200 });
    await seedAudit({ username: 'alice', status: 200 });
    await seedAudit({ username: 'alice', status: 500 });
    await seedAudit({ username: 'bob', status: 200 });
    const svc = new AdminAuditAggregateService(prisma);
    const r = await svc.stats('user');
    expect(r.totalEvents).toBe(4);
    expect(r.buckets[0]!.key).toBe('alice');
    expect(r.buckets[0]!.total).toBe(3);
    expect(r.buckets[0]!.failed).toBe(1);
    expect(r.buckets[0]!.failureRate).toBeCloseTo(0.333);
    expect(r.buckets[1]!.key).toBe('bob');
    expect(r.buckets[1]!.failureRate).toBe(0);
  });

  it('按 resource 分组', async () => {
    await seedAudit({ resourceType: 'virtual_key' });
    await seedAudit({ resourceType: 'virtual_key' });
    await seedAudit({ resourceType: 'webhook' });
    const svc = new AdminAuditAggregateService(prisma);
    const r = await svc.stats('resource');
    expect(r.buckets[0]!.key).toBe('virtual_key');
    expect(r.buckets[0]!.total).toBe(2);
  });

  it('按 action 分组', async () => {
    await seedAudit({ action: 'create' });
    await seedAudit({ action: 'delete' });
    await seedAudit({ action: 'delete' });
    const svc = new AdminAuditAggregateService(prisma);
    const r = await svc.stats('action');
    expect(r.buckets[0]!.key).toBe('delete');
    expect(r.buckets[0]!.total).toBe(2);
  });

  it('topN 裁剪', async () => {
    for (let i = 0; i < 15; i++) {
      await seedAudit({ username: `u${i}` });
    }
    const svc = new AdminAuditAggregateService(prisma);
    const r = await svc.stats('user', { topN: 5 });
    expect(r.buckets).toHaveLength(5);
    expect(r.totalEvents).toBe(15);
  });
});

describe('Tick 43 — stats by day (JS bucket)', () => {
  beforeEach(async () => {
    await prisma.adminAuditLog.deleteMany();
  });

  it('窗口内 7 天空数据 → 7 个空桶', async () => {
    const svc = new AdminAuditAggregateService(prisma);
    const r = await svc.stats('day');
    expect(r.buckets.length).toBeGreaterThanOrEqual(7);
    expect(r.totalEvents).toBe(0);
  });

  it('按日聚合 + 跨日失败率', async () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 3600_000);
    await seedAudit({ at: today, status: 200 });
    await seedAudit({ at: today, status: 500 });
    await seedAudit({ at: yesterday, status: 200 });
    const svc = new AdminAuditAggregateService(prisma);
    const r = await svc.stats('day');
    expect(r.totalEvents).toBe(3);
    const nonZero = r.buckets.filter((b) => b.total > 0);
    expect(nonZero.length).toBe(2);
  });
});

describe('Tick 43 — GET /admin/audit/stats 端点', () => {
  beforeEach(async () => {
    await prisma.adminAuditLog.deleteMany();
  });

  it('GET ?dimension=user → 200 + dimension=user', async () => {
    await seedAudit({ username: 'admin' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit/stats?dimension=user',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dimension).toBe('user');
    expect(body.totalEvents).toBe(1);
  });

  it('GET 默认 dimension=user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit/stats',
      headers: { cookie: sessionCookie },
    });
    const body = res.json();
    expect(body.dimension).toBe('user');
  });

  it('未知 dimension → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit/stats?dimension=invalid',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('未登录 → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/audit/stats' });
    expect(res.statusCode).toBe(401);
  });
});
