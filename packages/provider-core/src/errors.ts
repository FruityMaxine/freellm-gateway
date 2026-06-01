/**
 * Map a raw provider response or thrown error to a FreeLLM error kind.
 *
 * The full classifier lives in `routing-core` (Tick 4) and uses more context;
 * this lightweight helper is enough for unit-tested provider adapters to
 * report a stable `kind` on each call without pulling the routing layer in.
 */
import type { FreeLLMErrorKind } from '@freellm/shared';

export interface RawProviderError {
  status?: number | null;
  message?: string;
  body?: unknown;
  causeName?: string;
}

export function classifyProviderError(raw: RawProviderError): FreeLLMErrorKind {
  const { status, message = '', causeName = '' } = raw;
  if (status == null) {
    if (/abort|timeout/i.test(message) || causeName === 'AbortError') return 'timeout';
    if (/ECONN|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|fetch failed/i.test(message)) return 'network_error';
    return 'network_error';
  }
  if (status === 400) return 'bad_request';
  if (status === 401) return 'auth_failure';
  if (status === 402) return 'balance_insufficient';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 408) return 'timeout';
  if (status === 413) return 'context_overflow';
  if (status === 422) return 'unsupported_capability';
  if (status === 429) return 'rate_limited';
  if (status === 451) return 'content_filter';
  if (status >= 500 && status < 600) return 'provider_unavailable';
  return 'unknown';
}

export function isRetriable(kind: FreeLLMErrorKind): boolean {
  switch (kind) {
    case 'rate_limited':
    case 'timeout':
    case 'network_error':
    case 'provider_unavailable':
    case 'invalid_response':
      return true;
    default:
      return false;
  }
}
