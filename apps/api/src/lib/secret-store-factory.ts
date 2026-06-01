/**
 * 进程级 SecretStore 工厂（组 4 Tick 2 v1.8.0.0 引入）。
 *
 * 背景（修复前的命脉 bug）：bootstrap.ts 与 providers.routes.ts 一共 6 处硬编码
 * `new EnvSecretStore()`。EnvSecretStore 只读 `process.env`，永远读不到 DB
 * `upstream_keys.cipherText`。于是：
 *   - 取用 key 时 resolveKey 拿到 null → 上游 LLM 收到空 Bearer → 401。
 *   - 写入 key 时 EnvSecretStore.write 抛 "read-only" → attachApiKey catch 降级存 `plain:<key>`。
 * 结果真实 LLM 推理 100% 失败，而 UI/路由引擎全好，表现为「网关假活」。
 *
 * 本工厂返回单例 DbEncryptedSecretStore（接 PrismaSecretKV + FREELLM_MASTER_KEY），
 * read/write 都落到 upstream_keys.cipherText，且 read 支持 plain:/pending:/v1 三格式。
 * 仅当 master key 缺失/过短时回落 EnvSecretStore（dev/CI 场景）。
 */
import type { PrismaClient } from '@prisma/client';
import {
  DbEncryptedSecretStore,
  EnvSecretStore,
  type SecretKV,
  type SecretStore,
} from '@freellm/shared';
import { getConfig } from '../config.js';
import { getPrisma } from './prisma.js';

const UPSTREAM_PREFIX = 'upstream_key:';

/**
 * SecretKV over the `UpstreamKey.cipherText` column.
 *
 * Ref 约定为 `upstream_key:<rowId>`。其它前缀一律视为不支持（read→null / write→throw），
 * 这样未来若新增 webhook secret 等 KV 类型，可在此显式扩展而非静默误写。
 */
export class PrismaSecretKV implements SecretKV {
  constructor(private prisma: PrismaClient) {}

  private idOf(key: string): string | null {
    return key.startsWith(UPSTREAM_PREFIX) ? key.slice(UPSTREAM_PREFIX.length) : null;
  }

  async read(key: string): Promise<string | null> {
    const id = this.idOf(key);
    if (!id) return null;
    const row = await this.prisma.upstreamKey.findUnique({
      where: { id },
      select: { cipherText: true },
    });
    return row?.cipherText ?? null;
  }

  async write(key: string, value: string): Promise<void> {
    const id = this.idOf(key);
    if (!id) throw new Error(`PrismaSecretKV: unsupported secret ref "${key}"`);
    await this.prisma.upstreamKey.update({ where: { id }, data: { cipherText: value } });
  }

  async remove(key: string): Promise<void> {
    const id = this.idOf(key);
    if (!id) return;
    // 行还有 label/digest/limits 等字段，不整行删除；把 cipherText 标成占位让 read 返 null。
    await this.prisma.upstreamKey
      .update({ where: { id }, data: { cipherText: 'pending:removed' } })
      .catch(() => {
        /* 行可能已被上层级联删除，忽略 */
      });
  }
}

let cached: SecretStore | null = null;

/**
 * 返回进程单例 SecretStore。
 * master key 就绪 → DbEncryptedSecretStore（生产）；否则 → EnvSecretStore（dev/CI 回落）。
 */
export function getSecretStore(prisma: PrismaClient = getPrisma()): SecretStore {
  if (cached) return cached;
  const { env } = getConfig();
  const masterKey = env.FREELLM_MASTER_KEY;
  if (typeof masterKey === 'string' && masterKey.trim().length >= 32) {
    cached = new DbEncryptedSecretStore(new PrismaSecretKV(prisma), masterKey);
  } else {
    // 组 4 Tick 5 P1 修复：生产环境 env schema 强制 master key ≥32（缺则 loadEnv 已硬失败），
    // 故此分支生产不可达。但绝不静默退化——EnvSecretStore 只读，会触发 attachApiKey 的
    // plain: 明文降级（命脉 bug 源头）。醒目告警，让任何意外走到这里的场景可被发现。
    console.warn(
      '[secret-store-factory] FREELLM_MASTER_KEY 缺失或 <32 字节，SecretStore 退化为只读 ' +
        'EnvSecretStore —— 写入将触发 plain: 明文降级，凭据不加密。仅 dev/CI 可接受，生产严禁。',
    );
    cached = new EnvSecretStore();
  }
  return cached;
}

/** 仅供测试重置单例。 */
export function __resetSecretStoreCache(): void {
  cached = null;
}
