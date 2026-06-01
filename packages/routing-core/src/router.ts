/**
 * The router turns a downstream request + active policy + model pool into an
 * ordered candidate list. It does not touch the network — `RouteExecutor`
 * (apps/api) consumes the candidates and walks them with cooldown gates.
 */
import type { ModelCapabilities, RoutingMode, VirtualKeyPermissions } from '@freellm/shared';
import { scoreModel, type ScoreExplanation, type ModelScoreInput } from './scorer.js';

export interface PoolModel {
  modelId: string;
  upstreamId: string;
  providerSlug: string;
  isFree: boolean;
  contextLength: number;
  capabilities: ModelCapabilities;
  status: 'active' | 'degraded' | 'rate_limited' | 'disabled' | 'removed' | 'paid_now';
  blacklisted: boolean;
  whitelisted: boolean;
  weightAdj: number;
  /** Live scores; defaulted to 0.5 baseline when score row is missing. */
  scores: {
    availability: number;
    latency: number;
    rateLimit: number;
    quality: number;
    context: number;
    freshness: number;
    cost: number;
    stability: number;
    firstTokenLatency: number;
  };
}

export interface RouteRequestContext {
  alias?: string;
  explicitModel?: string;
  requireCapabilities?: Partial<ModelCapabilities> & { minContextLength?: number };
  permissions?: VirtualKeyPermissions;
  policy: {
    name: string;
    mode: RoutingMode;
    weights?: Record<string, number>;
    params?: Record<string, unknown>;
  };
  /** Max candidates to return; the executor walks them in order. */
  maxCandidates: number;
}

export interface Candidate {
  model: PoolModel;
  score: ScoreExplanation;
  rationale: string;
}

export interface RoutingDecision {
  candidates: Candidate[];
  mode: RoutingMode;
  filteredOut: Array<{ upstreamId: string; reason: string }>;
}

const ALIAS_HANDLERS: Record<string, (pool: PoolModel[]) => PoolModel[]> = {
  'free/auto': (p) => p.filter((m) => m.isFree),
  'free/best': (p) => p.filter((m) => m.isFree),
  'free/fast': (p) => p.filter((m) => m.isFree && m.scores.latency >= 0.4),
  'free/large-context': (p) => p.filter((m) => m.isFree && m.contextLength >= 100_000),
  'openrouter/free': (p) =>
    p.filter((m) => m.providerSlug === 'openrouter' && m.upstreamId === 'openrouter/free'),
  // Tick 17 v1.1.0.0：按能力过滤的新别名。
  'free/with-tools': (p) => p.filter((m) => m.isFree && m.capabilities.tools),
  'free/with-vision': (p) => p.filter((m) => m.isFree && m.capabilities.vision),
  'free/json-mode': (p) => p.filter((m) => m.isFree && m.capabilities.json),
};

function passesCapabilityFilter(
  model: PoolModel,
  required?: Partial<ModelCapabilities> & { minContextLength?: number },
): boolean {
  if (!required) return true;
  const caps = model.capabilities;
  if (required.stream === true && !caps.stream) return false;
  if (required.json === true && !caps.json) return false;
  if (required.tools === true && !caps.tools) return false;
  if (required.vision === true && !caps.vision) return false;
  if (required.audio === true && !caps.audio) return false;
  if (required.minContextLength && model.contextLength < required.minContextLength) return false;
  return true;
}

function passesVirtualKey(model: PoolModel, perm?: VirtualKeyPermissions): boolean {
  if (!perm) return true;
  if (perm.allowedModels?.length && !perm.allowedModels.includes(model.upstreamId)) return false;
  if (perm.deniedModels?.includes(model.upstreamId)) return false;
  if (perm.allowedProviders?.length && !perm.allowedProviders.includes(model.providerSlug)) return false;
  if (!perm.allowPaidModels && !model.isFree) return false;
  if (!perm.allowStreaming) {
    // streaming refused if downstream cannot consume it — only matters when explicit
  }
  return true;
}

function passesStatus(model: PoolModel, mode: RoutingMode, allowPaid: boolean): boolean {
  if (model.status === 'disabled' || model.status === 'removed') return false;
  if (model.status === 'paid_now' && !allowPaid && mode !== 'paid-allowed') return false;
  return true;
}

