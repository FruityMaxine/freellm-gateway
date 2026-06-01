/**
 * 路由器 bench：在不同池规模（10 / 100 / 500 模型）下的决策延迟。
 * 路由器是 hot path 关键开销之一 —— alias 过滤 + 权限筛 + capability 校验 + 评分排序。
 */
import { bench, describe } from 'vitest';
import { Router, type PoolModel } from '../../../packages/routing-core/src/router.js';

function makePool(n: number): PoolModel[] {
  const pool: PoolModel[] = [];
  for (let i = 0; i < n; i++) {
    pool.push({
      modelId: `m-${i}`,
      upstreamId: `provider/model-${i}:free`,
      providerSlug: i % 5 === 0 ? 'openai' : 'openrouter',
      isFree: i % 7 !== 0,
      contextLength: 32_000 + (i * 1000) % 200_000,
      capabilities: { stream: true, json: true, tools: i % 3 === 0, vision: false, audio: false },
      status: 'active',
      blacklisted: false,
      whitelisted: i % 11 === 0,
      weightAdj: 0,
      scores: {
        availability: 0.5 + (i % 50) / 100,
        latency: 0.4 + (i % 60) / 100,
        rateLimit: 0.5,
        quality: 0.5 + (i % 40) / 100,
        context: 0.6,
        freshness: 0.5,
        cost: 1,
        stability: 0.7,
        firstTokenLatency: 0.5,
      },
    });
  }
  return pool;
}

const router = new Router();
const pool10 = makePool(10);
const pool100 = makePool(100);
const pool500 = makePool(500);

const ctx = {
  alias: 'free/auto',
  policy: { name: 'default', mode: 'auto-best-free' as const },
  maxCandidates: 5,
};

describe('router', () => {
  bench('router.decide - 10 模型池', () => {
    router.decide(pool10, ctx);
  });

  bench('router.decide - 100 模型池', () => {
    router.decide(pool100, ctx);
  });

  bench('router.decide - 500 模型池', () => {
    router.decide(pool500, ctx);
  });

  bench('router.decide - weighted-free 模式', () => {
    router.decide(pool100, {
      ...ctx,
      policy: { name: 'weighted', mode: 'weighted-free' },
    });
  });
});
