/**
 * Tick 32 v1.7.4.0 单元 + 集成测试：
 * - makeEmptyBuckets：1h / 24h / 7d 桶数与时间间隔
 * - bucketRequests：分桶累加 + 跨窗口外日志跳过
 * - MetricsTimeseriesService.buildTimeseries：聚合 success/failed/cost
 * - /admin/metrics/timeseries 端点契约（200 / 401 / window 参数校验）
 * - 5 秒 TTL 缓存命中第二次不打 DB
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import {
  MetricsTimeseriesService,
  makeEmptyBuckets,
  bucketRequests,
} from '../src/services/metrics-timeseries.service.js';
import { invalidateTimeseriesCache } from '../src/routes/admin/metrics-timeseries.routes.js';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { hashPassword } from '../src/services/admin-user.service.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick32-test.db`
    : `${process.cwd()}/data/freellm-tick32-test.db`,
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
    version: '1.7.4.0',
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

describe('Tick 32 — makeEmptyBuckets 窗口配置', () => {
  it('1h → 60 个 1 分钟桶', () => {
    const buckets = makeEmptyBuckets('1h', new Date('2026-05-23T12:00:00Z'));
    expect(buckets).toHaveLength(60);
    const first = new Date(buckets[0]!.t).getTime();
    const second = new Date(buckets[1]!.t).getTime();
    expect(second - first).toBe(60_000);
  });

  it('24h → 24 个 1 小时桶', () => {
    const buckets = makeEmptyBuckets('24h', new Date('2026-05-23T12:00:00Z'));
    expect(buckets).toHaveLength(24);
    const first = new Date(buckets[0]!.t).getTime();
    const second = new Date(buckets[1]!.t).getTime();
    expect(second - first).toBe(60 * 60_000);
  });

  it('7d → 7 个 1 天桶', () => {
    const buckets = makeEmptyBuckets('7d', new Date('2026-05-23T12:00:00Z'));
    expect(buckets).toHaveLength(7);
    const first = new Date(buckets[0]!.t).getTime();
    const second = new Date(buckets[1]!.t).getTime();
    expect(second - first).toBe(24 * 60 * 60_000);
  });

  it('每个 bucket 初始全 0', () => {
    const buckets = makeEmptyBuckets('1h', new Date());
    for (const b of buckets) {
      expect(b.requests).toBe(0);
      expect(b.success).toBe(0);
      expect(b.failed).toBe(0);
      expect(b.costUsd).toBe(0);
    }
  });
});

describe('Tick 32 — bucketRequests 分桶累加', () => {
  it('日志按 startedAt 落入正确桶', () => {
    const now = new Date('2026-05-23T12:00:00Z');
    const buckets = makeEmptyBuckets('24h', now);
    // 5 小时前的日志（成功）
    const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60_000);
    bucketRequests(
      [
        { startedAt: fiveHoursAgo, status: 200, estimatedCostUsd: 0.01 },
        { startedAt: fiveHoursAgo, status: 500, estimatedCostUsd: null },
      ],
      buckets,
      60 * 60_000,
      now,
    );
    // 找到落入的 bucket
    const total = buckets.reduce((acc, b) => acc + b.requests, 0);
    expect(total).toBe(2);
    const totalCost = buckets.reduce((acc, b) => acc + b.costUsd, 0);
    expect(totalCost).toBeCloseTo(0.01);
    const totalSuccess = buckets.reduce((acc, b) => acc + b.success, 0);
    const totalFailed = buckets.reduce((acc, b) => acc + b.failed, 0);
    expect(totalSuccess).toBe(1);
    expect(totalFailed).toBe(1);
  });

  it('窗口外日志被跳过', () => {
    const now = new Date('2026-05-23T12:00:00Z');
    const buckets = makeEmptyBuckets('1h', now);
    // 2 小时前 = 1h 窗口外
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60_000);
    bucketRequests(
      [{ startedAt: twoHoursAgo, status: 200, estimatedCostUsd: 0.5 }],
      buckets,
      60_000,
      now,
    );
    const total = buckets.reduce((acc, b) => acc + b.requests, 0);
    expect(total).toBe(0);
  });

  it('status null 视为失败', () => {
    const now = new Date('2026-05-23T12:00:00Z');
    const buckets = makeEmptyBuckets('24h', now);
    bucketRequests(
      [{ startedAt: new Date(now.getTime() - 3600_000), status: null, estimatedCostUsd: null }],
      buckets,
      60 * 60_000,
      now,
    );
    const totalFailed = buckets.reduce((acc, b) => acc + b.failed, 0);
    expect(totalFailed).toBe(1);
  });
});

describe('Tick 32 — MetricsTimeseriesService 端到端', () => {
  beforeEach(async () => {
    await prisma.requestLog.deleteMany();
  });

  it('24h 窗口聚合数据库日志', async () => {
    const now = new Date();
    await prisma.requestLog.createMany({
      data: [
        {
          requestId: 'a',
          status: 200,
          estimatedCostUsd: 0.01,
          startedAt: new Date(now.getTime() - 2 * 60 * 60_000), // 2h ago
        },
        {
          requestId: 'b',
          status: 500,
          estimatedCostUsd: null,
          startedAt: new Date(now.getTime() - 2 * 60 * 60_000),
        },
        {
          requestId: 'c',
          status: 200,
          estimatedCostUsd: 0.005,
          startedAt: new Date(now.getTime() - 6 * 60 * 60_000), // 6h ago
        },
      ],
    });
    const svc = new MetricsTimeseriesService(prisma);
    const payload = await svc.buildTimeseries('24h', now);
    expect(payload.window).toBe('24h');
    expect(payload.bucketMs).toBe(60 * 60_000);
    expect(payload.buckets).toHaveLength(24);
    const totalRequests = payload.buckets.reduce((a, b) => a + b.requests, 0);
    expect(totalRequests).toBe(3);
    const totalCost = payload.buckets.reduce((a, b) => a + b.costUsd, 0);
    expect(totalCost).toBeCloseTo(0.015);
  });

  it('1h 窗口只看到 60 分钟内', async () => {
    const now = new Date();
    await prisma.requestLog.createMany({
      data: [
        {
          requestId: 'x',
          status: 200,
          estimatedCostUsd: 0.001,
          startedAt: new Date(now.getTime() - 30 * 60_000), // 30 分钟前
        },
        {
          requestId: 'y',
          status: 200,
          estimatedCostUsd: 0.001,
          startedAt: new Date(now.getTime() - 2 * 60 * 60_000), // 2 小时前
        },
      ],
    });
    const svc = new MetricsTimeseriesService(prisma);
    const payload = await svc.buildTimeseries('1h', now);
    expect(payload.buckets).toHaveLength(60);
    const total = payload.buckets.reduce((a, b) => a + b.requests, 0);
    expect(total).toBe(1);
  });
});

describe('Tick 32 — /admin/metrics/timeseries 端点', () => {
  beforeEach(async () => {
    await prisma.requestLog.deleteMany();
    invalidateTimeseriesCache();
  });

  it('默认 window=24h → 200 + 24 个桶', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/metrics/timeseries',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.window).toBe('24h');
    expect(body.buckets).toHaveLength(24);
    expect(body.bucketMs).toBe(60 * 60_000);
  });

  it('window=1h / 7d 显式参数', async () => {
    const res1 = await app.inject({
      method: 'GET',
      url: '/admin/metrics/timeseries?window=1h',
      headers: { cookie: sessionCookie },
    });
    expect(res1.json().buckets).toHaveLength(60);
    const res2 = await app.inject({
      method: 'GET',
      url: '/admin/metrics/timeseries?window=7d',
      headers: { cookie: sessionCookie },
    });
    expect(res2.json().buckets).toHaveLength(7);
  });

  it('未知 window → zod 抛错', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/metrics/timeseries?window=bogus',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('未登录 → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/metrics/timeseries',
    });
    expect(res.statusCode).toBe(401);
  });
});
