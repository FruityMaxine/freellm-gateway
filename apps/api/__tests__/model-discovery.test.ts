import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import {
  ProviderRegistry,
  parseProviderConfig,
  MockOpenRouterProvider,
} from '@freellm/provider-core';
import { ModelDiscoveryService } from '../src/services/model-discovery.service.js';
import { EventBus } from '../src/services/event-bus.js';
import { _setConfigForTests } from '../src/config.js';

const TEST_DB = './data/freellm-discovery-test.db';
let prisma: PrismaClient;
let registry: ProviderRegistry;
let bus: EventBus;

beforeAll(() => {
  // Stand up an isolated SQLite file for this suite.
  if (existsSync(TEST_DB)) rmSync(TEST_DB);
  mkdirSync('./data', { recursive: true });
  execSync(`DATABASE_URL=\"file:${TEST_DB}\" npx prisma db push --schema prisma/schema.prisma --skip-generate --accept-data-loss`, {
    cwd: process.cwd().endsWith('/apps/api')
      ? `${process.cwd()}/../..`
      : process.cwd(),
    stdio: 'pipe',
  });
  _setConfigForTests({
    version: '0.2.0.0',
    env: makeTestEnv(),
  });
  prisma = new PrismaClient({ datasources: { db: { url: `file:${TEST_DB}` } } });
  registry = new ProviderRegistry();
  bus = new EventBus();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Wipe data between tests so each is hermetic.
  await prisma.errorEvent.deleteMany();
  await prisma.modelSnapshot.deleteMany();
  await prisma.modelScore.deleteMany();
  await prisma.model.deleteMany();
  await prisma.provider.deleteMany();
  registry.clear();

  await prisma.provider.create({
    data: { slug: 'openrouter', kind: 'openrouter', name: 'OR', baseUrl: 'http://mock' },
  });
  const cfg = parseProviderConfig({
    slug: 'openrouter',
    kind: 'openrouter',
    name: 'OR',
    baseUrl: 'http://mock',
  });
  // Directly install a MockOpenRouterProvider — bypass the factory because we
  // want the fixture-backed provider, not the live HTTP one.
  const provider = new MockOpenRouterProvider(cfg, { apiKey: null, baseUrl: 'http://mock' });
  (registry as unknown as { providers: Map<string, unknown> }).providers.set('openrouter', provider);
});

describe('ModelDiscoveryService', () => {
  it('first cycle creates all fixture models and emits "added" events', async () => {
    const svc = new ModelDiscoveryService({ prisma, registry, events: bus });
    const reports = await svc.refreshAll();
    expect(reports).toHaveLength(1);
    expect(reports[0]!.ok).toBe(true);
    expect(reports[0]!.discovered).toBeGreaterThanOrEqual(8);

    const models = await prisma.model.findMany();
    expect(models.length).toBe(reports[0]!.discovered);
    expect(models.every((m) => m.status === 'active')).toBe(true);

    const snapshots = await prisma.modelSnapshot.findMany();
    expect(snapshots.length).toBe(models.length);

    const events = await prisma.errorEvent.findMany({ where: { kind: 'model_change' } });
    expect(events.length).toBeGreaterThanOrEqual(models.length);
  });

  it('second cycle with no changes produces zero diff events', async () => {
    const svc = new ModelDiscoveryService({ prisma, registry, events: bus });
    await svc.refreshAll();
    const second = await svc.refreshAll();
    expect(second[0]!.events).toHaveLength(0);
  });

  it('mutating fixture detects removed + paid_now + capability change', async () => {
    const svc = new ModelDiscoveryService({ prisma, registry, events: bus });
    await svc.refreshAll();

    // Mutate the mock provider's payload between cycles.
    const provider = registry.get('openrouter') as MockOpenRouterProvider;
    // Drop one free model entirely (remove)
    provider.fixtureModels = provider.fixtureModels.filter(
      (m) => (m as { id: string }).id !== 'meta-llama/llama-3.3-70b-instruct:free',
    );
    // Flip Qwen 2.5 72b to paid by overriding pricing
    provider.fixtureModels = provider.fixtureModels.map((m) => {
      const e = m as { id: string; pricing?: { prompt?: string; completion?: string }; supported_parameters?: string[] };
      if (e.id === 'qwen/qwen-2.5-72b-instruct:free') {
        return { ...e, pricing: { prompt: '0.00001', completion: '0.00002', request: '0', image: '0' } };
      }
      if (e.id === 'google/gemma-2-9b-it:free') {
        // Add a capability (response_format / tools)
        return { ...e, supported_parameters: ['temperature', 'max_tokens', 'response_format', 'tools'] };
      }
      return e;
    });

    const second = await svc.refreshAll();
    const kinds = second[0]!.events.map((e) => e.kind);
    expect(kinds).toContain('removed');
    expect(kinds).toContain('paid_now');
    expect(kinds).toContain('capability_changed');

    // Verify DB reflects the changes
    const llama = await prisma.model.findFirst({
      where: { upstreamId: 'meta-llama/llama-3.3-70b-instruct:free' },
    });
    expect(llama?.status).toBe('removed');

    const qwen = await prisma.model.findFirst({
      where: { upstreamId: 'qwen/qwen-2.5-72b-instruct:free' },
    });
    expect(qwen?.status).toBe('paid_now');
    expect(qwen?.isFree).toBe(false);
  });

  it('upstream failure marks provider degraded + writes provider_outage event', async () => {
    const provider = registry.get('openrouter') as MockOpenRouterProvider;
    provider.listModelsFault = 'rate_limited';
    const svc = new ModelDiscoveryService({ prisma, registry, events: bus });
    const reports = await svc.refreshAll();
    expect(reports[0]!.ok).toBe(false);
    const row = await prisma.provider.findUnique({ where: { slug: 'openrouter' } });
    expect(row?.status).toBe('degraded');
    const outage = await prisma.errorEvent.findFirst({
      where: { kind: 'provider_outage' },
    });
    expect(outage).toBeTruthy();
  });

  it('emits global EventBus messages', async () => {
    const seen: string[] = [];
    bus.onAny((ev) => {
      seen.push(ev.topic);
    });
    const svc = new ModelDiscoveryService({ prisma, registry, events: bus });
    await svc.refreshAll();
    expect(seen).toContain('model:added');
    expect(seen).toContain('discovery:cycle');
  });
});

function makeTestEnv() {
  return {
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
    FREELLM_MOCK_PROVIDERS_ENABLED: true,
  };
}
