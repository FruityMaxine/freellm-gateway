/**
 * Stable ID generation helpers.
 *
 * We avoid uuid v4 here because cuid2 is shorter, lexicographically sortable,
 * and collision-resistant enough for our request volume. Virtual API keys use
 * a higher-entropy random source — defined in `secret-store` not here.
 */
import { createId, init } from '@paralleldrive/cuid2';

/** Default 24-char cuid2 — used by Prisma `@default(cuid())` and most domain ids. */
export const newId = createId;

/** Short 10-char cuid2 for human-visible request ids attached to telemetry. */
export const newRequestId = init({ length: 10 });

/** Format a `req_<10char>` request id for header propagation. */
export function newPublicRequestId(): string {
  return `req_${newRequestId()}`;
}
