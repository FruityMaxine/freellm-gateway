/**
 * Tick 25 v1.6.0.0 单元测试：
 * - signWebhook 输出形态 + 时间戳 + 头格式
 * - verifyWebhook 成功 / 篡改 / 过期 / 格式错
 * - HMAC 验证恒定时间比较（不抛错）
 * - 投递 ID 唯一性 sanity
 */
import { describe, it, expect } from 'vitest';
import { signWebhook, verifyWebhook } from '../src/lib/webhook-signer.js';

const SECRET = 'test-webhook-secret-do-not-use-in-prod';
const PAYLOAD = JSON.stringify({ topic: 'model:added', model: 'mock/echo:free' });

describe('Tick 25 — signWebhook', () => {
  it('返回签名头形态 t=<int>,v1=<hex>', () => {
    const r = signWebhook(SECRET, PAYLOAD);
    expect(r.signatureHeader).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('timestamp 与签名头中的 t 一致', () => {
    const r = signWebhook(SECRET, PAYLOAD, 1_700_000_000_000);
    expect(r.timestamp).toBe(1_700_000_000);
    expect(r.signatureHeader.startsWith('t=1700000000,v1=')).toBe(true);
  });

  it('同样输入 + 显式 now → 签名可重现', () => {
    const a = signWebhook(SECRET, PAYLOAD, 1_700_000_000_000);
    const b = signWebhook(SECRET, PAYLOAD, 1_700_000_000_000);
    expect(a.signatureHeader).toBe(b.signatureHeader);
  });

  it('每次 deliveryId 唯一', () => {
    const a = signWebhook(SECRET, PAYLOAD);
    const b = signWebhook(SECRET, PAYLOAD);
    expect(a.deliveryId).not.toBe(b.deliveryId);
  });
});

describe('Tick 25 — verifyWebhook', () => {
  it('正确签名 → valid=true', () => {
    const signed = signWebhook(SECRET, PAYLOAD);
    const r = verifyWebhook(SECRET, PAYLOAD, signed.signatureHeader);
    expect(r.valid).toBe(true);
  });

  it('错误 secret → signature_mismatch', () => {
    const signed = signWebhook(SECRET, PAYLOAD);
    const r = verifyWebhook('different-secret-key-here', PAYLOAD, signed.signatureHeader);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('signature_mismatch');
  });

  it('篡改 payload → signature_mismatch', () => {
    const signed = signWebhook(SECRET, PAYLOAD);
    const r = verifyWebhook(SECRET, PAYLOAD + 'x', signed.signatureHeader);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('signature_mismatch');
  });

  it('过期（> 5 分钟）→ expired', () => {
    const oldTs = 1_700_000_000_000;
    const signed = signWebhook(SECRET, PAYLOAD, oldTs);
    const r = verifyWebhook(SECRET, PAYLOAD, signed.signatureHeader, {
      now: oldTs + 10 * 60 * 1000, // 10 分钟后
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('expired');
  });

  it('未过期（5 分钟内）→ valid', () => {
    const oldTs = 1_700_000_000_000;
    const signed = signWebhook(SECRET, PAYLOAD, oldTs);
    const r = verifyWebhook(SECRET, PAYLOAD, signed.signatureHeader, {
      now: oldTs + 100 * 1000, // 100 秒后
    });
    expect(r.valid).toBe(true);
  });

  it('自定义 toleranceSeconds 生效', () => {
    const oldTs = 1_700_000_000_000;
    const signed = signWebhook(SECRET, PAYLOAD, oldTs);
    // 默认拒，自定义 1800（30 分钟）放行
    const r = verifyWebhook(SECRET, PAYLOAD, signed.signatureHeader, {
      now: oldTs + 10 * 60 * 1000,
      toleranceSeconds: 1800,
    });
    expect(r.valid).toBe(true);
  });

  it('格式错的签名头 → malformed', () => {
    const cases = ['', 'invalid', 't=abc,v1=xxx', 'v1=abc', 'random string'];
    for (const sig of cases) {
      const r = verifyWebhook(SECRET, PAYLOAD, sig);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('malformed');
    }
  });
});
