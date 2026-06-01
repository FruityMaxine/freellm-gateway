/**
 * Decide whether an upstream model is "free".
 *
 * We never trust a single signal. The classifier returns a label plus the
 * reason it landed there so admins can audit it. Adding a signal is cheap —
 * append to `signals`, update `classify`, add a test in
 * `__tests__/free-detector.test.ts`.
 */
import type { FreeClassification, DiscoveredModel } from '@freellm/shared';
import type { ProviderListModelsResult } from './types.js';

export type FreeDetectorReason =
  | 'pricing_all_zero'
  | 'pricing_partial_zero'
  | 'pricing_nonzero'
  | 'suffix_free'
  | 'id_heuristic'
  | 'top_provider_free_tier'
  | 'missing_pricing'
  | 'manual_override';

export interface FreeDetectorResult {
  classification: FreeClassification;
  reason: FreeDetectorReason;
  /**
   * Confidence in [0..1]. `free` / `paid` with confidence ≥ 0.8 should be
   * treated as authoritative; `suspected` is "needs a human glance".
   */
  confidence: number;
}

const FREE_NUMBER_FORMS = new Set(['0', '0.0', '0.00', '0e0', '0e-9', '0e+0']);

function isZero(raw: string | number | undefined | null): boolean {
  if (raw === undefined || raw === null) return false;
  if (typeof raw === 'number') return raw === 0;
  const norm = raw.trim().toLowerCase();
  if (!norm) return false;
  if (FREE_NUMBER_FORMS.has(norm)) return true;
  // Parse strings like "0", "0.0", "0E0", "0.00000000".
  const asNumber = Number(norm);
  return Number.isFinite(asNumber) && asNumber === 0;
}

function looksLikeFreeSuffix(upstreamId: string): boolean {
  return /:free(\b|$)/i.test(upstreamId);
}

function idLooksFree(upstreamId: string): boolean {
  // Names that strongly hint at a free or evaluation tier even without pricing data.
  return /\b(free|trial|sandbox|preview-free)\b/i.test(upstreamId);
}

export interface FreeDetectorInput {
  upstreamId: string;
  displayName?: string;
  pricing?: { prompt?: string | number; completion?: string | number; request?: string | number; image?: string | number };
  topProvider?: string;
  manualOverride?: 'force_free' | 'force_paid' | null;
}

export function classifyFree(input: FreeDetectorInput): FreeDetectorResult {
  // Manual override always wins.
  if (input.manualOverride === 'force_free') {
    return { classification: 'free', reason: 'manual_override', confidence: 1 };
  }
  if (input.manualOverride === 'force_paid') {
    return { classification: 'paid', reason: 'manual_override', confidence: 1 };
  }

  const pricing = input.pricing ?? {};
  const promptZero = isZero(pricing.prompt);
  const completionZero = isZero(pricing.completion);
  const requestZero = isZero(pricing.request);
  const anyPricingFieldPresent =
    pricing.prompt !== undefined || pricing.completion !== undefined || pricing.request !== undefined;

  const suffixFree = looksLikeFreeSuffix(input.upstreamId);
  const idHints = idLooksFree(input.upstreamId);

  // High-confidence "free": pricing is published and every relevant field is zero.
  if (anyPricingFieldPresent && promptZero && completionZero && (pricing.request === undefined || requestZero)) {
    if (suffixFree || idHints) {
      return { classification: 'free', reason: 'pricing_all_zero', confidence: 0.99 };
    }
    return { classification: 'free', reason: 'pricing_all_zero', confidence: 0.92 };
  }

  // Mid-confidence "free": pricing partially zero (e.g. prompt 0, completion not yet published).
  if (anyPricingFieldPresent && (promptZero || completionZero) && suffixFree) {
    return { classification: 'free', reason: 'pricing_partial_zero', confidence: 0.85 };
  }

  // High-confidence "paid": pricing fields exist and at least one is published and non-zero.
  const anyPublishedNonZero =
    (pricing.prompt !== undefined && !promptZero) ||
    (pricing.completion !== undefined && !completionZero) ||
    (pricing.request !== undefined && !requestZero);
  if (anyPricingFieldPresent && anyPublishedNonZero) {
    return { classification: 'paid', reason: 'pricing_nonzero', confidence: 0.95 };
  }

  // No pricing info; rely on naming + provider tier heuristics.
  if (suffixFree) {
    return { classification: 'suspected', reason: 'suffix_free', confidence: 0.65 };
  }
  if (idHints) {
    return { classification: 'suspected', reason: 'id_heuristic', confidence: 0.5 };
  }
  if (input.topProvider && /\bfree\b/i.test(input.topProvider)) {
    return { classification: 'suspected', reason: 'top_provider_free_tier', confidence: 0.55 };
  }

  return { classification: 'unknown', reason: 'missing_pricing', confidence: 0.2 };
}

/**
 * Convenience: classify a freshly-listed provider model and produce a
 * `DiscoveredModel` ready for persistence/diffing.
 */
export function toDiscoveredModel(entry: ProviderListModelsResult): DiscoveredModel {
  const det = classifyFree({
    upstreamId: entry.upstreamId,
    displayName: entry.displayName,
    pricing: entry.pricing,
    topProvider: entry.topProvider,
  });
  return {
    upstreamId: entry.upstreamId,
    displayName: entry.displayName,
    contextLength: entry.contextLength,
    ...(entry.pricing !== undefined ? { pricing: entry.pricing } : {}),
    capabilities: entry.capabilities,
    ...(entry.paramsSupported !== undefined ? { paramsSupported: entry.paramsSupported } : {}),
    ...(entry.topProvider !== undefined ? { topProvider: entry.topProvider } : {}),
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(deriveFamily(entry.upstreamId) !== undefined
      ? { family: deriveFamily(entry.upstreamId)! }
      : {}),
    classification: det.classification,
    classificationReason: `${det.reason}@${det.confidence.toFixed(2)}`,
    raw: entry.raw,
  };
}

function deriveFamily(upstreamId: string): string | undefined {
  // Pull a short family tag from the id ("meta-llama/llama-3.3" → "llama").
  const lowered = upstreamId.toLowerCase();
  const families = [
    'llama',
    'qwen',
    'mistral',
    'mixtral',
    'gemma',
    'phi',
    'deepseek',
    'yi',
    'openrouter',
    'grok',
    'claude',
    'gpt',
    'gemini',
    'cohere',
    'command-r',
    'nemotron',
    'olmo',
    'minimax',
    'baichuan',
  ];
  for (const f of families) {
    if (lowered.includes(f)) return f;
  }
  return undefined;
}
