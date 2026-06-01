/**
 * Updates the persistent `model_scores` row after each upstream attempt.
 * Implements the EWMA helpers from `@freellm/routing-core/scorer` against
 * the DB so the next request sees fresh numbers.
 */
import type { PrismaClient } from '@prisma/client';
import { applyScoreSample, FULL_WEIGHTS_WITH_FIRST_TOKEN, scoreModel } from '@freellm/routing-core';
import { parseModelCapabilities } from '@freellm/shared';

export interface ScoreUpdater {
  recordAttempt(
    modelId: string,
    sample: { ok: boolean; durationMs: number; firstTokenMs?: number; kind?: string },
  ): Promise<void>;
}

export class ScoreUpdaterService implements ScoreUpdater {
  constructor(private prisma: PrismaClient) {}

  async recordAttempt(
    modelId: string,
    sample: { ok: boolean; durationMs: number; firstTokenMs?: number; kind?: string },
  ): Promise<void> {
    const existing = await this.prisma.modelScore.findUnique({ where: { modelId } });
    const seed = existing ?? {
      modelId,
      availabilityScore: 0.5,
      latencyScore: 0.5,
      rateLimitScore: 0.5,
      qualityScore: 0.5,
      contextScore: 0.5,
      capabilityScore: 0.5,
      freshnessScore: 0.5,
      costScore: 1,
      stabilityScore: 0.5,
      firstTokenLatencyMs: null,
      avgLatencyMs: null,
      successCount24h: 0,
      failureCount24h: 0,
      rateLimit24h: 0,
      composite: 0,
      explanationJson: null,
    };

    const updated = applyScoreSample(
      {
        availabilityScore: seed.availabilityScore,
        latencyScore: seed.latencyScore,
        rateLimitScore: seed.rateLimitScore,
        stabilityScore: seed.stabilityScore,
        successCount24h: seed.successCount24h,
        failureCount24h: seed.failureCount24h,
        rateLimit24h: seed.rateLimit24h,
        avgLatencyMs: seed.avgLatencyMs ?? 0,
        firstTokenLatencyMs: seed.firstTokenLatencyMs ?? 0,
      },
      sample,
    );

    // Recompute the composite to keep the row's `composite` column live.
    const model = await this.prisma.model.findUnique({
      where: { id: modelId },
      select: {
        id: true,
        upstreamId: true,
        provider: { select: { slug: true } },
        capabilitiesJson: true,
        contextLength: true,
        isFree: true,
        blacklisted: true,
        whitelisted: true,
        weightAdj: true,
      },
    });
    if (!model) return;

    const capabilities = parseModelCapabilities(model.capabilitiesJson);
    const explanation = scoreModel(
      {
        modelId: model.id,
        upstreamId: model.upstreamId,
        providerSlug: model.provider.slug,
        availability: updated.availabilityScore,
        latency: updated.latencyScore,
        rateLimit: updated.rateLimitScore,
        quality: seed.qualityScore,
        context: seed.contextScore,
        freshness: seed.freshnessScore,
        cost: seed.costScore,
        stability: updated.stabilityScore,
        firstTokenLatency: clampLatencyScore(updated.firstTokenLatencyMs),
        weightAdj: model.weightAdj,
        blacklisted: model.blacklisted,
        whitelisted: model.whitelisted,
        capabilities,
        contextLength: model.contextLength,
        isFree: model.isFree,
      },
      { weights: FULL_WEIGHTS_WITH_FIRST_TOKEN },
    );

    await this.prisma.modelScore.upsert({
      where: { modelId },
      update: {
        availabilityScore: updated.availabilityScore,
        latencyScore: updated.latencyScore,
        rateLimitScore: updated.rateLimitScore,
        stabilityScore: updated.stabilityScore,
        successCount24h: updated.successCount24h,
        failureCount24h: updated.failureCount24h,
        rateLimit24h: updated.rateLimit24h,
        avgLatencyMs: updated.avgLatencyMs || null,
        firstTokenLatencyMs: updated.firstTokenLatencyMs || null,
        composite: explanation.composite,
        explanationJson: JSON.stringify(explanation),
      },
      create: {
        modelId,
        availabilityScore: updated.availabilityScore,
        latencyScore: updated.latencyScore,
        rateLimitScore: updated.rateLimitScore,
        stabilityScore: updated.stabilityScore,
        successCount24h: updated.successCount24h,
        failureCount24h: updated.failureCount24h,
        rateLimit24h: updated.rateLimit24h,
        avgLatencyMs: updated.avgLatencyMs || null,
        firstTokenLatencyMs: updated.firstTokenLatencyMs || null,
        costScore: model.isFree ? 1 : 0,
        composite: explanation.composite,
        explanationJson: JSON.stringify(explanation),
      },
    });
  }
}

function clampLatencyScore(ms: number): number {
  if (!ms) return 0.5;
  // 0 ms → 1.0, 60_000 ms → 0
  return Math.max(0, Math.min(1, 1 - ms / 60_000));
}
