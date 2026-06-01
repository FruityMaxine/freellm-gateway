/**
 * 组 4 Tick 2 v1.8.0.0 — DbEncryptedSecretStore.read 三格式容错回归测试。
 *
 * 守护真实 LLM 推理命脉根因的修复：cipherText 字段历史上可能是
 * plain:<key> / pending:<hex> / v1:iv:tag:ct 三种形态，read 必须各自正确处理，
 * 否则上游收到空 Bearer → 401 → 全链失效。
 */
import { describe, it, expect } from 'vitest';
import { DbEncryptedSecretStore, type SecretKV } from '../src/secret-store.js';
import { encryptSecret } from '../src/crypto.js';

// 测试用 32 字节 master key（base64）
const MK = Buffer.alloc(32, 7).toString('base64');

/** 返回固定 blob 的最小 KV stub。 */
class StubKV implements SecretKV {
  constructor(private val: string | null) {}
  async read(): Promise<string | null> {
    return this.val;
  }
  async write(): Promise<void> {}
  async remove(): Promise<void> {}
}

describe('DbEncryptedSecretStore.read 三格式容错', () => {
  it('plain: 前缀 → strip 返回明文（这正是修复前丢失 key 的格式）', async () => {
    const store = new DbEncryptedSecretStore(new StubKV('plain:sk-or-v1-abc123'), MK);
    expect(await store.read('upstream_key:1')).toBe('sk-or-v1-abc123');
  });

  it('pending: 占位 → 返回 null（write 尚未落盘）', async () => {
    const store = new DbEncryptedSecretStore(new StubKV('pending:deadbeef'), MK);
    expect(await store.read('upstream_key:1')).toBeNull();
  });

  it('v1 真密文 → 解密返回明文', async () => {
    const ref = 'upstream_key:42';
    const blob = encryptSecret('sk-or-v1-real-key', MK, { aad: ref });
    const store = new DbEncryptedSecretStore(new StubKV(blob), MK);
    expect(await store.read(ref)).toBe('sk-or-v1-real-key');
  });

  it('plain: 空值 → 返回 null', async () => {
    const store = new DbEncryptedSecretStore(new StubKV('plain:'), MK);
    expect(await store.read('upstream_key:1')).toBeNull();
  });

  it('null blob → 返回 null', async () => {
    const store = new DbEncryptedSecretStore(new StubKV(null), MK);
    expect(await store.read('upstream_key:1')).toBeNull();
  });

  it('write 真加密（非 plain:）后 read 往返一致', async () => {
    let stored: string | null = null;
    const kv: SecretKV = {
      async read() {
        return stored;
      },
      async write(_k, v) {
        stored = v;
      },
      async remove() {
        stored = null;
      },
    };
    const store = new DbEncryptedSecretStore(kv, MK);
    await store.write('upstream_key:7', 'sk-or-v1-roundtrip');
    expect(stored).toMatch(/^v1:/); // 确认真加密，不再降级 plain:
    expect(await store.read('upstream_key:7')).toBe('sk-or-v1-roundtrip');
  });
});
