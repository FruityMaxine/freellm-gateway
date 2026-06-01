/**
 * Demo 虚拟密钥独立限额（Tick 23 v1.5.0.0 引入）。
 *
 * Playground 公开访客体验路由用 `isDemo=true` 的虚拟密钥；额度比正常 VK 紧很多，
 * 防止匿名滥用：
 *   - 15 次请求 / 天
 *   - 1000 token / 天
 *
 * 单独走 KV 抽象（多实例 + Redis 时跨实例共享），key 前缀 `freellm:demo:`。
 */
import { getKvStore } from './kv-store.js';

export const DEMO_DAILY_REQUEST_LIMIT = 15;
export const DEMO_DAILY_TOKEN_LIMIT = 1000;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 检查 demo 密钥的日请求额度，命中即 +1，超额返回 false。
 * key 维度为「虚拟密钥 ID + 日期」，确保每个 demo key 每天独立计数。
 */
export async function enforceDemoDailyRequests(virtualKeyId: string): Promise<boolean> {
  const kv = getKvStore();
  const key = `freellm:demo:req:${virtualKeyId}:${todayKey()}`;
  const count = await kv.incrAndExpire(key, 86_400);
  return count <= DEMO_DAILY_REQUEST_LIMIT;
}

/**
 * 检查 demo 密钥的日 Token 额度，按已消费 + 即将消费判断。
 * 调用方式：先调 `peekDemoDailyTokens` 看剩余；返回 ≤ 0 即拒绝。
 * 真正消费在请求完成后由 `recordDemoTokenUsage` 上报。
 */
export async function peekDemoDailyTokens(virtualKeyId: string): Promise<number> {
  const kv = getKvStore();
  const key = `freellm:demo:tok:${virtualKeyId}:${todayKey()}`;
  const raw = await kv.get(key);
  const used = raw ? Number.parseInt(raw, 10) : 0;
  return DEMO_DAILY_TOKEN_LIMIT - used;
}

export async function recordDemoTokenUsage(virtualKeyId: string, tokens: number): Promise<void> {
  if (tokens <= 0) return;
  const kv = getKvStore();
  const key = `freellm:demo:tok:${virtualKeyId}:${todayKey()}`;
  const raw = await kv.get(key);
  const prev = raw ? Number.parseInt(raw, 10) : 0;
  await kv.set(key, String(prev + tokens), 86_400);
}