export class Router {
  decide(pool: PoolModel[], ctx: RouteRequestContext): RoutingDecision {
    const filteredOut: Array<{ upstreamId: string; reason: string }> = [];

    const aliasFiltered = ctx.alias && ALIAS_HANDLERS[ctx.alias] ? ALIAS_HANDLERS[ctx.alias]!(pool) : pool;
    if (ctx.alias && ALIAS_HANDLERS[ctx.alias]) {
      for (const m of pool) {
        if (!aliasFiltered.includes(m)) filteredOut.push({ upstreamId: m.upstreamId, reason: `alias ${ctx.alias}` });
      }
    }

    const allowPaid = (ctx.permissions?.allowPaidModels ?? false) || ctx.policy.mode === 'paid-allowed';

    const survivors: PoolModel[] = [];
    for (const m of aliasFiltered) {
      if (!passesStatus(m, ctx.policy.mode, allowPaid)) {
        filteredOut.push({ upstreamId: m.upstreamId, reason: `status ${m.status}` });
        continue;
      }
      if (!passesCapabilityFilter(m, ctx.requireCapabilities)) {
        filteredOut.push({ upstreamId: m.upstreamId, reason: 'capability filter' });
        continue;
      }
      if (!passesVirtualKey(m, ctx.permissions)) {
        filteredOut.push({ upstreamId: m.upstreamId, reason: 'virtual-key permissions' });
        continue;
      }
      if (m.blacklisted) {
        filteredOut.push({ upstreamId: m.upstreamId, reason: 'blacklisted' });
        continue;
      }
      survivors.push(m);
    }

    let ordered = this.orderForMode(survivors, ctx);

    if (ctx.explicitModel && ctx.policy.mode === 'prefer-model-fallback') {
      const pinned = survivors.find((m) => m.upstreamId === ctx.explicitModel);
      if (pinned) ordered = [pinned, ...ordered.filter((m) => m !== pinned)];
    }
    if (ctx.policy.mode === 'provider-specific' && typeof ctx.policy.params?.providerSlug === 'string') {
      ordered = ordered.filter((m) => m.providerSlug === ctx.policy.params!.providerSlug);
    }

    const trimmed = ordered.slice(0, ctx.maxCandidates);
    const candidates: Candidate[] = trimmed.map((m) => {
      const score = scoreModel(this.toScoreInput(m, ctx), { weights: ctx.policy.weights as never });
      return { model: m, score, rationale: this.modeRationale(ctx.policy.mode, m, score) };
    });

    return { candidates, mode: ctx.policy.mode, filteredOut };
  }

  private toScoreInput(m: PoolModel, _ctx: RouteRequestContext): ModelScoreInput {
    return {
      modelId: m.modelId,
      upstreamId: m.upstreamId,
      providerSlug: m.providerSlug,
      availability: m.scores.availability,
      latency: m.scores.latency,
      rateLimit: m.scores.rateLimit,
      quality: m.scores.quality,
      context: m.scores.context,
      freshness: m.scores.freshness,
      cost: m.scores.cost,
      stability: m.scores.stability,
      firstTokenLatency: m.scores.firstTokenLatency,
      weightAdj: m.weightAdj,
      blacklisted: m.blacklisted,
      whitelisted: m.whitelisted,
      capabilities: m.capabilities,
      contextLength: m.contextLength,
      isFree: m.isFree,
    };
  }

  private orderForMode(pool: PoolModel[], ctx: RouteRequestContext): PoolModel[] {
    const mode = ctx.policy.mode;
    const scored = pool
      .map((m) => ({ m, s: scoreModel(this.toScoreInput(m, ctx), { weights: ctx.policy.weights as never }).composite }))
      .sort((a, b) => b.s - a.s);

    switch (mode) {
      case 'auto-best-free':
      case 'paid-allowed':
        return scored.map((x) => x.m);
      case 'round-robin-free': {
        // shuffle deterministically by upstreamId hash for reproducibility within a request
        return [...pool].sort((a, b) => hash(a.upstreamId) - hash(b.upstreamId));
      }
      case 'weighted-free': {
        const out: PoolModel[] = [];
        let bag = scored.slice();
        const total = bag.reduce((acc, x) => acc + Math.max(0.01, x.s), 0);
        while (bag.length && out.length < pool.length) {
          let r = Math.random() * total;
          let picked = bag[0]!;
          for (const x of bag) {
            r -= Math.max(0.01, x.s);
            if (r <= 0) {
              picked = x;
              break;
            }
          }
          out.push(picked.m);
          bag = bag.filter((x) => x.m.upstreamId !== picked.m.upstreamId);
        }
        return out;
      }
      case 'openrouter-free-router':
        return scored
          .map((x) => x.m)
          .filter((m) => m.providerSlug === 'openrouter' && m.upstreamId === 'openrouter/free');
      case 'prefer-model-fallback':
        return scored.map((x) => x.m);
      case 'provider-specific': {
        const slug = ctx.policy.params?.providerSlug as string | undefined;
        const filtered = slug ? scored.filter((x) => x.m.providerSlug === slug) : scored;
        return filtered.map((x) => x.m);
      }
      default:
        return scored.map((x) => x.m);
    }
  }

  private modeRationale(mode: RoutingMode, model: PoolModel, score: ScoreExplanation): string {
    switch (mode) {
      case 'auto-best-free':
        return `auto pick: composite=${score.composite.toFixed(2)} (${score.summary})`;
      case 'round-robin-free':
        return `round-robin slot — composite=${score.composite.toFixed(2)}`;
      case 'weighted-free':
        return `weighted draw — composite=${score.composite.toFixed(2)}`;
      case 'openrouter-free-router':
        return 'openrouter/free router';
      case 'prefer-model-fallback':
        return `fallback after explicit model — composite=${score.composite.toFixed(2)}`;
      case 'provider-specific':
        return `provider-pinned to ${model.providerSlug}`;
      case 'paid-allowed':
        return `paid fallback allowed — composite=${score.composite.toFixed(2)}, free=${model.isFree}`;
      default:
        return `${mode}: composite=${score.composite.toFixed(2)}`;
    }
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}
