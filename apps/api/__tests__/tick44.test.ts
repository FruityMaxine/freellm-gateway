/**
 * Tick 44 v1.7.16.0 集成测试：
 * - GET /admin/models/:id 响应包含 scores + snapshots + errorEvents
 * - errorEvents 仅返回 modelId 匹配的，按 createdAt 倒序，最多 20 条
 * - snapshots 倒序 + 最多 10 条
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
    ? `${process.cwd()}/../../data/freellm-tick44-test.db`
    : `${process.cwd()}/data/freellm-tick44-test.db`,
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
    version: '1.7.16.0',
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
      slug: 'tick44-test',
      kind: 'mock',
      name: 'Tick 44 Test',
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

describe('Tick 44 — GET /admin/models/:id 详情含 scores + snapshots + errorEvents', () => {
  beforeEach(async () => {
    await prisma.errorEvent.deleteMany();
    await prisma.modelSnapshot.deleteMany();
    await prisma.modelScore.deleteMany();
    await prisma.model.deleteMany();
  });

  it('未知 id → 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/models/no-such-id',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('未登录 → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/models/x' });
    expect(res.statusCode).toBe(401);
  });

  it('模型 + score → 返回 ModelScore 9 维', async () => {
    const m = await prisma.model.create({
      data: {
        providerId,
        upstreamId: 'tick44/score',
        displayName: 'Score Test',
        isFree: false,
      },
    });
    await prisma.modelScore.create({
      data: {
        modelId: m.id,
        availabilityScore: 0.9,
        latencyScore: 0.7,
        rateLimitScore: 0.8,
        qualityScore: 0.85,
        contextScore: 0.6,
        capabilityScore: 0.75,
        freshnessScore: 0.5,
        costScore: 0.3,
        stabilityScore: 0.95,
        composite: 0.74,
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/models/${m.id}`,
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(m.id);
    expect(body.scores).toBeTruthy();
    expect(body.scores.availabilityScore).toBeCloseTo(0.9);
    expect(body.scores.composite).toBeCloseTo(0.74);
    expect(body.scores.stabilityScore).toBeCloseTo(0.95);
  });

  it('snapshots 倒序 + 最多 10 条', async () => {
    const m = await prisma.model.create({
      data: {
        providerId,
        upstreamId: 'tick44/snap',
        displayName: 'Snap Test',
        isFree: false,
      },
    });
    // 注入 12 条快照，期望返回 10 条且按 takenAt 倒序
    const now = Date.now();
    for (let i = 0; i < 12; i++) {
      await prisma.modelSnapshot.create({
        data: {
          modelId: m.id,
          providerId,
          upstreamId: 'tick44/snap',
          payloadJson: '{}',
          isFree: false,
          takenAt: new Date(now - i * 60_000),
        },
      });
    }
    const res = await app.inject({
      method: 'GET',
      url: `/admin/models/${m.id}`,
      headers: { cookie: sessionCookie },
    });
    const body = res.json();
    expect(body.snapshots).toHaveLength(10);
    const t0 = new Date(body.snapshots[0].takenAt).getTime();
    const t1 = new Date(body.snapshots[1].takenAt).getTime();
    expect(t0).toBeGreaterThan(t1);
  });

  it('errorEvents 仅返回 modelId 匹配 + 倒序 + 最多 20', async () => {
    const m1 = await prisma.model.create({
      data: { providerId, upstreamId: 'tick44/err1', displayName: 'E1', isFree: false },
    });
    const m2 = await prisma.model.create({
      data: { providerId, upstreamId: 'tick44/err2', displayName: 'E2', isFree: false },
    });
    // 25 条 m1 错误事件 + 3 条 m2 错误事件
    for (let i = 0; i < 25; i++) {
      await prisma.errorEvent.create({
        data: {
          kind: 'model_change',
          severity: 'warn',
          modelId: m1.id,
          message: `m1-${i}`,
          createdAt: new Date(Date.now() - i * 60_000),
        },
      });
    }
    for (let i = 0; i < 3; i++) {
      await prisma.errorEvent.create({
        data: {
          kind: 'unknown',
          severity: 'error',
          modelId: m2.id,
          message: `m2-${i}`,
        },
      });
    }
    const res = await app.inject({
      method: 'GET',
      url: `/admin/models/${m1.id}`,
      headers: { cookie: sessionCookie },
    });
    const body = res.json();
    expect(body.errorEvents).toHaveLength(20);
    // 所有事件都属于 m1
    for (const e of body.errorEvents) {
      expect(e.message).toMatch(/^m1-/);
    }
    // 倒序
    const t0 = new Date(body.errorEvents[0].createdAt).getTime();
    const t1 = new Date(body.errorEvents[1].createdAt).getTime();
    expect(t0).toBeGreaterThan(t1);
  });

  it('无 scores → scores=null', async () => {
    const m = await prisma.model.create({
      data: { providerId, upstreamId: 'tick44/no-score', displayName: 'NoScore', isFree: true },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/models/${m.id}`,
      headers: { cookie: sessionCookie },
    });
    const body = res.json();
    expect(body.scores).toBeNull();
  });

  it('无 errorEvents → errorEvents=[]', async () => {
    const m = await prisma.model.create({
      data: { providerId, upstreamId: 'tick44/no-err', displayName: 'NoErr', isFree: true },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/models/${m.id}`,
      headers: { cookie: sessionCookie },
    });
    expect(res.json().errorEvents).toEqual([]);
  });

  it('errorEvent severity 字段透传 (info/warn/error/critical)', async () => {
    const m = await prisma.model.create({
      data: { providerId, upstreamId: 'tick44/sev', displayName: 'Sev', isFree: false },
    });
    await prisma.errorEvent.create({
      data: { kind: 'model_change', severity: 'critical', modelId: m.id, message: 'critical msg' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/models/${m.id}`,
      headers: { cookie: sessionCookie },
    });
    expect(res.json().errorEvents[0].severity).toBe('critical');
  });
});
