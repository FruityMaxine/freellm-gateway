/**
 * Tick 42 v1.7.14.0 集成测试：
 * - GET /admin/logs/:requestId 返回扁平化 attemptsList（含 startedAt / firstTokenMs /
 *   cooldownTriggered / bytesIn / bytesOut / providerSlug / providerName / modelDisplayName）
 * - 多 attempt 按 ordinal 升序
 * - 404 + 401
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
    ? `${process.cwd()}/../../data/freellm-tick42-test.db`
    : `${process.cwd()}/data/freellm-tick42-test.db`,
);

let prisma: PrismaClient;
let app: FastifyInstance;
let sessionCookie: string;
let providerId: string;
let modelId: string;

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
    version: '1.7.14.0',
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
  const provider = await prisma.provider.create({
    data: {
      slug: 'wf-test',
      kind: 'mock',
      name: 'Waterfall Test Provider',
      baseUrl: 'mock://local',
      enabled: true,
      priority: 100,
    },
  });
  providerId = provider.id;
  const model = await prisma.model.create({
    data: {
      providerId,
      upstreamId: 'wf/model',
      displayName: 'Waterfall Model',
      isFree: true,
    },
  });
  modelId = model.id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Tick 42 — GET /admin/logs/:requestId 详情 + 扁平化 attempts', () => {
  beforeEach(async () => {
    await prisma.routeAttempt.deleteMany();
    await prisma.requestLog.deleteMany();
  });

  it('未知 requestId → 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/logs/no-such-req',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('未登录 → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/logs/x' });
    expect(res.statusCode).toBe(401);
  });

  it('单 attempt → 完整字段 + 扁平化 providerSlug / modelDisplayName', async () => {
    const requestStartedAt = new Date('2026-05-23T12:00:00Z');
    await prisma.requestLog.create({
      data: {
        requestId: 'req-wf-1',
        upstreamProvider: 'wf-test',
        upstreamModel: 'wf/model',
        status: 200,
        durationMs: 800,
        startedAt: requestStartedAt,
      },
    });
    await prisma.routeAttempt.create({
      data: {
        requestId: 'req-wf-1',
        ordinal: 1,
        providerId,
        modelId,
        upstreamModel: 'wf/model',
        startedAt: requestStartedAt,
        finishedAt: new Date(requestStartedAt.getTime() + 800),
        durationMs: 800,
        firstTokenMs: 120,
        status: 200,
        bytesIn: 1024,
        bytesOut: 2048,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/logs/req-wf-1',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.requestId).toBe('req-wf-1');
    expect(body.attemptsList).toHaveLength(1);
    const a = body.attemptsList[0];
    expect(a.ordinal).toBe(1);
    expect(a.providerSlug).toBe('wf-test');
    expect(a.providerName).toBe('Waterfall Test Provider');
    expect(a.modelDisplayName).toBe('Waterfall Model');
    expect(a.firstTokenMs).toBe(120);
    expect(a.durationMs).toBe(800);
    expect(a.bytesIn).toBe(1024);
    expect(a.bytesOut).toBe(2048);
    expect(a.cooldownTriggered).toBe(false);
    expect(a.startedAt).toBeTruthy();
    expect(a.finishedAt).toBeTruthy();
  });

  it('多 attempt 按 ordinal 升序 + 第 2 次 cooldownTriggered=true', async () => {
    const baseAt = new Date('2026-05-23T12:00:00Z');
    await prisma.requestLog.create({
      data: {
        requestId: 'req-multi',
        upstreamProvider: 'wf-test',
        status: 200,
        durationMs: 3000,
        startedAt: baseAt,
      },
    });
    // 故意倒序插入测试 orderBy
    await prisma.routeAttempt.create({
      data: {
        requestId: 'req-multi',
        ordinal: 2,
        providerId,
        upstreamModel: 'wf/model',
        startedAt: new Date(baseAt.getTime() + 1500),
        finishedAt: new Date(baseAt.getTime() + 3000),
        durationMs: 1500,
        firstTokenMs: 80,
        status: 200,
        cooldownTriggered: true,
      },
    });
    await prisma.routeAttempt.create({
      data: {
        requestId: 'req-multi',
        ordinal: 1,
        providerId,
        upstreamModel: 'fail/model',
        startedAt: baseAt,
        finishedAt: new Date(baseAt.getTime() + 1500),
        durationMs: 1500,
        status: 502,
        errorKind: 'upstream_5xx',
        errorMessage: 'simulated failure',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/logs/req-multi',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.attemptsList).toHaveLength(2);
    expect(body.attemptsList[0].ordinal).toBe(1);
    expect(body.attemptsList[0].errorKind).toBe('upstream_5xx');
    expect(body.attemptsList[0].errorMessage).toBe('simulated failure');
    expect(body.attemptsList[1].ordinal).toBe(2);
    expect(body.attemptsList[1].cooldownTriggered).toBe(true);
  });

  it('attempt 缺 provider/model 关系 → providerSlug / modelDisplayName 为 null', async () => {
    const baseAt = new Date('2026-05-23T12:00:00Z');
    await prisma.requestLog.create({
      data: {
        requestId: 'req-noref',
        status: null,
        startedAt: baseAt,
      },
    });
    await prisma.routeAttempt.create({
      data: {
        requestId: 'req-noref',
        ordinal: 1,
        upstreamModel: 'unknown',
        startedAt: baseAt,
        durationMs: 100,
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/logs/req-noref',
      headers: { cookie: sessionCookie },
    });
    const body = res.json();
    expect(body.attemptsList[0].providerSlug).toBeNull();
    expect(body.attemptsList[0].modelDisplayName).toBeNull();
  });

  it('attempt 列表为空时仍正常返回（无 attempts 的纯 RequestLog）', async () => {
    await prisma.requestLog.create({
      data: {
        requestId: 'req-no-attempts',
        startedAt: new Date(),
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/logs/req-no-attempts',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().attemptsList).toEqual([]);
  });

  it('bytesIn/bytesOut 默认为 0', async () => {
    await prisma.requestLog.create({
      data: { requestId: 'req-bytes', startedAt: new Date() },
    });
    await prisma.routeAttempt.create({
      data: {
        requestId: 'req-bytes',
        ordinal: 1,
        startedAt: new Date(),
        durationMs: 50,
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/logs/req-bytes',
      headers: { cookie: sessionCookie },
    });
    const body = res.json();
    expect(body.attemptsList[0].bytesIn).toBe(0);
    expect(body.attemptsList[0].bytesOut).toBe(0);
  });
});
