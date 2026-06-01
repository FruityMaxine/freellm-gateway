/**
 * Prisma-backed implementation of the `CooldownStore` port from
 * @freellm/routing-core. Maps the engine's `(scope, key)` model to the
 * Prisma `cooldowns` table where `key` is either `modelId` or
 * `providerSlug`.
 */
import type { PrismaClient } from '@prisma/client';
import type {
  CooldownRecord,
  CooldownScope,
  CooldownStore,
} from '@freellm/routing-core';

export class PrismaCooldownStore implements CooldownStore {
  constructor(private prisma: PrismaClient) {}

  async list(scope?: CooldownScope): Promise<CooldownRecord[]> {
    const rows = await this.prisma.cooldown.findMany({
      where: scope ? { scope } : {},
      orderBy: { expiresAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.mapRow(r));
  }

  async findActive(scope: CooldownScope, key: string): Promise<CooldownRecord | null> {
    const row = await this.prisma.cooldown.findFirst({
      where: scope === 'model' ? { scope: 'model', modelId: key } : { scope: 'provider', providerId: key },
      orderBy: { expiresAt: 'desc' },
    });
    return row ? this.mapRow(row) : null;
  }

  async upsert(record: Omit<CooldownRecord, 'createdAt'>): Promise<CooldownRecord> {
    const existing = await this.prisma.cooldown.findFirst({
      where:
        record.scope === 'model'
          ? { scope: 'model', modelId: record.key }
          : { scope: 'provider', providerId: record.key },
    });
    if (existing) {
      const updated = await this.prisma.cooldown.update({
        where: { id: existing.id },
        data: {
          reason: record.reason,
          attempts: record.attempts,
          backoffMs: record.backoffMs,
          expiresAt: record.expiresAt,
          halfOpen: record.halfOpen,
        },
      });
      return this.mapRow(updated);
    }
    const created = await this.prisma.cooldown.create({
      data: {
        scope: record.scope,
        ...(record.scope === 'model' ? { modelId: record.key } : { providerId: record.key }),
        reason: record.reason,
        attempts: record.attempts,
        backoffMs: record.backoffMs,
        expiresAt: record.expiresAt,
        halfOpen: record.halfOpen,
      },
    });
    return this.mapRow(created);
  }

  async reset(id: string): Promise<void> {
    await this.prisma.cooldown.update({
      where: { id },
      data: { resolvedAt: new Date(), halfOpen: false, expiresAt: new Date(0) },
    });
  }

  async clearExpired(now: Date = new Date()): Promise<number> {
    const r = await this.prisma.cooldown.deleteMany({
      where: { expiresAt: { lte: now }, halfOpen: false, resolvedAt: { not: null } },
    });
    return r.count;
  }

  private mapRow(row: {
    id: string;
    scope: string;
    modelId: string | null;
    providerId: string | null;
    reason: string;
    attempts: number;
    backoffMs: number;
    expiresAt: Date;
    halfOpen: boolean;
    createdAt: Date;
  }): CooldownRecord {
    const scope = row.scope as CooldownScope;
    return {
      id: row.id,
      scope,
      key: scope === 'model' ? row.modelId ?? '' : row.providerId ?? '',
      reason: row.reason,
      attempts: row.attempts,
      backoffMs: row.backoffMs,
      expiresAt: row.expiresAt,
      halfOpen: row.halfOpen,
      createdAt: row.createdAt,
    };
  }
}
