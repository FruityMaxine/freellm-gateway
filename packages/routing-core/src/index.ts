/**
 * Routing engine — composite scorer, router, error classifier, cooldown.
 */
import type { RoutingMode } from '@freellm/shared';

export interface RoutingContextSummary {
  alias?: string;
  explicitModel?: string;
  policyName: string;
  mode: RoutingMode;
  requireCapabilities?: {
    stream?: boolean;
    json?: boolean;
    tools?: boolean;
    vision?: boolean;
    minContextLength?: number;
  };
}

export { type RoutingMode } from '@freellm/shared';
export * from './scorer.js';
export * from './error-classifier.js';
export * from './cooldown.js';
export * from './router.js';
