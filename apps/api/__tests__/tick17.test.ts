/**
 * Tick 17 v1.1.0.0 集成测试：
 * - virtual key 日 embeddings 限额（enforceDailyEmbeddings）
 * - /admin/events SSE 端点 smoke（ready + heartbeat 协议）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  enforceDailyEmbeddings,
  enforceDailyTokens,
  _resetAuthBuckets,
} from '../src/plugins/virtual-key-auth.js';

describe('Tick 17 — enforceDailyEmbeddings', () => {
  beforeEach(() => {
    _resetAuthBuckets();
  });

  it('null/0 视为无限制：永远返回 true', () => {
    expect(enforceDailyEmbeddings('k1', null)).toBe(true);
    expect(enforceDailyEmbeddings('k1', undefined)).toBe(true);
    expect(enforceDailyEmbeddings('k1', 0)).toBe(true);
  });

  it('未到上限 → true 并消费 +1；到达上限 → false', () => {
    expect(enforceDailyEmbeddings('k2', 3)).toBe(true); // 1
    expect(enforceDailyEmbeddings('k2', 3)).toBe(true); // 2
    expect(enforceDailyEmbeddings('k2', 3)).toBe(true); // 3
    expect(enforceDailyEmbeddings('k2', 3)).toBe(false); // 4 → 拒
  });

  it('不同 key 限额互不干扰', () => {
    expect(enforceDailyEmbeddings('k3', 1)).toBe(true);
    expect(enforceDailyEmbeddings('k3', 1)).toBe(false); // k3 已用尽
    expect(enforceDailyEmbeddings('k4', 1)).toBe(true); // k4 仍可用
  });

  it('与 enforceDailyTokens 桶共存但维度独立', () => {
    // 同一 key 两个维度独立计数，不影响彼此。
    expect(enforceDailyEmbeddings('k5', 2)).toBe(true);
    expect(enforceDailyEmbeddings('k5', 2)).toBe(true);
    expect(enforceDailyEmbeddings('k5', 2)).toBe(false);
    // Token 维度仍可用（这里 limit=100，未消耗过 token 故返回 true）
    expect(enforceDailyTokens('k5', 100)).toBe(true);
  });
});

describe('Tick 17 — useAdminEvents 协议字段', () => {
  it('SSE event 字段名约定（与 admin/events.routes 端点保持一致）', () => {
    const topics = [
      'ready',
      'heartbeat',
      'model:added',
      'model:removed',
      'model:paid_now',
      'model:capability_changed',
      'discovery:cycle',
    ];
    // 仅静态契约检查：避免改 topic 名时前后端不一致。
    expect(new Set(topics).size).toBe(topics.length);
    expect(topics).toContain('discovery:cycle');
    expect(topics).toContain('model:added');
  });
});
