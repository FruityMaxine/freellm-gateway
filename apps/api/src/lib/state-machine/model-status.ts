/**
 * Model status state machine.
 *
 * `models.status` advances along a small set of legal transitions. Centralising
 * them here means the discovery service, routing engine, and admin endpoints
 * can never put a row into an inconsistent state — every change goes through
 * `transitionModelStatus` which records the trigger for audit.
 */
import type { ModelStatus } from '@freellm/shared';

export type ModelStatusTrigger =
  | 'discovery_first_seen'
  | 'discovery_still_present'
  | 'discovery_missing'
  | 'discovery_pricing_now_paid'
  | 'discovery_pricing_returned_free'
  | 'discovery_capability_changed'
  | 'route_success'
  | 'route_rate_limited'
  | 'route_unavailable'
  | 'route_recovered'
  | 'manual_disable'
  | 'manual_enable'
  | 'manual_blacklist';

interface TransitionRule {
  to: ModelStatus;
  /** Permitted source statuses. `*` means any. */
  from: ModelStatus[] | '*';
}

const RULES: Record<ModelStatusTrigger, TransitionRule> = {
  discovery_first_seen: { to: 'active', from: '*' },
  discovery_still_present: { to: 'active', from: ['active', 'degraded', 'rate_limited'] },
  discovery_missing: { to: 'removed', from: '*' },
  discovery_pricing_now_paid: { to: 'paid_now', from: '*' },
  discovery_pricing_returned_free: { to: 'active', from: ['paid_now', 'disabled'] },
  discovery_capability_changed: { to: 'active', from: ['active', 'degraded', 'rate_limited'] },
  route_success: { to: 'active', from: ['degraded', 'rate_limited'] },
  route_rate_limited: { to: 'rate_limited', from: ['active', 'degraded'] },
  route_unavailable: { to: 'degraded', from: ['active', 'rate_limited'] },
  route_recovered: { to: 'active', from: ['degraded', 'rate_limited', 'disabled'] },
  manual_disable: { to: 'disabled', from: '*' },
  manual_enable: { to: 'active', from: '*' },
  manual_blacklist: { to: 'disabled', from: '*' },
};

export interface ModelStatusTransitionResult {
  changed: boolean;
  from: ModelStatus;
  to: ModelStatus;
  trigger: ModelStatusTrigger;
  reason?: string;
}

export function nextModelStatus(
  current: ModelStatus,
  trigger: ModelStatusTrigger,
): ModelStatusTransitionResult {
  const rule = RULES[trigger];
  const allowed = rule.from === '*' ? true : rule.from.includes(current);
  if (!allowed) {
    return { changed: false, from: current, to: current, trigger, reason: 'transition not allowed' };
  }
  if (rule.to === current) {
    return { changed: false, from: current, to: current, trigger };
  }
  return { changed: true, from: current, to: rule.to, trigger };
}

export function isTerminalStatus(status: ModelStatus): boolean {
  return status === 'removed';
}

export function listAllowedTransitions(): Array<{
  trigger: ModelStatusTrigger;
  rule: TransitionRule;
}> {
  return (Object.keys(RULES) as ModelStatusTrigger[]).map((trigger) => ({
    trigger,
    rule: RULES[trigger],
  }));
}
