/**
 * Tick 49 v1.7.21.0 集成测试 — Logs 错误率趋势：
 *  - bucketByStatus 正确把 2xx/4xx/5xx/null 分桶
 *  - aggregateSummary 整窗口聚合 + 派生 rate 字段
 *  - makeEmptyBuckets 1h/24h/7d 个数正确
 *  - service build() 整链路（写 RequestLog → bucket → 派生）
 *  - GET /admin/metrics/error-rate-timeseries 端点 + 5s TTL 缓存
 *  - 默认 window 24h
 *  - 未登录 401
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
import {
  ErrorRateTimeseriesService,
  makeEmptyBuckets,
  bucketByStatus,
  aggregateSummary,
} from '../src/services/error-rate-timeseries.service.js';
import { invalidateErrorRateCache } from '../src/routes/admin/error-rate-timeseries.routes.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick49-test.db`
    : `${process.cwd()}/data/freellm-tick49-test.db`,
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
    version: '1.7.21.0',
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
  app.cron.stopAll();
  await app.close();
  await prisma.$disconnect();
});

beforeEach(() => {
  invalidateErrorRateCache();
});

describe('Tick 49 — makeEmptyBuckets / bucketByStatus / aggregateSummary 单元', () => {
  it('makeEmptyBuckets 1h=60 / 24h=24 / 7d=7', () => {
    const now = new Date('2026-05-23T12:00:00Z');
    expect(makeEmptyBuckets('1h', now)).toHaveLength(60);
    expect(makeEmptyBuckets('24h', now)).toHaveLength(24);
    expect(makeEmptyBuckets('7d', now)).toHaveLength(7);
    // bucket 时间从旧到新单调递增
    const buckets = makeEmptyBuckets('24h', now);
    for (let i = 1; i < buckets.length; i += 1) {
      expect(new Date(buckets[i]!.t).getTime()).toBeGreaterThan(new Date(buckets[i - 1]!.t).getTime());
    }
  });

  it('bucketByStatus 把 200/404/500/null 分桶并算 rate', () => {
    const now = new Date('2026-05-23T12:00:00Z');
    const buckets = makeEmptyBuckets('24h', now);
    const bucket0Start = new Date(buckets[0]!.t).getTime();
    const rows = [
      { startedAt: new Date(bucket0Start + 100), status: 200 },
      { startedAt: new Date(bucket0Start + 200), status: 200 },
      { startedAt: new Date(bucket0Start + 300), status: 404 },
      { startedAt: new Date(bucket0Start + 400), status: 500 },
      { startedAt: new Date(bucket0Start + 500), status: null },
    ];
    bucketByStatus(rows, buckets, 60 * 60_000);
    const b0 = buckets[0]!;
    expect(b0.total).toBe(5);
    expect(b0.status2xx).toBe(2);
    expect(b0.status4xx).toBe(1);
    expect(b0.status5xx).toBe(1);
    expect(b0.statusNull).toBe(1);
    // 失败 = 4xx + 5xx + null = 3 / 5 = 0.6
    expect(b0.errorRate).toBeCloseTo(0.6);
    expect(b0.clientErrorRate).toBeCloseTo(0.2);
    expect(b0.serverErrorRate).toBeCloseTo(0.2);
  });

  it('bucketByStatus 越界 row 跳过', () => {
    const now = new Date('2026-05-23T12:00:00Z');
    const buckets = makeEmptyBuckets('1h', now);
    const bucket0Start = new Date(buckets[0]!.t).getTime();
    bucketByStatus(
      [
        { startedAt: new Date(bucket0Start - 10_000_000), status: 200 },
        { startedAt: new Date(bucket0Start + 30 * 60_000), status: 200 },
      ],
      buckets,
      60_000,
    );
    const totals = buckets.reduce((acc, b) => acc + b.total, 0);
    expect(totals).toBe(1); // 只有第二行落在窗口内
  });

  it('aggregateSummary 跨桶累加 + 派生 rate', () => {
    const now = new Date('2026-05-23T12:00:00Z');
    const buckets = makeEmptyBuckets('24h', now);
    const bucket0Start = new Date(buckets[0]!.t).getTime();
    bucketByStatus(
      [
        { startedAt: new Date(bucket0Start + 100), status: 200 },
        { startedAt: new Date(bucket0Start + 60 * 60_000 + 100), status: 500 },
        { startedAt: new Date(bucket0Start + 60 * 60_000 + 200), status: 500 },
      ],
      buckets,
      60 * 60_000,
    );
    const sum = aggregateSummary(buckets);
    expect(sum.total).toBe(3);
    expect(sum.status2xx).toBe(1);
    expect(sum.status5xx).toBe(2);
    expect(sum.errorRate).toBeCloseTo(2 / 3, 3);
    expect(sum.serverErrorRate).toBeCloseTo(2 / 3, 3);
    expect(sum.clientErrorRate).toBe(0);
  });

  it('aggregateSummary 空桶 → 全 0 rate', () => {
    const sum = aggregateSummary(makeEmptyBuckets('1h', new Date()));
    expect(sum.total).toBe(0);
    expect(sum.errorRate).toBe(0);
    expect(sum.clientErrorRate).toBe(0);
    expect(sum.serverErrorRate).toBe(0);
  });
});

describe('Tick 49 — service.build() 端到端', () => {
  beforeEach(async () => {
    await prisma.requestLog.deleteMany({});
  });

  it('空表 → summary 全 0', async () => {
    const svc = new ErrorRateTimeseriesService(prisma);
    const payload = await svc.build('24h');
    expect(payload.window).toBe('24h');
    expect(payload.buckets.length).toBe(24);
    expect(payload.summary.total).toBe(0);
    expect(payload.summary.errorRate).toBe(0);
  });

  it('写 RequestLog → build 反映到 summary 与 buckets', async () => {
    const now = new Date();
    await prisma.requestLog.createMany({
      data: [
        { requestId: 'req_a1', startedAt: new Date(now.getTime() - 5 * 60_000), status: 200 },
        { requestId: 'req_a2', startedAt: new Date(now.getTime() - 10 * 60_000), status: 200 },
        { requestId: 'req_a3', startedAt: new Date(now.getTime() - 15 * 60_000), status: 503 },
        { requestId: 'req_a4', startedAt: new Date(now.getTime() - 20 * 60_000), status: 400 },
      ],
    });
    const svc = new ErrorRateTimeseriesService(prisma);
    const payload = await svc.build('1h');
    expect(payload.summary.total).toBe(4);
    expect(payload.summary.status2xx).toBe(2);
    expect(payload.summary.status4xx).toBe(1);
    expect(payload.summary.status5xx).toBe(1);
    expect(payload.summary.errorRate).toBeCloseTo(0.5, 3);
  });
});

describe('Tick 49 — GET /admin/metrics/error-rate-timeseries 端点', () => {
  it('GET → 200 + 含 summary + buckets', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/metrics/error-rate-timeseries?window=24h',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.window).toBe('24h');
    expect(Array.isArray(body.buckets)).toBe(true);
    expect(body.buckets.length).toBe(24);
    expect(body.summary).toBeTruthy();
    expect(typeof body.summary.errorRate).toBe('number');
  });

  it('默认 window=24h', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/metrics/error-rate-timeseries',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().window).toBe('24h');
  });

  it('window=1h 返回 60 个桶', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/metrics/error-rate-timeseries?window=1h',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().buckets.length).toBe(60);
  });

  it('未登录 → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/metrics/error-rate-timeseries',
    });
    expect(res.statusCode).toBe(401);
  });
});
