/**
 * Virtual API key management.
 *
 * The `secret` is 256-bit random encoded as URL-safe base32-ish hex; we hash
 * it with sha256 and only ever store the hash + a short prefix. The
 * downstream caller sees the plaintext exactly once.
 */
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { hashApiKey, publicDigest, type VirtualKeyPermissions } from '@freellm/shared';

export type VirtualKeyEnvironment = 'live' | 'test';

export interface CreateVirtualKeyInput {
  label: string;
  environment?: VirtualKeyEnvironment;
  permissions: VirtualKeyPermissions;
  expiresAt?: Date | null;
  notes?: string;
  tags?: string[];
  createdBy?: string;
  /** Tick 55 v1.7.27.0：归属人(RBAC)。user role 用户创建时自动绑自己。 */
  ownerId?: string | null;
  /** Tick 19 v1.3.0.0：归属项目（nullable，兼容旧调用方）。 */
  projectId?: string | null;
}

export interface CreateVirtualKeyResult {
  id: string;
  prefix: string;
  /** Plain-text secret — returned exactly once. */
  secret: string;
  label: string;
  environment: VirtualKeyEnvironment;
  createdAt: Date;
}

const PREFIX_LEN = 8;

export class VirtualKeyService {
  constructor(private prisma: PrismaClient) {}

  async create(input: CreateVirtualKeyInput): Promise<CreateVirtualKeyResult> {
    const env: VirtualKeyEnvironment = input.environment ?? 'live';
    const random = randomBytes(32).toString('hex'); // 64 hex chars
    const secret = `fllm_${env}_${random}`;
    const hash = hashApiKey(secret);
    const prefix = `${secret.slice(0, `fllm_${env}_`.length + PREFIX_LEN)}…${publicDigest(secret)}`;
    const row = await this.prisma.virtualKey.create({
      data: {
        hash,
        prefix,
        label: input.label,
        environment: env,
        enabled: true,
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        ...(input.tags ? { tagsJson: JSON.stringify(input.tags) } : {}),
        ...(input.createdBy ? { createdBy: input.createdBy } : {}),
        // Tick 55 v1.7.27.0：归属当前登录的 admin user (RBAC owner filter 用)
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        ...permissionsToColumns(input.permissions),
      },
    });
    return {
      id: row.id,
      prefix: row.prefix,
      secret,
      label: row.label,
      environment: row.environment as VirtualKeyEnvironment,
      createdAt: row.createdAt,
    };
  }

  async resolveBySecret(secret: string) {
    if (!/^fllm_(live|test)_[a-f0-9]{16,128}$/i.test(secret)) return null;
    const row = await this.prisma.virtualKey.findUnique({ where: { hash: hashApiKey(secret) } });
    return row;
  }

  /**
   * Tick 20 v1.3.1.0：拿 VK 时同步 join 出 Project + Organization，
   * 让鉴权 plugin 一次拿全三层身份（VK / Project / Organization）。
   */
  async resolveBySecretWithTenancy(secret: string) {
    if (!/^fllm_(live|test)_[a-f0-9]{16,128}$/i.test(secret)) return null;
    return this.prisma.virtualKey.findUnique({
      where: { hash: hashApiKey(secret) },
      include: {
        project: {
          include: {
            organization: true,
          },
        },
      },
    });
  }

