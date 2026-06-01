/**
 * Tick 35 v1.7.7.0 集成测试：
 * - POST /admin/models/bulk 5 个 action (blacklist / whitelist / enable / disable / reset)
 * - bulk action 副作用 (status 同步 + 双向冲突字段清除)
 * - GET /admin/models/export 只导出有覆盖的模型
 * - POST /admin/models/import 按 (providerSlug, upstreamId) 复合键 + 找不到时 skipped
 * - bulk ids 上限 / 未登录
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

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick35-test.db`
    : `${process.cwd()}/data/freellm-tick35-test.db`,
);

let prisma: PrismaClient;
let app: FastifyInstance;
let sessionCookie: string;
let providerId: string;

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

async function seedModel(upstreamId: string): Promise<string> {
  const m = await prisma.model.create({
    data: {
      providerId,
      upstreamId,
      displayName: upstreamId,
      isFree: true,
      status: 'active',
    },
  });
  return m.id;
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
    version: '1.7.7.0',
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
  const provider = await prisma.provider.upsert({
    where: { slug: 'bulk-test' },
    update: {},
    create: {
      slug: 'bulk-test',
      kind: 'mock',
      name: 'Bulk Test',
      baseUrl: 'mock://local',
      enabled: true,
      priority: 100,
    },
  });
  providerId = provider.id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Tick 35 — POST /admin/models/bulk', () => {
  beforeEach(async () => {
    await prisma.model.deleteMany();
  });

  it('blacklist 批量：5 个 model 设 blacklisted=true + force_disabled', async () => {
    const ids = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => seedModel(`bulk/blk-${i}`)),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/admin/models/bulk',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { ids, action: 'blacklist' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.modified).toBe(5);
    const after = await prisma.model.findMany({ where: { id: { in: ids } } });
    for (const m of after) {
      expect(m.blacklisted).toBe(true);
      expect(m.manualOverride).toBe('force_disabled');
      expect(m.status).toBe('disabled');
    }
  });

  it('whitelist 批量：清掉 blacklisted + 设 force_enabled', async () => {
    const id = await seedModel('bulk/wl-1');
    await prisma.model.update({ where: { id }, data: { blacklisted: true } });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/models/bulk',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { ids: [id], action: 'whitelist' },
    });
    expect(res.statusCode).toBe(200);
    const after = await prisma.model.findUnique({ where: { id } });
    expect(after!.whitelisted).toBe(true);
    expect(after!.blacklisted).toBe(false);
    expect(after!.manualOverride).toBe('force_enabled');
    expect(after!.status).toBe('active');
  });

  it('reset 批量：清掉所有覆盖字段', async () => {
    const id = await seedModel('bulk/rs-1');
    await prisma.model.update({
      where: { id },
      data: {
        blacklisted: true,
        whitelisted: false,
        manualOverride: 'force_disabled',
        notes: 'auto-blacklisted',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/models/bulk',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { ids: [id], action: 'reset' },
    });
    expect(res.statusCode).toBe(200);
    const after = await prisma.model.findUnique({ where: { id } });
    expect(after!.blacklisted).toBe(false);
    expect(after!.whitelisted).toBe(false);
    expect(after!.manualOverride).toBeNull();
    expect(after!.notes).toBeNull();
  });

  it('enable 与 disable 互斥语义', async () => {
    const id = await seedModel('bulk/sw-1');
    await app.inject({
      method: 'POST',
      url: '/admin/models/bulk',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { ids: [id], action: 'disable' },
    });
    let after = await prisma.model.findUnique({ where: { id } });
    expect(after!.manualOverride).toBe('force_disabled');
    expect(after!.status).toBe('disabled');

    await app.inject({
      method: 'POST',
      url: '/admin/models/bulk',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { ids: [id], action: 'enable' },
    });
    after = await prisma.model.findUnique({ where: { id } });
    expect(after!.manualOverride).toBe('force_enabled');
    expect(after!.status).toBe('active');
    expect(after!.blacklisted).toBe(false);
  });

  it('ids 超过 500 → 400 (zod max)', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `id-${i}`);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/models/bulk',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { ids, action: 'blacklist' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('未知 action → 400', async () => {
    const id = await seedModel('bulk/un-1');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/models/bulk',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { ids: [id], action: 'invalid-action' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('未登录 → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/models/bulk',
      payload: { ids: ['x'], action: 'blacklist' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Tick 35 — export + import', () => {
  beforeEach(async () => {
    await prisma.model.deleteMany();
  });

  it('export 只包含有覆盖的模型', async () => {
    await seedModel('exp/plain'); // 无覆盖 → 不导出
    const flagged = await seedModel('exp/flagged');
    await prisma.model.update({ where: { id: flagged }, data: { blacklisted: true } });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/models/export',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.models[0].upstreamId).toBe('exp/flagged');
    expect(body.models[0].blacklisted).toBe(true);
    expect(body.models[0].providerSlug).toBe('bulk-test');
  });

  it('import 按 (providerSlug, upstreamId) 复合键匹配，找不到时 skipped', async () => {
    await seedModel('imp/exists');

    const res = await app.inject({
      method: 'POST',
      url: '/admin/models/import',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: {
        models: [
          {
            providerSlug: 'bulk-test',
            upstreamId: 'imp/exists',
            blacklisted: true,
            notes: 'imported',
          },
          {
            providerSlug: 'bulk-test',
            upstreamId: 'imp/missing',
            blacklisted: true,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.requested).toBe(2);
    expect(body.modified).toBe(1);
    expect(body.skipped).toBe(1);

    const after = await prisma.model.findFirst({ where: { upstreamId: 'imp/exists' } });
    expect(after!.blacklisted).toBe(true);
    expect(after!.notes).toBe('imported');
  });

  it('import 0 个 → 400 (zod min)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/models/import',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { models: [] },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('import 含 manualOverride=force_disabled → 同步设 status=disabled', async () => {
    const id = await seedModel('imp/sync');
    await app.inject({
      method: 'POST',
      url: '/admin/models/import',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: {
        models: [
          {
            providerSlug: 'bulk-test',
            upstreamId: 'imp/sync',
            manualOverride: 'force_disabled',
          },
        ],
      },
    });
    const after = await prisma.model.findUnique({ where: { id } });
    expect(after!.manualOverride).toBe('force_disabled');
    expect(after!.status).toBe('disabled');
  });
});
