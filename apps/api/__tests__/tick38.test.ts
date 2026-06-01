/**
 * Tick 38 v1.7.10.0 单元 + 集成测试：
 * - percentile 纯函数
 * - VirtualKeyReportService.buildMonthlyReport: totals / dailyBreakdown / topModels / errorBreakdown
 * - formatAsCsv 输出格式
 * - GET /admin/virtual-keys/:id/report (JSON) + .csv 端点
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import {
  VirtualKeyReportService,
  percentile,
} from '../src/services/virtual-key-report.service.js';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { hashPassword } from '../src/services/admin-user.service.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick38-test.db`
    : `${process.cwd()}/data/freellm-tick38-test.db`,
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

async function seedVk(id: string): Promise<void> {
  await prisma.virtualKey.upsert({
    where: { id },
    update: {},
    create: {
      id,
      label: id,
      environment: 'test',
      prefix: `fllm_test_${id.slice(0, 6)}`,
      hash: `dummy-${id}`,
      enabled: true,
    },
  });
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
    version: '1.7.10.0',
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

describe('Tick 38 — percentile 纯函数', () => {
  it('空数组 → 0', () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it('排序后取分位', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(6);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
  });
});

describe('Tick 38 — VirtualKeyReportService.buildMonthlyReport', () => {
  beforeEach(async () => {
    await prisma.requestLog.deleteMany();
    await prisma.virtualKey.deleteMany();
    await seedVk('vk_report_test');
  });

  it('空月 → totals 全 0 + 日桶按月天数', async () => {
    const svc = new VirtualKeyReportService(prisma);
    const r = await svc.buildMonthlyReport('vk_report_test', 2026, 5);
    expect(r.year).toBe(2026);
    expect(r.month).toBe(5);
    expect(r.daysInMonth).toBe(31); // 5 月 31 天
    expect(r.dailyBreakdown).toHaveLength(31);
    expect(r.totals.requests).toBe(0);
    expect(r.topModels).toEqual([]);
    expect(r.errorBreakdown).toEqual([]);
  });

  it('单月数据完整聚合', async () => {
    await prisma.requestLog.createMany({
      data: [
        {
          requestId: 'r1',
          virtualKeyId: 'vk_report_test',
          upstreamProvider: 'or',
          upstreamModel: 'deepseek/chat',
          status: 200,
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          durationMs: 100,
          estimatedCostUsd: 0.01,
          startedAt: new Date(Date.UTC(2026, 4, 5, 12, 0, 0)), // 5/5
        },
        {
          requestId: 'r2',
          virtualKeyId: 'vk_report_test',
          upstreamProvider: 'or',
          upstreamModel: 'deepseek/chat',
          status: 200,
          totalTokens: 50,
          durationMs: 200,
          estimatedCostUsd: 0.02,
          startedAt: new Date(Date.UTC(2026, 4, 5, 14, 0, 0)),
        },
        {
          requestId: 'r3',
          virtualKeyId: 'vk_report_test',
          upstreamProvider: 'or',
          upstreamModel: 'cheap/model',
          status: 502,
          errorKind: 'upstream_5xx',
          totalTokens: 10,
          durationMs: 50,
          startedAt: new Date(Date.UTC(2026, 4, 10, 12, 0, 0)),
        },
      ],
    });
    const svc = new VirtualKeyReportService(prisma);
    const r = await svc.buildMonthlyReport('vk_report_test', 2026, 5);
    expect(r.totals.requests).toBe(3);
    expect(r.totals.successful).toBe(2);
    expect(r.totals.failed).toBe(1);
    expect(r.totals.totalTokens).toBe(210);
    expect(r.totals.costUsd).toBeCloseTo(0.03, 6);
    expect(r.totals.avgLatencyMs).toBeGreaterThan(0);

    // day 5 应有 2 请求；day 10 应有 1
    expect(r.dailyBreakdown[4]!.requests).toBe(2);
    expect(r.dailyBreakdown[4]!.costUsd).toBeCloseTo(0.03, 6);
    expect(r.dailyBreakdown[9]!.requests).toBe(1);
    expect(r.dailyBreakdown[9]!.failed).toBe(1);

    // top models
    expect(r.topModels).toHaveLength(2);
    expect(r.topModels[0]!.upstreamModel).toBe('deepseek/chat');
    expect(r.topModels[0]!.costUsd).toBeCloseTo(0.03, 6);

    // error breakdown
    expect(r.errorBreakdown).toHaveLength(1);
    expect(r.errorBreakdown[0]!.errorKind).toBe('upstream_5xx');
  });

  it('跨月日志不计入', async () => {
    await prisma.requestLog.create({
      data: {
        requestId: 'cross',
        virtualKeyId: 'vk_report_test',
        upstreamProvider: 'or',
        upstreamModel: 'x',
        status: 200,
        totalTokens: 100,
        startedAt: new Date(Date.UTC(2026, 3, 30, 12, 0, 0)), // 4/30
      },
    });
    const svc = new VirtualKeyReportService(prisma);
    const r = await svc.buildMonthlyReport('vk_report_test', 2026, 5);
    expect(r.totals.requests).toBe(0);
  });

  it('formatAsCsv 包含三个段', async () => {
    await prisma.requestLog.create({
      data: {
        requestId: 'csv',
        virtualKeyId: 'vk_report_test',
        upstreamProvider: 'or',
        upstreamModel: 'm',
        status: 200,
        totalTokens: 100,
        estimatedCostUsd: 0.001,
        startedAt: new Date(Date.UTC(2026, 4, 1, 12, 0, 0)),
      },
    });
    const svc = new VirtualKeyReportService(prisma);
    const r = await svc.buildMonthlyReport('vk_report_test', 2026, 5);
    const csv = svc.formatAsCsv(r);
    expect(csv).toContain('## Totals');
    expect(csv).toContain('## Daily Breakdown');
    expect(csv).toContain('## Top Models');
    expect(csv).toContain('## Error Breakdown');
    expect(csv).toContain('vk_report_test');
  });

  it('month=2 (2026 是平年) → 28 天', async () => {
    const svc = new VirtualKeyReportService(prisma);
    const r = await svc.buildMonthlyReport('vk_report_test', 2026, 2);
    expect(r.daysInMonth).toBe(28);
  });
});

describe('Tick 38 — /admin/virtual-keys/:id/report 端点', () => {
  beforeEach(async () => {
    await prisma.requestLog.deleteMany();
    await prisma.virtualKey.deleteMany();
    await seedVk('vk_endpoint');
  });

  it('GET JSON → 200 + totals', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/virtual-keys/vk_endpoint/report?month=2026-05',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.virtualKeyId).toBe('vk_endpoint');
    expect(body.year).toBe(2026);
    expect(body.month).toBe(5);
    expect(body.totals).toBeDefined();
  });

  it('GET .csv → 200 + text/csv + Content-Disposition', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/virtual-keys/vk_endpoint/report.csv?month=2026-05',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('vk-report-vk_endpoint-2026-05.csv');
    expect(res.body).toContain('## Totals');
  });

  it('未知月份格式 → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/virtual-keys/vk_endpoint/report?month=2026-13',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('未登录 → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/virtual-keys/vk_endpoint/report?month=2026-05',
    });
    expect(res.statusCode).toBe(401);
  });
});
