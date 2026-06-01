/**
 * 从实时数据库构建 router 所需的 `PoolModel[]` 快照。
 *
 * 单次查询拉取全部活跃模型，由 routing engine 负责过滤，热路径开销可预期；
 * Tick 13 加入 5 秒 TTL 缓存（pool-cache.ts）以摊薄高 QPS 下的 Prisma 开销。
 *
 * Tick 13 优化：从 `include` 切换到 `select` —— 只拉 builder 实际需要的列，
 * 避免 over-fetch provider.apiKeyEnv / Score 大字段等 hot path 用不到的数据。
 */
import type { PrismaClient } from '@prisma/client';
import type { PoolModel } from '@freellm/routing-core';
import type { ModelCapabilities } from '@freellm/shared';

const BASELINE = {
  availability: 0.5,
  latency: 0.5,
  rateLimit: 0.5,
  quality: 0.5,
  context: 0.5,
  freshness: 0.5,
  cost: 1,
  stability: 0.5,
  firstTokenLatency: 0.5,
};

export async function buildPool(prisma: PrismaClient): Promise<PoolModel[]> {
  const models = await prisma.model.findMany({
    where: { status: { notIn: ['removed', 'disabled'] } },
    select: {
      id: true,
      upstreamId: true,
      isFree: true,
      contextLength: true,
      capabilitiesJson: true,
      status: true,
      blacklisted: true,
      whitelisted: true,
      weightAdj: true,
      provider: { select: { slug: true } },
      scores: {
        select: {
          availabilityScore: true,
          latencyScore: true,
          rateLimitScore: true,
          qualityScore: true,
          contextScore: true,
          freshnessScore: true,
          costScore: true,
          stabilityScore: true,
        },
      },
    },
    take: 800,
  });
  return models.map((m) => {
    const caps = parseCaps(m.capabilitiesJson);
    const s = m.scores;
    return {
      modelId: m.id,
      upstreamId: m.upstreamId,
      providerSlug: m.provider.slug,
      isFree: m.isFree,
      contextLength: m.contextLength,
      capabilities: caps,
      status: m.status as PoolModel['status'],
      blacklisted: m.blacklisted,
      whitelisted: m.whitelisted,
      weightAdj: m.weightAdj,
      scores: {
        availability: s?.availabilityScore ?? BASELINE.availability,
        latency: s?.latencyScore ?? BASELINE.latency,
        rateLimit: s?.rateLimitScore ?? BASELINE.rateLimit,
        quality: s?.qualityScore ?? BASELINE.quality,
        context:
          s?.contextScore ?? clamp01(m.contextLength / 200_000),
        freshness: s?.freshnessScore ?? BASELINE.freshness,
        cost: s?.costScore ?? (m.isFree ? 1 : 0),
        stability: s?.stabilityScore ?? BASELINE.stability,
        firstTokenLatency: BASELINE.firstTokenLatency,
      },
    };
  });
}

function parseCaps(json: string): ModelCapabilities {
  try {
    const o = JSON.parse(json) as Partial<ModelCapabilities>;
    return {
      stream: Boolean(o.stream),
      json: Boolean(o.json),
      tools: Boolean(o.tools),
      vision: Boolean(o.vision),
      audio: Boolean(o.audio),
    };
  } catch {
    return { stream: false, json: false, tools: false, vision: false, audio: false };
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
