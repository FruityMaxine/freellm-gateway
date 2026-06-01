/**
 * 通用 stale-while-revalidate TTL 缓存（Tick 16 v1.0.1.0 引入）。
 *
 * 设计：
 * - 同步过期 + 异步刷新：过期时返回旧值并触发后台刷新，永不阻塞调用方。
 * - in-flight 去重：并发首次调用只跑一次 loader。
 * - 失败时保留 stale：刷新失败不抹掉旧值。
 * - 进程级 module-singleton；不跨进程，不依赖 Redis。
 *
 * 用法：
 *   const cache = createTtlCache<MetricsPayload>({
 *     name: 'metrics',
 *     ttlMs: 5_000,
 *     loader: () => buildMetricsPayload(prisma),
 *   });
 *   const metrics = await cache.get();
 *   cache.invalidate();  // 数据写入后手动失效
 */

export interface TtlCache<T> {
  get(): Promise<T>;
  invalidate(): void;
  peek(): Readonly<{ value: T | null; expiresAt: number; refreshing: boolean }>;
}

export interface TtlCacheOptions<T> {
  /** 缓存名称（仅用于日志 / 调试） */
  name: string;
  /** 缓存有效期（毫秒） */
  ttlMs: number;
  /** 数据加载函数（被缓存的真实工作） */
  loader: () => Promise<T>;
}

export function createTtlCache<T>(opts: TtlCacheOptions<T>): TtlCache<T> {
  const state = {
    value: null as T | null,
    expiresAt: 0,
    inFlight: null as Promise<T> | null,
    refreshing: false,
  };

  return {
    async get(): Promise<T> {
      const now = Date.now();

      // 命中且未过期：直接返回
      if (state.value !== null && now < state.expiresAt) {
        return state.value;
      }

      // 命中但过期：返回 stale，后台异步刷新
      if (state.value !== null) {
        if (!state.refreshing) {
          state.refreshing = true;
          opts
            .loader()
            .then((next) => {
              state.value = next;
              state.expiresAt = Date.now() + opts.ttlMs;
            })
            .catch((err) => {
              console.warn(`[ttl-cache ${opts.name}] 刷新失败，保留 stale 值：`, (err as Error).message);
            })
            .finally(() => {
              state.refreshing = false;
            });
        }
        return state.value;
      }

      // 冷启动：必须等真实查询完成 + in-flight 去重
      if (state.inFlight) {
        return state.inFlight;
      }
      state.inFlight = opts.loader().then((next) => {
        state.value = next;
        state.expiresAt = Date.now() + opts.ttlMs;
        state.inFlight = null;
        return next;
      });
      try {
        return await state.inFlight;
      } catch (err) {
        state.inFlight = null;
        throw err;
      }
    },

    invalidate(): void {
      state.value = null;
      state.expiresAt = 0;
      state.refreshing = false;
    },

    peek() {
      return state;
    },
  };
}
