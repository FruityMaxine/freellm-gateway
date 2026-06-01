import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { _setConfigForTests } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';

let app: FastifyInstance;

beforeAll(async () => {
  _setConfigForTests({
    version: '0.1.0.0',
    env: {
      FREELLM_API_HOST: '127.0.0.1',
      FREELLM_API_PORT: 0,
      FREELLM_API_BASE_URL: 'http://127.0.0.1:3001',
      FREELLM_WEB_ORIGIN: 'http://127.0.0.1:5173',
      FREELLM_NODE_ENV: 'test',
      FREELLM_LOG_LEVEL: 'error',
      DATABASE_URL: 'file:./data/freellm-test.db',
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
    },
  });
  const built = await buildApp();
  app = built.app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('returns 200 + ok envelope + service identity', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.ok).toBe(true);
    expect(json.service).toBe('freellm-api');
    expect(json.version).toBe('0.1.0.0');
    expect(json.env).toBe('test');
    expect(typeof json.timestamp).toBe('string');
  });

  it('attaches a request id header', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-freellm-request-id']).toMatch(/^req_[a-z0-9]+$/);
  });
});

describe('404 fallback', () => {
  it('returns the FreeLLM error envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/no-such-route' });
    expect(res.statusCode).toBe(404);
    const json = res.json();
    expect(json.error.code).toBe('not_found');
    expect(json.error.type).toBe('api_error');
    expect(typeof json.request_id).toBe('string');
  });
});

describe('mock provider is auto-registered', () => {
  it('exposes mock provider via the registry decorator', () => {
    expect(app.registry).toBeDefined();
    expect(app.registry.has('mock')).toBe(true);
  });
});
