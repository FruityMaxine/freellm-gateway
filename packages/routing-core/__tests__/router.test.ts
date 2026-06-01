import { describe, it, expect } from 'vitest';
import { Router, type PoolModel, type RouteRequestContext } from '../src/router.js';
import type { RoutingMode } from '@freellm/shared';

function mk(over: Partial<PoolModel> & { upstreamId: string; modelId: string }): PoolModel {
  return {
    modelId: over.modelId,
    upstreamId: over.upstreamId,
    providerSlug: over.providerSlug ?? 'openrouter',
    isFree: over.isFree ?? true,
    contextLength: over.contextLength ?? 32_000,
    capabilities:
      over.capabilities ?? { stream: true, json: false, tools: false, vision: false, audio: false },
    status: over.status ?? 'active',
    blacklisted: over.blacklisted ?? false,
    whitelisted: over.whitelisted ?? false,
    weightAdj: over.weightAdj ?? 0,
    scores: over.scores ?? {
      availability: 0.8,
      latency: 0.7,
      rateLimit: 0.8,
      quality: 0.6,
      context: 0.5,
      freshness: 0.5,
      cost: 1,
      stability: 0.6,
      firstTokenLatency: 0.7,
    },
  };
}

const POOL: PoolModel[] = [
  mk({ modelId: 'mA', upstreamId: 'a:free', isFree: true, scores: { availability: 0.9, latency: 0.9, rateLimit: 0.9, quality: 0.6, context: 0.5, freshness: 0.5, cost: 1, stability: 0.6, firstTokenLatency: 0.9 } }),
  mk({ modelId: 'mB', upstreamId: 'b:free', isFree: true, scores: { availability: 0.4, latency: 0.6, rateLimit: 0.5, quality: 0.6, context: 0.5, freshness: 0.5, cost: 1, stability: 0.6, firstTokenLatency: 0.6 } }),
  mk({ modelId: 'mC', upstreamId: 'c-paid', isFree: false, scores: { availability: 0.99, latency: 0.99, rateLimit: 0.99, quality: 0.99, context: 0.99, freshness: 0.5, cost: 0, stability: 0.99, firstTokenLatency: 0.99 } }),
  mk({ modelId: 'mD', upstreamId: 'd:free', isFree: true, status: 'rate_limited' }),
  mk({ modelId: 'mE', upstreamId: 'openrouter/free', isFree: true, providerSlug: 'openrouter' }),
  mk({ modelId: 'mF', upstreamId: 'f:free', isFree: true, blacklisted: true }),
];

function ctx(mode: RoutingMode, over: Partial<RouteRequestContext> = {}): RouteRequestContext {
  return {
    alias: over.alias,
    explicitModel: over.explicitModel,
    requireCapabilities: over.requireCapabilities,
    permissions: over.permissions,
    policy: { name: 'default', mode, weights: undefined, params: over.policy?.params },
    maxCandidates: over.maxCandidates ?? 4,
  };
}

describe('Router', () => {
  it('auto-best-free picks the highest-composite free model first', () => {
    const r = new Router();
    const d = r.decide(POOL, ctx('auto-best-free', { alias: 'free/auto' }));
    expect(d.candidates[0]!.model.modelId).toBe('mA');
    expect(d.candidates.every((c) => c.model.isFree)).toBe(true);
  });

  it('blacklisted models do not appear', () => {
    const r = new Router();
    const d = r.decide(POOL, ctx('auto-best-free', { alias: 'free/auto' }));
    expect(d.candidates.find((c) => c.model.modelId === 'mF')).toBeUndefined();
    expect(d.filteredOut.find((x) => x.upstreamId === 'f:free')).toBeDefined();
  });

  it('openrouter-free-router only returns the openrouter/free model', () => {
    const r = new Router();
    const d = r.decide(POOL, ctx('openrouter-free-router'));
    expect(d.candidates).toHaveLength(1);
    expect(d.candidates[0]!.model.upstreamId).toBe('openrouter/free');
  });

  it('prefer-model-fallback puts explicit model first then auto pool', () => {
    const r = new Router();
    const d = r.decide(POOL, ctx('prefer-model-fallback', { explicitModel: 'b:free' }));
    expect(d.candidates[0]!.model.modelId).toBe('mB');
  });

  it('provider-specific filters to one provider', () => {
    const ALT = POOL.map((m) => (m.modelId === 'mA' ? { ...m, providerSlug: 'mock' } : m));
    const r = new Router();
    const d = r.decide(ALT, ctx('provider-specific', { policy: { name: 'p', mode: 'provider-specific', params: { providerSlug: 'mock' } } }));
    expect(d.candidates.every((c) => c.model.providerSlug === 'mock')).toBe(true);
  });

  it('paid-allowed surfaces paid models alongside free', () => {
    const r = new Router();
    const d = r.decide(POOL, ctx('paid-allowed', { maxCandidates: 6 }));
    expect(d.candidates.some((c) => c.model.isFree === false)).toBe(true);
  });

  it('respects virtual-key allowedModels list', () => {
    const r = new Router();
    const d = r.decide(POOL, ctx('auto-best-free', {
      permissions: {
        allowedModels: ['a:free'],
        deniedModels: [],
        allowedProviders: [],
        allowPaidModels: false,
        allowStreaming: true,
      },
    }));
    expect(d.candidates).toHaveLength(1);
    expect(d.candidates[0]!.model.upstreamId).toBe('a:free');
  });

  it('respects virtual-key deniedModels list', () => {
    const r = new Router();
    const d = r.decide(POOL, ctx('auto-best-free', {
      permissions: {
        allowedModels: [],
        deniedModels: ['a:free'],
        allowedProviders: [],
        allowPaidModels: true,
        allowStreaming: true,
      },
    }));
    expect(d.candidates.find((c) => c.model.upstreamId === 'a:free')).toBeUndefined();
  });

  it('capability filter drops models without tools support', () => {
    const r = new Router();
    const d = r.decide(POOL, ctx('auto-best-free', {
      requireCapabilities: { tools: true },
    }));
    expect(d.candidates.every((c) => c.model.capabilities.tools)).toBe(true);
  });

  it('minContextLength filter removes small-context models', () => {
    const r = new Router();
    const d = r.decide(POOL, ctx('auto-best-free', {
      requireCapabilities: { minContextLength: 100_000 },
    }));
    expect(d.candidates.every((c) => c.model.contextLength >= 100_000)).toBe(true);
  });

  it('no candidates returns empty list + filteredOut entries', () => {
    const r = new Router();
    const d = r.decide([], ctx('auto-best-free'));
    expect(d.candidates).toHaveLength(0);
  });
});
