/**
 * Cross-package shared types.
 *
 * These describe the *data contracts* that flow between layers. Domain entities
 * (rows owned by Prisma) live in `apps/api`; the types here represent the
 * messages exchanged between subsystems and the runtime config surface.
 */

export type ProviderKind =
  | 'openrouter'
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'google'
  | 'openai-compat'
  | 'mock';

export type ProviderHealthStatus = 'active' | 'degraded' | 'rate_limited' | 'disabled';

export type ModelStatus =
  | 'active'
  | 'degraded'
  | 'rate_limited'
  | 'disabled'
  | 'removed'
  | 'paid_now';

export type FreeClassification = 'free' | 'paid' | 'suspected' | 'unknown';

export interface ModelCapabilities {
  stream: boolean;
  json: boolean;
  tools: boolean;
  vision: boolean;
  audio: boolean;
  // additional bits the discovery engine learns lazily
  reasoning?: boolean;
  longContext?: boolean;
}

/**
 * Audit P1-G: single source of truth for parsing capabilitiesJson rows.
 * Three call sites (pool-builder / score-updater / snapshot-diff) previously
 * each carried a local copy, two of which silently dropped `reasoning` and
 * `longContext` — a real bug that this helper closes.
 */
export function parseModelCapabilities(json: string | null | undefined): ModelCapabilities {
  if (!json) return { stream: false, json: false, tools: false, vision: false, audio: false };
  try {
    const o = JSON.parse(json) as Partial<ModelCapabilities>;
    return {
      stream: Boolean(o.stream),
      json: Boolean(o.json),
      tools: Boolean(o.tools),
      vision: Boolean(o.vision),
      audio: Boolean(o.audio),
      ...(o.reasoning !== undefined ? { reasoning: Boolean(o.reasoning) } : {}),
      ...(o.longContext !== undefined ? { longContext: Boolean(o.longContext) } : {}),
    };
  } catch (err) {
    // Audit SF P1-5: don't silently coerce — log once and return safe defaults.
    console.warn('[shared] parseModelCapabilities: bad JSON, defaulting to no caps', { err: (err as Error).message });
    return { stream: false, json: false, tools: false, vision: false, audio: false };
  }
}

export interface ModelPricing {
  prompt?: string; // upstream returns strings (sometimes scientific)
  completion?: string;
  request?: string;
  image?: string;
}

export interface DiscoveredModel {
  upstreamId: string;
  displayName: string;
  contextLength: number;
  pricing?: ModelPricing;
  capabilities: ModelCapabilities;
  paramsSupported?: string[];
  topProvider?: string;
  description?: string;
  family?: string;
  classification: FreeClassification;
  classificationReason: string;
  raw: unknown;
}

export type RoutingMode =
  | 'auto-best-free'
  | 'round-robin-free'
  | 'weighted-free'
  | 'openrouter-free-router'
  | 'prefer-model-fallback'
  | 'provider-specific'
  | 'paid-allowed';

/** Single attempt within a downstream chat-completions request. */
export interface RouteAttemptReport {
  ordinal: number;
  providerSlug: string;
  upstreamModel: string;
  durationMs: number;
  firstTokenMs?: number;
  status: number | null;
  ok: boolean;
  errorKind?: string;
  errorMessage?: string;
}

/** Effective resolution returned by the routing engine. */
export interface RouteResolution {
  requestId: string;
  alias?: string;
  attempts: RouteAttemptReport[];
  finalProvider?: string;
  finalModel?: string;
  ok: boolean;
}

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export interface VirtualKeyPermissions {
  allowedModels?: string[];
  deniedModels?: string[];
  allowedProviders?: string[];
  maxRequestsPerMinute?: number | null;
  maxRequestsPerDay?: number | null;
  maxTokensPerDay?: number | null;
  /** Tick 17 v1.1.0.0：日 embeddings 调用上限。null = 无限制。 */
  maxEmbeddingsPerDay?: number | null;
  /** Tick 56 v1.7.28.0：日累计 USD 上限(支持小数, null = 无限)。 */
  maxCostUsdPerDay?: number | null;
  allowPaidModels: boolean;
  allowStreaming: boolean;
  /** Tick 56 v1.7.28.0：推理思考强度。默认 none (关闭, 不传 reasoning 字段)。 */
  reasoningEffort?: ReasoningEffort;
  /** Tick 56 v1.7.28.0：允许 user 开关 reasoning(否则强制 none)。 */
  allowReasoning?: boolean;
}
