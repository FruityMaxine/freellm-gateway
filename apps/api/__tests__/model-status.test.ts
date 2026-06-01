import { describe, it, expect } from 'vitest';
import {
  nextModelStatus,
  isTerminalStatus,
  listAllowedTransitions,
} from '../src/lib/state-machine/model-status.js';

describe('nextModelStatus', () => {
  it('first sighting flips removed → active', () => {
    const r = nextModelStatus('removed', 'discovery_first_seen');
    expect(r.changed).toBe(true);
    expect(r.to).toBe('active');
  });

  it('still-present keeps active as active', () => {
    const r = nextModelStatus('active', 'discovery_still_present');
    expect(r.changed).toBe(false);
    expect(r.to).toBe('active');
  });

  it('manual disable from any state', () => {
    expect(nextModelStatus('active', 'manual_disable').to).toBe('disabled');
    expect(nextModelStatus('removed', 'manual_disable').to).toBe('disabled');
  });

  it('rate-limit transition from active', () => {
    const r = nextModelStatus('active', 'route_rate_limited');
    expect(r.changed).toBe(true);
    expect(r.to).toBe('rate_limited');
  });

  it('rejects route_rate_limited from disabled', () => {
    const r = nextModelStatus('disabled', 'route_rate_limited');
    expect(r.changed).toBe(false);
    expect(r.reason).toMatch(/not allowed/);
  });

  it('pricing returns free → active from paid_now', () => {
    const r = nextModelStatus('paid_now', 'discovery_pricing_returned_free');
    expect(r.changed).toBe(true);
    expect(r.to).toBe('active');
  });

  it('removed is terminal', () => {
    expect(isTerminalStatus('removed')).toBe(true);
    expect(isTerminalStatus('active')).toBe(false);
  });

  it('listAllowedTransitions returns ≥10 rules', () => {
    expect(listAllowedTransitions().length).toBeGreaterThanOrEqual(10);
  });
});
