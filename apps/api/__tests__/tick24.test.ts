/**
 * Tick 24 v1.5.1.0 单元测试：
 * - extractClientIp 提取 X-Forwarded-For / X-Real-IP / req.ip
 * - enforceIpRateLimit 窗口 + 桶隔离 + unknown IP 拒绝
 * - 默认限额常量
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyRequest } from 'fastify';
import {
  DEMO_IP_LIMIT_PER_HOUR,
  enforceIpRateLimit,
  extractClientIp,
} from '../src/lib/ip-rate-limit.js';
import { MemoryKvStore, _setKvStoreForTests } from '../src/lib/kv-store.js';

function fakeReq(headers: Record<string, string | undefined>, ip = ''): FastifyRequest {
  return {
    headers: headers as never,
    ip,
  } as unknown as FastifyRequest;
}

describe('Tick 24 — extractClientIp', () => {
  it('优先 X-Forwarded-For 第一段', () => {
    expect(
      extractClientIp(fakeReq({ 'x-forwarded-for': '203.0.113.10, 10.0.0.1' })),
    ).toBe('203.0.113.10');
  });

  it('X-Real-IP 次优先', () => {
    expect(extractClientIp(fakeReq({ 'x-real-ip': '198.51.100.5' }))).toBe('198.51.100.5');
  });

  it('回落 req.ip', () => {
    expect(extractClientIp(fakeReq({}, '127.0.0.1'))).toBe('127.0.0.1');
  });

  it('全空时返回 "unknown"', () => {
    expect(extractClientIp(fakeReq({}, ''))).toBe('unknown');
  });

  it('XFF 含空白被 trim', () => {
    expect(extractClientIp(fakeReq({ 'x-forwarded-for': '  192.0.2.1  ' }))).toBe('192.0.2.1');
  });
});

describe('Tick 24 — enforceIpRateLimit 滑动窗口', () => {
  beforeEach(() => {
    _setKvStoreForTests(new MemoryKvStore());
  });

  it('默认限额常量 = 5 次/小时', () => {
    expect(DEMO_IP_LIMIT_PER_HOUR).toBe(5);
  });

  it('首 5 次放行，第 6 次拒绝', async () => {
    for (let i = 0; i < 5; i++) {
      expect(await enforceIpRateLimit('demo-key', '203.0.113.1')).toBe(true);
    }
    expect(await enforceIpRateLimit('demo-key', '203.0.113.1')).toBe(false);
  });

  it('不同 IP 桶隔离', async () => {
    for (let i = 0; i < 5; i++) await enforceIpRateLimit('demo-key', '203.0.113.2');
    expect(await enforceIpRateLimit('demo-key', '203.0.113.2')).toBe(false);
    // 另一个 IP 仍有完整额度
    expect(await enforceIpRateLimit('demo-key', '203.0.113.3')).toBe(true);
  });

  it('不同 namespace 桶隔离', async () => {
    for (let i = 0; i < 5; i++) await enforceIpRateLimit('demo-key', '203.0.113.4');
    expect(await enforceIpRateLimit('demo-key', '203.0.113.4')).toBe(false);
    // 同 IP 不同 namespace 仍有额度
    expect(await enforceIpRateLimit('other-endpoint', '203.0.113.4')).toBe(true);
  });

  it('unknown IP 直接拒绝', async () => {
    expect(await enforceIpRateLimit('demo-key', 'unknown')).toBe(false);
    expect(await enforceIpRateLimit('demo-key', '')).toBe(false);
  });

  it('自定义 limit / window 生效', async () => {
    // 2 次窗口
    expect(await enforceIpRateLimit('custom', '203.0.113.5', 2, 60)).toBe(true);
    expect(await enforceIpRateLimit('custom', '203.0.113.5', 2, 60)).toBe(true);
    expect(await enforceIpRateLimit('custom', '203.0.113.5', 2, 60)).toBe(false);
  });
});
