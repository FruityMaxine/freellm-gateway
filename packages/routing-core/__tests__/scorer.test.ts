import { describe, it, expect } from 'vitest';
import {
  scoreModel,
  applyScoreSample,
  ewmaUpdate,
  FULL_WEIGHTS_WITH_FIRST_TOKEN,
} from '../src/scorer.js';

const BASE = {
  modelId: 'm1',
  upstreamId: 'foo/bar:free',
  providerSlug: 'mock',
  availability: 0.8,
  latency: 0.7,
  rateLimit: 0.9,
  quality: 0.6,
  context: 0.7,
  freshness: 0.5,
  cost: 1,
  stability: 0.6,
  firstTokenLatency: 0.7,
  weightAdj: 0,
  blacklisted: false,
  whitelisted: false,
  capabilities: { stream: true, json: true, tools: false, vision: false, audio: false },
  contextLength: 32_000,
  isFree: true,
};

describe('scoreModel', () => {
  it('produces composite in [0,1]', () => {
    const r = scoreModel(BASE);
    expect(r.composite).toBeGreaterThanOrEqual(0);
    expect(r.composite).toBeLessThanOrEqual(1);
  });

  it('produces 9 dimension contributions', () => {
    const r = scoreModel(BASE);
    expect(r.dimensions).toHaveLength(9);
    const sum = r.dimensions.reduce((acc, d) => acc + d.contribution, 0);
    // weightAdj=0, blacklist=0, whitelist=0, isFree+cost=0 bonus → composite ≈ sum + 0.02
    expect(Math.abs(r.composite - (sum + 0.02))).toBeLessThan(0.01);
  });

  it('blacklisted models collapse to 0', () => {
    const r = scoreModel({ ...BASE, blacklisted: true });
    expect(r.composite).toBe(0);
  });

  it('whitelisted models gain a small bonus', () => {
    const base = scoreModel(BASE);
    const white = scoreModel({ ...BASE, whitelisted: true });
    expect(white.composite).toBeGreaterThan(base.composite);
  });

  it('weightAdj nudges the score', () => {
    const pos = scoreModel({ ...BASE, weightAdj: 1 });
    const neg = scoreModel({ ...BASE, weightAdj: -1 });
    expect(pos.composite).toBeGreaterThan(neg.composite);
  });

  it('summary cites the top dimensions', () => {
    const r = scoreModel(BASE);
    expect(r.summary).toMatch(/\d+%/);
  });

  it('uses custom weights from policy', () => {
    const r = scoreModel(BASE, { weights: { latency: 1, availability: 0, rateLimit: 0 } as never });
    const latencyDim = r.dimensions.find((d) => d.dimension === 'latency');
    expect(latencyDim?.weight).toBe(1);
  });

  it('clamps NaN sub-scores to 0', () => {
    const r = scoreModel({ ...BASE, availability: Number.NaN });
    const avail = r.dimensions.find((d) => d.dimension === 'availability');
    expect(avail?.rawScore).toBe(0);
  });
});

describe('applyScoreSample (EWMA)', () => {
  const seed = {
    availabilityScore: 0.5,
    latencyScore: 0.5,
    rateLimitScore: 0.5,
    stabilityScore: 0.5,
    successCount24h: 0,
    failureCount24h: 0,
    rateLimit24h: 0,
    avgLatencyMs: 0,
    firstTokenLatencyMs: 0,
  };

  it('success raises availability + stability', () => {
    const r = applyScoreSample(seed, { ok: true, durationMs: 500 });
    expect(r.availabilityScore).toBeGreaterThan(seed.availabilityScore);
    expect(r.stabilityScore).toBeGreaterThan(seed.stabilityScore);
    expect(r.successCount24h).toBe(1);
  });

  it('failure lowers availability', () => {
    const r = applyScoreSample(seed, { ok: false, durationMs: 500, kind: 'timeout' });
    expect(r.availabilityScore).toBeLessThan(seed.availabilityScore);
    expect(r.failureCount24h).toBe(1);
  });

  it('rate_limited samples sink rate_limit score', () => {
    const r = applyScoreSample(seed, { ok: false, durationMs: 0, kind: 'rate_limited' });
    expect(r.rateLimitScore).toBeLessThan(seed.rateLimitScore);
    expect(r.rateLimit24h).toBe(1);
  });

  it('ewmaUpdate is a stable weighted average', () => {
    expect(ewmaUpdate(0.5, 1, 0.5)).toBe(0.75);
    expect(ewmaUpdate(0.5, 0, 0.5)).toBe(0.25);
  });

  it('FULL_WEIGHTS_WITH_FIRST_TOKEN keeps default 8 + adds firstTokenLatency', () => {
    expect(FULL_WEIGHTS_WITH_FIRST_TOKEN.firstTokenLatency).toBeGreaterThan(0);
  });
});
