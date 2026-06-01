/**
 * Tick 46 v1.7.18.0 单元 + 集成测试：
 * - RetentionPolicyService.getPolicy 默认 + 持久化读
 * - setPolicy 校验 (负数 / 超上限 / 部分字段更新)
 * - runPurge 三域清扫 (audit / playgroundSession / errorEvent resolvedAt 才清)
 * - 端点契约 (GET/PATCH/POST + 401)
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import {
  RetentionPolicyService,
  DEFAULT_RETENTION,
} from '../src/services/retention-policy.service.js';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { hashPassword } from '../src/services/admin-user.service.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick46-test.db`
    : `${process.cwd()}/data/freellm-tick46-test.db`,
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
    version: '1.7.18.0',
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
  await app.close();
  await prisma.$disconnect();
});

describe('Tick 46 — RetentionPolicyService getPolicy + setPolicy', () => {
  beforeEach(async () => {
    await prisma.setting.deleteMany();
  });

  it('未设过 → 返回 DEFAULT_RETENTION', async () => {
    const svc = new RetentionPolicyService(prisma);
    const p = await svc.getPolicy();
    expect(p).toEqual(DEFAULT_RETENTION);
  });

  it('setPolicy 写入 + 复读', async () => {
    const svc = new RetentionPolicyService(prisma);
    const next = await svc.setPolicy({
      adminAuditRetentionDays: 30,
      playgroundSessionRetentionDays: 7,
    });
    expect(next.adminAuditRetentionDays).toBe(30);
    expect(next.playgroundSessionRetentionDays).toBe(7);
    expect(next.errorEventRetentionDays).toBe(DEFAULT_RETENTION.errorEventRetentionDays);
    const read = await svc.getPolicy();
    expect(read.adminAuditRetentionDays).toBe(30);
  });

  it('负数 / 超上限 → bad_request', async () => {
    const svc = new RetentionPolicyService(prisma);
    await expect(svc.setPolicy({ adminAuditRetentionDays: -1 })).rejects.toThrow(/不可为负/);
    await expect(svc.setPolicy({ adminAuditRetentionDays: 5000 })).rejects.toThrow(/不可超过/);
  });

  it('JSON 损坏 → 回退 DEFAULT', async () => {
    await prisma.setting.create({
      data: { key: 'retention.policy', value: 'not-json', category: 'retention' },
    });
    const svc = new RetentionPolicyService(prisma);
    expect(await svc.getPolicy()).toEqual(DEFAULT_RETENTION);
  });
});

describe('Tick 46 — runPurge 三域清扫', () => {
  beforeEach(async () => {
    await prisma.errorEvent.deleteMany();
    await prisma.playgroundSession.deleteMany();
    await prisma.adminAuditLog.deleteMany();
    await prisma.setting.deleteMany();
  });

  it('过期 audit + session + 已解决 errorEvent 都被清；未解决 errorEvent 保留', async () => {
    const old = new Date(Date.now() - 365 * 24 * 60 * 60_000); // 1 年前
    await prisma.adminAuditLog.create({
      data: {
        username: 'admin',
        action: 'create',
        resourceType: 'vk',
        method: 'POST',
        path: '/x',
        status: 200,
        createdAt: old,
      },
    });
    await prisma.adminAuditLog.create({
      data: {
        username: 'admin',
        action: 'create',
        resourceType: 'vk',
        method: 'POST',
        path: '/y',
        status: 200,
      },
    });
    await prisma.playgroundSession.create({
      data: {
        ownerId: 'o1',
        name: 'old',
        messagesJson: '[]',
        lastMessageAt: old,
      },
    });
    await prisma.errorEvent.createMany({
      data: [
        {
          kind: 'balance_low',
          severity: 'warn',
          message: 'old-resolved',
          createdAt: old,
          resolvedAt: old,
        },
        {
          kind: 'balance_low',
          severity: 'warn',
          message: 'old-unresolved',
          createdAt: old,
        },
        {
          kind: 'balance_low',
          severity: 'warn',
          message: 'recent-resolved',
          resolvedAt: new Date(),
        },
      ],
    });

    const svc = new RetentionPolicyService(prisma);
    const r = await svc.runPurge();
    expect(r.auditPurged).toBe(1);
    expect(r.playgroundSessionsPurged).toBe(1);
    expect(r.errorEventsPurged).toBe(1); // 只清 old-resolved

    // 未解决保留
    const remaining = await prisma.errorEvent.findMany();
    expect(remaining).toHaveLength(2);
    const msgs = remaining.map((e) => e.message);
    expect(msgs).toContain('old-unresolved');
    expect(msgs).toContain('recent-resolved');
  });

  it('retention=0 跳过该域', async () => {
    const svc = new RetentionPolicyService(prisma);
    await svc.setPolicy({
      adminAuditRetentionDays: 0,
      playgroundSessionRetentionDays: 0,
      errorEventRetentionDays: 0,
    });
    await prisma.adminAuditLog.create({
      data: {
        username: 'admin',
        action: 'create',
        resourceType: 'vk',
        method: 'POST',
        path: '/x',
        status: 200,
        createdAt: new Date(Date.now() - 1000 * 24 * 3600_000),
      },
    });
    const r = await svc.runPurge();
    expect(r.auditPurged).toBe(0);
  });
});

describe('Tick 46 — /admin/settings/retention 端点', () => {
  beforeEach(async () => {
    await prisma.setting.deleteMany();
  });

  it('GET → 默认策略', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/settings/retention',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().adminAuditRetentionDays).toBe(DEFAULT_RETENTION.adminAuditRetentionDays);
  });

  it('PATCH 部分更新', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/settings/retention',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { adminAuditRetentionDays: 14 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().adminAuditRetentionDays).toBe(14);
  });

  it('PATCH 超出 → 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/settings/retention',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: { adminAuditRetentionDays: 9999 },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('POST purge → 200 + 报告', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/settings/retention/purge',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.auditPurged).toBe('number');
    expect(typeof body.playgroundSessionsPurged).toBe('number');
    expect(typeof body.errorEventsPurged).toBe('number');
  });

  it('未登录 → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/settings/retention' });
    expect(res.statusCode).toBe(401);
  });
});
