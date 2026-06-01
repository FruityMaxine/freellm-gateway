import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { parseProviderConfig, MultiScenarioMockProvider } from '@freellm/provider-core';
import type { FastifyInstance } from 'fastify';
import { VirtualKeyService } from '../src/services/virtual-key.service.js';
import { _resetAuthBuckets } from '../src/plugins/virtual-key-auth.js';
import { hashPassword } from '../src/services/admin-user.service.js';

// Absolute path so the `prisma db push` subprocess (run from repo root) and
// the in-test PrismaClient (run from apps/api) hit the same SQLite file.
import { resolve as resolvePath } from 'node:path';
const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-v1-test.db`
    : `${process.cwd()}/data/freellm-v1-test.db`,
);
let app: FastifyInstance;
let prisma: PrismaClient;
let virtualKeySecret: string;
let virtualKeyId: string;

beforeAll(async () => {
  // Remove the file plus any -journal / -wal sidecars before db push so the
  // schema starts truly fresh.
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
    version: '0.4.0.0',
    env: {
      FREELLM_API_HOST: '127.0.0.1',
      FREELLM_API_PORT: 0,
      FREELLM_API_BASE_URL: 'http://127.0.0.1:3001',
      FREELLM_WEB_ORIGIN: 'http://127.0.0.1:5173',
      FREELLM_NODE_ENV: 'test' as const,
      FREELLM_LOG_LEVEL: 'error' as const,
      DATABASE_URL: `file:${TEST_DB}`,
      FREELLM_MASTER_KEY: 'test-master-key-for-vitest-only-do-not-use',
      FREELLM_SESSION_SECRET: 'test-session-secret-for-vitest-only-do-not-use',
      FREELLM_ADMIN_USERNAME: 'admin',
      FREELLM_ADMIN_PASSWORD: 'admin',
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
      FREELLM_MOCK_PROVIDERS_ENABLED: false, // we'll set our own
    },
  });

  prisma = new PrismaClient({ datasources: { db: { url: `file:${TEST_DB}` } } });

  await prisma.adminUser.create({
    data: { username: 'admin', passwordHash: hashPassword('correct-horse-battery-staple') },
  });

  // Seed a routing policy + multi-mock provider + one free model
  await prisma.routingPolicy.create({
    data: {
      name: 'default-auto-best-free',
      isDefault: true,
      mode: 'auto-best-free',
      weightsJson: JSON.stringify({
        availability: 0.3, latency: 0.15, rateLimit: 0.2, quality: 0.15, context: 0.1, freshness: 0.05, cost: 0, stability: 0.05,
      }),
    },
  });
  const provider = await prisma.provider.create({
    data: { slug: 'multi-mock', kind: 'mock', name: 'Multi-Mock', baseUrl: 'mock://', enabled: true },
  });
  await prisma.model.create({
    data: {
      providerId: provider.id,
      upstreamId: 'multi-mock/echo:free',
      displayName: 'Multi Echo',
      contextLength: 16_000,
      isFree: true,
      capabilitiesJson: JSON.stringify({ stream: true, json: true, tools: false, vision: false, audio: false }),
      status: 'active',
    },
  });

  const { app: builtApp, registry } = await buildApp();
  app = builtApp;

  // Replace registered provider with our programmable mock
  const cfg = parseProviderConfig({ slug: 'multi-mock', kind: 'mock', name: 'Multi-Mock', baseUrl: 'mock://' });
  (registry as unknown as { providers: Map<string, unknown> }).providers.set(
    'multi-mock',
    new MultiScenarioMockProvider(cfg, { apiKey: null, baseUrl: 'mock://' }),
  );

  // Create a virtual key
  const svc = new VirtualKeyService(prisma);
  const created = await svc.create({
    label: 'vitest',
    environment: 'test',
    permissions: {
      allowedModels: [],
      deniedModels: [],
      allowedProviders: [],
      allowPaidModels: false,
      allowStreaming: true,
    },
  });
  virtualKeySecret = created.secret;
  virtualKeyId = created.id;

  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(() => {
  _resetAuthBuckets();
});

function bearer(): Record<string, string> {
  return { Authorization: `Bearer ${virtualKeySecret}` };
}

describe('POST /v1/chat/completions', () => {
  it('rejects missing Bearer token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: { model: 'free/auto', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects garbage Bearer token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { Authorization: 'Bearer fllm_test_garbage' },
      payload: { model: 'free/auto', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('non-stream success returns OpenAI shape + 5 freellm headers', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { ...bearer(), 'Content-Type': 'application/json' },
      payload: { model: 'free/auto', messages: [{ role: 'user', content: 'hello world' }], stream: false },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.choices?.[0]?.message?.content).toContain('hello world');
    expect(res.headers['x-freellm-request-id']).toMatch(/^req_/);
    expect(res.headers['x-freellm-upstream-provider']).toBe('multi-mock');
    expect(res.headers['x-freellm-upstream-model']).toBe('multi-mock/echo:free');
    expect(res.headers['x-freellm-route-attempts']).toBeDefined();
    expect(res.headers['x-freellm-cache-hit']).toBe('false');
  });

  it('writes a request_log row with the upstream identifiers', async () => {
    const before = await prisma.requestLog.count();
    await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: bearer(),
      payload: { model: 'free/auto', messages: [{ role: 'user', content: 'logme' }] },
    });
    const after = await prisma.requestLog.count();
    expect(after).toBeGreaterThanOrEqual(before + 1);
    const log = await prisma.requestLog.findFirst({ orderBy: { startedAt: 'desc' } });
    expect(log?.upstreamProvider).toBe('multi-mock');
  });

  it('deniedModels blocks the request', async () => {
    const svc = new VirtualKeyService(prisma);
    await svc.patch(virtualKeyId, {
      permissions: {
        allowedModels: [],
        deniedModels: ['multi-mock/echo:free'],
        allowedProviders: [],
        allowPaidModels: false,
        allowStreaming: true,
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: bearer(),
      payload: { model: 'free/auto', messages: [{ role: 'user', content: 'hi' }] },
    });
    // No candidates → no_route_available
    expect(res.statusCode).toBe(503);
    const j = res.json();
    expect(j.error.code).toBe('no_route_available');
    // restore
    await svc.patch(virtualKeyId, {
      permissions: {
        allowedModels: [],
        deniedModels: [],
        allowedProviders: [],
        allowPaidModels: false,
        allowStreaming: true,
      },
    });
  });

  it('streaming returns SSE events ending with [DONE]', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { ...bearer(), Accept: 'text/event-stream' },
      payload: { model: 'free/auto', messages: [{ role: 'user', content: 'stream me' }], stream: true },
    });
    // With reply.hijack the raw body is the SSE payload itself; fastify inject
    // captures it but the content-type header is whatever the raw socket wrote.
    expect(res.body).toContain('data: ');
    expect(res.body).toContain('[DONE]');
  });
});

describe('virtual key permissions', () => {
  it('denies streaming when allowStreaming=false', async () => {
    const svc = new VirtualKeyService(prisma);
    await svc.patch(virtualKeyId, {
      permissions: {
        allowedModels: [],
        deniedModels: [],
        allowedProviders: [],
        allowPaidModels: false,
        allowStreaming: false,
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: bearer(),
      payload: { model: 'free/auto', messages: [{ role: 'user', content: 'hi' }], stream: true },
    });
    expect(res.statusCode).toBe(403);
    await svc.patch(virtualKeyId, {
      permissions: {
        allowedModels: [],
        deniedModels: [],
        allowedProviders: [],
        allowPaidModels: false,
        allowStreaming: true,
      },
    });
  });
});

describe('GET /v1/models', () => {
  it('lists models the key may use', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: bearer(),
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.object).toBe('list');
    expect(json.data.length).toBeGreaterThan(0);
    expect(json.data[0].owned_by).toBeDefined();
  });
});

describe('GET /v1/key + /v1/usage', () => {
  it('returns key info + usage summary', async () => {
    const k = await app.inject({ method: 'GET', url: '/v1/key', headers: bearer() });
    expect(k.statusCode).toBe(200);
    expect(k.json().label).toBe('vitest');

    const u = await app.inject({ method: 'GET', url: '/v1/usage', headers: bearer() });
    expect(u.statusCode).toBe(200);
    expect(u.json().object).toBe('usage.summary');
  });
});

describe('admin auth', () => {
  it('unauthenticated /admin/models returns 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/models' });
    expect(res.statusCode).toBe(401);
  });

  it('login wrong password returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { username: 'admin', password: 'nope' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('login + cookie + /admin/auth/me happy path', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { username: 'admin', password: 'correct-horse-battery-staple' },
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers['set-cookie'];
    expect(cookie).toBeDefined();
    const me = await app.inject({
      method: 'GET',
      url: '/admin/auth/me',
      headers: { cookie: (cookie as string).split(';')[0]! },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().username).toBe('admin');
  });

  it('5 failed logins locks account', async () => {
    // Use a fresh user so we don't disturb the happy-path admin row.
    await prisma.adminUser.upsert({
      where: { username: 'lockee' },
      update: {},
      create: { username: 'lockee', passwordHash: hashPassword('the-real-password') },
    });
    for (let i = 0; i < 6; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/admin/auth/login',
        payload: { username: 'lockee', password: 'wrong-pw' },
      });
    }
    const row = await prisma.adminUser.findUnique({ where: { username: 'lockee' } });
    expect(row?.lockedUntil).toBeTruthy();
  });
});
