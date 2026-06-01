/**
 * Tick 41 v1.7.13.0 单元 + 集成测试：
 * - VkUsageWeeklyReportService.generate 全 VK 周聚合
 * - maybeSendWeekly 周一上午发送 + 非周一/同周 skip
 * - forceSend 无视限制
 * - getLastSentAt 持久化
 * - 端点契约（GET preview + POST send）
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { VkUsageWeeklyReportService } from '../src/services/vk-usage-weekly-report.service.js';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { hashPassword } from '../src/services/admin-user.service.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick41-test.db`
    : `${process.cwd()}/data/freellm-tick41-test.db`,
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

async function seedLog(opts: {
  vkId?: string;
  status?: number;
  cost?: number | null;
  tokens?: number;
  at?: Date;
}): Promise<void> {
  await prisma.requestLog.create({
    data: {
      requestId: `r-${Math.random().toString(36).slice(2)}`,
      ...(opts.vkId ? { virtualKeyId: opts.vkId } : {}),
      upstreamProvider: 'or',
      upstreamModel: 'm',
      status: opts.status ?? 200,
      totalTokens: opts.tokens ?? 100,
      estimatedCostUsd: opts.cost ?? null,
      startedAt: opts.at ?? new Date(),
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
    version: '1.7.13.0',
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
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Tick 41 — VkUsageWeeklyReportService.generate', () => {
  beforeEach(async () => {
    await prisma.errorEvent.deleteMany();
    await prisma.requestLog.deleteMany();
    await prisma.virtualKey.deleteMany();
    await prisma.setting.deleteMany();
  });

  it('空数据 → totals 全 0 + topVks 空', async () => {
    const svc = new VkUsageWeeklyReportService(prisma);
    const r = await svc.generate();
    expect(r.totals.requests).toBe(0);
    expect(r.totals.costUsd).toBe(0);
    expect(r.topVks).toEqual([]);
    expect(r.alertedVkSummary).toEqual([]);
  });

  it('完整聚合：totals + topVks 按 cost 降序 + activeVks 计数', async () => {
    await seedVk('vk_a');
    await seedVk('vk_b');
    await seedLog({ vkId: 'vk_a', cost: 0.5, tokens: 100, status: 200 });
    await seedLog({ vkId: 'vk_a', cost: 0.3, tokens: 50, status: 200 });
    await seedLog({ vkId: 'vk_b', cost: 0.1, tokens: 30, status: 502 });
    const svc = new VkUsageWeeklyReportService(prisma);
    const r = await svc.generate();
    expect(r.totals.requests).toBe(3);
    expect(r.totals.successful).toBe(2);
    expect(r.totals.failed).toBe(1);
    expect(r.totals.costUsd).toBeCloseTo(0.9, 6);
    expect(r.totals.activeVks).toBe(2);
    expect(r.topVks).toHaveLength(2);
    expect(r.topVks[0]!.label).toBe('vk_a');
    expect(r.topVks[0]!.costUsd).toBeCloseTo(0.8, 6);
  });

  it('窗口外日志不计入', async () => {
    await seedVk('vk_old');
    await seedLog({
      vkId: 'vk_old',
      cost: 5.0,
      at: new Date(Date.now() - 30 * 24 * 3600_000),
    });
    const svc = new VkUsageWeeklyReportService(prisma);
    const r = await svc.generate();
    expect(r.totals.requests).toBe(0);
    expect(r.totals.costUsd).toBe(0);
  });

  it('alertedVkSummary 从 ErrorEvent 抽 virtualKeyId', async () => {
    await seedVk('vk_x');
    await prisma.errorEvent.createMany({
      data: [
        {
          kind: 'vk_usage_alert',
          severity: 'warn',
          message: 'm1',
          detailsJson: '{"virtualKeyId":"vk_x"}',
        },
        {
          kind: 'vk_usage_alert',
          severity: 'warn',
          message: 'm2',
          detailsJson: '{"virtualKeyId":"vk_x"}',
        },
      ],
    });
    const svc = new VkUsageWeeklyReportService(prisma);
    const r = await svc.generate();
    expect(r.totals.alertedVks).toBe(1);
    expect(r.alertedVkSummary).toHaveLength(1);
    expect(r.alertedVkSummary[0]!.count).toBe(2);
  });
});

describe('Tick 41 — maybeSendWeekly 窗口判定', () => {
  beforeEach(async () => {
    await prisma.setting.deleteMany();
  });

  // UTC: 2026-05-25 (Mon) 09:00 UTC
  const mondayMorning = new Date(Date.UTC(2026, 4, 25, 9, 0, 0));
  // UTC: 2026-05-26 (Tue) 09:00 UTC
  const tuesdayMorning = new Date(Date.UTC(2026, 4, 26, 9, 0, 0));
  // UTC: 2026-05-25 (Mon) 13:00 UTC (window-closed)
  const mondayAfternoon = new Date(Date.UTC(2026, 4, 25, 13, 0, 0));

  it('周二 → not-monday', async () => {
    const svc = new VkUsageWeeklyReportService(prisma);
    const r = await svc.maybeSendWeekly(tuesdayMorning);
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('not-monday');
  });

  it('周一下午 13:00 → window-closed', async () => {
    const svc = new VkUsageWeeklyReportService(prisma);
    const r = await svc.maybeSendWeekly(mondayAfternoon);
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('window-closed');
  });

  it('周一上午首次 → sent + 更新 lastSentAt', async () => {
    const svc = new VkUsageWeeklyReportService(prisma);
    const r = await svc.maybeSendWeekly(mondayMorning);
    expect(r.sent).toBe(true);
    expect(r.report).toBeDefined();
    const last = await svc.getLastSentAt();
    expect(last?.getTime()).toBe(mondayMorning.getTime());
  });

  it('同周再次触发 → too-soon', async () => {
    const svc = new VkUsageWeeklyReportService(prisma);
    await svc.maybeSendWeekly(mondayMorning);
    // 2 小时后再尝试
    const later = new Date(mondayMorning.getTime() + 2 * 60 * 60_000);
    const r = await svc.maybeSendWeekly(later);
    // 不在窗口（已超 12 点） → window-closed；或 too-soon
    expect(r.sent).toBe(false);
  });

  it('forceSend 无视周一限制 + 更新 lastSentAt', async () => {
    const svc = new VkUsageWeeklyReportService(prisma);
    const r = await svc.forceSend(tuesdayMorning);
    expect(r.totals).toBeDefined();
    const last = await svc.getLastSentAt();
    expect(last?.getTime()).toBe(tuesdayMorning.getTime());
  });
});

describe('Tick 41 — 端点', () => {
  beforeEach(async () => {
    await prisma.requestLog.deleteMany();
    await prisma.setting.deleteMany();
  });

  it('GET /admin/virtual-keys/weekly-report → 200 + report + lastSentAt', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/virtual-keys/weekly-report',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.report).toBeDefined();
    expect(body.report.totals).toBeDefined();
    expect(body.lastSentAt).toBeNull();
  });

  it('POST /admin/virtual-keys/weekly-report/send → 200 + 更新 lastSentAt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/virtual-keys/weekly-report/send',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    // 再 GET 一次确认 lastSentAt 不再 null
    const preview = await app.inject({
      method: 'GET',
      url: '/admin/virtual-keys/weekly-report',
      headers: { cookie: sessionCookie },
    });
    expect(preview.json().lastSentAt).toBeTruthy();
  });

  it('未登录 → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/virtual-keys/weekly-report/send',
    });
    expect(res.statusCode).toBe(401);
  });
});
