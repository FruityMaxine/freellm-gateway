/**
 * Resolve a downstream `model` string into a FreeLLM-internal alias + extra
 * routing hints. Aliases never reach the upstream verbatim — the router
 * picks the actual provider/upstream id.
 */

export type ModelAlias =
  | 'free/auto'
  | 'free/best'
  | 'free/fast'
  | 'free/large-context'
  | 'openrouter/free';

export const KNOWN_ALIASES: ModelAlias[] = [
  'free/auto',
  'free/best',
  'free/fast',
  'free/large-context',
  'openrouter/free',
];

export interface ResolvedModel {
  alias?: ModelAlias;
  explicitUpstreamId?: string;
  /** Hint to the router. */
  hints: {
    preferFast?: boolean;
    requireLargeContext?: boolean;
    forceProviderSlug?: string;
  };
}

export function resolveModel(raw: string): ResolvedModel {
  const trimmed = raw.trim();
  if ((KNOWN_ALIASES as string[]).includes(trimmed)) {
    const alias = trimmed as ModelAlias;
    const hints: ResolvedModel['hints'] = {};
    if (alias === 'free/fast') hints.preferFast = true;
    if (alias === 'free/large-context') hints.requireLargeContext = true;
    if (alias === 'openrouter/free') hints.forceProviderSlug = 'openrouter';
    return { alias, hints };
  }
  return { explicitUpstreamId: trimmed, hints: {} };
}
