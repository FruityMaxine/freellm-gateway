/**
 * 键值存储抽象（Tick 21 v1.4.0.0 引入）。
 *
 * 多实例部署时 RPM 限额 / cooldown 等状态必须跨进程共享，否则横向扩容形同虚设。
 * 本文件提供 `KvStore` 接口 + 默认内存实现 + 可选 Redis 实现（lazy import ioredis）。
 *
 * 选型规则：
 * - 未设 `FREELLM_REDIS_URL` → 走内存（单实例足够）。
 * - 设 `FREELLM_REDIS_URL` → 走 ioredis（多实例共享）。
 * - 进程级 module singleton；外部通过 `getKvStore()` 拿同一实例。
 *
 * 接口刻意收窄到 `get / set / incrAndExpire / del`，覆盖滑动窗口 RPM 与冷却两个
 * 主要场景。后续需要 hash / list 等再扩。
 */

export interface KvStore {
  /** 获取键值；不存在返回 null。 */
  get(key: string): Promise<string | null>;

  /**
   * 设置键值（覆盖式）。
   * @param ttlSeconds 可选过期秒数；未指定则不设置 TTL。
   */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

  /**
   * 原子计数：自增并（若新键）设置 TTL。
   * 用于 RPM 滑动窗口的核心原语 —— 同一窗口期内 N 次 `incrAndExpire('k', 60)` 返回 1..N。
   * @returns 自增后的当前值。
   */
  incrAndExpire(key: string, ttlSeconds: number): Promise<number>;

  /** 删除键。不存在不抛错。 */
  del(key: string): Promise<void>;

  /** 实例标签，用于日志识别（"memory" / "redis"）。 */
  readonly backend: 'memory' | 'redis';
}

// ─────────────────────────────────────────────────────────
// 内存实现：单进程默认。
// ─────────────────────────────────────────────────────────

interface MemoryEntry {
  value: string;
  /** 过期时间戳 (ms)；为 0 表示永久。 */
  expiresAt: number;
}

export class MemoryKvStore implements KvStore {
  readonly backend = 'memory';
  private readonly store = new Map<string, MemoryEntry>();

  private gc(key: string, now: number): MemoryEntry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== 0 && entry.expiresAt <= now) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.gc(key, Date.now());
    return entry ? entry.value : null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0;
    this.store.set(key, { value, expiresAt });
  }

  async incrAndExpire(key: string, ttlSeconds: number): Promise<number> {
    const now = Date.now();
    const existing = this.gc(key, now);
    if (!existing) {
      this.store.set(key, { value: '1', expiresAt: now + ttlSeconds * 1000 });
      return 1;
    }
    const next = Number.parseInt(existing.value, 10) + 1;
    existing.value = String(next);
    return next;
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** 仅供测试：清空全部键。 */
  _clear(): void {
    this.store.clear();
  }

  /** 仅供测试：当前键数（含过期，不主动 gc）。 */
  _size(): number {
    return this.store.size;
  }
}

// ─────────────────────────────────────────────────────────
// 全局单例：按 env 动态选 backend。
// ioredis 是 optional dep；若未装则即使设了 FREELLM_REDIS_URL 也回落内存并 warn。
// ─────────────────────────────────────────────────────────

import { createRequire } from 'node:module';

let singleton: KvStore | null = null;
const nodeRequire = createRequire(import.meta.url);

export function getKvStore(): KvStore {
  if (singleton) return singleton;
  const url = process.env.FREELLM_REDIS_URL;
  if (url) {
    try {
      // 用 createRequire 在 ESM 模块内同步加载可选实现，避免 async API 蔓延。
      const redisModule = nodeRequire('./redis-kv-store.js') as { createRedisKvStore: (u: string) => KvStore };
      singleton = redisModule.createRedisKvStore(url);
      console.info('[kv-store] 已启用 Redis 后端：', url.replace(/:\/\/[^@]*@/, '://***@'));
      return singleton;
    } catch (err) {
      console.warn(
        '[kv-store] FREELLM_REDIS_URL 已设但 Redis 后端加载失败（多半是 ioredis 未装），回落到内存：',
        (err as Error).message,
      );
    }
  }
  singleton = new MemoryKvStore();
  return singleton;
}

/** 仅供测试：重置 singleton + 注入自定义实现。 */
export function _setKvStoreForTests(store: KvStore | null): void {
  singleton = store;
}
