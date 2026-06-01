/**
 * Tick 40 v1.7.12.0 单元 + 集成测试：
 * - AlertsCenterService.list (按 kind / severity / resolved 筛选 + 分页)
 * - AlertsCenterService.resolve (落 resolvedAt + 重复 resolve 幂等)
 * - AlertsCenterService.stats (按 kind / severity 分组 + totalUnresolved)
 * - 端点契约（GET /admin/alerts + /stats + POST /:id/resolve）
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { AlertsCenterService } from '../src/services/alerts-center.service.js';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { hashPassword } from '../src/services/admin-user.service.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick40-test.db`
    : `${process.cwd()}/data/freellm-tick40-test.db`,
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

async function seedEvent(opts: {
  kind: string;
  severity?: string;
  message?: string;
  resolved?: boolean;
}): Promise<string> {
  const ev = await prisma.errorEvent.create({
    data: {
      kind: opts.kind,
      severity: opts.severity ?? 'warn',
      message: opts.message ?? `test ${opts.kind}`,
      resolvedAt: opts.resolved ? new Date() : null,
    },
  });
  return ev.id;
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
    version: '1.7.12.0',
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

describe('Tick 40 — AlertsCenterService.list 筛选', () => {
  beforeEach(async () => {
    await prisma.errorEvent.deleteMany();
  });

  it('无筛选 → 全部返回', async () => {
    await seedEvent({ kind: 'balance_low' });
    await seedEvent({ kind: 'vk_usage_alert' });
    await seedEvent({ kind: 'model_change' });
    const svc = new AlertsCenterService(prisma);
    const r = await svc.list();
    expect(r.total).toBe(3);
    expect(r.data).toHaveLength(3);
  });

  it('按 kind 筛选', async () => {
    await seedEvent({ kind: 'balance_low' });
    await seedEvent({ kind: 'vk_usage_alert' });
    const svc = new AlertsCenterService(prisma);
    const r = await svc.list({ kind: 'balance_low' });
    expect(r.total).toBe(1);
    expect(r.data[0]!.kind).toBe('balance_low');
  });

  it('按 severity 筛选', async () => {
    await seedEvent({ kind: 'balance_low', severity: 'warn' });
    await seedEvent({ kind: 'vk_usage_alert', severity: 'error' });
    const svc = new AlertsCenterService(prisma);
    const r = await svc.list({ severity: 'error' });
    expect(r.total).toBe(1);
  });

  it('按 resolved=false 只返回未解决', async () => {
    await seedEvent({ kind: 'balance_low', resolved: true });
    await seedEvent({ kind: 'balance_low', resolved: false });
    await seedEvent({ kind: 'balance_low', resolved: false });
    const svc = new AlertsCenterService(prisma);
    const unresolved = await svc.list({ resolved: false });
    expect(unresolved.total).toBe(2);
    const resolved = await svc.list({ resolved: true });
    expect(resolved.total).toBe(1);
  });

  it('limit + offset 分页', async () => {
    for (let i = 0; i < 5; i++) await seedEvent({ kind: 'balance_low', message: `e${i}` });
    const svc = new AlertsCenterService(prisma);
    const page1 = await svc.list({ limit: 2, offset: 0 });
    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(5);
    const page2 = await svc.list({ limit: 2, offset: 2 });
    expect(page2.data).toHaveLength(2);
  });
});

describe('Tick 40 — AlertsCenterService.resolve', () => {
  beforeEach(async () => {
    await prisma.errorEvent.deleteMany();
  });

  it('resolve 落 resolvedAt', async () => {
    const id = await seedEvent({ kind: 'balance_low' });
    const svc = new AlertsCenterService(prisma);
    const result = await svc.resolve(id);
    expect(result.resolvedAt).toBeTruthy();
  });

  it('重复 resolve 幂等不抛错', async () => {
    const id = await seedEvent({ kind: 'balance_low', resolved: true });
    const svc = new AlertsCenterService(prisma);
    const result = await svc.resolve(id);
    expect(result.resolvedAt).toBeTruthy();
  });

  it('resolve 不存在 → not_found', async () => {
    const svc = new AlertsCenterService(prisma);
    await expect(svc.resolve('non-exist-id')).rejects.toThrow(/不存在/);
  });
});

describe('Tick 40 — AlertsCenterService.stats', () => {
  beforeEach(async () => {
    await prisma.errorEvent.deleteMany();
  });

  it('空 → totalUnresolved=0', async () => {
    const svc = new AlertsCenterService(prisma);
    const s = await svc.stats();
    expect(s.totalUnresolved).toBe(0);
    expect(s.byKind).toEqual([]);
  });

  it('混合 resolved + unresolved → 正确分组', async () => {
    await seedEvent({ kind: 'balance_low', resolved: false });
    await seedEvent({ kind: 'balance_low', resolved: true });
    await seedEvent({ kind: 'vk_usage_alert', resolved: false });
    await seedEvent({ kind: 'vk_usage_alert', resolved: false });
    await seedEvent({ kind: 'model_change', resolved: true });
    const svc = new AlertsCenterService(prisma);
    const s = await svc.stats();
    expect(s.totalUnresolved).toBe(3);

    const vkRow = s.byKind.find((k) => k.kind === 'vk_usage_alert');
    expect(vkRow).toBeTruthy();
    expect(vkRow!.unresolved).toBe(2);
    expect(vkRow!.total).toBe(2);

    const balanceRow = s.byKind.find((k) => k.kind === 'balance_low');
    expect(balanceRow!.unresolved).toBe(1);
    expect(balanceRow!.total).toBe(2);

    const modelRow = s.byKind.find((k) => k.kind === 'model_change');
    expect(modelRow!.unresolved).toBe(0);
    expect(modelRow!.total).toBe(1);
  });
});

describe('Tick 40 — /admin/alerts 端点', () => {
  beforeEach(async () => {
    await prisma.errorEvent.deleteMany();
  });

  it('GET /admin/alerts → 200', async () => {
    await seedEvent({ kind: 'balance_low' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/alerts',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it('GET /admin/alerts/stats → 200 + byKind', async () => {
    await seedEvent({ kind: 'balance_low' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/alerts/stats',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalUnresolved).toBe(1);
    expect(Array.isArray(body.byKind)).toBe(true);
  });

  it('POST /admin/alerts/:id/resolve → 200 + resolvedAt', async () => {
    const id = await seedEvent({ kind: 'balance_low' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/alerts/${id}/resolve`,
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().resolvedAt).toBeTruthy();
  });

  it('POST resolve 不存在 → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/alerts/no-such/resolve',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('未登录 → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/alerts' });
    expect(res.statusCode).toBe(401);
  });

  it('?resolved=false 只返回未解决', async () => {
    await seedEvent({ kind: 'balance_low', resolved: false });
    await seedEvent({ kind: 'balance_low', resolved: true });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/alerts?resolved=false',
      headers: { cookie: sessionCookie },
    });
    expect(res.json().total).toBe(1);
  });
});
