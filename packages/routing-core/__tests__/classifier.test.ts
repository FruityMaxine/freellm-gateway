import { describe, it, expect } from 'vitest';
import { classifyRoutingError, isRetriableKind } from '../src/error-classifier.js';

describe('classifyRoutingError', () => {
  it('classifies 429 as rate_limited retriable', () => {
    const r = classifyRoutingError({ status: 429 });
    expect(r.kind).toBe('rate_limited');
    expect(r.retriable).toBe(true);
    expect(r.hintMs).toBeGreaterThanOrEqual(2000);
  });

  it('classifies 402 as balance_insufficient + providerLevel', () => {
    const r = classifyRoutingError({ status: 402 });
    expect(r.kind).toBe('balance_insufficient');
    expect(r.providerLevel).toBe(true);
  });

  it('classifies content filter in 400 body', () => {
    const r = classifyRoutingError({ status: 400, bodySnippet: 'content_policy violation' });
    expect(r.kind).toBe('content_filter');
    expect(r.retriable).toBe(false);
  });

  it('classifies context overflow in 422 body', () => {
    const r = classifyRoutingError({ status: 422, bodySnippet: 'maximum tokens exceeded' });
    expect(r.kind).toBe('context_overflow');
  });

  it('classifies AbortError as timeout retriable', () => {
    const r = classifyRoutingError({ status: null, causeName: 'AbortError', message: 'aborted' });
    expect(r.kind).toBe('timeout');
    expect(r.retriable).toBe(true);
  });

  it('classifies ECONNRESET network error', () => {
    const r = classifyRoutingError({ status: null, errno: 'ECONNRESET', message: 'ECONNRESET' });
    expect(r.kind).toBe('network_error');
    expect(r.retriable).toBe(true);
  });

  it('classifies 503 provider_unavailable providerLevel', () => {
    const r = classifyRoutingError({ status: 503 });
    expect(r.kind).toBe('provider_unavailable');
    expect(r.providerLevel).toBe(true);
  });

  it('classifies 401 with invalid_key as auth_failure', () => {
    const r = classifyRoutingError({ status: 401, bodySnippet: 'Invalid API key' });
    expect(r.kind).toBe('auth_failure');
    expect(r.providerLevel).toBe(true);
  });

  it('classifies 404 not_found not retriable', () => {
    const r = classifyRoutingError({ status: 404 });
    expect(r.kind).toBe('not_found');
    expect(r.retriable).toBe(false);
  });

  it('classifies 451 content_filter not retriable', () => {
    const r = classifyRoutingError({ status: 451 });
    expect(r.kind).toBe('content_filter');
    expect(r.retriable).toBe(false);
  });

  it('isRetriableKind covers retriable + non-retriable', () => {
    expect(isRetriableKind('rate_limited')).toBe(true);
    expect(isRetriableKind('timeout')).toBe(true);
    expect(isRetriableKind('provider_unavailable')).toBe(true);
    expect(isRetriableKind('network_error')).toBe(true);
    expect(isRetriableKind('bad_request')).toBe(false);
    expect(isRetriableKind('content_filter')).toBe(false);
    expect(isRetriableKind('balance_insufficient')).toBe(false);
  });
});
