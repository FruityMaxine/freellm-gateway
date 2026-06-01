/**
 * Tick 17 v1.1.0.0：新增 3 个 capability-based alias 的覆盖测试。
 * - free/with-tools
 * - free/with-vision
 * - free/json-mode
 */
import { describe, it, expect } from 'vitest';
import { Router, type PoolModel } from '../src/router.js';

function mk(over: Partial<PoolModel> & { upstreamId: string; modelId: string }): PoolModel {
  return {
    modelId: over.modelId,
    upstreamId: over.upstreamId,
    providerSlug: over.providerSlug ?? 'openrouter',
    isFree: over.isFree ?? true,
    contextLength: over.contextLength ?? 32_000,
    capabilities:
      over.capabilities ?? { stream: true, json: false, tools: false, vision: false, audio: false },
    status: over.status ?? 'active',
    blacklisted: over.blacklisted ?? false,
    whitelisted: over.whitelisted ?? false,
    weightAdj: over.weightAdj ?? 0,
    scores: over.scores ?? {
      availability: 0.8,
      latency: 0.7,
      rateLimit: 0.8,
      quality: 0.6,
      context: 0.5,
      freshness: 0.5,
      cost: 1,
      stability: 0.6,
      firstTokenLatency: 0.7,
    },
  };
}

const POOL: PoolModel[] = [
  mk({ modelId: 'tools', upstreamId: 'tools:free', capabilities: { stream: true, json: true, tools: true, vision: false, audio: false } }),
  mk({ modelId: 'vision', upstreamId: 'vision:free', capabilities: { stream: true, json: true, tools: false, vision: true, audio: false } }),
  mk({ modelId: 'json', upstreamId: 'json:free', capabilities: { stream: true, json: true, tools: false, vision: false, audio: false } }),
  mk({ modelId: 'plain', upstreamId: 'plain:free', capabilities: { stream: true, json: false, tools: false, vision: false, audio: false } }),
];

describe('Tick 17 v1.1.0.0 — capability-based aliases', () => {
  const router = new Router();

  it('free/with-tools 只选 capabilities.tools=true 的候选', () => {
    const d = router.decide(POOL, {
      alias: 'free/with-tools',
      policy: { name: 'default', mode: 'auto-best-free' },
      maxCandidates: 4,
    });
    expect(d.candidates.length).toBeGreaterThan(0);
    for (const c of d.candidates) {
      expect(c.model.capabilities.tools).toBe(true);
    }
  });

  it('free/with-vision 只选 capabilities.vision=true 的候选', () => {
    const d = router.decide(POOL, {
      alias: 'free/with-vision',
      policy: { name: 'default', mode: 'auto-best-free' },
      maxCandidates: 4,
    });
    expect(d.candidates.length).toBeGreaterThan(0);
    for (const c of d.candidates) {
      expect(c.model.capabilities.vision).toBe(true);
    }
  });

  it('free/json-mode 只选 capabilities.json=true 的候选', () => {
    const d = router.decide(POOL, {
      alias: 'free/json-mode',
      policy: { name: 'default', mode: 'auto-best-free' },
      maxCandidates: 4,
    });
    expect(d.candidates.length).toBeGreaterThan(0);
    for (const c of d.candidates) {
      expect(c.model.capabilities.json).toBe(true);
    }
    // plain 模型（json=false）不应入候选
    expect(d.candidates.map((c) => c.model.modelId)).not.toContain('plain');
  });

  it('未知 alias 退化为不过滤（保留兼容性）', () => {
    const d = router.decide(POOL, {
      alias: 'free/nonexistent-alias',
      policy: { name: 'default', mode: 'auto-best-free' },
      maxCandidates: 4,
    });
    // 没匹配 alias handler 时全池进入下一层过滤
    expect(d.candidates.length).toBeGreaterThan(0);
  });
});
