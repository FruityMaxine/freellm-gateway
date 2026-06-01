/**
 * Composite model scorer.
 *
 * Each model carries 9 normalised [0..1] sub-scores; the policy supplies
 * weights and we return both the composite number and a self-explanatory
 * `ScoreExplanation` blob so the Routing Lab page can show *why*.
 */
import type { ModelCapabilities } from '@freellm/shared';

export interface RoutingPolicyWeights {
  availability: number;
  latency: number;
  rateLimit: number;
  quality: number;
  context: number;
  freshness: number;
  cost: number;
  stability: number;
}

export const DEFAULT_WEIGHTS: RoutingPolicyWeights = {
  availability: 0.3,
  latency: 0.15,
  rateLimit: 0.2,
  quality: 0.15,
  context: 0.1,
  freshness: 0.05,
  cost: 0,
  stability: 0.05,
};

export interface ModelScoreInput {
  modelId: string;
  upstreamId: string;
  providerSlug: string;
  /** 0..1 each */
  availability: number;
  latency: number;
  rateLimit: number;
  quality: number;
  context: number;
  freshness: number;
  cost: number;
  stability: number;
  firstTokenLatency: number;
  /** -1..1 operator nudge — applied as a final additive bias. */
  weightAdj?: number;
  blacklisted?: boolean;
  whitelisted?: boolean;
  capabilities: ModelCapabilities;
  contextLength: number;
  isFree: boolean;
}

export interface ScoreExplanationDimension {
  dimension: keyof RoutingPolicyWeights | 'firstTokenLatency';
  weight: number;
  rawScore: number;
  contribution: number;
}

export interface ScoreExplanation {
  modelId: string;
  upstreamId: string;
  providerSlug: string;
  composite: number;
  weightAdj: number;
  blacklistPenalty: number;
  whitelistBonus: number;
  dimensions: ScoreExplanationDimension[];
  /** Short human-readable summary used in tooltips. */
  summary: string;
}

export const FULL_WEIGHTS_WITH_FIRST_TOKEN: RoutingPolicyWeights & { firstTokenLatency?: number } = {
  ...DEFAULT_WEIGHTS,
  firstTokenLatency: 0.05,
};

export function clamp01(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export interface ScorerOptions {
  weights?: Partial<RoutingPolicyWeights & { firstTokenLatency: number }>;
  /** Soft floor — models below this composite are filtered by the router. */
  scoreFloor?: number;
}

export function scoreModel(input: ModelScoreInput, opts: ScorerOptions = {}): ScoreExplanation {
  const w: RoutingPolicyWeights & { firstTokenLatency: number } = {
    ...FULL_WEIGHTS_WITH_FIRST_TOKEN,
    ...opts.weights,
  } as RoutingPolicyWeights & { firstTokenLatency: number };

  const dims: ScoreExplanationDimension[] = [
    { dimension: 'availability', weight: w.availability, rawScore: clamp01(input.availability), contribution: 0 },
    { dimension: 'latency', weight: w.latency, rawScore: clamp01(input.latency), contribution: 0 },
    { dimension: 'rateLimit', weight: w.rateLimit, rawScore: clamp01(input.rateLimit), contribution: 0 },
    { dimension: 'quality', weight: w.quality, rawScore: clamp01(input.quality), contribution: 0 },
    { dimension: 'context', weight: w.context, rawScore: clamp01(input.context), contribution: 0 },
    { dimension: 'freshness', weight: w.freshness, rawScore: clamp01(input.freshness), contribution: 0 },
    { dimension: 'cost', weight: w.cost, rawScore: clamp01(input.cost), contribution: 0 },
    { dimension: 'stability', weight: w.stability, rawScore: clamp01(input.stability), contribution: 0 },
    {
      dimension: 'firstTokenLatency',
      weight: w.firstTokenLatency ?? 0,
      rawScore: clamp01(input.firstTokenLatency),
      contribution: 0,
    },
  ];

  let composite = 0;
  for (const d of dims) {
    d.contribution = d.weight * d.rawScore;
    composite += d.contribution;
  }

  const weightAdj = Math.max(-1, Math.min(1, input.weightAdj ?? 0));
  composite += weightAdj * 0.1;

  // Free models get a tiny "discoverability" bonus only when cost weight is 0
  // (i.e. the operator hasn't asked us to factor cost in directly).
  if (input.isFree && (w.cost ?? 0) === 0) composite += 0.02;

  const whitelistBonus = input.whitelisted ? 0.05 : 0;
  composite = clamp01(composite + whitelistBonus);

  // Blacklist is a hard veto; no amount of upstream excellence wins.
  const blacklistPenalty = input.blacklisted ? composite : 0;
  if (input.blacklisted) composite = 0;

  const dominant = [...dims]
    .filter((d) => d.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3);
  const summary = dominant.length
    ? `${composite.toFixed(2)} driven by ${dominant
        .map((d) => `${d.dimension} (${(d.contribution * 100).toFixed(0)}%)`)
        .join(', ')}`
    : `${composite.toFixed(2)} (no dimension contributed)`;

  return {
    modelId: input.modelId,
    upstreamId: input.upstreamId,
    providerSlug: input.providerSlug,
    composite,
    weightAdj,
    blacklistPenalty,
    whitelistBonus,
    dimensions: dims,
    summary,
  };
}

/**
 * Update an existing 9-dimension score in place after a single attempt.
 * Uses an EWMA so a single bad attempt does not wipe a model's history.
 */
export interface ScoreSampleInput {
  ok: boolean;
  durationMs: number;
  firstTokenMs?: number;
  kind?: string;
}

export interface MutableScores {
  availabilityScore: number;
  latencyScore: number;
  rateLimitScore: number;
  stabilityScore: number;
  successCount24h: number;
  failureCount24h: number;
  rateLimit24h: number;
  avgLatencyMs: number;
  firstTokenLatencyMs: number;
}

const EWMA_ALPHA = 0.2;

export function ewmaUpdate(prev: number, sample: number, alpha = EWMA_ALPHA): number {
  return prev * (1 - alpha) + sample * alpha;
}

export function applyScoreSample(scores: MutableScores, sample: ScoreSampleInput): MutableScores {
  const next = { ...scores };
  if (sample.ok) next.successCount24h += 1;
  else next.failureCount24h += 1;
  if (sample.kind === 'rate_limited') next.rateLimit24h += 1;

  const successRate = next.successCount24h / Math.max(1, next.successCount24h + next.failureCount24h);
  next.availabilityScore = ewmaUpdate(next.availabilityScore, sample.ok ? 1 : 0, 0.1);
  next.stabilityScore = ewmaUpdate(next.stabilityScore, successRate);

  // Latency normalisation: 0 ms → 1.0, 60_000 ms → 0
  const latencyNorm = clamp01(1 - sample.durationMs / 60_000);
  next.latencyScore = ewmaUpdate(next.latencyScore, latencyNorm);
  next.avgLatencyMs = Math.round(ewmaUpdate(next.avgLatencyMs, sample.durationMs));

  if (sample.firstTokenMs !== undefined) {
    next.firstTokenLatencyMs = Math.round(ewmaUpdate(next.firstTokenLatencyMs, sample.firstTokenMs));
  }

  if (sample.kind === 'rate_limited') {
    next.rateLimitScore = ewmaUpdate(next.rateLimitScore, 0);
  } else if (sample.ok) {
    next.rateLimitScore = ewmaUpdate(next.rateLimitScore, 1);
  }

  return next;
}
