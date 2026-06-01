/**
 * buildPool 的 5 秒 TTL 缓存。
 *
 * 路由 hot path 每次请求都会重建 pool（一次 Prisma 大查询 + 数据装配）。
 * 在 QPS 较高时这是显著的开销，但 model 池实际变化很慢（discovery 每 30 分钟 + scorer 周期）。
 * 5 秒缓存对热点路径降压非常显著，对路由决策的新鲜度影响可以忽略。
 *
 * 设计要点：
 * - 进程级 module-singleton 缓存（不跨进程，不依赖 Redis）
 * - 失效采用「同步过期 + 异步刷新（stale-while-revalidate）」模式：
 *   - 过期时仍返回 stale 值，立即触发后台刷新
 *   - 永不阻塞调用方
 * - 首次冷启动：必须等真实查询完成
 * - in-flight 去重：并发首调用只跑一次实查
 * - invalidate(): 手动清除，方便测试与 admin/refresh 显式刷新
 */
import type { PrismaClient } from '@prisma/client';
import type { PoolModel } from '@freellm/routing-core';
import { buildPool } from './pool-builder.js';

const DEFAULT_TTL_MS = 5_000;

interface CacheState {
  value: PoolModel[] | null;
  expiresAt: number;
  inFlight: Promise<PoolModel[]> | null;
  refreshing: boolean;
}

const state: CacheState = {
  value: null,
  expiresAt: 0,
  inFlight: null,
  refreshing: false,
};

export function invalidatePoolCache(): void {
  state.value = null;
  state.expiresAt = 0;
  state.refreshing = false;
}

export async function getCachedPool(
  prisma: PrismaClient,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<PoolModel[]> {
  const now = Date.now();

  if (state.value && now < state.expiresAt) {
    return state.value;
  }

  if (state.value) {
    if (!state.refreshing) {
      state.refreshing = true;
      buildPool(prisma)
        .then((next) => {
          state.value = next;
          state.expiresAt = Date.now() + ttlMs;
        })
        .catch(() => {
          // 失败时保留 stale 值；下一次调用会再触发刷新
        })
        .finally(() => {
          state.refreshing = false;
        });
    }
    return state.value;
  }

  if (state.inFlight) {
    return state.inFlight;
  }
  state.inFlight = buildPool(prisma).then((next) => {
    state.value = next;
    state.expiresAt = Date.now() + ttlMs;
    state.inFlight = null;
    return next;
  });
  try {
    return await state.inFlight;
  } catch (err) {
    state.inFlight = null;
    throw err;
  }
}

// 仅供测试使用：内部状态快照
export function __peekPoolCacheState(): Readonly<CacheState> {
  return state;
}
