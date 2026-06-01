import { describe, it, expect } from 'vitest';
import { classifyProviderError, isRetriable } from '../src/errors.js';

describe('classifyProviderError', () => {
  it('maps common HTTP statuses', () => {
    expect(classifyProviderError({ status: 400 })).toBe('bad_request');
    expect(classifyProviderError({ status: 401 })).toBe('auth_failure');
    expect(classifyProviderError({ status: 402 })).toBe('balance_insufficient');
    expect(classifyProviderError({ status: 403 })).toBe('forbidden');
    expect(classifyProviderError({ status: 404 })).toBe('not_found');
    expect(classifyProviderError({ status: 413 })).toBe('context_overflow');
    expect(classifyProviderError({ status: 429 })).toBe('rate_limited');
    expect(classifyProviderError({ status: 451 })).toBe('content_filter');
    expect(classifyProviderError({ status: 502 })).toBe('provider_unavailable');
  });

  it('maps network/abort to network_error/timeout', () => {
    expect(classifyProviderError({ status: null, message: 'fetch failed' })).toBe('network_error');
    expect(classifyProviderError({ status: null, causeName: 'AbortError', message: 'aborted' })).toBe(
      'timeout',
    );
  });

  it('decides retriability', () => {
    expect(isRetriable('rate_limited')).toBe(true);
    expect(isRetriable('timeout')).toBe(true);
    expect(isRetriable('provider_unavailable')).toBe(true);
    expect(isRetriable('bad_request')).toBe(false);
    expect(isRetriable('auth_failure')).toBe(false);
  });
});
