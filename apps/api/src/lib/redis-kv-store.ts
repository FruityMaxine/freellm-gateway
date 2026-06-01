/**
 * Redis 后端 KvStore 实现（Tick 21 v1.4.0.0 引入）。
 *
 * ioredis 是 optional dependency。`kv-store.ts` 的 `getKvStore()` 用动态 require
 * 加载本模块，未装 ioredis 时静默回落内存。
 *
 * 注意：本文件 import 'ioredis' 是顶层，若 ioredis 缺失会在第一次解析时抛错。
 * 这是预期 —— `kv-store.ts` 用 try/catch 包裹动态 require 处理该错。
 */
import { createRequire } from 'node:module';
import type { KvStore } from './kv-store.js';

// 仅在本模块被 createRequire('./redis-kv-store.js') 拉起时才解析 ioredis；
// 未装 ioredis 时这一行会抛 MODULE_NOT_FOUND，被 kv-store.ts 捕获后回落内存。
const nodeRequire = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IORedis: any = nodeRequire('ioredis');

class RedisKvStore implements KvStore {
  readonly backend = 'redis' as const;
  // 用 `any` 是因为 ioredis 是 optional 的类型在本仓库未装；运行期 duck-type 即可。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly client: any;

  constructor(url: string) {
    this.client = new IORedis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => Math.min(times * 200, 2000),
    });
    this.client.on('error', (err: Error) => {
      console.warn('[redis-kv-store] Redis 连接错误：', err.message);
    });
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async incrAndExpire(key: string, ttlSeconds: number): Promise<number> {
    // Redis pipeline：INCR + EXPIRE 一次往返。
    // EXPIRE 永远刷新过期（即使已存在）——保证窗口期向后滑动，
    // 与内存实现一致（首次设置 TTL，后续仅自增）。这里选择"仅在新键时 EXPIRE"：
    // INCR 后判断返回 1 才 EXPIRE。
    const pipeline = this.client.multi();
    pipeline.incr(key);
    pipeline.expire(key, ttlSeconds, 'NX');
    const results = (await pipeline.exec()) as Array<[Error | null, unknown]>;
    if (!results || !results[0]) throw new Error('redis incr 返回空');
    const [err, val] = results[0];
    if (err) throw err;
    return typeof val === 'number' ? val : Number.parseInt(String(val), 10);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}

export function createRedisKvStore(url: string): KvStore {
  return new RedisKvStore(url);
}
