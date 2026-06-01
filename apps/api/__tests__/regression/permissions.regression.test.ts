/**
 * AI 权限回归测试。
 *
 * 用 baselines.json 的 permissions 用例确保虚拟密钥权限矩阵在路由层正确生效：
 * deniedModels / allowedProviders / allowPaidModels 三类规则不能因策略改动失效。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Router, type PoolModel } from '@freellm/routing-core';
import type { VirtualKeyPermissions } from '@freellm/shared';

interface PermCase {
  scenario: string;
  deniedModels?: string[];
  allowedProviders?: string[];
  allowPaidModels?: boolean;
  expectExcludeUpstreamId?: string;
  expectAllProviderSlug?: string;
  expectExcludeIsFree?: boolean;
}

function loadBaselines(): { permissions: PermCase[] } {
  const p = resolve(__dirname, 'baselines.json');
  return JSON.parse(readFileSync(p, 'utf8')) as { permissions: PermCase[] };
}

function makePool(): PoolModel[] {
  return [
    {
      modelId: 'free-1',
      upstreamId: 'meta/llama-3.3-70b-instruct:free',
      providerSlug: 'openrouter',
      isFree: true,
      contextLength: 128_000,
      capabilities: { stream: true, json: true, tools: false, vision: false, audio: false },
      status: 'active',
      blacklisted: false,
      whitelisted: false,
      weightAdj: 0,
      scores: defaultScores(),
    },
    {
      modelId: 'paid-1',
      upstreamId: 'openai/gpt-4o',
      providerSlug: 'openai',
      isFree: false,
      contextLength: 128_000,
      capabilities: { stream: true, json: true, tools: true, vision: true, audio: false },
      status: 'active',
      blacklisted: false,
      whitelisted: false,
      weightAdj: 0,
      scores: defaultScores(),
    },
    {
      modelId: 'paid-2',
      upstreamId: 'openai/gpt-4o-mini',
      providerSlug: 'openai',
      isFree: false,
      contextLength: 128_000,
      capabilities: { stream: true, json: true, tools: true, vision: true, audio: false },
      status: 'active',
      blacklisted: false,
      whitelisted: false,
      weightAdj: 0,
      scores: defaultScores(),
    },
  ];
}

function defaultScores(): PoolModel['scores'] {
  return {
    availability: 0.9,
    latency: 0.7,
    rateLimit: 0.8,
    quality: 0.75,
    context: 0.6,
    freshness: 0.55,
    cost: 1,
    stability: 0.75,
    firstTokenLatency: 0.6,
  };
}

describe('AI 回归 - 权限矩阵（baseline 对照）', () => {
  const { permissions } = loadBaselines();
  const router = new Router();
  const pool = makePool();

  for (const c of permissions) {
    it(c.scenario, () => {
      const perm: VirtualKeyPermissions = {
        allowedModels: [],
        deniedModels: c.deniedModels ?? [],
        allowedProviders: c.allowedProviders ?? [],
        maxRequestsPerMinute: null,
        maxRequestsPerDay: null,
        maxTokensPerDay: null,
        allowPaidModels: c.allowPaidModels ?? true,
        allowStreaming: true,
      };

      const mode = c.allowPaidModels === false ? 'auto-best-free' : 'paid-allowed';
      const decision = router.decide(pool, {
        alias: c.allowPaidModels === false ? 'free/auto' : undefined,
        permissions: perm,
        policy: { name: 'default', mode },
        maxCandidates: 10,
      });

      if (c.expectExcludeUpstreamId) {
        for (const cand of decision.candidates) {
          expect(cand.model.upstreamId).not.toBe(c.expectExcludeUpstreamId);
        }
      }
      if (c.expectAllProviderSlug) {
        for (const cand of decision.candidates) {
          expect(cand.model.providerSlug).toBe(c.expectAllProviderSlug);
        }
      }
      if (c.expectExcludeIsFree === false) {
        for (const cand of decision.candidates) {
          expect(cand.model.isFree).toBe(true);
        }
      }
    });
  }
});
