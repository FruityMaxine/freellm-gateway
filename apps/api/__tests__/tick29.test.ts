/**
 * Tick 29 v1.7.1.0 单元 + 集成测试：
 * - 工具函数：actionFromMethod / resourceTypeFromPath / resourceIdFromPath / redactSensitive / serializeBody
 * - AdminAuditService.record + list + facets
 * - 自动捕获 hook：POST/PATCH/DELETE → 写一条；GET → 不写
 * - /admin/audit 端点契约（200 / 401 / 筛选）
 * - body 截断与脱敏在端到端流程中生效
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import {
  AdminAuditService,
  actionFromMethod,
  resourceTypeFromPath,
  resourceIdFromPath,
  redactSensitive,
  serializeBody,
} from '../src/services/admin-audit.service.js';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { hashPassword } from '../src/services/admin-user.service.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick29-test.db`
    : `${process.cwd()}/data/freellm-tick29-test.db`,
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
    version: '1.7.1.0',
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
  sessionCookie = await loginAdmin();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Tick 29 — 工具函数', () => {
  it('actionFromMethod 正确映射 HTTP method', () => {
    expect(actionFromMethod('POST', '/admin/auth/login')).toBe('login');
    expect(actionFromMethod('POST', '/admin/auth/logout')).toBe('logout');
    expect(actionFromMethod('POST', '/admin/virtual-keys')).toBe('create');
    expect(actionFromMethod('PATCH', '/admin/virtual-keys/vk_x')).toBe('update');
    expect(actionFromMethod('PUT', '/admin/virtual-keys/vk_x')).toBe('update');
    expect(actionFromMethod('DELETE', '/admin/virtual-keys/vk_x')).toBe('delete');
    expect(actionFromMethod('POST', '/admin/virtual-keys/vk_x/rotate')).toBe('refresh');
    expect(actionFromMethod('GET', '/admin/virtual-keys')).toBe('other');
  });

  it('resourceTypeFromPath 按前缀映射资源类型', () => {
    expect(resourceTypeFromPath('/admin/virtual-keys')).toBe('virtual_key');
    expect(resourceTypeFromPath('/admin/virtual-keys/vk_x')).toBe('virtual_key');
    expect(resourceTypeFromPath('/admin/providers/openrouter')).toBe('provider');
    expect(resourceTypeFromPath('/admin/webhooks')).toBe('webhook');
    expect(resourceTypeFromPath('/admin/settings')).toBe('setting');
    expect(resourceTypeFromPath('/admin/auth/login')).toBe('auth');
    expect(resourceTypeFromPath('/admin/audit')).toBe('audit');
    expect(resourceTypeFromPath('/admin/foo')).toBe('other');
  });

  it('resourceIdFromPath 抽 URL 最后一段（排除 sub-action）', () => {
    expect(resourceIdFromPath('/admin/virtual-keys')).toBeNull();
    expect(resourceIdFromPath('/admin/virtual-keys/vk_abc')).toBe('vk_abc');
    expect(resourceIdFromPath('/admin/virtual-keys/vk_abc/')).toBe('vk_abc');
    expect(resourceIdFromPath('/admin/virtual-keys/vk_abc?query=1')).toBe('vk_abc');
    // sub-action 关键字排除
    expect(resourceIdFromPath('/admin/virtual-keys/vk_abc/rotate')).toBeNull();
    expect(resourceIdFromPath('/admin/auth/login')).toBeNull();
  });

  it('redactSensitive 递归脱敏', () => {
    const input = {
      label: 'safe',
      secret: 'top-secret-value',
      password: 'p4ss',
      apiKey: 'sk-xxx',
      nested: {
        token: 'bearer-foo',
        normal: 'kept',
      },
      list: [{ secret: 'list-secret' }, { normal: 'ok' }],
    };
    const out = redactSensitive(input) as Record<string, unknown>;
    expect(out.label).toBe('safe');
    expect(out.secret).toBe('[REDACTED]');
    expect(out.password).toBe('[REDACTED]');
    expect(out.apiKey).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).token).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).normal).toBe('kept');
    expect((out.list as Array<Record<string, unknown>>)[0]!.secret).toBe('[REDACTED]');
    expect((out.list as Array<Record<string, unknown>>)[1]!.normal).toBe('ok');
  });

  it('serializeBody 空值返回 null + 长 body 截断 + 不可序列化标记', () => {
    expect(serializeBody(null)).toBeNull();
    expect(serializeBody(undefined)).toBeNull();
    expect(serializeBody('')).toBeNull();
    expect(serializeBody({})).toBeNull();
    const short = { a: 1 };
    expect(serializeBody(short)).toBe('{"a":1}');
    const huge = { data: 'x'.repeat(10_000) };
    const out = serializeBody(huge);
    expect(out).toBeTruthy();
    expect(out!.length).toBeLessThan(10_000 + 100);
    expect(out).toContain('[truncated');
    // 循环引用 → 不可序列化
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(serializeBody(cyc)).toBe('[unserializable]');
  });
});

describe('Tick 29 — AdminAuditService 持久化与查询', () => {
  beforeEach(async () => {
    await prisma.adminAuditLog.deleteMany();
  });

  it('record 写入 + list 按时间倒序返回', async () => {
    const svc = new AdminAuditService(prisma);
    for (let i = 0; i < 3; i++) {
      await svc.record({
        userId: 'u1',
        username: 'admin',
        action: 'create',
        resourceType: 'virtual_key',
        resourceId: `vk_${i}`,
        method: 'POST',
        path: '/admin/virtual-keys',
        status: 200,
        requestBody: `{"i":${i}}`,
        clientIp: '127.0.0.1',
        userAgent: 'test',
        requestId: `r${i}`,
        errorMessage: null,
        durationMs: 10,
      });
      await new Promise((r) => setTimeout(r, 5));
    }
    const result = await svc.list();
    expect(result.total).toBe(3);
    expect(result.data).toHaveLength(3);
    // 最新的 r2 排第一
    expect(result.data[0]!.requestId).toBe('r2');
    expect(result.data[2]!.requestId).toBe('r0');
  });

  it('list 按 action / resourceType / username 筛选', async () => {
    const svc = new AdminAuditService(prisma);
    await svc.record({
      userId: 'u1',
      username: 'alice',
      action: 'create',
      resourceType: 'virtual_key',
      resourceId: 'vk_1',
      method: 'POST',
      path: '/admin/virtual-keys',
      status: 200,
      requestBody: null,
      clientIp: null,
      userAgent: null,
      requestId: 'r1',
      errorMessage: null,
      durationMs: 5,
    });
    await svc.record({
      userId: 'u2',
      username: 'bob',
      action: 'delete',
      resourceType: 'webhook',
      resourceId: 'sub_x',
      method: 'DELETE',
      path: '/admin/webhooks/sub_x',
      status: 200,
      requestBody: null,
      clientIp: null,
      userAgent: null,
      requestId: 'r2',
      errorMessage: null,
      durationMs: 8,
    });
    expect((await svc.list({ action: 'create' })).total).toBe(1);
    expect((await svc.list({ resourceType: 'webhook' })).total).toBe(1);
    expect((await svc.list({ username: 'alice' })).total).toBe(1);
    expect((await svc.list({ username: 'nobody' })).total).toBe(0);
  });

  it('purgeOlderThan 删除超龄记录', async () => {
    const svc = new AdminAuditService(prisma);
    // 直接 raw create 模拟 100 天前的记录
    await prisma.adminAuditLog.create({
      data: {
        username: 'old',
        action: 'create',
        resourceType: 'virtual_key',
        method: 'POST',
        path: '/admin/virtual-keys',
        status: 200,
        createdAt: new Date(Date.now() - 100 * 24 * 3600_000),
      },
    });
    await svc.record({
      userId: null,
      username: 'new',
      action: 'create',
      resourceType: 'virtual_key',
      resourceId: null,
      method: 'POST',
      path: '/admin/virtual-keys',
      status: 200,
      requestBody: null,
      clientIp: null,
      userAgent: null,
      requestId: null,
      errorMessage: null,
      durationMs: null,
    });
    const purged = await svc.purgeOlderThan(90);
    expect(purged).toBe(1);
    const left = await svc.list();
    expect(left.total).toBe(1);
    expect(left.data[0]!.username).toBe('new');
  });
});

describe('Tick 29 — 自动捕获 hook 集成', () => {
  beforeEach(async () => {
    await prisma.adminAuditLog.deleteMany();
  });

  it('POST /admin/virtual-keys 自动写一条 audit 记录', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/virtual-keys',
      headers: { cookie: sessionCookie, 'content-type': 'application/json' },
      payload: {
        label: 'tick29-test',
        permissions: {
          allowedModels: [],
          deniedModels: [],
          allowPaidModels: false,
          allowStreaming: true,
        },
      },
    });
    expect(res.statusCode).toBe(200);
    // hook 是 onResponse 异步，等 50ms 让审计写完
    await new Promise((r) => setTimeout(r, 50));
    const rows = await prisma.adminAuditLog.findMany();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows.find((r) => r.path === '/admin/virtual-keys' && r.method === 'POST');
    expect(row).toBeTruthy();
    expect(row!.action).toBe('create');
    expect(row!.resourceType).toBe('virtual_key');
    expect(row!.username).toBe('admin');
    expect(row!.status).toBe(200);
    expect(row!.requestBody).toContain('tick29-test');
  });

  it('GET /admin/metrics 不写 audit（只审计写操作）', async () => {
    await prisma.adminAuditLog.deleteMany();
    await app.inject({
      method: 'GET',
      url: '/admin/metrics',
      headers: { cookie: sessionCookie },
    });
    await new Promise((r) => setTimeout(r, 50));
    const rows = await prisma.adminAuditLog.findMany();
    expect(rows.length).toBe(0);
  });

  it('POST /admin/auth/login（已 logged-in 仍写一条）记录 username', async () => {
    await prisma.adminAuditLog.deleteMany();
    await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { username: 'admin', password: 'correct-horse-battery-staple' },
    });
    await new Promise((r) => setTimeout(r, 50));
    const rows = await prisma.adminAuditLog.findMany();
    const loginRow = rows.find((r) => r.path === '/admin/auth/login');
    expect(loginRow).toBeTruthy();
    expect(loginRow!.action).toBe('login');
    expect(loginRow!.username).toBe('admin');
    // password 应已 redact
    expect(loginRow!.requestBody ?? '').not.toContain('correct-horse-battery-staple');
    expect(loginRow!.requestBody ?? '').toContain('[REDACTED]');
  });
});

describe('Tick 29 — /admin/audit 端点契约', () => {
  beforeEach(async () => {
    await prisma.adminAuditLog.deleteMany();
  });

  it('GET /admin/audit 已登录返回列表 + total', async () => {
    await prisma.adminAuditLog.create({
      data: {
        username: 'admin',
        action: 'create',
        resourceType: 'virtual_key',
        method: 'POST',
        path: '/admin/virtual-keys',
        status: 200,
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /admin/audit?action=create 服务端筛选', async () => {
    await prisma.adminAuditLog.createMany({
      data: [
        {
          username: 'admin',
          action: 'create',
          resourceType: 'virtual_key',
          method: 'POST',
          path: '/admin/virtual-keys',
          status: 200,
        },
        {
          username: 'admin',
          action: 'delete',
          resourceType: 'webhook',
          method: 'DELETE',
          path: '/admin/webhooks/x',
          status: 200,
        },
      ],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit?action=create',
      headers: { cookie: sessionCookie },
    });
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.data[0]!.action).toBe('create');
  });

  it('GET /admin/audit/facets 返回 actions + resourceTypes', async () => {
    await prisma.adminAuditLog.createMany({
      data: [
        {
          username: 'a',
          action: 'create',
          resourceType: 'virtual_key',
          method: 'POST',
          path: '/admin/virtual-keys',
          status: 200,
        },
        {
          username: 'a',
          action: 'delete',
          resourceType: 'webhook',
          method: 'DELETE',
          path: '/admin/webhooks/x',
          status: 200,
        },
      ],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit/facets',
      headers: { cookie: sessionCookie },
    });
    const body = res.json();
    expect(body.actions).toContain('create');
    expect(body.actions).toContain('delete');
    expect(body.resourceTypes).toContain('virtual_key');
    expect(body.resourceTypes).toContain('webhook');
  });

  it('未登录 → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/audit' });
    expect(res.statusCode).toBe(401);
  });
});
