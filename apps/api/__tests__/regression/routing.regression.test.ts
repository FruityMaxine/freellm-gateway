/**
 * AI 路由回归测试。
 *
 * 用 baselines.json 中的 routing 用例对 Router.decide 的输出做断言：
 * 一旦后续 tick 改了路由策略导致行为偏移，本测试立刻失败。
 *
 * 若改动确实合理，请同步更新 baselines.json 并在 commit message 说明原因。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Router, type PoolModel } from '@freellm/routing-core';

interface RoutingCase {
  scenario: string;
  inputAlias: string;
  expectedTopProviderSlug?: string;
  expectedTopUpstreamId?: string;
  expectedIsFree?: boolean;
  expectExcludeModelId?: string;
  expectedRationaleIncludes?: string;
  expectedReasonIncludes?: string;
}

function loadBaselines(): { routing: RoutingCase[] } {
  const p = resolve(__dirname, 'baselines.json');
  return JSON.parse(readFileSync(p, 'utf8')) as { routing: RoutingCase[] };
}

function makePool(): PoolModel[] {
  return [
    {
      modelId: 'm-1',
      upstreamId: 'meta/llama-3.3-70b-instruct:free',
      providerSlug: 'openrouter',
      isFree: true,
      contextLength: 128_000,
      capabilities: { stream: true, json: true, tools: false, vision: false, audio: false },
      status: 'active',
      blacklisted: false,
      whitelisted: false,
      weightAdj: 0,
      scores: {
        availability: 0.95,
        latency: 0.8,
        rateLimit: 0.85,
        quality: 0.78,
        context: 0.7,
        freshness: 0.55,
        cost: 1,
        stability: 0.8,
        firstTokenLatency: 0.65,
      },
    },
    {
      modelId: 'm-2',
      upstreamId: 'openrouter/free',
      providerSlug: 'openrouter',
      isFree: true,
      contextLength: 32_000,
      capabilities: { stream: true, json: true, tools: false, vision: false, audio: false },
      status: 'active',
      blacklisted: false,
      whitelisted: false,
      weightAdj: 0,
      scores: {
        availability: 0.7,
        latency: 0.65,
        rateLimit: 0.6,
        quality: 0.55,
        context: 0.4,
        freshness: 0.5,
        cost: 1,
        stability: 0.6,
        firstTokenLatency: 0.5,
      },
    },
    {
      modelId: 'm-blacklisted',
      upstreamId: 'sketchy/model:free',
      providerSlug: 'openrouter',
      isFree: true,
      contextLength: 4_000,
      capabilities: { stream: true, json: false, tools: false, vision: false, audio: false },
      status: 'active',
      blacklisted: true,
      whitelisted: false,
      weightAdj: 0,
      scores: {
        availability: 0.99,
        latency: 0.95,
        rateLimit: 0.95,
        quality: 0.9,
        context: 0.1,
        freshness: 0.9,
        cost: 1,
        stability: 0.99,
        firstTokenLatency: 0.95,
      },
    },
  ];
}

describe('AI 回归 - 路由决策（baseline 对照）', () => {
  const { routing } = loadBaselines();
  const router = new Router();
  const pool = makePool();

  for (const c of routing) {
    it(c.scenario, () => {
      const decision = router.decide(pool, {
        alias: c.inputAlias,
        policy: { name: 'default', mode: 'auto-best-free' },
        maxCandidates: 5,
      });

      if (c.expectedTopProviderSlug) {
        expect(decision.candidates[0]?.model.providerSlug).toBe(c.expectedTopProviderSlug);
      }
      if (c.expectedTopUpstreamId) {
        expect(decision.candidates[0]?.model.upstreamId).toBe(c.expectedTopUpstreamId);
      }
      if (c.expectedIsFree !== undefined) {
        expect(decision.candidates[0]?.model.isFree).toBe(c.expectedIsFree);
      }
      if (c.expectExcludeModelId) {
        for (const cand of decision.candidates) {
          expect(cand.model.modelId).not.toBe(c.expectExcludeModelId);
        }
      }
      if (c.expectedReasonIncludes) {
        const reasons = decision.filteredOut.map((f) => f.reason).join(' | ');
        expect(reasons.toLowerCase()).toContain(c.expectedReasonIncludes.toLowerCase());
      }
    });
  }
});
