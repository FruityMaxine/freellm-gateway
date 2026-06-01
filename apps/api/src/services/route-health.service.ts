/**
 * 路由健康三源聚合 service（组 5 Tick 3 v1.13.0.0）。
 *
 * 把分散的三个数据源拼成一个看板快照，供 RouteHealth 前端可视化：
 *   1. cooldowns —— 复用 PrismaCooldownStore（与 /admin/cooldowns 同源），含 halfOpen + 倒计时
 *   2. topModels —— ModelScore 表 top-N 的 9 维评分快照（喂 ModelScoreRadar 雷达图）
 *   3. providers —— 各 provider 最近 N 次 HealthCheck 时间线 + lastHealthAt
 */
import type { PrismaClient } from '@prisma/client';
import { PrismaCooldownStore } from './prisma-cooldown-store.js';

export interface RouteHealthCooldown {
  id: string;
  scope: 'model' | 'provider';
  label: string;
  reason: string;
  attempts: number;
  backoffMs: number;
  expiresAt: string;
  halfOpen: boolean;
  remainingMs: number;
}

export interface RouteHealthModel {
  modelId: string;
  upstreamId: string;
  providerSlug: string;
  composite: number;
  scores: {
    availabilityScore: number;
    latencyScore: number;
    rateLimitScore: number;
    qualityScore: number;
    contextScore: number;
    capabilityScore: number;
    freshnessScore: number;
    costScore: number;
    stabilityScore: number;
  };
}

export interface RouteHealthProvider {
  slug: string;
  name: string;
  lastHealthAt: string | null;
  checks: Array<{ ok: boolean; latencyMs: number | null; takenAt: string }>;
}

export interface RouteHealthSnapshot {
  cooldowns: RouteHealthCooldown[];
  topModels: RouteHealthModel[];
  providers: RouteHealthProvider[];
  generatedAt: string;
}

export class RouteHealthService {
  constructor(private prisma: PrismaClient) {}

  async snapshot(topN = 6, checksPerProvider = 16): Promise<RouteHealthSnapshot> {
    // 1) 活跃 cooldowns（复用 store，解析 model/provider 友好 label + 倒计时）。
    const store = new PrismaCooldownStore(this.prisma);
    const records = await store.list();
    const now = Date.now();
    const cooldowns = await Promise.all(
      records.map(async (r): Promise<RouteHealthCooldown> => {
        let label = r.key;
        if (r.scope === 'model') {
          const m = await this.prisma.model.findUnique({
            where: { id: r.key },
            select: { upstreamId: true, provider: { select: { slug: true } } },
          });
          if (m) label = `${m.provider.slug}/${m.upstreamId}`;
        } else if (r.scope === 'provider') {
          const p = await this.prisma.provider.findUnique({ where: { id: r.key }, select: { slug: true } });
          if (p) label = p.slug;
        }
        return {
          id: r.id,
          scope: r.scope,
          label,
          reason: r.reason,
          attempts: r.attempts,
          backoffMs: r.backoffMs,
          expiresAt: r.expiresAt.toISOString(),
          halfOpen: r.halfOpen,
          remainingMs: Math.max(0, r.expiresAt.getTime() - now),
        };
      }),
    );

    // 2) Top-N 模型 9 维评分快照（喂雷达图）。
    const scoreRows = await this.prisma.modelScore.findMany({
      orderBy: { composite: 'desc' },
      take: topN,
      include: { model: { select: { upstreamId: true, provider: { select: { slug: true } } } } },
    });
    const topModels: RouteHealthModel[] = scoreRows.map((s) => ({
      modelId: s.modelId,
      upstreamId: s.model.upstreamId,
      providerSlug: s.model.provider.slug,
      composite: s.composite,
      scores: {
        availabilityScore: s.availabilityScore,
        latencyScore: s.latencyScore,
        rateLimitScore: s.rateLimitScore,
        qualityScore: s.qualityScore,
        contextScore: s.contextScore,
        capabilityScore: s.capabilityScore,
        freshnessScore: s.freshnessScore,
        costScore: s.costScore,
        stabilityScore: s.stabilityScore,
      },
    }));

    // 3) Provider 健康时间线（最近 N 次 health check，升序便于时间线渲染）。
    const provs = await this.prisma.provider.findMany({
      where: { enabled: true },
      select: { id: true, slug: true, name: true, lastHealthAt: true },
    });
    const providers: RouteHealthProvider[] = await Promise.all(
      provs.map(async (p) => {
        const checks = await this.prisma.healthCheck.findMany({
          where: { providerId: p.id, scope: 'provider' },
          orderBy: { takenAt: 'desc' },
          take: checksPerProvider,
          select: { ok: true, latencyMs: true, takenAt: true },
        });
        return {
          slug: p.slug,
          name: p.name,
          lastHealthAt: p.lastHealthAt?.toISOString() ?? null,
          checks: checks
            .reverse()
            .map((c) => ({ ok: c.ok, latencyMs: c.latencyMs, takenAt: c.takenAt.toISOString() })),
        };
      }),
    );

    return { cooldowns, topModels, providers, generatedAt: new Date().toISOString() };
  }
}
