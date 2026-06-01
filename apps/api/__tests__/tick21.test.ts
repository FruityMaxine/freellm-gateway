/**
 * Tick 21 v1.4.0.0 单元测试：
 * - KvStore 接口契约（MemoryKvStore）
 * - getKvStore 单例 + 未设 FREELLM_REDIS_URL 走内存
 * - enforceOrgRpmAsync 走 KV 接口
 */
import { afterAll, beforeEach, describe, it, expect } from 'vitest';
import { MemoryKvStore, _setKvStoreForTests, getKvStore } from '../src/lib/kv-store.js';
import { enforceOrgRpmAsync } from '../src/lib/per-org-limit.js';

describe('Tick 21 — MemoryKvStore 契约', () => {
  let kv: MemoryKvStore;

  beforeEach(() => {
    kv = new MemoryKvStore();
  });

  it('set + get 基本读写', async () => {
    expect(await kv.get('miss')).toBeNull();
    await kv.set('k1', 'v1');
    expect(await kv.get('k1')).toBe('v1');
  });

  it('set 覆盖式（同 key 二次 set）', async () => {
    await kv.set('k', '1');
    await kv.set('k', '2');
    expect(await kv.get('k')).toBe('2');
  });

  it('set ttlSeconds=0 / 不传 → 永久键（不过期）', async () => {
    await kv.set('perm', 'x');
    expect(await kv.get('perm')).toBe('x');
    await kv.set('perm2', 'y', 0);
    expect(await kv.get('perm2')).toBe('y');
  });

  it('TTL 过期后 get 返回 null', async () => {
    await kv.set('exp', 'z', 1);
    expect(await kv.get('exp')).toBe('z');
    // 等待 1.1s 模拟过期
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await kv.get('exp')).toBeNull();
  });

  it('incrAndExpire 首次写入返回 1', async () => {
    expect(await kv.incrAndExpire('counter', 60)).toBe(1);
  });

  it('incrAndExpire 同 key 多次自增', async () => {
    expect(await kv.incrAndExpire('c', 60)).toBe(1);
    expect(await kv.incrAndExpire('c', 60)).toBe(2);
    expect(await kv.incrAndExpire('c', 60)).toBe(3);
    expect(await kv.get('c')).toBe('3');
  });

  it('del 删除已有键 + 删除不存在键不抛错', async () => {
    await kv.set('to-del', 'x');
    await kv.del('to-del');
    expect(await kv.get('to-del')).toBeNull();
    await expect(kv.del('never-set')).resolves.toBeUndefined();
  });

  it('backend 标签为 "memory"', () => {
    expect(kv.backend).toBe('memory');
  });
});

describe('Tick 21 — getKvStore 单例', () => {
  afterAll(() => {
    _setKvStoreForTests(null);
    delete process.env.FREELLM_REDIS_URL;
  });

  it('未设 FREELLM_REDIS_URL → MemoryKvStore', () => {
    _setKvStoreForTests(null);
    delete process.env.FREELLM_REDIS_URL;
    const store = getKvStore();
    expect(store.backend).toBe('memory');
  });

  it('多次调用返回同一实例（singleton）', () => {
    _setKvStoreForTests(null);
    delete process.env.FREELLM_REDIS_URL;
    const a = getKvStore();
    const b = getKvStore();
    expect(a).toBe(b);
  });

  it('_setKvStoreForTests 可注入自定义实现', async () => {
    const fake = new MemoryKvStore();
    _setKvStoreForTests(fake);
    expect(getKvStore()).toBe(fake);
  });
});

describe('Tick 21 — enforceOrgRpmAsync 走 KV', () => {
  beforeEach(() => {
    _setKvStoreForTests(new MemoryKvStore());
  });

  afterAll(() => {
    _setKvStoreForTests(null);
  });

  it('null / 0 limit 视为无限制', async () => {
    expect(await enforceOrgRpmAsync('org-x', null)).toBe(true);
    expect(await enforceOrgRpmAsync('org-x', 0)).toBe(true);
    expect(await enforceOrgRpmAsync('org-x', undefined)).toBe(true);
  });

  it('orgId 为空字符串 / null 视为不强制', async () => {
    expect(await enforceOrgRpmAsync(null, 5)).toBe(true);
    expect(await enforceOrgRpmAsync('', 5)).toBe(true);
  });

  it('在 limit 内放行；超限拒绝', async () => {
    expect(await enforceOrgRpmAsync('org-y', 3)).toBe(true); // 1
    expect(await enforceOrgRpmAsync('org-y', 3)).toBe(true); // 2
    expect(await enforceOrgRpmAsync('org-y', 3)).toBe(true); // 3
    expect(await enforceOrgRpmAsync('org-y', 3)).toBe(false); // 4 → 超限
  });

  it('不同 orgId 桶独立', async () => {
    expect(await enforceOrgRpmAsync('org-a', 1)).toBe(true);
    expect(await enforceOrgRpmAsync('org-a', 1)).toBe(false);
    expect(await enforceOrgRpmAsync('org-b', 1)).toBe(true);
  });
});
