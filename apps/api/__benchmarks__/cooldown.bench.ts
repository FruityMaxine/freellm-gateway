/**
 * 冷却引擎 bench：失败注册 + 冷却查询的吞吐能力。
 * 每次路由决策都要查冷却表，注册失败时也要写表 —— 这是路由 hot path 的次要瓶颈。
 */
import { bench, describe } from 'vitest';
import {
  CooldownEngine,
  MemoryCooldownStore,
} from '../../../packages/routing-core/src/cooldown.js';

const store = new MemoryCooldownStore();
const engine = new CooldownEngine(store);

// 预填一些冷却记录模拟真实场景
for (let i = 0; i < 50; i++) {
  await engine.registerFailure({
    scope: 'model',
    key: `m-${i}`,
    reason: 'rate_limited',
  });
}

describe('cooldown', () => {
  bench('registerFailure - rate_limited', async () => {
    await engine.registerFailure({
      scope: 'model',
      key: `m-${Math.floor(Math.random() * 100)}`,
      reason: 'rate_limited',
    });
  });

  bench('check - 命中冷却中', async () => {
    await engine.check('model', 'm-1');
  });

  bench('check - 未命中（无冷却记录）', async () => {
    await engine.check('model', 'm-non-existent');
  });
});
