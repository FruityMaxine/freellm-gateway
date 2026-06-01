/**
 * Log-time redaction helpers.
 *
 * The default policy is "no plaintext secrets, ever". The pino instance in
 * `apps/api` is configured with these helpers to keep call sites blissfully
 * unaware: callers may log whole request objects and we still won't leak.
 */
import { createHash } from 'node:crypto';

const REDACTED = '[redacted]';

/** Mask an API key keeping its first 4 and last 2 characters for human triage. */
export function maskKey(key: string): string {
  if (!key) return REDACTED;
  if (key.length <= 8) return REDACTED;
  return `${key.slice(0, 4)}…${key.slice(-2)}`;
}

/** Sha256 digest, first 12 hex chars — used for non-reversible prompt traces. */
export function prompt12(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
}

/** Headers that always vanish from logs. */
export const SENSITIVE_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
  'x-openrouter-key',
  'x-freellm-internal-token',
]);

export function scrubHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(k.toLowerCase())) {
      out[k] = REDACTED;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Recursively walk a JSON-able object, redacting fields by name. */
export function scrubObject<T>(obj: T): T {
  return _scrub(obj, new WeakSet()) as T;
}

const SENSITIVE_FIELDS = new Set([
  'authorization',
  'apiKey',
  'api_key',
  'password',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'sessionSecret',
  'masterKey',
  'cipherText',
  'cipher_text',
  'plain',
  'plaintext',
  // Audit P1-C: extra fields we know the codebase emits.
  'secret',
  'tokenHash',
  'sessionToken',
  'hash',
]);

function _scrub(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => _scrub(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_FIELDS.has(k)) {
      out[k] = REDACTED;
    } else if (typeof v === 'string' && k.toLowerCase().includes('key')) {
      out[k] = maskKey(v);
    } else {
      out[k] = _scrub(v, seen);
    }
  }
  return out;
}
