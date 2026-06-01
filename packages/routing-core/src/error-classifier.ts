/**
 * The full error classifier the routing engine relies on. Builds on the
 * lightweight `classifyProviderError` in `@freellm/provider-core` and adds
 * payload-aware rules (e.g. detecting balance / context-overflow / content
 * filter messages that providers tuck into 400/422 responses).
 */
import type { FreeLLMErrorKind } from '@freellm/shared';

export interface ClassifierInput {
  status?: number | null;
  message?: string;
  bodySnippet?: string;
  causeName?: string;
  /** Network-layer hints: 'ECONNRESET' / 'ETIMEDOUT' / 'EAI_AGAIN' / 'AbortError'. */
  errno?: string;
}

export interface ClassifiedError {
  kind: FreeLLMErrorKind;
  reason: string;
  retriable: boolean;
  /** Suggested per-attempt cooldown — the cooldown engine multiplies by exp backoff. */
  hintMs?: number;
  /** Whether the failure should bench the provider, not just the model. */
  providerLevel?: boolean;
}

const BAL_PATTERNS = [
  /insufficient[_ ]balance/i,
  /credit.*exhausted/i,
  /quota.*exceeded/i,
  /payment.*required/i,
];

const CTX_PATTERNS = [
  /context[_ ]length/i,
  /maximum.*tokens?/i,
  /input.*too[_ ]large/i,
  /exceeded.*max/i,
];

const CF_PATTERNS = [
  /content[_ ]policy/i,
  /content[_ ]filter/i,
  /safety.*violation/i,
  /policy.*violation/i,
  /blocked.*content/i,
];

const AUTH_PATTERNS = [/invalid.*key/i, /unauthor/i, /expired.*token/i, /revoked/i];

function combinedText(input: ClassifierInput): string {
  return [input.message ?? '', input.bodySnippet ?? ''].filter(Boolean).join(' | ');
}

export function classifyRoutingError(input: ClassifierInput): ClassifiedError {
  const text = combinedText(input);
  const status = input.status ?? null;

  // Network / transport problems — status is null.
  if (status === null) {
    if (input.causeName === 'AbortError' || /abort|timeout/i.test(text)) {
      return { kind: 'timeout', reason: 'abort/timeout', retriable: true, hintMs: 1500 };
    }
    if (input.errno === 'ETIMEDOUT' || /ETIMEDOUT/.test(text)) {
      return { kind: 'timeout', reason: 'ETIMEDOUT', retriable: true, hintMs: 1500 };
    }
    if (input.errno === 'ECONNRESET' || /ECONNRESET/.test(text)) {
      return { kind: 'network_error', reason: 'ECONNRESET', retriable: true, hintMs: 1000 };
    }
    if (/EAI_AGAIN|ENOTFOUND|DNS/i.test(text)) {
      return {
        kind: 'network_error',
        reason: 'dns/network',
        retriable: true,
        hintMs: 2000,
        providerLevel: true,
      };
    }
    return { kind: 'network_error', reason: 'unspecified network failure', retriable: true, hintMs: 1500 };
  }

  // Body-aware refinements when status is suggestive but ambiguous.
  if (status === 400 || status === 422) {
    if (CTX_PATTERNS.some((re) => re.test(text))) {
      return { kind: 'context_overflow', reason: 'context length', retriable: false };
    }
    if (CF_PATTERNS.some((re) => re.test(text))) {
      return { kind: 'content_filter', reason: 'content policy', retriable: false };
    }
    if (BAL_PATTERNS.some((re) => re.test(text))) {
      return {
        kind: 'balance_insufficient',
        reason: 'balance text in 400/422',
        retriable: false,
        providerLevel: true,
      };
    }
    return { kind: 'bad_request', reason: 'caller-side validation', retriable: false };
  }

  if (status === 401) {
    if (AUTH_PATTERNS.some((re) => re.test(text))) {
      return { kind: 'auth_failure', reason: 'auth pattern', retriable: false, providerLevel: true };
    }
    return { kind: 'unauthorized', reason: '401', retriable: false, providerLevel: true };
  }
  if (status === 402) {
    return { kind: 'balance_insufficient', reason: '402', retriable: false, providerLevel: true };
  }
  if (status === 403) {
    return { kind: 'forbidden', reason: '403', retriable: false };
  }
  if (status === 404) {
    return { kind: 'not_found', reason: '404 — model likely removed', retriable: false };
  }
  if (status === 408) {
    return { kind: 'timeout', reason: '408', retriable: true, hintMs: 1500 };
  }
  if (status === 413) {
    return { kind: 'context_overflow', reason: '413', retriable: false };
  }
  if (status === 425) {
    return { kind: 'rate_limited', reason: '425 too early', retriable: true, hintMs: 2000 };
  }
  if (status === 429) {
    return { kind: 'rate_limited', reason: '429', retriable: true, hintMs: 5000 };
  }
  if (status === 451) {
    return { kind: 'content_filter', reason: '451', retriable: false };
  }
  if (status >= 500 && status < 600) {
    return {
      kind: 'provider_unavailable',
      reason: `${status}`,
      retriable: true,
      hintMs: status === 503 ? 3000 : 1500,
      providerLevel: status === 503,
    };
  }
  if (status >= 200 && status < 300) {
    if (/invalid|malformed|parse/i.test(text)) {
      return { kind: 'invalid_response', reason: '2xx with bad body', retriable: true, hintMs: 500 };
    }
    return { kind: 'unknown', reason: 'unexpected 2xx classified as error', retriable: false };
  }
  return { kind: 'unknown', reason: `unhandled ${status}`, retriable: false };
}

export function isRetriableKind(kind: FreeLLMErrorKind): boolean {
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
