/**
 * Pluggable secret storage.
 *
 * In dev we typically read upstream keys straight from `process.env` (the
 * `EnvSecretStore`); in production we want them at rest under our master key
 * (the `DbEncryptedSecretStore`). The runtime picks one by configuration; the
 * surface stays the same so callers never see plaintext until the moment of
 * use.
 */
import { decryptSecret, encryptSecret } from './crypto.js';

export interface StoredSecret {
  /** Opaque identifier the store understands (env var name, db row id, …). */
  ref: string;
  /** A short non-secret prefix for display, e.g. `sk-…ab12`. */
  digest?: string;
}

export interface SecretStore {
  /** Identifier of the backend, for diagnostics. */
  readonly kind: 'env' | 'db' | 'memory';
  /** Resolve a previously stored secret. */
  read(ref: string): Promise<string | null>;
  /** Persist a new secret; returns the storage reference. */
  write(ref: string, plaintext: string): Promise<StoredSecret>;
  /** Remove a stored secret. */
  remove(ref: string): Promise<void>;
}

/** Reads secrets from `process.env` — does NOT persist. Useful in CI / dev. */
export class EnvSecretStore implements SecretStore {
  readonly kind = 'env' as const;
  async read(ref: string): Promise<string | null> {
    const v = process.env[ref];
    return v === undefined || v === '' ? null : v;
  }
  async write(): Promise<StoredSecret> {
    throw new Error('EnvSecretStore is read-only; configure DbEncryptedSecretStore for writes');
  }
  async remove(): Promise<void> {
    throw new Error('EnvSecretStore is read-only');
  }
}

/** In-memory store, used by unit tests. */
export class MemorySecretStore implements SecretStore {
  readonly kind = 'memory' as const;
  private map = new Map<string, string>();
  async read(ref: string): Promise<string | null> {
    return this.map.get(ref) ?? null;
  }
  async write(ref: string, plaintext: string): Promise<StoredSecret> {
    this.map.set(ref, plaintext);
    return { ref };
  }
  async remove(ref: string): Promise<void> {
    this.map.delete(ref);
  }
}

/**
 * Stores ciphertext in a caller-provided KV.
 *
 * The KV interface is intentionally minimal so this class can sit on top of
 * Prisma (Tick 5), Redis, the file system, or a managed Secret Manager later.
 */
export interface SecretKV {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class DbEncryptedSecretStore implements SecretStore {
  readonly kind = 'db' as const;
  constructor(private kv: SecretKV, private masterKey: string) {
    if (!masterKey || masterKey.length < 32) {
      throw new Error('DbEncryptedSecretStore: FREELLM_MASTER_KEY missing or too short');
    }
  }
  async read(ref: string): Promise<string | null> {
    const blob = await this.kv.read(ref);
    if (!blob) return null;
    // 三格式容错（cipherText 字段历史上可能是三种形态之一）：
    //   `plain:<key>`   —— 早期 secret-store 写入失败时的明文降级（provider-admin attachApiKey catch 分支）
    //   `pending:<hex>` —— UpstreamKey 行刚 create、加密尚未落盘的占位符
    //   `v1:iv:tag:ct`  —— 正常的 AES-256-GCM 密文
    // 不识别前缀直接丢给 decryptSecret 会因 split(':') !== 4 抛错 → 调用方拿到空 key →
    // 上游 401「No cookie auth credentials found」。这正是真实 LLM 推理全失效的根因。
    if (blob.startsWith('plain:')) {
      const v = blob.slice('plain:'.length);
      return v.length > 0 ? v : null;
    }
    if (blob.startsWith('pending:')) return null;
    return decryptSecret(blob, this.masterKey, { aad: ref });
  }
  async write(ref: string, plaintext: string): Promise<StoredSecret> {
    const blob = encryptSecret(plaintext, this.masterKey, { aad: ref });
    await this.kv.write(ref, blob);
    return { ref };
  }
  async remove(ref: string): Promise<void> {
    await this.kv.remove(ref);
  }
}

/** Factory that picks a store based on env. */
export function makeSecretStore(opts: {
  masterKey?: string;
  kv?: SecretKV;
  mode?: 'env' | 'db' | 'memory';
}): SecretStore {
  const mode = opts.mode ?? (opts.kv && opts.masterKey ? 'db' : 'env');
  if (mode === 'memory') return new MemorySecretStore();
  if (mode === 'db') {
    if (!opts.kv || !opts.masterKey) {
      throw new Error('db secret store requires kv + masterKey');
    }
    return new DbEncryptedSecretStore(opts.kv, opts.masterKey);
  }
  return new EnvSecretStore();
}
