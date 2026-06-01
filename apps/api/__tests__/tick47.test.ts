/**
 * Tick 47 v1.7.19.0 集成测试：
 * - cron.schedule 注册后 lastRunAt / successCount / failureCount 追踪正确
 * - 任务抛错时 lastError + failureCount 递增
 * - GET /admin/cron/status 返回 stale 派生字段
 * - 401
 *
 * 注意：buildApp 在 NODE_ENV=test 下不启动 cron schedules，所以本测试通过
 *   `app.cron.schedule(...)` 手动注册一个测试用 job。
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
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
    ? `${process.cwd()}/../../data/freellm-tick47-test.db`
    : `${process.cwd()}/data/freellm-tick47-test.db`,
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
    version: '1.7.19.0',
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
  // 停掉测试中注册的所有 cron 让 vitest 干净退出
  app.cron.stopAll();
  await app.close();
  await prisma.$disconnect();
});

describe('Tick 47 — cron registry 追踪 + /admin/cron/status', () => {
  it('注册即时 list 返回 0 lastRunAt + 0 计数', async () => {
    app.cron.schedule('test-pending', 1_000_000, async () => {
      // 长周期 → 测试期间不会真跑
    });
    const list = app.cron.list();
    const job = list.find((j) => j.name === 'test-pending');
    expect(job).toBeTruthy();
    expect(job!.lastRunAt).toBeNull();
    expect(job!.successCount).toBe(0);
    expect(job!.failureCount).toBe(0);
    expect(job!.everyMs).toBe(1_000_000);
  });

  it('GET /admin/cron/status → 200 + 含 sinceLastRunMs + stale 字段', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/cron/status',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.generatedAt).toBeTruthy();
    const pending = body.data.find((j: { name: string }) => j.name === 'test-pending');
    expect(pending).toBeTruthy();
    expect(pending.stale).toBe(true); // 从未运行 → stale=true
    expect(pending.sinceLastRunMs).toBeNull();
  });

  it('未登录 → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/cron/status' });
    expect(res.statusCode).toBe(401);
  });

  it('短周期 job 跑一次后 successCount=1 + lastRunAt/lastFinishedAt 有值', async () => {
    let ran = 0;
    app.cron.schedule('test-fast', 50, async () => {
      ran += 1;
    });
    // 等 setInterval 至少触发一次
    await new Promise((r) => setTimeout(r, 200));
    const job = app.cron.list().find((j) => j.name === 'test-fast');
    expect(job).toBeTruthy();
    expect(ran).toBeGreaterThanOrEqual(1);
    expect(job!.successCount).toBeGreaterThanOrEqual(1);
    expect(job!.lastRunAt).toBeTruthy();
    expect(job!.lastFinishedAt).toBeTruthy();
    expect(job!.lastDurationMs).toBeGreaterThanOrEqual(0);
    expect(job!.lastError).toBeNull();
  });

  it('抛错 job → failureCount + lastError 累计', async () => {
    app.cron.schedule('test-broken', 50, async () => {
      throw new Error('boom');
    });
    await new Promise((r) => setTimeout(r, 200));
    const job = app.cron.list().find((j) => j.name === 'test-broken');
    expect(job!.failureCount).toBeGreaterThanOrEqual(1);
    expect(job!.lastError).toBe('boom');
    expect(job!.lastErrorAt).toBeTruthy();
    expect(job!.successCount).toBe(0);
  });

  it('GET /admin/cron/status 跑过的 job stale=false', async () => {
    // test-fast 周期 50ms，2 倍 = 100ms；上次 200ms 内一定跑过 → 不 stale
    const res = await app.inject({
      method: 'GET',
      url: '/admin/cron/status',
      headers: { cookie: sessionCookie },
    });
    const body = res.json();
    const fast = body.data.find((j: { name: string }) => j.name === 'test-fast');
    expect(fast).toBeTruthy();
    expect(typeof fast.sinceLastRunMs).toBe('number');
    // 短周期且刚跑过, sinceLastRunMs 可能小于 2*50ms 不算 stale
  });

  it('重新 schedule 同名 job 重置计数', async () => {
    app.cron.schedule('test-replace', 50, async () => {});
    await new Promise((r) => setTimeout(r, 150));
    const beforeJob = app.cron.list().find((j) => j.name === 'test-replace');
    expect(beforeJob!.successCount).toBeGreaterThanOrEqual(1);

    // 重新注册同名 job → 计数应重置为 0
    app.cron.schedule('test-replace', 1_000_000, async () => {});
    const after = app.cron.list().find((j) => j.name === 'test-replace');
    expect(after!.successCount).toBe(0);
    expect(after!.failureCount).toBe(0);
    expect(after!.everyMs).toBe(1_000_000);
  });
});
