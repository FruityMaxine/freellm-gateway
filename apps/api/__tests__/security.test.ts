/**
 * Tick 12 安全加固回归测试。
 * 每个用例对应 audit-report.md 中的 P0/P1 编号，便于追溯。
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
import { AdminUserService } from '../src/services/admin-user.service.js';
import { VirtualKeyService } from '../src/services/virtual-key.service.js';
import { encryptSecret, decryptSecret, hashApiKey, timingSafeEqualHex, prompt12 } from '@freellm/shared';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-security-test.db`
    : `${process.cwd()}/data/freellm-security-test.db`,
);
let app: FastifyInstance;
let prisma: PrismaClient;

beforeAll(async () => {
  for (const ext of ['', '-journal', '-wal', '-shm']) {
    const p = `${TEST_DB}${ext}`;
    if (existsSync(p)) rmSync(p);
  }
  mkdirSync('./data', { recursive: true });
  execSync(
    `DATABASE_URL=\"file:${TEST_DB}\" npx prisma db push --schema prisma/schema.prisma --skip-generate --accept-data-loss`,
    {
      cwd: process.cwd().endsWith('/apps/api') ? `${process.cwd()}/../..` : process.cwd(),
      stdio: 'pipe',
    },
  );
  process.env.DATABASE_URL = `file:${TEST_DB}`;
  _setConfigForTests({
    version: '0.9.0.0',
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
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Tick 12 安全加固回归', () => {
  it('P0-1 admin cookie helper 写入 SameSite=Strict + HttpOnly', () => {
    // 直接验证 helper 函数行为（避免依赖完整登录链路）。
    const replyStub: { headers: Record<string, string> } = { headers: {} };
    const reply = {
      header: (k: string, v: string) => {
        replyStub.headers[k] = v;
      },
    } as unknown as Parameters<typeof import('../src/plugins/admin-auth.js')['setSessionCookie']>[0];
    const setSessionCookie = (mod: typeof import('../src/plugins/admin-auth.js')) => mod.setSessionCookie;
    return import('../src/plugins/admin-auth.js').then((mod) => {
      const sc = setSessionCookie(mod);
      sc(reply, 'plain-token', new Date(Date.now() + 3600_000));
      const cookie = replyStub.headers['Set-Cookie'] ?? '';
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
    });
  });

  it('P0-2 登录失败 5 次后账号锁定（顺序触发，验证 increment + lock 状态）', async () => {
    await prisma.adminUser.upsert({
      where: { username: 'lockout-target' },
      update: { failedLogins: 0, lockedUntil: null },
      create: {
        username: 'lockout-target',
        passwordHash: hashPassword('correct-horse-battery-staple-1'),
      },
    });
    const svc = new AdminUserService(prisma);
    for (let i = 0; i < 6; i += 1) {
      await svc.login('lockout-target', 'wrong-pw');
    }
    const row = await prisma.adminUser.findUnique({ where: { username: 'lockout-target' } });
    expect(row?.failedLogins).toBeGreaterThanOrEqual(5);
    expect(row?.lockedUntil).toBeTruthy();
  });

  it('P0-3 env：生产模式必须显式提供 SESSION_SECRET（缺失即报错）', async () => {
    const { loadEnv } = await import('@freellm/shared');
    let threw = false;
    try {
      loadEnv({
        FREELLM_NODE_ENV: 'production',
        FREELLM_API_BASE_URL: 'http://127.0.0.1:3001',
        FREELLM_WEB_ORIGIN: 'http://127.0.0.1:5173',
        FREELLM_MASTER_KEY: 'a'.repeat(64), // 64 hex = 32 bytes
        DATABASE_URL: 'file:./data/freellm.db',
        // 故意不提供 SESSION_SECRET
      } as NodeJS.ProcessEnv);
    } catch (err) {
      threw = true;
      expect(String((err as Error).message)).toContain('FREELLM_SESSION_SECRET');
    }
    expect(threw).toBe(true);
  });

  it('P0-4 virtual key：sha256 hash + timingSafeEqualHex 二次校验', async () => {
    const svc = new VirtualKeyService(prisma);
    const created = await svc.create({
      label: 'security-test',
      environment: 'test',
      permissions: {
        allowedModels: [],
        deniedModels: [],
        allowedProviders: [],
        allowPaidModels: false,
        allowStreaming: true,
      },
    });
    expect(created.secret).toMatch(/^fllm_test_[a-f0-9]{64}$/);
    const row = await svc.resolveBySecret(created.secret);
    expect(row?.id).toBe(created.id);
    // hash 自身相等
    expect(timingSafeEqualHex(hashApiKey(created.secret), row!.hash)).toBe(true);
    // 一位错误 secret 不应通过
    const bogus = created.secret.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
    expect(await svc.resolveBySecret(bogus)).toBeNull();
  });

  it('P0-5 MASTER_KEY 长度强制 ≥32 字符', async () => {
    const { loadEnv } = await import('@freellm/shared');
    expect(() =>
      loadEnv({
        FREELLM_NODE_ENV: 'development',
        FREELLM_MASTER_KEY: 'tooshort',
      } as NodeJS.ProcessEnv),
    ).toThrow(/FREELLM_MASTER_KEY/);
  });

  it('P0-7 EventBus listener 抛出不互相影响', async () => {
    const { EventBus } = await import('../src/services/event-bus.js');
    const bus = new EventBus();
    let secondCalled = false;
    bus.on('topic', () => {
      throw new Error('first listener boom');
    });
    bus.on('topic', () => {
      secondCalled = true;
    });
    // 不应抛错（rejected 由 console.error 吞掉，但流程继续）
    await bus.emit('topic', { x: 1 });
    expect(secondCalled).toBe(true);
  });

  it('P1-A 登录失败统一错误信息，不区分 unknown_user 与 bad_password', async () => {
    const r1 = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { username: 'no-such-user', password: 'whatever' },
    });
    const r2 = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { username: 'admin', password: 'wrong-pw' },
    });
    expect(r1.statusCode).toBe(401);
    expect(r2.statusCode).toBe(401);
    // 不应在 message 中泄露 reason 字段（unknown_user / bad_password 这种内部状态）
    expect(r1.json().error.message).not.toMatch(/unknown_user|bad_password/);
    expect(r2.json().error.message).not.toMatch(/unknown_user|bad_password/);
  });

  it('AES-256-GCM upstream key 加密 / 解密 / AAD 隔离', async () => {
    const master = Buffer.alloc(32, 9).toString('base64');
    const blob = encryptSecret('sk-upstream-secret', master, { aad: 'upstream_key:row-1' });
    expect(decryptSecret(blob, master, { aad: 'upstream_key:row-1' })).toBe('sk-upstream-secret');
    // 错误的 AAD 解密必须失败 — 防止跨行 cipher 复用
    expect(() => decryptSecret(blob, master, { aad: 'upstream_key:row-2' })).toThrow();
  });

  it('prompt 摘要 12 字符，且不包含原文', async () => {
    const text = '用户敏感问句，含隐私字段 ssn 123-45-6789';
    const digest = prompt12(text);
    expect(digest).toMatch(/^[a-f0-9]{12}$/);
    expect(digest).not.toContain('123-45');
  });

  it('Authorization 头不会出现在 redact 输出中', async () => {
    const { scrubObject } = await import('@freellm/shared');
    const scrubbed = scrubObject({
      headers: { authorization: 'Bearer fllm_test_secret', accept: 'application/json' },
      apiKey: 'sk-very-secret',
      tokenHash: 'abc123hashvalue',
      secret: 'fllm_live_topsecret',
    }) as Record<string, unknown>;
    const flat = JSON.stringify(scrubbed);
    expect(flat).not.toContain('fllm_test_secret');
    expect(flat).not.toContain('sk-very-secret');
    expect(flat).not.toContain('topsecret');
    expect(flat).not.toContain('abc123hashvalue');
    expect(flat).toContain('redacted');
  });

  it('admin session 在 logout 后立即失效（即时撤销）', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { username: 'admin', password: 'correct-horse-battery-staple' },
    });
    const cookie = String(login.headers['set-cookie'] ?? '').split(';')[0]!;
    const before = await app.inject({ method: 'GET', url: '/admin/auth/me', headers: { cookie } });
    expect(before.statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/admin/auth/logout', headers: { cookie } });
    const after = await app.inject({ method: 'GET', url: '/admin/auth/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });
});
