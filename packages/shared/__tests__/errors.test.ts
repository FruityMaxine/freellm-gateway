import { describe, it, expect } from 'vitest';
import { FreeLLMError, mapKindToHttpStatus, isFreeLLMError } from '../src/errors.js';

describe('FreeLLMError', () => {
  it('maps kinds to http statuses', () => {
    expect(mapKindToHttpStatus('rate_limited')).toBe(429);
    expect(mapKindToHttpStatus('balance_insufficient')).toBe(402);
    expect(mapKindToHttpStatus('context_overflow')).toBe(413);
    expect(mapKindToHttpStatus('unknown')).toBe(500);
  });

  it('serialises to JSON', () => {
    const err = new FreeLLMError('rate_limited', 'slow down', {
      context: { providerId: 'p1', retryAfterSeconds: 5 },
    });
    expect(err.toJSON()).toMatchObject({
      kind: 'rate_limited',
      httpStatus: 429,
      context: { providerId: 'p1', retryAfterSeconds: 5 },
    });
  });

  it('renders OpenAI-compatible error envelope', () => {
    const err = new FreeLLMError('content_filter', 'blocked');
    const envelope = err.toOpenAIError();
    expect(envelope.error.type).toBe('content_policy_violation');
    expect(envelope.error.code).toBe('content_filter');
  });

  it('isFreeLLMError type guard', () => {
    expect(isFreeLLMError(new FreeLLMError('timeout', 'ouch'))).toBe(true);
    expect(isFreeLLMError(new Error('plain'))).toBe(false);
  });
});