  async listAll() {
    return this.prisma.virtualKey.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /**
   * Tick 55 v1.7.27.0：按 ownerId 过滤(user role 用)。
   * ownerId=null → 等价 listAll(给 admin role)。
   */
  async listByOwner(ownerId: string | null) {
    if (!ownerId) return this.listAll();
    return this.prisma.virtualKey.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async patch(id: string, patch: Partial<CreateVirtualKeyInput & { enabled: boolean }>) {
    const updates: Record<string, unknown> = {};
    if (patch.label !== undefined) updates.label = patch.label;
    if (patch.notes !== undefined) updates.notes = patch.notes;
    if (patch.enabled !== undefined) updates.enabled = patch.enabled;
    if (patch.tags !== undefined) updates.tagsJson = JSON.stringify(patch.tags);
    if (patch.expiresAt !== undefined)
      updates.expiresAt = patch.expiresAt === null ? null : patch.expiresAt;
    if (patch.permissions) Object.assign(updates, permissionsToColumns(patch.permissions));
    return this.prisma.virtualKey.update({ where: { id }, data: updates });
  }

  async revoke(id: string) {
    return this.prisma.virtualKey.update({
      where: { id },
      data: { enabled: false, revokedAt: new Date() },
    });
  }

  async rotate(id: string): Promise<CreateVirtualKeyResult> {
    const existing = await this.prisma.virtualKey.findUnique({ where: { id } });
    if (!existing) throw new Error(`virtual key ${id} not found`);
    const random = randomBytes(32).toString('hex');
    const env = existing.environment as VirtualKeyEnvironment;
    const secret = `fllm_${env}_${random}`;
    const hash = hashApiKey(secret);
    const prefix = `${secret.slice(0, `fllm_${env}_`.length + PREFIX_LEN)}…${publicDigest(secret)}`;
    const updated = await this.prisma.virtualKey.update({
      where: { id },
      data: { hash, prefix, revokedAt: null, enabled: true },
    });
    return {
      id: updated.id,
      prefix: updated.prefix,
      secret,
      label: updated.label,
      environment: env,
      createdAt: updated.createdAt,
    };
  }

  async touchUsage(id: string, ip: string | null, tokens: bigint) {
    await this.prisma.virtualKey.update({
      where: { id },
      data: {
        lastUsedAt: new Date(),
        lastUsedIp: ip ?? null,
        totalRequests: { increment: 1 },
        totalTokens: { increment: tokens },
      },
    });
  }
}

function permissionsToColumns(perm: VirtualKeyPermissions): Record<string, unknown> {
  return {
    ...(perm.allowedModels ? { allowedModelsJson: JSON.stringify(perm.allowedModels) } : {}),
    ...(perm.deniedModels ? { deniedModelsJson: JSON.stringify(perm.deniedModels) } : {}),
    ...(perm.allowedProviders ? { allowedProvidersJson: JSON.stringify(perm.allowedProviders) } : {}),
    ...(perm.maxRequestsPerMinute !== undefined ? { maxRequestsPerMinute: perm.maxRequestsPerMinute } : {}),
    ...(perm.maxRequestsPerDay !== undefined ? { maxRequestsPerDay: perm.maxRequestsPerDay } : {}),
    ...(perm.maxTokensPerDay !== undefined ? { maxTokensPerDay: perm.maxTokensPerDay } : {}),
    ...(perm.maxEmbeddingsPerDay !== undefined ? { maxEmbeddingsPerDay: perm.maxEmbeddingsPerDay } : {}),
    ...(perm.maxCostUsdPerDay !== undefined ? { maxCostUsdPerDay: perm.maxCostUsdPerDay } : {}),
    allowPaidModels: perm.allowPaidModels,
    allowStreaming: perm.allowStreaming,
    ...(perm.reasoningEffort !== undefined ? { reasoningEffort: perm.reasoningEffort } : {}),
    ...(perm.allowReasoning !== undefined ? { allowReasoning: perm.allowReasoning } : {}),
  };
}

export function rowPermissions(row: {
  allowedModelsJson: string | null;
  deniedModelsJson: string | null;
  allowedProvidersJson: string | null;
  maxRequestsPerMinute: number | null;
  maxRequestsPerDay: number | null;
  maxTokensPerDay: number | null;
  maxEmbeddingsPerDay: number | null;
  maxCostUsdPerDay?: number | null;
  allowPaidModels: boolean;
  allowStreaming: boolean;
  reasoningEffort?: string;
  allowReasoning?: boolean;
}): VirtualKeyPermissions {
  const parse = (raw: string | null): string[] | undefined => {
    if (!raw) return undefined;
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    ...(parse(row.allowedModelsJson) ? { allowedModels: parse(row.allowedModelsJson)! } : {}),
    ...(parse(row.deniedModelsJson) ? { deniedModels: parse(row.deniedModelsJson)! } : {}),
    ...(parse(row.allowedProvidersJson) ? { allowedProviders: parse(row.allowedProvidersJson)! } : {}),
    maxRequestsPerMinute: row.maxRequestsPerMinute,
    maxRequestsPerDay: row.maxRequestsPerDay,
    maxTokensPerDay: row.maxTokensPerDay,
    maxEmbeddingsPerDay: row.maxEmbeddingsPerDay,
    maxCostUsdPerDay: row.maxCostUsdPerDay ?? null,
    allowPaidModels: row.allowPaidModels,
    allowStreaming: row.allowStreaming,
    reasoningEffort: (row.reasoningEffort as VirtualKeyPermissions['reasoningEffort']) ?? 'none',
    allowReasoning: row.allowReasoning ?? true,
  };
}
