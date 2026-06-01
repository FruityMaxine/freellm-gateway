/**
 * 组织级 RPM 限额（Tick 20 v1.3.1.0 引入，Tick 21 v1.4.0.0 改走 KvStore 接口）。
 *
 * 之前是进程级 Map；现在透过 `getKvStore()` 走抽象层 ——
 * 单实例时拿到 `MemoryKvStore` 行为不变，多实例时跑 Redis 后端即可共享窗口。
 *
 * 兼容性：保留旧的同步 `enforceOrgRpm()` 签名作为内存桶老路径，
 * 新增异步 `enforceOrgRpmAsync()` 走 KvStore，供后续 tick 切换调用方。
 * 调用方按需选择；本 tick 不强制把同步路径全替换（避免破坏 Tick 20 测试）。
 */
import { getKvStore } from './kv-store.js';

interface OrgRpmBucket {
  windowStart: number;
  count: number;
}

const orgRpmBuckets = new Map<string, OrgRpmBucket>();

/**
 * 同步版本（保留兼容，内存桶）。
 * limit null/0/undefined 视为不强制。orgId 为空视为不强制。
 */
export function enforceOrgRpm(
  organizationId: string | null | undefined,
  limit: number | null | undefined,
): boolean {
  if (!organizationId || !limit) return true;
  const now = Date.now();
  const bucket = orgRpmBuckets.get(organizationId);
  if (!bucket || now - bucket.windowStart > 60_000) {
    orgRpmBuckets.set(organizationId, { windowStart: now, count: 1 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/**
 * 异步版本（Tick 21 引入，走 KvStore）。
 * 用 `incrAndExpire(key, 60)` 作为滑动窗口核心；返回值 ≤ limit 即放行。
 * 多实例部署下设置 `FREELLM_REDIS_URL` 后即自动走 Redis 共享窗口。
 */
export async function enforceOrgRpmAsync(
  organizationId: string | null | undefined,
  limit: number | null | undefined,
): Promise<boolean> {
  if (!organizationId || !limit) return true;
  const kv = getKvStore();
  const key = `freellm:rpm:org:${organizationId}`;
  const count = await kv.incrAndExpire(key, 60);
  return count <= limit;
}

// 仅供测试
export function _resetOrgRpmBuckets(): void {
  orgRpmBuckets.clear();
}

export function _peekOrgRpmBucket(orgId: string): Readonly<OrgRpmBucket> | undefined {
  return orgRpmBuckets.get(orgId);
}
