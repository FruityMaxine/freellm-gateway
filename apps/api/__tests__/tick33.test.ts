/**
 * Tick 33 v1.7.5.0 单元 + 集成测试：
 * - VirtualKeyCostService.compute：累计 cost + topModels 排序 + 窗口边界
 * - VirtualKeyCostService.listAllCosts：按 vkId 分组返回
 * - /admin/virtual-keys/:id/cost 端点契约
 * - /admin/virtual-keys/costs 端点契约
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { VirtualKeyCostService } from '../src/services/virtual-key-cost.service.js';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { hashPassword } from '../src/services/admin-user.service.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick33-test.db`
    : `${process.cwd()}/data/freellm-tick33-test.db`,
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
    version: '1.7.5.0',
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

/** 准备 VK 行，避免触发 RequestLog → VirtualKey FK 约束。 */
async function seedVk(id: string): Promise<void> {
  await prisma.virtualKey.upsert({
    where: { id },
    update: {},
    create: {
      id,
      label: id,
      environment: 'test',
      prefix: `fllm_test_${id.slice(0, 6)}`,
      hash: `dummy-hash-${id}`,
      enabled: true,
    },
  });
}

describe('Tick 33 — VirtualKeyCostService.compute', () => {
  beforeEach(async () => {
    await prisma.requestLog.deleteMany();
    await prisma.virtualKey.deleteMany();
    await seedVk('vk_empty');
    await seedVk('vk_test');
    await seedVk('vk_a');
    await seedVk('vk_b');
    await seedVk('vk_cheap');
    await seedVk('vk_expensive');
    await seedVk('vk_x');
  });

  it('空数据 → totalCostUsd=0 + topModels=[]', async () => {
    const svc = new VirtualKeyCostService(prisma);
    const res = await svc.compute('vk_empty', 7);
    expect(res.virtualKeyId).toBe('vk_empty');
    expect(res.windowDays).toBe(7);
    expect(res.totalCostUsd).toBe(0);
    expect(res.totalRequests).toBe(0);
    expect(res.successfulRequests).toBe(0);
    expect(res.topModels).toEqual([]);
  });

  it('累加 estimatedCostUsd 跨多个 log', async () => {
    await prisma.requestLog.createMany({
      data: [
        {
          requestId: 'r1',
          virtualKeyId: 'vk_test',
          upstreamProvider: 'or',
          upstreamModel: 'deepseek/chat',
          status: 200,
          estimatedCostUsd: 0.01,
          startedAt: new Date(),
        },
        {
          requestId: 'r2',
          virtualKeyId: 'vk_test',
          upstreamProvider: 'or',
          upstreamModel: 'deepseek/chat',
          status: 200,
          estimatedCostUsd: 0.02,
          startedAt: new Date(),
        },
        {
          requestId: 'r3',
          virtualKeyId: 'vk_test',
          upstreamProvider: 'or',
          upstreamModel: 'cheap/model',
          status: 500,
          estimatedCostUsd: 0.001,
          startedAt: new Date(),
        },
      ],
    });
    const svc = new VirtualKeyCostService(prisma);
    const res = await svc.compute('vk_test', 7);
    expect(res.totalCostUsd).toBeCloseTo(0.031, 6);
    expect(res.totalRequests).toBe(3);
    expect(res.successfulRequests).toBe(2);
    expect(res.billableRequests).toBe(3);
    expect(res.topModels[0]!.upstreamModel).toBe('deepseek/chat');
    expect(res.topModels[0]!.costUsd).toBeCloseTo(0.03, 6);
    expect(res.topModels[0]!.requests).toBe(2);
  });

  it('窗口外 log 不计入', async () => {
    await prisma.requestLog.createMany({
      data: [
        {
          requestId: 'r-old',
          virtualKeyId: 'vk_test',
          upstreamProvider: 'or',
          upstreamModel: 'm',
          status: 200,
          estimatedCostUsd: 999,
          startedAt: new Date(Date.now() - 100 * 24 * 3600_000),
        },
        {
          requestId: 'r-new',
          virtualKeyId: 'vk_test',
          upstreamProvider: 'or',
          upstreamModel: 'm',
          status: 200,
          estimatedCostUsd: 0.5,
          startedAt: new Date(),
        },
      ],
    });
    const svc = new VirtualKeyCostService(prisma);
    const res = await svc.compute('vk_test', 7);
    expect(res.totalCostUsd).toBeCloseTo(0.5);
    expect(res.totalRequests).toBe(1);
  });

  it('estimatedCostUsd null 不计入 totalCost 但计入 totalRequests', async () => {
    await prisma.requestLog.createMany({
      data: [
        {
          requestId: 'r-free',
          virtualKeyId: 'vk_test',
          upstreamProvider: 'or',
          upstreamModel: 'free/model',
          status: 200,
          estimatedCostUsd: null,
          startedAt: new Date(),
        },
        {
          requestId: 'r-paid',
          virtualKeyId: 'vk_test',
          upstreamProvider: 'or',
          upstreamModel: 'paid/model',
          status: 200,
          estimatedCostUsd: 0.05,
          startedAt: new Date(),
        },
      ],
    });
    const svc = new VirtualKeyCostService(prisma);
    const res = await svc.compute('vk_test', 7);
    expect(res.totalCostUsd).toBeCloseTo(0.05);
    expect(res.totalRequests).toBe(2);
    expect(res.billableRequests).toBe(1);
  });

  it('不同 vk 完全隔离', async () => {
    await prisma.requestLog.createMany({
      data: [
        {
          requestId: 'a',
          virtualKeyId: 'vk_a',
          upstreamProvider: 'or',
          upstreamModel: 'x',
          status: 200,
          estimatedCostUsd: 1.23,
          startedAt: new Date(),
        },
        {
          requestId: 'b',
          virtualKeyId: 'vk_b',
          upstreamProvider: 'or',
          upstreamModel: 'y',
          status: 200,
          estimatedCostUsd: 4.56,
          startedAt: new Date(),
        },
      ],
    });
    const svc = new VirtualKeyCostService(prisma);
    const a = await svc.compute('vk_a', 7);
    const b = await svc.compute('vk_b', 7);
    expect(a.totalCostUsd).toBeCloseTo(1.23);
    expect(b.totalCostUsd).toBeCloseTo(4.56);
  });
});

