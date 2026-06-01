/**
 * Symmetric encryption helpers for storing upstream provider API keys.
 *
 * Format: `v1:<iv-b64>:<tag-b64>:<ciphertext-b64>`
 * - `v1` prefix lets us rotate to v2 with a different scheme without ambiguity.
 * - AES-256-GCM. 96-bit IV, 128-bit auth tag, 32-byte key.
 * - Authenticated additional data (AAD) is bound per record to prevent
 *   moving a ciphertext from one logical scope (e.g. an `UpstreamKey` row)
 *   to another and decrypting it.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'v1';

function decodeMasterKey(raw: string): Buffer {
  const trimmed = raw.trim();
  // accept base64; fall back to hex if it does not decode
  try {
    const b = Buffer.from(trimmed, 'base64');
    if (b.length === KEY_BYTES) return b;
  } catch {
    /* fall through */
  }
  const hex = Buffer.from(trimmed, 'hex');
  if (hex.length === KEY_BYTES) return hex;
  throw new Error(
    `FREELLM_MASTER_KEY must decode to ${KEY_BYTES} bytes (base64 or hex); got ${trimmed.length} chars`,
  );
}

export interface EncryptOptions {
  /** Optional context bound into the ciphertext (e.g. `upstream_key:<id>`). */
  aad?: string;
}

export function encryptSecret(plaintext: string, masterKey: string, opts: EncryptOptions = {}): string {
  const key = decodeMasterKey(masterKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (opts.aad) cipher.setAAD(Buffer.from(opts.aad, 'utf8'));
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export function decryptSecret(blob: string, masterKey: string, opts: EncryptOptions = {}): string {
  const parts = blob.split(':');
  if (parts.length !== 4) throw new Error(`encryptSecret: unexpected blob format`);
  const [version, ivB64, tagB64, encB64] = parts;
  if (version !== VERSION) throw new Error(`encryptSecret: unsupported version ${version}`);
  const key = decodeMasterKey(masterKey);
  const iv = Buffer.from(ivB64!, 'base64');
  const tag = Buffer.from(tagB64!, 'base64');
  const enc = Buffer.from(encB64!, 'base64');
  if (tag.length !== TAG_BYTES) throw new Error('encryptSecret: bad auth tag length');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  if (opts.aad) decipher.setAAD(Buffer.from(opts.aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/**
 * Hash a virtual API key for storage. We use sha256 (not bcrypt) because:
 *  - virtual keys are 256-bit random — bcrypt brute-force resistance is unneeded
 *  - we need constant-time lookup by hash on every request
 */
export function hashApiKey(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('hex');
}

/** Constant-time string compare for hashes. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** Short, non-secret display digest for showing a key in lists (`sha256:abc12345`). */
export function publicDigest(plain: string): string {
  return 'sha256:' + createHash('sha256').update(plain, 'utf8').digest('hex').slice(0, 8);
}
