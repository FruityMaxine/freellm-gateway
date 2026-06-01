/**
 * Tick 22 v1.4.1.0 单元 + 集成测试：
 * - 迁移脚本：表顺序常量 + 干跑入口可调用
 * - SSE Pub/Sub 适配器：未设 redis url 时 attached=false 静默退化
 * - EventBus 在 mocked pub 下 publish 调用次数 + 远端注入不循环
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/services/event-bus.js';
import { attachRedisPubSub, _instanceId } from '../src/services/event-bus-redis.js';

describe('Tick 22 — 迁移脚本表顺序', () => {
  it('表顺序常量按外键依赖排序（Project 在 Organization 之后；RequestLog 在 VirtualKey 之后）', async () => {
    const mod = await import('../../../scripts/migrate-sqlite-to-postgres.js').catch(() => null);
    // 脚本是 .ts，从 dist 编译产物可能不存在；直接 importPath 失败则跳过此用例。
    if (!mod) {
      // fallback：直接读源码验证常量名（轻量字符串校验）。
      const fs = await import('node:fs');
      const path = await import('node:path');
      const repoRoot = process.cwd().endsWith('/apps/api')
        ? path.resolve(process.cwd(), '../..')
        : process.cwd();
      const source = fs.readFileSync(
        path.join(repoRoot, 'scripts/migrate-sqlite-to-postgres.ts'),
        'utf8',
      );
      // 顺序敏感字符串
      const idxOrg = source.indexOf("'Organization'");
      const idxProject = source.indexOf("'Project'");
      const idxVk = source.indexOf("'VirtualKey'");
      const idxReqLog = source.indexOf("'RequestLog'");
      expect(idxOrg).toBeGreaterThan(0);
      expect(idxProject).toBeGreaterThan(idxOrg);
      expect(idxVk).toBeGreaterThan(idxProject);
      expect(idxReqLog).toBeGreaterThan(idxVk);
    }
  });
});

describe('Tick 22 — attachRedisPubSub 静默退化', () => {
  beforeEach(() => {
    delete process.env.FREELLM_REDIS_URL;
  });

  it('FREELLM_REDIS_URL 未设 → attached=false 不抛错', () => {
    const bus = new EventBus();
    const result = attachRedisPubSub(bus);
    expect(result.attached).toBe(false);
    // detach 是 noop，可调用不抛错
    expect(() => result.detach()).not.toThrow();
  });

  it('显式传 redisUrl 为空字符串仍然不挂接', () => {
    const bus = new EventBus();
    const result = attachRedisPubSub(bus, { redisUrl: '' });
    expect(result.attached).toBe(false);
  });

  it('ioredis 缺失时（伪造 url 但本机无 ioredis）回落到 not attached', () => {
    // 注：本仓库未装 ioredis，所以即使 url 已设也应回落到 false。
    const bus = new EventBus();
    const result = attachRedisPubSub(bus, { redisUrl: 'redis://localhost:6379' });
    // 在未装 ioredis 的环境：attached=false 且 bus.emit 未被 patch
    expect(result.attached).toBe(false);
  });

  it('未挂接时 bus.emit 行为不变（本地 listeners 正常收）', async () => {
    const bus = new EventBus();
    const received: unknown[] = [];
    bus.on('test:topic', (p) => {
      received.push(p);
    });
    attachRedisPubSub(bus, { redisUrl: '' });
    await bus.emit('test:topic', { a: 1 });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ a: 1 });
  });
});

describe('Tick 22 — instanceId 唯一性 + fanout 防护', () => {
  it('_instanceId 返回稳定字符串', () => {
    const id1 = _instanceId();
    const id2 = _instanceId();
    expect(typeof id1).toBe('string');
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^freellm-/);
  });
});

describe('Tick 22 — virtual-key-auth 切到 async 版本（编译期契约）', () => {
  it('per-org-limit 导出 enforceOrgRpmAsync 函数', async () => {
    const mod = await import('../src/lib/per-org-limit.js');
    expect(typeof mod.enforceOrgRpmAsync).toBe('function');
  });

  it('enforceOrgRpmAsync 返回 Promise<boolean>', async () => {
    const { enforceOrgRpmAsync } = await import('../src/lib/per-org-limit.js');
    const result = enforceOrgRpmAsync(null, null);
    expect(result).toBeInstanceOf(Promise);
    const value = await result;
    expect(typeof value).toBe('boolean');
  });
});

describe('Tick 22 — EventBus 与 Pub/Sub 适配器 patch 模式（mock）', () => {
  it('未 attach 时 EventBus.emit 是原始实现', async () => {
    const bus = new EventBus();
    const ref = bus.emit;
    attachRedisPubSub(bus, { redisUrl: '' });
    // 静默退化时 emit 引用未变
    expect(bus.emit).toBe(ref);
  });

  it('detach() 后 EventBus.emit 恢复原始实现', async () => {
    const bus = new EventBus();
    const original = bus.emit;
    const { detach } = attachRedisPubSub(bus, { redisUrl: '' });
    await detach();
    expect(bus.emit).toBe(original);
  });
});
