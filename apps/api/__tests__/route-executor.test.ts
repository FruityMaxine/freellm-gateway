import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import {
  ProviderRegistry,
  parseProviderConfig,
  MockProvider,
} from '@freellm/provider-core';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ProviderCallOutcome,
} from '@freellm/provider-core';
import type { PoolModel, RouteRequestContext } from '@freellm/routing-core';
import { PrismaCooldownStore } from '../src/services/prisma-cooldown-store.js';
import { ScoreUpdaterService } from '../src/services/score-updater.service.js';
import { _setConfigForTests } from '../src/config.js';

// vitest will resolve the import via tsc/jiti at runtime — we keep the
// canonical path through services/ to avoid duplication.
// (re-import from services to get the typed class)
import { RouteExecutorService as RealRouteExecutorService } from '../src/services/route-executor.service.js';

const TEST_DB = './data/freellm-executor-test.db';
let prisma: PrismaClient;
let registry: ProviderRegistry;

beforeAll(() => {
  if (existsSync(TEST_DB)) rmSync(TEST_DB);
  mkdirSync('./data', { recursive: true });
  execSync(
    `DATABASE_URL=\"file:${TEST_DB}\" npx prisma db push --schema prisma/schema.prisma --skip-generate --accept-data-loss`,
    {
      cwd: process.cwd().endsWith('/apps/api') ? `${process.cwd()}/../..` : process.cwd(),
      stdio: 'pipe',
    },
  );
  _setConfigForTests({
    version: '0.3.0.0',
    env: testEnv(),
  });
  prisma = new PrismaClient({ datasources: { db: { url: `file:${TEST_DB}` } } });
  registry = new ProviderRegistry();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// Provider that fails N times then succeeds.
class FlakyProvider extends MockProvider {
  remainingFailures = 0;
  failureKind = 'rate_limited';
  failureStatus = 429;

  override async complete(req: ChatCompletionRequest) {
    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      const outcome: ProviderCallOutcome = {
        ok: false,
        durationMs: 5,
        status: this.failureStatus,
        errorKind: this.failureKind,
        errorMessage: `simulated ${this.failureKind}`,
        upstreamModel: req.model,
      };
      const response: ChatCompletionResponse = {
        id: 'err',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: req.model,
        choices: [],
      };
      return { response, outcome };
    }
    return super.complete(req);
  }
  override async stream(req: ChatCompletionRequest) {
    return super.stream(req);
  }
}

class AlwaysFailProvider extends MockProvider {
  status: number;
  kind: string;
  constructor(...args: ConstructorParameters<typeof MockProvider>) {
    super(...args);
    this.status = 503;
    this.kind = 'provider_unavailable';
  }
  override async complete(req: ChatCompletionRequest) {
    const outcome: ProviderCallOutcome = {
      ok: false,
      durationMs: 5,
      status: this.status,
      errorKind: this.kind,
      errorMessage: 'always fails',
      upstreamModel: req.model,
    };
    const response: ChatCompletionResponse = {
      id: 'err',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: req.model,
      choices: [],
    };
    return { response, outcome };
  }
}

beforeEach(async () => {
  await prisma.cooldown.deleteMany();
  await prisma.routeAttempt.deleteMany();
  await prisma.requestLog.deleteMany();
  await prisma.modelScore.deleteMany();
  await prisma.model.deleteMany();
  await prisma.provider.deleteMany();
  registry.clear();

  // Seed three providers + models in DB.
  const p1 = await prisma.provider.create({
    data: { slug: 'fast', kind: 'mock', name: 'Fast', baseUrl: 'mock://' },
  });
  const p2 = await prisma.provider.create({
    data: { slug: 'slow', kind: 'mock', name: 'Slow', baseUrl: 'mock://' },
  });
  const p3 = await prisma.provider.create({
    data: { slug: 'broken', kind: 'mock', name: 'Broken', baseUrl: 'mock://' },
  });
  await prisma.model.create({
    data: {
      providerId: p1.id,
      upstreamId: 'fast/echo:free',
      displayName: 'Fast Echo',
      contextLength: 32_000,
      isFree: true,
      capabilitiesJson: JSON.stringify({ stream: true, json: false, tools: false, vision: false, audio: false }),
      status: 'active',
    },
  });
  await prisma.model.create({
    data: {
      providerId: p2.id,
      upstreamId: 'slow/echo:free',
      displayName: 'Slow Echo',
      contextLength: 16_000,
      isFree: true,
      capabilitiesJson: JSON.stringify({ stream: true, json: false, tools: false, vision: false, audio: false }),
      status: 'active',
    },
  });
  await prisma.model.create({
    data: {
      providerId: p3.id,
      upstreamId: 'broken/echo:free',
      displayName: 'Broken',
      contextLength: 8_000,
      isFree: true,
      capabilitiesJson: JSON.stringify({ stream: true, json: false, tools: false, vision: false, audio: false }),
      status: 'active',
    },
  });

  // Register providers
  const cfg1 = parseProviderConfig({ slug: 'fast', kind: 'mock', name: 'Fast', baseUrl: 'mock://' });
  const cfg2 = parseProviderConfig({ slug: 'slow', kind: 'mock', name: 'Slow', baseUrl: 'mock://' });
  const cfg3 = parseProviderConfig({ slug: 'broken', kind: 'mock', name: 'Broken', baseUrl: 'mock://' });
  (registry as unknown as { providers: Map<string, unknown> }).providers.set(
    'fast',
    new FlakyProvider(cfg1, { apiKey: null, baseUrl: 'mock://' }),
  );
  (registry as unknown as { providers: Map<string, unknown> }).providers.set(
    'slow',
    new MockProvider(cfg2, { apiKey: null, baseUrl: 'mock://' }),
  );
  (registry as unknown as { providers: Map<string, unknown> }).providers.set(
    'broken',
    new AlwaysFailProvider(cfg3, { apiKey: null, baseUrl: 'mock://' }),
  );
});

async function buildPool(): Promise<PoolModel[]> {
  const models = await prisma.model.findMany({ include: { provider: true } });
  return models.map((m) => ({
    modelId: m.id,
    upstreamId: m.upstreamId,
    providerSlug: m.provider.slug,
    isFree: m.isFree,
    contextLength: m.contextLength,
    capabilities: JSON.parse(m.capabilitiesJson),
    status: m.status as PoolModel['status'],
    blacklisted: m.blacklisted,
    whitelisted: m.whitelisted,
    weightAdj: m.weightAdj,
    scores: { availability: 0.8, latency: 0.8, rateLimit: 0.8, quality: 0.6, context: 0.5, freshness: 0.5, cost: 1, stability: 0.6, firstTokenLatency: 0.8 },
  }));
}

function makeCtx(): RouteRequestContext {
  return { policy: { name: 'default', mode: 'auto-best-free' }, alias: 'free/auto', maxCandidates: 4 };
}

describe('RouteExecutorService', () => {
  it('succeeds on the first healthy candidate', async () => {
    const exec = new RealRouteExecutorService({
      prisma,
      registry,
      cooldownStore: new PrismaCooldownStore(prisma),
      scoreUpdater: new ScoreUpdaterService(prisma),
      maxAttempts: 4,
    });
    const result = await exec.execute({
      request: { model: 'free/auto', messages: [{ role: 'user', content: 'hi' }] },
      ctx: makeCtx(),
      pool: await buildPool(),
      streaming: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok && 'response' in result) {
      expect(result.attempts.length).toBeGreaterThanOrEqual(1);
      expect(result.attempts[result.attempts.length - 1]!.ok).toBe(true);
    }
    expect(await prisma.requestLog.count()).toBe(1);
  });

  it('429 on first provider falls back to next; cooldown row written', async () => {
    const flaky = registry.get('fast') as FlakyProvider;
    flaky.remainingFailures = 2; // both fast attempts fail before fallback
    const exec = new RealRouteExecutorService({
      prisma,
      registry,
      cooldownStore: new PrismaCooldownStore(prisma),
      maxAttempts: 4,
    });
    const result = await exec.execute({
      request: { model: 'free/auto', messages: [{ role: 'user', content: 'hi' }] },
      ctx: makeCtx(),
      pool: await buildPool(),
      streaming: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempts.length).toBeGreaterThanOrEqual(2);
      // One of the early attempts should be a fast/echo failure.
      expect(result.attempts.some((a) => !a.ok && a.providerSlug === 'fast')).toBe(true);
    }
    const cooldowns = await prisma.cooldown.findMany();
    expect(cooldowns.length).toBeGreaterThanOrEqual(1);
  });

  it('all attempts failing returns all_attempts_failed error', async () => {
    const flaky = registry.get('fast') as FlakyProvider;
    flaky.remainingFailures = 10;
    const broken = registry.get('broken') as AlwaysFailProvider;
    // also break slow
    (registry as unknown as { providers: Map<string, unknown> }).providers.set(
      'slow',
      new AlwaysFailProvider(
        parseProviderConfig({ slug: 'slow', kind: 'mock', name: 'Slow', baseUrl: 'mock://' }),
        { apiKey: null, baseUrl: 'mock://' },
      ),
    );

    const exec = new RealRouteExecutorService({
      prisma,
      registry,
      cooldownStore: new PrismaCooldownStore(prisma),
      maxAttempts: 4,
    });
    const result = await exec.execute({
      request: { model: 'free/auto', messages: [{ role: 'user', content: 'hi' }] },
      ctx: makeCtx(),
      pool: await buildPool(),
      streaming: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('all_attempts_failed');
    }
    void broken;
  });

  it('persists route_attempts to DB', async () => {
    const flaky = registry.get('fast') as FlakyProvider;
    flaky.remainingFailures = 1;
    const exec = new RealRouteExecutorService({
      prisma,
      registry,
      cooldownStore: new PrismaCooldownStore(prisma),
      maxAttempts: 4,
    });
    const result = await exec.execute({
      request: { model: 'free/auto', messages: [{ role: 'user', content: 'hi' }] },
      ctx: makeCtx(),
      pool: await buildPool(),
      streaming: false,
    });
    expect(result.ok).toBe(true);
    const attempts = await prisma.routeAttempt.findMany();
    expect(attempts.length).toBeGreaterThanOrEqual(1);
  });

  it('non-retriable failure breaks the loop early', async () => {
    const flaky = registry.get('fast') as FlakyProvider;
    flaky.remainingFailures = 1;
    flaky.failureKind = 'content_filter';
    flaky.failureStatus = 451;
    const exec = new RealRouteExecutorService({
      prisma,
      registry,
      cooldownStore: new PrismaCooldownStore(prisma),
      maxAttempts: 4,
    });
    const result = await exec.execute({
      request: { model: 'free/auto', messages: [{ role: 'user', content: 'hi' }] },
      ctx: makeCtx(),
      pool: await buildPool(),
      streaming: false,
    });
    // first candidate fails with content_filter → loop should stop, no fallback
    expect(result.attempts.length).toBe(1);
    expect(result.ok).toBe(false);
  });
});

function testEnv() {
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
