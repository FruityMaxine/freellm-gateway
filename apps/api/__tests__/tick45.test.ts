/**
 * Tick 45 v1.7.17.0 单元 + 集成测试：
 * - PlaygroundPresetService CRUD + owner 隔离 + 验证 (name/prompt 长度 / temperature 范围)
 * - markUsed 触发 lastUsedAt
 * - 6 个端点契约（list/create/get/patch/delete/mark-used）+ owner 不匹配 404
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { PlaygroundPresetService } from '../src/services/playground-preset.service.js';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { hashPassword } from '../src/services/admin-user.service.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick45-test.db`
    : `${process.cwd()}/data/freellm-tick45-test.db`,
);

let prisma: PrismaClient;
let app: FastifyInstance;

const OWNER = 'owner-tick45-12345678';

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
    version: '1.7.17.0',
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
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Tick 45 — PlaygroundPresetService CRUD + 校验', () => {
  beforeEach(async () => {
    await prisma.playgroundPreset.deleteMany();
  });

  it('create + list + findByIdForOwner', async () => {
    const svc = new PlaygroundPresetService(prisma);
    const p = await svc.create({
      ownerId: OWNER,
      name: '代码助手',
      systemPrompt: '你是高级程序员',
      preferredModel: 'openrouter/auto',
      temperature: 0.3,
    });
    expect(p.id).toBeDefined();
    expect(p.name).toBe('代码助手');
    expect(p.temperature).toBeCloseTo(0.3);

    const list = await svc.list(OWNER);
    expect(list).toHaveLength(1);

    const found = await svc.findByIdForOwner(p.id, OWNER);
    expect(found?.id).toBe(p.id);
  });

  it('owner 不匹配 → findByIdForOwner null + update/delete 抛 not_found', async () => {
    const svc = new PlaygroundPresetService(prisma);
    const p = await svc.create({ ownerId: OWNER, name: 'X' });
    expect(await svc.findByIdForOwner(p.id, 'other-owner')).toBeNull();
    await expect(svc.update(p.id, 'other-owner', { name: 'Y' })).rejects.toThrow(/不存在/);
    await expect(svc.delete(p.id, 'other-owner')).rejects.toThrow(/不存在/);
  });

  it('temperature 超出 0-2 范围 → bad_request', async () => {
    const svc = new PlaygroundPresetService(prisma);
    await expect(
      svc.create({ ownerId: OWNER, name: 'T', temperature: 3 }),
    ).rejects.toThrow(/temperature/);
    await expect(
      svc.create({ ownerId: OWNER, name: 'T2', temperature: -0.1 }),
    ).rejects.toThrow(/temperature/);
  });

  it('空 name → bad_request', async () => {
    const svc = new PlaygroundPresetService(prisma);
    await expect(svc.create({ ownerId: OWNER, name: '   ' })).rejects.toThrow(/name/);
  });

  it('update 部分字段 + markUsed 触发 lastUsedAt', async () => {
    const svc = new PlaygroundPresetService(prisma);
    const p = await svc.create({ ownerId: OWNER, name: '原名' });
    expect(p.lastUsedAt).toBeNull();
    const updated = await svc.update(p.id, OWNER, { name: '新名', temperature: 1.2 });
    expect(updated.name).toBe('新名');
    expect(updated.temperature).toBeCloseTo(1.2);

    const used = await svc.markUsed(p.id, OWNER);
    expect(used.lastUsedAt).toBeTruthy();
  });

  it('delete + delete 不存在 → not_found', async () => {
    const svc = new PlaygroundPresetService(prisma);
    const p = await svc.create({ ownerId: OWNER, name: 'D' });
    await svc.delete(p.id, OWNER);
    expect(await prisma.playgroundPreset.findUnique({ where: { id: p.id } })).toBeNull();
    await expect(svc.delete(p.id, OWNER)).rejects.toThrow(/不存在/);
  });

  it('list 按 lastUsedAt 倒序 (null 最后)', async () => {
    const svc = new PlaygroundPresetService(prisma);
    const a = await svc.create({ ownerId: OWNER, name: 'A' });
    await new Promise((r) => setTimeout(r, 5));
    const b = await svc.create({ ownerId: OWNER, name: 'B' });
    await svc.markUsed(a.id, OWNER); // a 有 lastUsedAt
    const list = await svc.list(OWNER);
    expect(list[0]!.id).toBe(a.id); // lastUsedAt 倒序
    expect(list[1]!.id).toBe(b.id); // null lastUsedAt 在后
  });
});

describe('Tick 45 — /public/playground/presets/* 端点', () => {
  beforeEach(async () => {
    await prisma.playgroundPreset.deleteMany();
  });

  it('POST 创建 + GET 列表 + GET 详情', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/public/playground/presets',
      payload: { ownerId: OWNER, name: '快速测试', systemPrompt: '简短回答' },
    });
    expect(createRes.statusCode).toBe(200);
    const created = createRes.json();
    expect(created.preset.id).toBeDefined();

    const listRes = await app.inject({
      method: 'GET',
      url: `/public/playground/presets?owner=${OWNER}`,
    });
    expect(listRes.json().data).toHaveLength(1);

    const detailRes = await app.inject({
      method: 'GET',
      url: `/public/playground/presets/${created.preset.id}?owner=${OWNER}`,
    });
    expect(detailRes.json().preset.systemPrompt).toBe('简短回答');
  });

  it('PATCH 部分更新', async () => {
    const c = await app.inject({
      method: 'POST',
      url: '/public/playground/presets',
      payload: { ownerId: OWNER, name: 'P' },
    });
    const id = c.json().preset.id;
    const patched = await app.inject({
      method: 'PATCH',
      url: `/public/playground/presets/${id}?owner=${OWNER}`,
      payload: { temperature: 1.5, streaming: false },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().preset.temperature).toBeCloseTo(1.5);
    expect(patched.json().preset.streaming).toBe(false);
  });

  it('mark-used 端点 → lastUsedAt 更新', async () => {
    const c = await app.inject({
      method: 'POST',
      url: '/public/playground/presets',
      payload: { ownerId: OWNER, name: 'M' },
    });
    const id = c.json().preset.id;
    const before = c.json().preset.lastUsedAt;
    expect(before).toBeNull();
    const marked = await app.inject({
      method: 'POST',
      url: `/public/playground/presets/${id}/mark-used?owner=${OWNER}`,
    });
    expect(marked.statusCode).toBe(200);
    expect(marked.json().preset.lastUsedAt).toBeTruthy();
  });

  it('GET 详情 owner 不匹配 → 404', async () => {
    const c = await app.inject({
      method: 'POST',
      url: '/public/playground/presets',
      payload: { ownerId: OWNER, name: 'X' },
    });
    const id = c.json().preset.id;
    const wrong = await app.inject({
      method: 'GET',
      url: `/public/playground/presets/${id}?owner=other-owner-789`,
    });
    expect(wrong.statusCode).toBe(404);
  });

  it('owner 字段缺失 → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/public/playground/presets',
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('DELETE owner 不匹配 → 404', async () => {
    const c = await app.inject({
      method: 'POST',
      url: '/public/playground/presets',
      payload: { ownerId: OWNER, name: 'D' },
    });
    const id = c.json().preset.id;
    const wrong = await app.inject({
      method: 'DELETE',
      url: `/public/playground/presets/${id}?owner=other-owner-789`,
    });
    expect(wrong.statusCode).toBe(404);
  });
});
