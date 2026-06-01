/**
 * Webhook 出站签名（Tick 25 v1.6.0.0 引入）。
 *
 * 用 HMAC-SHA256 给 webhook payload 签名，下游验签：
 *   X-FreeLLM-Signature: t=<unix秒>,v1=<hmac_hex>
 *   X-FreeLLM-Event:     <topic>
 *   X-FreeLLM-Delivery:  <uuid>
 *
 * 验签算法（与 GitHub / Stripe 风格一致）：
 *   待签字符串 = `${timestamp}.${body}`
 *   v1 = HMAC-SHA256(secret, 待签字符串).hex
 *
 * 下游收到后：
 *   1. 解析 t / v1
 *   2. 检查 abs(now - t) < 5 分钟（防重放）
 *   3. 用同 secret 重算 HMAC，恒定时间比较
 *
 * 本库提供 `signWebhook(secret, body)` + `verifyWebhook(secret, body, header, opts)`，
 * 后者主要给单元测试与 admin 验证页用。
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export interface SignedWebhook {
  /** 签名头值，形如 `t=1715000000,v1=abc...` */
  signatureHeader: string;
  /** 投递 ID */
  deliveryId: string;
  /** 签名时间戳（秒） */
  timestamp: number;
}

export function signWebhook(secret: string, body: string, now: number = Date.now()): SignedWebhook {
  const timestamp = Math.floor(now / 1000);
  const payload = `${timestamp}.${body}`;
  const v1 = createHmac('sha256', secret).update(payload).digest('hex');
  return {
    signatureHeader: `t=${timestamp},v1=${v1}`,
    deliveryId: randomUUID(),
    timestamp,
  };
}

export interface VerifyOptions {
  /** 容忍的时钟偏差（秒），默认 300。 */
  toleranceSeconds?: number;
  /** 当前时间（毫秒，便于测试注入）。 */
  now?: number;
}

export interface VerifyResult {
  valid: boolean;
  reason?: 'malformed' | 'expired' | 'signature_mismatch';
}

export function verifyWebhook(
  secret: string,
  body: string,
  signatureHeader: string,
  opts: VerifyOptions = {},
): VerifyResult {
  const match = /^t=(\d+),v1=([0-9a-f]+)$/i.exec(signatureHeader.trim());
  if (!match) return { valid: false, reason: 'malformed' };
  const t = Number.parseInt(match[1]!, 10);
  const v1 = match[2]!;
  const tolerance = opts.toleranceSeconds ?? 300;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (Math.abs(now - t) > tolerance) return { valid: false, reason: 'expired' };

  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  // 恒定时间比较
  const a = Buffer.from(v1, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return { valid: false, reason: 'signature_mismatch' };
  const equal = timingSafeEqual(a, b);
  return equal ? { valid: true } : { valid: false, reason: 'signature_mismatch' };
}
