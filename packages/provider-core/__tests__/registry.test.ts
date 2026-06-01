import { describe, it, expect } from 'vitest';
import { ProviderRegistry, MockProvider, parseProviderConfig } from '../src/index.js';

describe('ProviderRegistry', () => {
  const cfg = parseProviderConfig({
    slug: 'mock',
    kind: 'mock',
    name: 'Mock',
    baseUrl: 'http://127.0.0.1',
  });
  const cred = { apiKey: null, baseUrl: 'http://127.0.0.1' };

  it('installs and looks up by slug', () => {
    const reg = new ProviderRegistry();
    const p = reg.install(cfg, cred);
    expect(p).toBeInstanceOf(MockProvider);
    expect(reg.get('mock')).toBe(p);
    expect(reg.has('mock')).toBe(true);
    expect(reg.list()).toHaveLength(1);
  });

  it('replaces on re-install', () => {
    const reg = new ProviderRegistry();
    const a = reg.install(cfg, cred);
    const b = reg.install(cfg, cred);
    expect(a).not.toBe(b);
    expect(reg.get('mock')).toBe(b);
  });

  it('throws on missing factory', () => {
    const reg = new ProviderRegistry();
    expect(() => reg.install({ ...cfg, kind: 'openrouter' }, cred)).toThrow(/factory/);
  });

  it('mock provider returns 2 free models', async () => {
    const reg = new ProviderRegistry();
    const provider = reg.install(cfg, cred);
    const models = await provider.listModels();
    expect(models).toHaveLength(2);
    expect(models[0]!.upstreamId).toBe('mock/echo:free');
    expect(models[0]!.pricing?.prompt).toBe('0');
  });

  it('mock complete echoes', async () => {
    const reg = new ProviderRegistry();
    const provider = reg.install(cfg, cred);
    const { response, outcome } = await provider.complete({
      model: 'mock/echo:free',
      messages: [{ role: 'user', content: 'hello world' }],
    });
    expect(outcome.ok).toBe(true);
    expect(response.choices[0]!.message.content).toContain('hello world');
  });
});
