/**
 * Tick 39 v1.7.11.0 单元 + 集成测试：
 * - getUsageSnapshot 各场景（无限额 / 低用量 / 接近上限 / 不存在 VK）
 * - checkAll 阈值触发 + 24h 防重复 + ErrorEvent 落库
 * - 3 个端点契约
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { VkUsageAlertService } from '../src/services/vk-usage-alert.service.js';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { hashPassword } from '../src/services/admin-user.service.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick39-test.db`
    : `${process.cwd()}/data/freellm-tick39-test.db`,
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

async function seedVk(
  id: string,
  opts: { maxRequestsPerDay?: number | null; maxTokensPerDay?: number | null } = {},
): Promise<void> {
  await prisma.virtualKey.upsert({
    where: { id },
    update: {
      maxRequestsPerDay: opts.maxRequestsPerDay ?? null,
      maxTokensPerDay: opts.maxTokensPerDay ?? null,
    },
    create: {
      id,
      label: id,
      environment: 'test',
      prefix: `fllm_test_${id.slice(0, 6)}`,
      hash: `dummy-${id}`,
      enabled: true,
      maxRequestsPerDay: opts.maxRequestsPerDay ?? null,
      maxTokensPerDay: opts.maxTokensPerDay ?? null,
    },
  });
}

async function seedRequestLogs(vkId: string, count: number, tokensEach = 0): Promise<void> {
  const data = Array.from({ length: count }, (_, i) => ({
    requestId: `${vkId}-${Date.now()}-${i}`,
    virtualKeyId: vkId,
    upstreamProvider: 'or',
    upstreamModel: 'm',
    status: 200,
    totalTokens: tokensEach,
    startedAt: new Date(),
  }));
  for (const d of data) {
    await prisma.requestLog.create({ data: d });
  }
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
    version: '1.7.11.0',
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

describe('Tick 39 — getUsageSnapshot', () => {
  beforeEach(async () => {
    await prisma.requestLog.deleteMany();
    await prisma.virtualKey.deleteMany();
  });

  it('不存在的 VK → null', async () => {
    const svc = new VkUsageAlertService(prisma);
    expect(await svc.getUsageSnapshot('no-such-vk')).toBeNull();
  });

  it('无限额 VK → usagePct 全 null + approachingLimit=false', async () => {
    await seedVk('vk_unlimited');
    await seedRequestLogs('vk_unlimited', 100, 1000);
    const svc = new VkUsageAlertService(prisma);
    const s = await svc.getUsageSnapshot('vk_unlimited');
    expect(s!.requestsToday).toBe(100);
    expect(s!.tokensToday).toBe(100_000);
    expect(s!.requestUsagePct).toBeNull();
    expect(s!.tokenUsagePct).toBeNull();
    expect(s!.approachingLimit).toBe(false);
  });

  it('请求用量 30% → approachingLimit=false', async () => {
    await seedVk('vk_low', { maxRequestsPerDay: 100 });
    await seedRequestLogs('vk_low', 30);
    const svc = new VkUsageAlertService(prisma);
    const s = await svc.getUsageSnapshot('vk_low');
    expect(s!.requestUsagePct).toBeCloseTo(0.3);
    expect(s!.approachingLimit).toBe(false);
  });

  it('请求用量 85% → approachingLimit=true', async () => {
    await seedVk('vk_hot', { maxRequestsPerDay: 100 });
    await seedRequestLogs('vk_hot', 85);
    const svc = new VkUsageAlertService(prisma);
    const s = await svc.getUsageSnapshot('vk_hot');
    expect(s!.requestUsagePct).toBeCloseTo(0.85);
    expect(s!.approachingLimit).toBe(true);
  });

  it('token 用量 90% → approachingLimit=true', async () => {
    await seedVk('vk_tk', { maxTokensPerDay: 10_000 });
    await seedRequestLogs('vk_tk', 9, 1000);
    const svc = new VkUsageAlertService(prisma);
    const s = await svc.getUsageSnapshot('vk_tk');
    expect(s!.tokenUsagePct).toBeCloseTo(0.9);
    expect(s!.approachingLimit).toBe(true);
  });
});

describe('Tick 39 — checkAll', () => {
  beforeEach(async () => {
    await prisma.errorEvent.deleteMany();
    await prisma.requestLog.deleteMany();
    await prisma.virtualKey.deleteMany();
    // 清掉全局 alertCache（module 级单例）让每个测试独立
    new VkUsageAlertService(prisma)._resetAlertCache();
  });

  it('无限额 VK 全不告警', async () => {
    await seedVk('vk_a');
    await seedVk('vk_b');
    const svc = new VkUsageAlertService(prisma);
    const r = await svc.checkAll();
    expect(r.scanned).toBe(0); // findMany where requires non-null limit
    expect(r.alertedVks).toEqual([]);
  });

  it('超阈值 → 告警 + 写 ErrorEvent', async () => {
    await seedVk('vk_overlimit', { maxRequestsPerDay: 100 });
    await seedRequestLogs('vk_overlimit', 95);
    const svc = new VkUsageAlertService(prisma);
    const r = await svc.checkAll();
    expect(r.scanned).toBe(1);
    expect(r.alertedVks).toHaveLength(1);
    expect(r.alertedVks[0]!.metric).toBe('requests');
    expect(r.alertedVks[0]!.consumed).toBe(95);
    expect(r.alertedVks[0]!.limit).toBe(100);
    expect(r.alertedVks[0]!.usagePct).toBeCloseTo(0.95);

    const events = await prisma.errorEvent.findMany({ where: { kind: 'vk_usage_alert' } });
    expect(events).toHaveLength(1);
    expect(events[0]!.severity).toBe('warn');
    expect(events[0]!.message).toContain('vk_overlimit');
  });

  it('24h 内重复 checkAll 不再次告警', async () => {
    await seedVk('vk_dup', { maxRequestsPerDay: 100 });
    await seedRequestLogs('vk_dup', 95);
    const svc = new VkUsageAlertService(prisma);
    const r1 = await svc.checkAll();
    expect(r1.alertedVks).toHaveLength(1);
    const r2 = await svc.checkAll();
    expect(r2.alertedVks).toHaveLength(0); // cooldown
    const events = await prisma.errorEvent.findMany({ where: { kind: 'vk_usage_alert' } });
    expect(events).toHaveLength(1);
  });

  it('requests 和 tokens 分别独立告警 (同 VK 两条)', async () => {
    await seedVk('vk_both', { maxRequestsPerDay: 100, maxTokensPerDay: 10_000 });
    await seedRequestLogs('vk_both', 90, 100); // 90 请求 + 9000 tokens (90%)
    const svc = new VkUsageAlertService(prisma);
    const r = await svc.checkAll();
    expect(r.alertedVks).toHaveLength(2);
    const metrics = r.alertedVks.map((a) => a.metric).sort();
    expect(metrics).toEqual(['requests', 'tokens']);
  });

  it('listRecentAlerts 倒序', async () => {
    await prisma.errorEvent.create({
      data: { kind: 'vk_usage_alert', severity: 'warn', message: 'first', detailsJson: '{"virtualKeyId":"v1"}', createdAt: new Date(Date.now() - 60_000) },
    });
    await prisma.errorEvent.create({
      data: { kind: 'vk_usage_alert', severity: 'warn', message: 'second', detailsJson: '{"virtualKeyId":"v2"}' },
    });
    const svc = new VkUsageAlertService(prisma);
    const alerts = await svc.listRecentAlerts();
    expect(alerts).toHaveLength(2);
    expect(alerts[0]!.message).toBe('second');
    expect(alerts[0]!.virtualKeyId).toBe('v2');
  });
});

describe('Tick 39 — 端点', () => {
  beforeEach(async () => {
    await prisma.errorEvent.deleteMany();
    await prisma.requestLog.deleteMany();
    await prisma.virtualKey.deleteMany();
    new VkUsageAlertService(prisma)._resetAlertCache();
    await seedVk('vk_test', { maxRequestsPerDay: 100 });
  });

  it('GET /admin/virtual-keys/:id/usage → 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/virtual-keys/vk_test/usage',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.virtualKeyId).toBe('vk_test');
    expect(body.maxRequestsPerDay).toBe(100);
  });

  it('POST /admin/virtual-keys/alerts/check → 200 + 报告', async () => {
    await seedRequestLogs('vk_test', 85);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/virtual-keys/alerts/check',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scanned).toBeGreaterThanOrEqual(1);
    expect(body.alertedVks.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /admin/virtual-keys/alerts/recent → 200 + 列表', async () => {
    await prisma.errorEvent.create({
      data: { kind: 'vk_usage_alert', severity: 'warn', message: 'test' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/virtual-keys/alerts/recent',
      headers: { cookie: sessionCookie },
    });
    const body = res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('未登录 → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/virtual-keys/alerts/check',
    });
    expect(res.statusCode).toBe(401);
  });
});