describe('Tick 33 — VirtualKeyCostService.listAllCosts', () => {
  beforeEach(async () => {
    await prisma.requestLog.deleteMany();
    await prisma.virtualKey.deleteMany();
    await seedVk('vk_cheap');
    await seedVk('vk_expensive');
  });

  it('按 vkId 分组，按 cost 降序', async () => {
    await prisma.requestLog.createMany({
      data: [
        {
          requestId: 'a1',
          virtualKeyId: 'vk_cheap',
          upstreamModel: 'm',
          status: 200,
          estimatedCostUsd: 0.01,
          startedAt: new Date(),
        },
        {
          requestId: 'a2',
          virtualKeyId: 'vk_expensive',
          upstreamModel: 'm',
          status: 200,
          estimatedCostUsd: 1.0,
          startedAt: new Date(),
        },
        {
          requestId: 'a3',
          virtualKeyId: 'vk_expensive',
          upstreamModel: 'm',
          status: 200,
          estimatedCostUsd: 2.0,
          startedAt: new Date(),
        },
      ],
    });
    const svc = new VirtualKeyCostService(prisma);
    const list = await svc.listAllCosts(7);
    expect(list).toHaveLength(2);
    expect(list[0]!.virtualKeyId).toBe('vk_expensive');
    expect(list[0]!.costUsd).toBeCloseTo(3.0);
    expect(list[0]!.requests).toBe(2);
    expect(list[1]!.virtualKeyId).toBe('vk_cheap');
  });
});

describe('Tick 33 — /admin/virtual-keys/:id/cost 端点', () => {
  beforeEach(async () => {
    await prisma.requestLog.deleteMany();
    await prisma.virtualKey.deleteMany();
    await seedVk('vk_test');
    await seedVk('vk_x');
  });

  it('GET 单 VK cost → 200 + 默认 7 天', async () => {
    await prisma.requestLog.create({
      data: {
        requestId: 'x',
        virtualKeyId: 'vk_test',
        upstreamProvider: 'or',
        upstreamModel: 'm',
        status: 200,
        estimatedCostUsd: 0.5,
        startedAt: new Date(),
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/virtual-keys/vk_test/cost',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.virtualKeyId).toBe('vk_test');
    expect(body.windowDays).toBe(7);
    expect(body.totalCostUsd).toBeCloseTo(0.5);
  });

  it('?days=30 切窗口', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/virtual-keys/vk_test/cost?days=30',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().windowDays).toBe(30);
  });

  it('days > 90 → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/virtual-keys/vk_test/cost?days=999',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('GET /admin/virtual-keys/costs → 200 + 列表', async () => {
    await prisma.requestLog.create({
      data: {
        requestId: 'r1',
        virtualKeyId: 'vk_x',
        upstreamModel: 'm',
        status: 200,
        estimatedCostUsd: 0.1,
        startedAt: new Date(),
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/virtual-keys/costs',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.windowDays).toBe(7);
  });

  it('未登录 → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/virtual-keys/vk_test/cost' });
    expect(res.statusCode).toBe(401);
  });
});
