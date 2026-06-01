/**
 * 评分器 bench：单条 scoreModel 调用在 9 个维度上的吞吐能力。
 * 模型池每次路由决策都会全量重评分 —— 这里直接决定 hot path 的 CPU 上限。
 */
import { bench, describe } from 'vitest';
import { scoreModel, type ModelScoreInput } from '../../../packages/routing-core/src/scorer.js';

const sample: ModelScoreInput = {
  modelId: 'm-1',
  upstreamId: 'meta/llama-3.3-70b-instruct:free',
  providerSlug: 'openrouter',
  availability: 0.92,
  latency: 0.78,
  rateLimit: 0.61,
  quality: 0.84,
  context: 0.7,
  freshness: 0.55,
  cost: 1,
  stability: 0.81,
  firstTokenLatency: 0.65,
  weightAdj: 0.1,
  blacklisted: false,
  whitelisted: false,
  capabilities: { stream: true, json: true, tools: false, vision: false, audio: false },
  contextLength: 128_000,
  isFree: true,
};

describe('scorer', () => {
  bench('scoreModel - 单次评分', () => {
    scoreModel(sample);
  });

  bench('scoreModel - 自定义权重', () => {
    scoreModel(sample, {
      weights: {
        availability: 0.4,
        latency: 0.25,
        rateLimit: 0.1,
        quality: 0.15,
        context: 0.05,
        freshness: 0.03,
        cost: 0,
        stability: 0.02,
        firstTokenLatency: 0,
      },
    });
  });

  bench('scoreModel x100 - 全池评分', () => {
    for (let i = 0; i < 100; i++) scoreModel(sample);
  });
});
