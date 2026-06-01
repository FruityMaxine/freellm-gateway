/**
 * Tick 34 v1.7.6.0 单元 + 集成测试：
 * - evaluateModelLogs 纯函数（连续失败 / 低成功率 / 不触发）
 * - ModelAutoBlacklistService.evaluateAll：触发条件 + 跳过条件 + 写 Model.manualOverride + 写 ErrorEvent
 * - listRecentlyAutoBlacklisted 查询
 * - POST /admin/models/auto-blacklist/evaluate + GET /recent 端点契约
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import {
  ModelAutoBlacklistService,
  evaluateModelLogs,
} from '../src/services/model-auto-blacklist.service.js';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { hashPassword } from '../src/services/admin-user.service.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick34-test.db`
    : `${process.cwd()}/data/freellm-tick34-test.db`,
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
    version: '1.7.6.0',
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
    where: { slug: 'autobl-test' },
    update: {},
    create: {
      slug: 'autobl-test',
      kind: 'mock',
      name: 'Auto Blacklist Test',
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

const DEFAULT_OPTS = {
  minSuccessRate: 0.5,
  minSampleSize: 10,
  consecutiveFailureWindow: 5,
  windowMs: 24 * 60 * 60_000,
};

describe('Tick 34 — evaluateModelLogs 纯函数', () => {
  it('空日志 → 不触发', () => {
    const r = evaluateModelLogs([], DEFAULT_OPTS);
    expect(r.shouldBlacklist).toBe(false);
    expect(r.sampleSize).toBe(0);
  });

  it('最近 5 次连续失败 → consecutive_failures', () => {
    const logs = Array.from({ length: 5 }, () => ({ status: 500, errorKind: 'upstream_5xx' }));
    const r = evaluateModelLogs(logs, DEFAULT_OPTS);
    expect(r.shouldBlacklist).toBe(true);
    expect(r.reason).toBe('consecutive_failures');
    expect(r.consecutiveFailures).toBe(5);
  });

  it('5 次失败但中间夹一次成功 → 连续断 → 看成功率', () => {
    // 最新 4 次失败 + 1 次成功 + 5 次失败 → consecutiveFailures = 4 (< 5), 成功率 1/10 = 0.1 → low_success_rate
    const logs = [
      ...Array.from({ length: 4 }, () => ({ status: 500, errorKind: 'upstream_5xx' })),
      { status: 200, errorKind: null },
      ...Array.from({ length: 5 }, () => ({ status: 500, errorKind: 'upstream_5xx' })),
    ];
    const r = evaluateModelLogs(logs, DEFAULT_OPTS);
    expect(r.consecutiveFailures).toBe(4);
    expect(r.shouldBlacklist).toBe(true);
    expect(r.reason).toBe('low_success_rate');
    expect(r.successRate).toBeCloseTo(0.1);
  });

  it('成功率 60% 高于阈值 → 不触发', () => {
    const logs = [
      ...Array.from({ length: 6 }, () => ({ status: 200, errorKind: null })),
      ...Array.from({ length: 4 }, () => ({ status: 500, errorKind: 'x' })),
    ];
    const r = evaluateModelLogs(logs, DEFAULT_OPTS);
    expect(r.shouldBlacklist).toBe(false);
  });

  it('样本量 < 10 → 不触发低成功率', () => {
    // 9 次全失败 → 但 < 10 个样本 → low_success_rate 不触发；不过 5 连失会触发 consecutive
    const logs = Array.from({ length: 4 }, () => ({ status: 500, errorKind: 'x' }));
    const r = evaluateModelLogs(logs, DEFAULT_OPTS);
    expect(r.shouldBlacklist).toBe(false);
    expect(r.consecutiveFailures).toBe(4);
  });

  it('status === null 视为失败', () => {
    const logs = Array.from({ length: 5 }, () => ({ status: null, errorKind: null }));
    const r = evaluateModelLogs(logs, DEFAULT_OPTS);
    expect(r.shouldBlacklist).toBe(true);
    expect(r.reason).toBe('consecutive_failures');
  });
});

describe('Tick 34 — ModelAutoBlacklistService.evaluateAll 集成', () => {
  beforeEach(async () => {
    await prisma.errorEvent.deleteMany();
    await prisma.requestLog.deleteMany();
    await prisma.model.deleteMany();
  });

  it('健康模型 → 不动', async () => {
    const m = await prisma.model.create({
      data: {
        providerId,
        upstreamId: 'healthy/model',
        displayName: 'Healthy',
        isFree: true,
        status: 'active',
      },
    });
    await prisma.requestLog.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        requestId: `r${i}`,
        upstreamProvider: 'autobl-test',
        upstreamModel: 'healthy/model',
        status: 200,
        startedAt: new Date(),
      })),
    });
    const svc = new ModelAutoBlacklistService(prisma);
    const report = await svc.evaluateAll();
    expect(report.blacklisted).toHaveLength(0);
    const after = await prisma.model.findUnique({ where: { id: m.id } });
    expect(after?.manualOverride).toBeNull();
  });

  it('连续失败 5+ → force_disabled + ErrorEvent', async () => {
    const m = await prisma.model.create({
      data: {
        providerId,
        upstreamId: 'sick/model',
        displayName: 'Sick',
        isFree: true,
        status: 'active',
      },
    });
    await prisma.requestLog.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({
        requestId: `r${i}`,
        upstreamProvider: 'autobl-test',
        upstreamModel: 'sick/model',
        status: 502,
        errorKind: 'upstream_5xx',
        startedAt: new Date(Date.now() - i * 60_000), // 错峰 1 分钟
      })),
    });
    const svc = new ModelAutoBlacklistService(prisma);
    const report = await svc.evaluateAll();
    expect(report.blacklisted).toHaveLength(1);
    expect(report.blacklisted[0]!.reason).toBe('consecutive_failures');
    const after = await prisma.model.findUnique({ where: { id: m.id } });
    expect(after?.manualOverride).toBe('force_disabled');
    expect(after?.notes).toContain('auto-blacklisted');

    const evt = await prisma.errorEvent.findFirst({ where: { modelId: m.id } });
    expect(evt).toBeTruthy();
    expect(evt!.kind).toBe('model_change');
  });

  it('whitelisted=true → 跳过', async () => {
    const m = await prisma.model.create({
      data: {
        providerId,
        upstreamId: 'protected/model',
        displayName: 'Protected',
        isFree: true,
        status: 'active',
        whitelisted: true,
      },
    });
    await prisma.requestLog.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        requestId: `p${i}`,
        upstreamProvider: 'autobl-test',
        upstreamModel: 'protected/model',
        status: 500,
        errorKind: 'x',
        startedAt: new Date(),
      })),
    });
    const svc = new ModelAutoBlacklistService(prisma);
    const report = await svc.evaluateAll();
    expect(report.skippedWhitelisted).toBeGreaterThanOrEqual(1);
    const after = await prisma.model.findUnique({ where: { id: m.id } });
    expect(after?.manualOverride).toBeNull();
  });

  it('manualOverride=force_enabled → 跳过', async () => {
    const m = await prisma.model.create({
      data: {
        providerId,
        upstreamId: 'force-on/model',
        displayName: 'Forced',
        isFree: true,
        status: 'active',
        manualOverride: 'force_enabled',
      },
    });
    await prisma.requestLog.createMany({
      data: Array.from({ length: 10 }, () => ({
        requestId: `f${Math.random()}`,
        upstreamProvider: 'autobl-test',
        upstreamModel: 'force-on/model',
        status: 500,
        errorKind: 'x',
        startedAt: new Date(),
      })),
    });
    const svc = new ModelAutoBlacklistService(prisma);
    const report = await svc.evaluateAll();
    expect(report.skippedForceEnabled).toBeGreaterThanOrEqual(1);
    const after = await prisma.model.findUnique({ where: { id: m.id } });
    expect(after?.manualOverride).toBe('force_enabled');
  });

  it('低成功率 (10/0) → low_success_rate', async () => {
    const m = await prisma.model.create({
      data: {
        providerId,
        upstreamId: 'low-success/model',
        displayName: 'LowSuccess',
        isFree: true,
        status: 'active',
      },
    });
    // 制造非连续 5 失败：交替 fail/success，最后 1 次成功 → 连续失败计数 = 0
    // 但样本 10 成功率仅 4/10 = 40% < 50% → low_success_rate
    await prisma.requestLog.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        requestId: `ls${i}`,
        upstreamProvider: 'autobl-test',
        upstreamModel: 'low-success/model',
        // 0,2,4,6 = success（4 次成功），1,3,5,7,8,9 = fail
        status: i % 2 === 0 && i < 8 ? 200 : 500,
        errorKind: i % 2 === 0 && i < 8 ? null : 'x',
        startedAt: new Date(Date.now() - i * 60_000),
      })),
    });
    const svc = new ModelAutoBlacklistService(prisma);
    const report = await svc.evaluateAll();
    expect(report.blacklisted).toHaveLength(1);
    expect(report.blacklisted[0]!.reason).toBe('low_success_rate');
    const after = await prisma.model.findUnique({ where: { id: m.id } });
    expect(after?.manualOverride).toBe('force_disabled');
  });

  it('listRecentlyAutoBlacklisted 返回近期记录', async () => {
    const m = await prisma.model.create({
      data: {
        providerId,
        upstreamId: 'history/model',
        displayName: 'Historic',
        isFree: true,
        status: 'active',
      },
    });
    await prisma.requestLog.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({
        requestId: `h${i}`,
        upstreamProvider: 'autobl-test',
        upstreamModel: 'history/model',
        status: 502,
        errorKind: 'upstream_5xx',
        startedAt: new Date(),
      })),
    });
    const svc = new ModelAutoBlacklistService(prisma);
    await svc.evaluateAll();
    const recent = await svc.listRecentlyAutoBlacklisted();
    expect(recent.length).toBeGreaterThanOrEqual(1);
    expect(recent[0]!.modelId).toBe(m.id);
    expect(recent[0]!.upstreamId).toBe('history/model');
  });
});

describe('Tick 34 — /admin/models/auto-blacklist/* 端点', () => {
  beforeEach(async () => {
    await prisma.errorEvent.deleteMany();
    await prisma.requestLog.deleteMany();
    await prisma.model.deleteMany();
  });

  it('POST evaluate → 200 + report', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/models/auto-blacklist/evaluate',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.evaluated).toBe('number');
    expect(Array.isArray(body.blacklisted)).toBe(true);
  });

  it('GET recent → 200 + 列表', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/models/auto-blacklist/recent',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('POST 未登录 → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/models/auto-blacklist/evaluate',
    });
    expect(res.statusCode).toBe(401);
  });
});
