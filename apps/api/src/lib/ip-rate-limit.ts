/**
 * IP 级速率限制（Tick 24 v1.5.1.0 引入）。
 *
 * 用于 /public/demo-key 等无鉴权端点的反滥用：从 `X-Forwarded-For` 或 `req.ip`
 * 抽取客户端 IP，按时间窗口计数，超额拒绝。
 *
 * 全走 KV 抽象（多实例 + Redis 时跨实例共享桶）。
 *
 * 默认限额：5 次 / IP / 小时（针对 demo key 签发）。可通过参数覆盖。
 */
import type { FastifyRequest } from 'fastify';
import { getKvStore } from './kv-store.js';

export const DEMO_IP_LIMIT_PER_HOUR = 5;
const HOUR_SECONDS = 3600;

/**
 * 从请求中提取客户端 IP。
 * 优先级：X-Forwarded-For 第一段（受反代信任时）→ X-Real-IP → req.ip → 'unknown'。
 * Fastify trustProxy 已启用时 req.ip 已是真实客户端 IP。
 */
export function extractClientIp(req: FastifyRequest): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]!.trim();
    if (first) return first;
  }
  const xri = req.headers['x-real-ip'];
  if (typeof xri === 'string' && xri.length > 0) return xri;
  return req.ip || 'unknown';
}

/**
 * 检查 IP 在指定时间窗口内的调用次数，命中即 +1，超额返回 false。
 * @param namespace 路径标签，避免不同端点共享同一桶（如 'demo-key' / 'signup'）。
 * @param ip 客户端 IP
 * @param limit 时间窗口内的最大调用数，缺省 5
 * @param windowSeconds 时间窗口（秒），缺省 3600（1 小时）
 */
export async function enforceIpRateLimit(
  namespace: string,
  ip: string,
  limit = DEMO_IP_LIMIT_PER_HOUR,
  windowSeconds = HOUR_SECONDS,
): Promise<boolean> {
  if (!ip || ip === 'unknown') {
    // 无法识别 IP 时保守拒绝，防止匿名滥用绕过。
    return false;
  }
  const kv = getKvStore();
  const key = `freellm:iprate:${namespace}:${ip}`;
  const count = await kv.incrAndExpire(key, windowSeconds);
  return count <= limit;
}
