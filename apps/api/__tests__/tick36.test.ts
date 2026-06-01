/**
 * Tick 36 v1.7.8.0 单元 + 集成测试：
 * - deriveNameFromMessages / parseMessages 工具函数
 * - PlaygroundSessionService.create / list / update / delete + owner 隔离
 * - 端点契约（5 个 CRUD）+ owner 不匹配 → 404 + ownerId 校验
 * - purgeOlderThan
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import {
  PlaygroundSessionService,
  deriveNameFromMessages,
  parseMessages,
} from '../src/services/playground-session.service.js';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { hashPassword } from '../src/services/admin-user.service.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick36-test.db`
    : `${process.cwd()}/data/freellm-tick36-test.db`,
);

let prisma: PrismaClient;
let app: FastifyInstance;

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
    version: '1.7.8.0',
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

describe('Tick 36 — 工具函数', () => {
  it('deriveNameFromMessages 取首条用户消息前 60 字符', () => {
    expect(deriveNameFromMessages([])).toBe('新对话');
    expect(
      deriveNameFromMessages([
        { role: 'system', content: 'sys' },
        { role: 'user', content: '你好 FreeLLM' },
      ]),
    ).toBe('你好 FreeLLM');
    const long = 'a'.repeat(100);
    expect(
      deriveNameFromMessages([{ role: 'user', content: long }]).length,
    ).toBe(60);
  });

  it('deriveNameFromMessages 空白折叠 + 兜底', () => {
    expect(
      deriveNameFromMessages([{ role: 'user', content: '   \n\n   ' }]),
    ).toBe('新对话');
    expect(
      deriveNameFromMessages([{ role: 'user', content: '  hello\nworld  ' }]),
    ).toBe('hello world');
  });

  it('parseMessages 健壮：非数组 / 缺字段 / 非法 JSON → []', () => {
    expect(parseMessages('not json')).toEqual([]);
    expect(parseMessages('{}')).toEqual([]);
    expect(parseMessages('[{"role":"user","content":"ok"}]')).toEqual([
      { role: 'user', content: 'ok' },
    ]);
    // 缺 role / content 的项被滤掉
    const mixed = parseMessages(
      '[{"role":"user","content":"a"},{"role":"user"},{"content":"x"}]',
    );
    expect(mixed).toHaveLength(1);
  });
});

describe('Tick 36 — PlaygroundSessionService', () => {
  beforeEach(async () => {
    await prisma.playgroundSession.deleteMany();
  });

  it('create + list + findByIdForOwner 闭环', async () => {
    const svc = new PlaygroundSessionService(prisma);
    const s = await svc.create({
      ownerId: 'owner-abc',
      messages: [{ role: 'user', content: '你好 Playground' }],
      demoVkPrefix: 'fllm_test_abcd',
    });
    expect(s.id).toBeDefined();
    expect(s.name).toBe('你好 Playground');
    expect(s.demoVkPrefix).toBe('fllm_test_abcd');

    const list = await svc.list('owner-abc');
    expect(list).toHaveLength(1);

    const found = await svc.findByIdForOwner(s.id, 'owner-abc');
    expect(found).toBeTruthy();
  });

  it('owner 不匹配 → findByIdForOwner 返回 null', async () => {
    const svc = new PlaygroundSessionService(prisma);
    const s = await svc.create({ ownerId: 'owner-1', messages: [] });
    expect(await svc.findByIdForOwner(s.id, 'owner-2')).toBeNull();
  });

  it('update 追加 messages 更新 lastMessageAt', async () => {
    const svc = new PlaygroundSessionService(prisma);
    const s = await svc.create({ ownerId: 'o', messages: [{ role: 'user', content: 'a' }] });
    const before = s.lastMessageAt.getTime();
    await new Promise((r) => setTimeout(r, 10));
    const updated = await svc.update(s.id, 'o', {
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ],
    });
    expect(updated.lastMessageAt.getTime()).toBeGreaterThan(before);
    expect(JSON.parse(updated.messagesJson)).toHaveLength(2);
  });

  it('update owner 不匹配 → 抛 not_found', async () => {
    const svc = new PlaygroundSessionService(prisma);
    const s = await svc.create({ ownerId: 'o1', messages: [] });
    await expect(svc.update(s.id, 'o2', { name: 'x' })).rejects.toThrow(/会话不存在/);
  });

  it('delete + delete owner 不匹配 → 404', async () => {
    const svc = new PlaygroundSessionService(prisma);
    const s = await svc.create({ ownerId: 'o', messages: [] });
    await expect(svc.delete(s.id, 'other')).rejects.toThrow(/会话不存在/);
    await svc.delete(s.id, 'o');
    expect(await prisma.playgroundSession.findUnique({ where: { id: s.id } })).toBeNull();
  });

  it('purgeOlderThan 删除超龄记录', async () => {
    const svc = new PlaygroundSessionService(prisma);
    await prisma.playgroundSession.create({
      data: {
        ownerId: 'o',
        name: 'old',
        messagesJson: '[]',
        lastMessageAt: new Date(Date.now() - 100 * 24 * 3600_000),
      },
    });
    await svc.create({ ownerId: 'o', messages: [{ role: 'user', content: 'new' }] });
    const purged = await svc.purgeOlderThan(90);
    expect(purged).toBe(1);
    const left = await prisma.playgroundSession.findMany();
    expect(left).toHaveLength(1);
    expect(left[0]!.name).toBe('new');
  });
});

describe('Tick 36 — /public/playground/sessions/* 端点', () => {
  beforeEach(async () => {
    await prisma.playgroundSession.deleteMany();
  });

  const OWNER = 'owner-tick36-abc-123';

  it('POST + GET 列表 + GET 详情', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/public/playground/sessions',
      payload: {
        ownerId: OWNER,
        messages: [{ role: 'user', content: '你好' }],
        demoVkPrefix: 'fllm_test_xy',
      },
    });
    expect(createRes.statusCode).toBe(200);
    const created = createRes.json();
    expect(created.session.id).toBeDefined();

    const listRes = await app.inject({
      method: 'GET',
      url: `/public/playground/sessions?owner=${OWNER}`,
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data).toHaveLength(1);

    const detailRes = await app.inject({
      method: 'GET',
      url: `/public/playground/sessions/${created.session.id}?owner=${OWNER}`,
    });
    expect(detailRes.statusCode).toBe(200);
    const body = detailRes.json();
    expect(body.session.messages).toHaveLength(1);
  });

  it('GET 详情 owner 不匹配 → 404', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/public/playground/sessions',
      payload: { ownerId: OWNER, messages: [] },
    });
    const id = createRes.json().session.id;
    const wrong = await app.inject({
      method: 'GET',
      url: `/public/playground/sessions/${id}?owner=different-owner-789`,
    });
    expect(wrong.statusCode).toBe(404);
  });

  it('PATCH 追加 messages + DELETE', async () => {
    const c = await app.inject({
      method: 'POST',
      url: '/public/playground/sessions',
      payload: { ownerId: OWNER, messages: [{ role: 'user', content: 'a' }] },
    });
    const id = c.json().session.id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/public/playground/sessions/${id}?owner=${OWNER}`,
      payload: {
        messages: [
          { role: 'user', content: 'a' },
          { role: 'assistant', content: 'b' },
        ],
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().session.messages).toHaveLength(2);

    const del = await app.inject({
      method: 'DELETE',
      url: `/public/playground/sessions/${id}?owner=${OWNER}`,
    });
    expect(del.statusCode).toBe(200);
    const after = await prisma.playgroundSession.findUnique({ where: { id } });
    expect(after).toBeNull();
  });

  it('owner 太短 → 400 (zod min 8)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/public/playground/sessions?owner=short',
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('owner 字段缺失 → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/public/playground/sessions',
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
