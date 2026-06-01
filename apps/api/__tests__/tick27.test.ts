/**
 * Tick 27 v1.6.2.0 集成测试：
 * - /admin/webhooks GET/POST/PATCH/DELETE 端点契约
 * - secret 仅显示前后片段不泄露
 * - sign-test + verify 端点联动
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { AdminUserService } from '../src/services/admin-user.service.js';
import { hashPassword } from '../src/services/admin-user.service.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick27-test.db`
    : `${process.cwd()}/data/freellm-tick27-test.db`,
);

let app: FastifyInstance;
let prisma: PrismaClient;
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
    `DATABASE_URL=\"file:${TEST_DB}\" npx prisma db push --schema prisma/schema.prisma --skip-generate --accept-data-loss`,
    {
      cwd: process.cwd().endsWith('/apps/api') ? `${process.cwd()}/../..` : process.cwd(),
      stdio: 'pipe',
    },
  );
  process.env.DATABASE_URL = `file:${TEST_DB}`;
  _setConfigForTests({
    version: '1.6.2.0',
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

describe('Tick 27 — /admin/webhooks CRUD 端点', () => {
  beforeEach(async () => {
    await prisma.webhookSubscription.deleteMany();
  });

  it('POST /admin/webhooks 创建并返回 id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/webhooks',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: {
        url: 'https://hooks.example.com/freellm',
        secret: 'super-secret-key-xyz',
        eventTopics: ['model:added'],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.subscription.id).toBeDefined();
  });

  it('GET /admin/webhooks 列表返回 secretPreview（前后片段，不泄露全文）', async () => {
    await prisma.webhookSubscription.create({
      data: {
        url: 'https://hooks.example.com/test',
        secret: 'abcdefghijklmnopqrstuvwxyz1234567890',
        eventTopicsJson: '[]',
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/webhooks',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    const row = body.data[0];
    expect(row.secretPreview).toMatch(/^abcd…7890$/);
    // 不能含完整 secret
    expect(JSON.stringify(row)).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890');
  });

  it('PATCH /admin/webhooks/:id 改 enabled 字段', async () => {
    const sub = await prisma.webhookSubscription.create({
      data: { url: 'https://hooks.example.com/p', secret: 'abcdefgh1234', eventTopicsJson: '[]' },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/webhooks/${sub.id}`,
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    const after = await prisma.webhookSubscription.findUnique({ where: { id: sub.id } });
    expect(after?.enabled).toBe(false);
  });

  it('DELETE /admin/webhooks/:id 删除订阅', async () => {
    const sub = await prisma.webhookSubscription.create({
      data: { url: 'https://hooks.example.com/d', secret: 'abcdefgh1234', eventTopicsJson: '[]' },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/webhooks/${sub.id}`,
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(await prisma.webhookSubscription.findUnique({ where: { id: sub.id } })).toBeNull();
  });

  it('DELETE 不存在 ID → 404 not_found', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/admin/webhooks/does-not-exist',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('未登录访问 /admin/webhooks → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/webhooks',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Tick 27 — /admin/webhooks/sign-test + verify 联动', () => {
  it('sign-test 返回签名头 + verify 通过', async () => {
    const signRes = await app.inject({
      method: 'POST',
      url: '/admin/webhooks/sign-test',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { secret: 'my-test-secret-9999', payload: '{"topic":"x"}' },
    });
    expect(signRes.statusCode).toBe(200);
    const signed = signRes.json();
    expect(signed.signatureHeader).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);

    const verifyRes = await app.inject({
      method: 'POST',
      url: '/admin/webhooks/verify',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: {
        secret: 'my-test-secret-9999',
        payload: '{"topic":"x"}',
        signatureHeader: signed.signatureHeader,
      },
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().valid).toBe(true);
  });

  it('verify 错 secret → valid=false reason=signature_mismatch', async () => {
    const signRes = await app.inject({
      method: 'POST',
      url: '/admin/webhooks/sign-test',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { secret: 'right-secret-1234', payload: '{"a":1}' },
    });
    const signed = signRes.json();
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/admin/webhooks/verify',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: {
        secret: 'wrong-secret-5678',
        payload: '{"a":1}',
        signatureHeader: signed.signatureHeader,
      },
    });
    expect(verifyRes.json().valid).toBe(false);
    expect(verifyRes.json().reason).toBe('signature_mismatch');
  });
});

// 抑制未使用 lint 警告
void AdminUserService;
