import { describe, it, expect } from 'vitest';
import { classifyFree, toDiscoveredModel } from '../src/free-detector.js';
import { FIXTURE_OPENROUTER_MODELS } from '../src/providers/openrouter-fixtures.js';
import { MockOpenRouterProvider } from '../src/providers/mock-openrouter.js';
import { parseProviderConfig } from '../src/config-schema.js';

describe('classifyFree', () => {
  it('all pricing fields zero + :free suffix → free, high confidence', () => {
    const r = classifyFree({
      upstreamId: 'meta-llama/llama-3.3:free',
      pricing: { prompt: '0', completion: '0', request: '0' },
    });
    expect(r.classification).toBe('free');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('all pricing zero, no :free suffix → still free', () => {
    const r = classifyFree({
      upstreamId: 'openrouter/free',
      pricing: { prompt: '0', completion: '0' },
    });
    expect(r.classification).toBe('free');
    expect(r.reason).toBe('pricing_all_zero');
  });

  it('non-zero pricing → paid', () => {
    const r = classifyFree({
      upstreamId: 'anthropic/claude-3.5-sonnet',
      pricing: { prompt: '0.000003', completion: '0.000015' },
    });
    expect(r.classification).toBe('paid');
    expect(r.reason).toBe('pricing_nonzero');
  });

  it('mixed: prompt 0, completion non-zero → paid', () => {
    const r = classifyFree({
      upstreamId: 'somecorp/model',
      pricing: { prompt: '0', completion: '0.00001' },
    });
    expect(r.classification).toBe('paid');
  });

  it(':free suffix without pricing → suspected', () => {
    const r = classifyFree({ upstreamId: 'edge/partial:free' });
    expect(r.classification).toBe('suspected');
    expect(r.reason).toBe('suffix_free');
  });

  it('id contains "free" without colon → suspected', () => {
    const r = classifyFree({ upstreamId: 'experimental/free-trial-model' });
    expect(r.classification).toBe('suspected');
  });

  it('no signals at all → unknown', () => {
    const r = classifyFree({ upstreamId: 'edge/no-pricing-test' });
    expect(r.classification).toBe('unknown');
    expect(r.reason).toBe('missing_pricing');
  });

  it('partial zero pricing + :free → free with partial reason', () => {
    const r = classifyFree({
      upstreamId: 'edge/partial-zero:free',
      pricing: { prompt: '0' },
    });
    expect(r.classification).toBe('free');
    expect(r.reason).toBe('pricing_partial_zero');
  });

  it('scientific zero notation counts as zero', () => {
    const r = classifyFree({
      upstreamId: 'foo/bar:free',
      pricing: { prompt: '0e0', completion: '0.0' },
    });
    expect(r.classification).toBe('free');
  });

  it('manual override force_free wins over paid pricing', () => {
    const r = classifyFree({
      upstreamId: 'anthropic/claude-3.5-sonnet',
      pricing: { prompt: '0.000003', completion: '0.000015' },
      manualOverride: 'force_free',
    });
    expect(r.classification).toBe('free');
    expect(r.reason).toBe('manual_override');
    expect(r.confidence).toBe(1);
  });

  it('manual override force_paid wins over zero pricing', () => {
    const r = classifyFree({
      upstreamId: 'meta-llama/x:free',
      pricing: { prompt: '0', completion: '0' },
      manualOverride: 'force_paid',
    });
    expect(r.classification).toBe('paid');
  });
});

describe('toDiscoveredModel', () => {
  it('derives a family tag and carries classification', async () => {
    const provider = new MockOpenRouterProvider(
      parseProviderConfig({
        slug: 'mock-or',
        kind: 'openrouter',
        name: 'Mock OpenRouter',
        baseUrl: 'http://127.0.0.1',
      }),
      { apiKey: null, baseUrl: 'http://127.0.0.1' },
    );
    const list = await provider.listModels();
    const llama = list.find((m) => m.upstreamId === 'meta-llama/llama-3.3-70b-instruct:free');
    expect(llama).toBeDefined();
    const dm = toDiscoveredModel(llama!);
    expect(dm.classification).toBe('free');
    expect(dm.family).toBe('llama');
    expect(dm.capabilities.tools).toBe(true);
    expect(dm.capabilities.json).toBe(true);
    expect(dm.capabilities.longContext).toBe(true);
  });

  it('correctly flags a paid model in the fixture', () => {
    const claude = FIXTURE_OPENROUTER_MODELS.data.find(
      (m) => m.id === 'anthropic/claude-3.5-sonnet',
    );
    expect(claude).toBeDefined();
    const r = classifyFree({
      upstreamId: claude!.id,
      pricing: claude!.pricing as { prompt: string; completion: string },
    });
    expect(r.classification).toBe('paid');
  });

  it('fixture has 7 free / 2 paid / 1 unknown', async () => {
    const provider = new MockOpenRouterProvider(
      parseProviderConfig({
        slug: 'mock-or',
        kind: 'openrouter',
        name: 'Mock OpenRouter',
        baseUrl: 'http://127.0.0.1',
      }),
      { apiKey: null, baseUrl: 'http://127.0.0.1' },
    );
    const list = await provider.listModels();
    const buckets = { free: 0, paid: 0, suspected: 0, unknown: 0 };
    for (const entry of list) {
      const dm = toDiscoveredModel(entry);
      buckets[dm.classification] += 1;
    }
    expect(buckets.free + buckets.paid + buckets.suspected + buckets.unknown).toBe(list.length);
    expect(buckets.free).toBeGreaterThanOrEqual(5);
    expect(buckets.paid).toBeGreaterThanOrEqual(2);
  });
});
