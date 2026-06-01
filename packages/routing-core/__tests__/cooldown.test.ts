import { describe, it, expect } from 'vitest';
import { CooldownEngine, MemoryCooldownStore } from '../src/cooldown.js';

describe('CooldownEngine', () => {
  it('first failure registers a cooldown', async () => {
    const store = new MemoryCooldownStore();
    const engine = new CooldownEngine(store);
    const rec = await engine.registerFailure({
      scope: 'model',
      key: 'm1',
      reason: 'rate_limited',
      hintMs: 1000,
    });
    expect(rec.attempts).toBe(1);
    expect(rec.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('repeated failures double the backoff', async () => {
    const store = new MemoryCooldownStore();
    const engine = new CooldownEngine(store, { jitterPct: 0 });
    await engine.registerFailure({ scope: 'model', key: 'm1', reason: 'rl', hintMs: 1000 });
    const second = await engine.registerFailure({ scope: 'model', key: 'm1', reason: 'rl', hintMs: 1000 });
    expect(second.attempts).toBe(2);
    expect(second.backoffMs).toBeGreaterThanOrEqual(2000);
  });

  it('check returns allowed=false while active', async () => {
    const store = new MemoryCooldownStore();
    const engine = new CooldownEngine(store, { jitterPct: 0 });
    await engine.registerFailure({ scope: 'model', key: 'm1', reason: 'rl', hintMs: 5000 });
    const d = await engine.check('model', 'm1');
    expect(d.allowed).toBe(false);
  });

  it('check flips expired cooldown to half-open and allows one probe', async () => {
    const store = new MemoryCooldownStore();
    // Simulate a record that already expired.
    await store.upsert({
      id: 'cd-model-m1',
      scope: 'model',
      key: 'm1',
      reason: 'rl',
      attempts: 1,
      backoffMs: 1,
      expiresAt: new Date(Date.now() - 1_000),
      halfOpen: false,
    });
    const engine = new CooldownEngine(store);
    const first = await engine.check('model', 'm1');
    expect(first.allowed).toBe(true);
    expect(first.halfOpenProbe).toBe(true);
    const second = await engine.check('model', 'm1');
    expect(second.allowed).toBe(false);
    expect(second.halfOpenProbe).toBe(false);
  });

  it('registerSuccess clears the cooldown', async () => {
    const store = new MemoryCooldownStore();
    const engine = new CooldownEngine(store);
    await engine.registerFailure({ scope: 'model', key: 'm1', reason: 'rl', hintMs: 1000 });
    await engine.registerSuccess('model', 'm1');
    const d = await engine.check('model', 'm1');
    expect(d.allowed).toBe(true);
    expect(d.halfOpenProbe).toBe(false);
  });

  it('list returns scoped records', async () => {
    const store = new MemoryCooldownStore();
    const engine = new CooldownEngine(store);
    await engine.registerFailure({ scope: 'model', key: 'm1', reason: 'rl', hintMs: 1000 });
    await engine.registerFailure({ scope: 'provider', key: 'openrouter', reason: '503', hintMs: 1000 });
    expect((await engine.listActive('model'))).toHaveLength(1);
    expect((await engine.listActive('provider'))).toHaveLength(1);
    expect((await engine.listActive())).toHaveLength(2);
  });
});
