/**
 * FreeLLM canonical error hierarchy.
 *
 * Every layer maps its raw errors into one of `FreeLLMErrorKind` values so the
 * routing engine, response shaper, and request logger can react uniformly.
 * Extending the union is a deliberate act — `error-classifier` (Tick 4) maps
 * upstream signals onto these kinds and must be updated alongside the union.
 */

export type FreeLLMErrorKind =
  // Caller-facing input problems (do NOT retry)
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'unsupported_capability'
  | 'context_overflow'
  // Provider-side conditions (retry / fallback)
  | 'rate_limited'
  | 'provider_unavailable'
  | 'timeout'
  | 'network_error'
  | 'invalid_response'
  | 'content_filter'
  | 'balance_insufficient'
  | 'auth_failure'
  // Routing engine outcomes
  | 'no_route_available'
  | 'all_attempts_failed'
  | 'cooldown_active'
  // Catch-all
  | 'unknown';

export interface FreeLLMErrorContext {
  requestId?: string;
  providerId?: string;
  modelId?: string;
  upstreamModel?: string;
  status?: number;
  attempts?: number;
  upstreamErrorPayload?: unknown;
  retriable?: boolean;
  // Hint for the response shaper: should we tell the downstream to retry later?
  retryAfterSeconds?: number;
}

export class FreeLLMError extends Error {
  override readonly name = 'FreeLLMError';
  readonly kind: FreeLLMErrorKind;
  readonly httpStatus: number;
  readonly context: FreeLLMErrorContext;

  constructor(
    kind: FreeLLMErrorKind,
    message: string,
    options: { context?: FreeLLMErrorContext; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.kind = kind;
    this.context = options.context ?? {};
    this.httpStatus = mapKindToHttpStatus(kind);
  }

  toJSON(): Record<string, unknown> {
    return {
      kind: this.kind,
      message: this.message,
      httpStatus: this.httpStatus,
      context: this.context,
    };
  }

  /** Format compatible with OpenAI error response shape. */
  toOpenAIError(): {
    error: { message: string; type: string; code: string; param?: string };
  } {
    return {
      error: {
        message: this.message,
        type: openAiTypeFor(this.kind),
        code: this.kind,
      },
    };
  }
}

const HTTP_STATUS_BY_KIND: Record<FreeLLMErrorKind, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  unsupported_capability: 422,
  context_overflow: 413,
  rate_limited: 429,
  provider_unavailable: 503,
  timeout: 504,
  network_error: 502,
  invalid_response: 502,
  content_filter: 451,
  balance_insufficient: 402,
  auth_failure: 401,
  no_route_available: 503,
  all_attempts_failed: 502,
  cooldown_active: 503,
  unknown: 500,
};

export function mapKindToHttpStatus(kind: FreeLLMErrorKind): number {
  return HTTP_STATUS_BY_KIND[kind] ?? 500;
}

function openAiTypeFor(kind: FreeLLMErrorKind): string {
  switch (kind) {
    case 'bad_request':
    case 'unsupported_capability':
    case 'context_overflow':
      return 'invalid_request_error';
    case 'unauthorized':
    case 'forbidden':
    case 'auth_failure':
      return 'authentication_error';
    case 'rate_limited':
      return 'rate_limit_error';
    case 'balance_insufficient':
      return 'billing_error';
    case 'content_filter':
      return 'content_policy_violation';
    default:
      return 'api_error';
  }
}

export function isFreeLLMError(value: unknown): value is FreeLLMError {
  return value instanceof FreeLLMError;
}
