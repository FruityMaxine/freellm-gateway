/**
 * Tick 30 v1.7.2.0 单元 + 集成测试：
 * - 工具函数：parsePriceString / parsePricingJson / computeCost
 * - RequestCostService.getPricing 缓存 + estimate 综合输出
 * - RequestLoggerService.finish 写入 estimatedCostUsd（成功）+ 跳过（失败 / 无 pricing）
 * - /admin/metrics 暴露 costToday / cost7d / topCostModels
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import {
  RequestCostService,
  parsePriceString,
  parsePricingJson,
  computeCost,
} from '../src/services/request-cost.service.js';
import { RequestLoggerService } from '../src/services/request-logger.service.js';
import { invalidateMetricsCache } from '../src/routes/admin/metrics.routes.js';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';
import { hashPassword } from '../src/services/admin-user.service.js';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick30-test.db`
    : `${process.cwd()}/data/freellm-tick30-test.db`,
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
    version: '1.7.2.0',
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

describe('Tick 30 — 工具函数', () => {
  it('parsePriceString 兼容字符串小数 / 数字 / null / 异常', () => {
    expect(parsePriceString('0.00000014')).toBeCloseTo(1.4e-7);
    expect(parsePriceString('0')).toBe(0);
    expect(parsePriceString(0.5)).toBe(0.5);
    expect(parsePriceString(null)).toBe(0);
    expect(parsePriceString(undefined)).toBe(0);
    expect(parsePriceString('not-a-number')).toBe(0);
    expect(parsePriceString({})).toBe(0);
  });

  it('parsePricingJson 提取三字段，缺失项填 0', () => {
    const p = parsePricingJson('{"prompt":"0.0000014","completion":"0.0000028","request":"0"}');
    expect(p).not.toBeNull();
    expect(p!.prompt).toBeCloseTo(1.4e-6);
    expect(p!.completion).toBeCloseTo(2.8e-6);
    expect(p!.request).toBe(0);
    const p2 = parsePricingJson('{"prompt":"0.01"}');
    expect(p2!.prompt).toBe(0.01);
    expect(p2!.completion).toBe(0);
    expect(p2!.request).toBe(0);
  });

  it('parsePricingJson null/无效 → null', () => {
    expect(parsePricingJson(null)).toBeNull();
    expect(parsePricingJson('')).toBeNull();
    expect(parsePricingJson('not-json')).toBeNull();
  });

  it('computeCost = prompt × promptTokens + completion × completionTokens + request', () => {
    const pricing = { prompt: 1e-6, completion: 2e-6, request: 0.001 };
    const cost = computeCost(pricing, 1000, 500);
    expect(cost.promptUsd).toBeCloseTo(1e-3);
    expect(cost.completionUsd).toBeCloseTo(1e-3);
    expect(cost.requestUsd).toBe(0.001);
    expect(cost.totalUsd).toBeCloseTo(0.003);
  });

  it('computeCost 负值 / NaN token 归零', () => {
    const p = { prompt: 1e-6, completion: 1e-6, request: 0 };
    const cost = computeCost(p, -100, NaN);
    expect(cost.totalUsd).toBe(0);
  });
});

describe('Tick 30 — RequestCostService 缓存与查表', () => {
  beforeEach(async () => {
    await prisma.model.deleteMany();
    await prisma.provider.deleteMany();
  });

  it('未知 provider/model → estimate 返回 null', async () => {
    const svc = new RequestCostService(prisma);
    expect(await svc.estimate({
      providerSlug: 'unknown',
      upstreamModelId: 'foo/bar',
      promptTokens: 100,
      completionTokens: 50,
    })).toBeNull();
  });

  it('已知 model 返回 cost 且第二次命中缓存', async () => {
    const provider = await prisma.provider.create({
      data: {
        slug: 'or-test',
        kind: 'openrouter',
        name: 'OR Test',
        baseUrl: 'https://openrouter.ai/api/v1',
        enabled: true,
        priority: 100,
      },
    });
    await prisma.model.create({
      data: {
        providerId: provider.id,
        upstreamId: 'deepseek/chat',
        displayName: 'DeepSeek',
        isFree: false,
        pricingJson: JSON.stringify({
          prompt: '0.00000014',
          completion: '0.00000028',
          request: '0',
        }),
      },
    });
    const svc = new RequestCostService(prisma);
    const cost = await svc.estimate({
      providerSlug: 'or-test',
      upstreamModelId: 'deepseek/chat',
      promptTokens: 1_000_000,
      completionTokens: 500_000,
    });
    expect(cost).not.toBeNull();
    expect(cost!.promptUsd).toBeCloseTo(0.14);
    expect(cost!.completionUsd).toBeCloseTo(0.14);
    expect(cost!.totalUsd).toBeCloseTo(0.28);

    // 把 model 删掉，缓存仍能返回（验证缓存生效）
    await prisma.model.deleteMany();
    const cost2 = await svc.estimate({
      providerSlug: 'or-test',
      upstreamModelId: 'deepseek/chat',
      promptTokens: 1,
      completionTokens: 1,
    });
    expect(cost2).not.toBeNull();
  });

  it('model 无 pricingJson → null', async () => {
    const provider = await prisma.provider.create({
      data: {
        slug: 'or-empty',
        kind: 'openrouter',
        name: 'OR Empty',
        baseUrl: 'https://openrouter.ai/api/v1',
        enabled: true,
        priority: 100,
      },
    });
    await prisma.model.create({
      data: {
        providerId: provider.id,
        upstreamId: 'm/x',
        displayName: 'X',
        isFree: true,
      },
    });
    const svc = new RequestCostService(prisma);
    expect(
      await svc.estimate({
        providerSlug: 'or-empty',
        upstreamModelId: 'm/x',
        promptTokens: 100,
        completionTokens: 100,
      }),
    ).toBeNull();
  });
});

describe('Tick 30 — RequestLoggerService.finish 自动写 cost', () => {
  let providerId: string;

  beforeEach(async () => {
    await prisma.requestLog.deleteMany();
    await prisma.model.deleteMany();
    await prisma.provider.deleteMany();
    const provider = await prisma.provider.create({
      data: {
        slug: 'or-x',
        kind: 'openrouter',
        name: 'OR X',
        baseUrl: 'https://openrouter.ai/api/v1',
        enabled: true,
        priority: 100,
      },
    });
    providerId = provider.id;
    await prisma.model.create({
      data: {
        providerId,
        upstreamId: 'deepseek/chat',
        displayName: 'DeepSeek',
        isFree: false,
        pricingJson: JSON.stringify({
          prompt: '0.000001',
          completion: '0.000002',
          request: '0',
        }),
      },
    });
  });

  it('成功请求 → estimatedCostUsd 写入', async () => {
    const logger = new RequestLoggerService(prisma, { keepDigest: false, keepFull: false });
    await logger.start({ requestId: 'r1', streaming: false, messages: [{ role: 'user', content: 'hi' }] });
    await logger.finish({
      requestId: 'r1',
      status: 200,
      upstreamProvider: 'or-x',
      upstreamModel: 'deepseek/chat',
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      durationMs: 100,
    });
    const log = await prisma.requestLog.findUnique({ where: { requestId: 'r1' } });
    expect(log).toBeTruthy();
    // 1000*1e-6 + 500*2e-6 = 1e-3 + 1e-3 = 2e-3 = 0.002
    expect(log!.estimatedCostUsd).toBeCloseTo(0.002, 6);
  });

  it('失败请求（status >= 400） → 不写 cost', async () => {
    const logger = new RequestLoggerService(prisma, { keepDigest: false, keepFull: false });
    await logger.start({ requestId: 'r2', streaming: false, messages: [{ role: 'user', content: 'hi' }] });
    await logger.finish({
      requestId: 'r2',
      status: 502,
      errorKind: 'upstream_error',
      upstreamProvider: 'or-x',
      upstreamModel: 'deepseek/chat',
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      durationMs: 100,
    });
    const log = await prisma.requestLog.findUnique({ where: { requestId: 'r2' } });
    expect(log!.estimatedCostUsd).toBeNull();
  });

  it('无 pricing 的 model → estimatedCostUsd = null', async () => {
    await prisma.model.create({
      data: {
        providerId,
        upstreamId: 'no-pricing/foo',
        displayName: 'No Pricing',
        isFree: true,
      },
    });
    const logger = new RequestLoggerService(prisma, { keepDigest: false, keepFull: false });
    await logger.start({ requestId: 'r3', streaming: false, messages: [{ role: 'user', content: 'hi' }] });
    await logger.finish({
      requestId: 'r3',
      status: 200,
      upstreamProvider: 'or-x',
      upstreamModel: 'no-pricing/foo',
      promptTokens: 1000,
      completionTokens: 500,
      durationMs: 100,
    });
    const log = await prisma.requestLog.findUnique({ where: { requestId: 'r3' } });
    expect(log!.estimatedCostUsd).toBeNull();
  });
});

describe('Tick 30 — /admin/metrics 暴露 cost 累计', () => {
  beforeEach(async () => {
    await prisma.requestLog.deleteMany();
    invalidateMetricsCache(); // 5 秒 TTL 缓存可能跨测试残留，强制失效
  });

  it('costToday / cost7d / topCostModels 字段存在并按 estimatedCostUsd 累加', async () => {
    // 注入 3 条成本不同的请求
    await prisma.requestLog.createMany({
      data: [
        {
          requestId: 'a',
          upstreamProvider: 'or-x',
          upstreamModel: 'deepseek/chat',
          status: 200,
          totalTokens: 1000,
          estimatedCostUsd: 0.01,
          startedAt: new Date(),
        },
        {
          requestId: 'b',
          upstreamProvider: 'or-x',
          upstreamModel: 'deepseek/chat',
          status: 200,
          totalTokens: 2000,
          estimatedCostUsd: 0.02,
          startedAt: new Date(),
        },
        {
          requestId: 'c',
          upstreamProvider: 'or-x',
          upstreamModel: 'cheap/model',
          status: 200,
          totalTokens: 500,
          estimatedCostUsd: 0.001,
          startedAt: new Date(),
        },
      ],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/metrics',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.costToday).toBeCloseTo(0.031, 6);
    expect(body.cost7d).toBeCloseTo(0.031, 6);
    // top 2：deepseek 0.03 > cheap 0.001
    expect(body.topCostModels).toHaveLength(2);
    expect(body.topCostModels[0].upstreamModel).toBe('deepseek/chat');
    expect(body.topCostModels[0].costUsd).toBeCloseTo(0.03, 6);
    expect(body.topCostModels[0].requests).toBe(2);
    expect(body.topCostModels[1].upstreamModel).toBe('cheap/model');
  });

  it('无 cost 数据 → 字段为 0 / 空数组', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/metrics',
      headers: { cookie: sessionCookie },
    });
    const body = res.json();
    expect(body.costToday).toBe(0);
    expect(body.cost7d).toBe(0);
    expect(body.topCostModels).toEqual([]);
  });
});
