import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret, hashApiKey, publicDigest } from '../src/crypto.js';

const MASTER = Buffer.alloc(32, 7).toString('base64');

describe('crypto', () => {
  it('round-trips a secret with AAD', () => {
    const blob = encryptSecret('sk-test-abc', MASTER, { aad: 'upstream:1' });
    expect(blob.startsWith('v1:')).toBe(true);
    expect(decryptSecret(blob, MASTER, { aad: 'upstream:1' })).toBe('sk-test-abc');
  });

  it('rejects mismatched AAD', () => {
    const blob = encryptSecret('sk-test-abc', MASTER, { aad: 'upstream:1' });
    expect(() => decryptSecret(blob, MASTER, { aad: 'upstream:2' })).toThrow();
  });

  it('rejects unknown version prefix', () => {
    expect(() => decryptSecret('v9:aa:bb:cc', MASTER)).toThrow();
  });

  it('rejects malformed blob', () => {
    expect(() => decryptSecret('not-a-blob', MASTER)).toThrow();
  });

  it('hashApiKey is deterministic and hex-encoded', () => {
    const h1 = hashApiKey('fllm_test_xyz');
    const h2 = hashApiKey('fllm_test_xyz');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('publicDigest is short and prefixed', () => {
    expect(publicDigest('fllm_live_abc')).toMatch(/^sha256:[a-f0-9]{8}$/);
  });
});
