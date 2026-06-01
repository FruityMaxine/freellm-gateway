/**
 * Tick 26 v1.6.1.0 单元 + 集成测试：
 * - WebhookSubscriptionService CRUD + topic 匹配 + URL/secret 校验
 * - WebhookDispatcherService 重试逻辑 + topic 过滤 + 签名头注入
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { WebhookSubscriptionService } from '../src/services/webhook-subscription.service.js';
import { WebhookDispatcherService } from '../src/services/webhook-dispatcher.service.js';
import { EventBus } from '../src/services/event-bus.js';
import { FreeLLMError } from '@freellm/shared';

const TEST_DB = resolvePath(
  process.cwd().endsWith('/apps/api')
    ? `${process.cwd()}/../../data/freellm-tick26-test.db`
    : `${process.cwd()}/data/freellm-tick26-test.db`,
);

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
  prisma = new PrismaClient({ datasources: { db: { url: `file:${TEST_DB}` } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Tick 26 — WebhookSubscriptionService 校验', () => {
  const svc = () => new WebhookSubscriptionService(prisma);

  it('合法 https URL 通过', () => {
    expect(() => svc().validateUrl('https://example.com/hook')).not.toThrow();
    expect(() => svc().validateUrl('http://localhost:8080/x')).not.toThrow();
  });

  it('非 http(s) URL 抛 bad_request', () => {
    expect(() => svc().validateUrl('ftp://x.com')).toThrow(FreeLLMError);
    expect(() => svc().validateUrl('javascript:alert(1)')).toThrow(FreeLLMError);
    expect(() => svc().validateUrl('not a url')).toThrow(FreeLLMError);
  });

  it('secret 长度 < 8 抛 bad_request', () => {
    expect(() => svc().validateSecret('short')).toThrow(FreeLLMError);
    expect(() => svc().validateSecret('1234567')).toThrow(FreeLLMError);
    expect(() => svc().validateSecret('12345678')).not.toThrow();
  });
});

describe('Tick 26 — WebhookSubscriptionService CRUD + topic 匹配', () => {
  beforeEach(async () => {
    await prisma.webhookSubscription.deleteMany();
  });

  it('create + list + findById 闭环', async () => {
    const svc = new WebhookSubscriptionService(prisma);
    const sub = await svc.create({
      url: 'https://hooks.example.com/freellm',
      secret: 'super-secret-key-xyz',
      eventTopics: ['model:added', 'discovery:cycle'],
    });
    expect(sub.id).toBeDefined();
    expect(sub.eventTopicsJson).toBe('["model:added","discovery:cycle"]');

    const list = await svc.list();
    expect(list).toHaveLength(1);

    const fetched = await svc.findById(sub.id);
    expect(fetched?.url).toBe('https://hooks.example.com/freellm');
  });

  it('eventTopics 为空 → 订阅所有 topic（findMatching 永远命中）', async () => {
    const svc = new WebhookSubscriptionService(prisma);
    await svc.create({
      url: 'https://hooks.example.com/all',
      secret: 'super-secret-key-xyz',
      eventTopics: [],
    });
    expect(await svc.findMatching('any:topic')).toHaveLength(1);
    expect(await svc.findMatching('another')).toHaveLength(1);
  });

  it('eventTopics 非空 → 按字面相等匹配', async () => {
    const svc = new WebhookSubscriptionService(prisma);
    await svc.create({
      url: 'https://hooks.example.com/specific',
      secret: 'super-secret-key-xyz',
      eventTopics: ['model:added'],
    });
    expect(await svc.findMatching('model:added')).toHaveLength(1);
    expect(await svc.findMatching('model:removed')).toHaveLength(0);
  });

  it('enabled=false 的订阅不会被 findMatching 选中', async () => {
    const svc = new WebhookSubscriptionService(prisma);
    const sub = await svc.create({
      url: 'https://hooks.example.com/x',
      secret: 'super-secret-key-xyz',
      eventTopics: ['model:added'],
    });
    await svc.update(sub.id, { enabled: false });
    expect(await svc.findMatching('model:added')).toHaveLength(0);
  });

  it('delete 删除订阅 + recordDelivery 累加统计', async () => {
    const svc = new WebhookSubscriptionService(prisma);
    const sub = await svc.create({
      url: 'https://hooks.example.com/y',
      secret: 'super-secret-key-xyz',
    });
    await svc.recordDelivery(sub.id, true);
    await svc.recordDelivery(sub.id, false, 'connection refused');
    const after = await svc.findById(sub.id);
    expect(after?.totalDeliveries).toBe(2);
    expect(after?.totalFailures).toBe(1);
    expect(after?.lastSuccessAt).toBeInstanceOf(Date);
    expect(after?.lastErrorMessage).toBe('connection refused');

    await svc.delete(sub.id);
    expect(await svc.findById(sub.id)).toBeNull();
  });
});

describe('Tick 26 — WebhookDispatcherService 重试 + 签名头', () => {
  beforeEach(async () => {
    await prisma.webhookSubscription.deleteMany();
    await prisma.errorEvent.deleteMany();
  });

  it('首次 2xx 成功 → 仅 1 次 fetch + 不重试 + 记 success', async () => {
    const svc = new WebhookSubscriptionService(prisma);
    const sub = await svc.create({
      url: 'https://hooks.example.com/ok',
      secret: 'super-secret-key-xyz',
      eventTopics: ['test:topic'],
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    const bus = new EventBus();
    const dispatcher = new WebhookDispatcherService(prisma, bus, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      maxAttempts: 3,
      baseBackoffMs: 1,
    });
    dispatcher.attach();
    await bus.emit('test:topic', { hello: 'world' });
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const after = await svc.findById(sub.id);
    expect(after?.totalDeliveries).toBe(1);
    expect(after?.totalFailures).toBe(0);
  });

  it('全部 5xx 失败 → 3 次重试 + 记 error_events + totalFailures+1', async () => {
    const svc = new WebhookSubscriptionService(prisma);
    const sub = await svc.create({
      url: 'https://hooks.example.com/fail',
      secret: 'super-secret-key-xyz',
      eventTopics: ['fail:topic'],
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    const bus = new EventBus();
    const dispatcher = new WebhookDispatcherService(prisma, bus, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      maxAttempts: 3,
      baseBackoffMs: 1,
    });
    dispatcher.attach();
    await bus.emit('fail:topic', {});
    await new Promise((r) => setTimeout(r, 100));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const after = await svc.findById(sub.id);
    expect(after?.totalFailures).toBeGreaterThanOrEqual(1);
    const errs = await prisma.errorEvent.findMany({ where: { kind: 'webhook_delivery_failed' } });
    expect(errs.length).toBeGreaterThanOrEqual(1);
  });

  it('topic 不匹配 → 不调 fetch', async () => {
    const svc = new WebhookSubscriptionService(prisma);
    await svc.create({
      url: 'https://hooks.example.com/skip',
      secret: 'super-secret-key-xyz',
      eventTopics: ['only:this'],
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    const bus = new EventBus();
    const dispatcher = new WebhookDispatcherService(prisma, bus, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    dispatcher.attach();
    await bus.emit('not:matching', {});
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('请求头含 X-FreeLLM-Signature / X-FreeLLM-Delivery / X-FreeLLM-Event', async () => {
    const svc = new WebhookSubscriptionService(prisma);
    await svc.create({
      url: 'https://hooks.example.com/headers',
      secret: 'super-secret-key-xyz',
      eventTopics: ['head:test'],
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    const bus = new EventBus();
    const dispatcher = new WebhookDispatcherService(prisma, bus, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    dispatcher.attach();
    await bus.emit('head:test', { x: 1 });
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).toHaveBeenCalled();
    const args = fetchMock.mock.calls[0]!;
    const init = args[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['X-FreeLLM-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(headers['X-FreeLLM-Delivery']).toMatch(/^[0-9a-f-]+$/);
    expect(headers['X-FreeLLM-Event']).toBe('head:test');
    expect(headers['Content-Type']).toBe('application/json');
  });
});
