/**
 * Tick 17 v1.1.0.0：Embeddings 提供者方法测试。
 * 覆盖 MockProvider 的确定性 embedding 与 BaseProvider 默认 unsupported_capability。
 */
import { describe, it, expect } from 'vitest';
import { MockProvider, BaseProvider } from '../src/base.js';
import type { EmbeddingResponse, ProviderCredential } from '../src/types.js';

const cred: ProviderCredential = { apiKey: null, baseUrl: 'http://mock.invalid' };
const cfg = {
  slug: 'mock',
  kind: 'mock' as const,
  name: 'Mock',
  baseUrl: 'http://mock.invalid',
  enabled: true,
  priority: 100,
  timeoutMs: 5000,
  rpmLimit: 0,
  dailyLimit: 0,
  supportsStreaming: true,
  compatibleMode: true,
};

describe('embed() (Tick 17)', () => {
  it('Mock provider：单条字符串输入返回 1 个向量', async () => {
    const mock = new MockProvider(cfg, cred);
    const r = await mock.embed({ model: 'mock/embed', input: '你好 FreeLLM' });
    expect(r.outcome.ok).toBe(true);
    expect(r.response.data).toHaveLength(1);
    expect(r.response.data[0]!.index).toBe(0);
    expect(Array.isArray(r.response.data[0]!.embedding)).toBe(true);
    expect((r.response.data[0]!.embedding as number[]).length).toBe(32);
  });

  it('Mock provider：数组输入逐条返回向量', async () => {
    const mock = new MockProvider(cfg, cred);
    const r = await mock.embed({ model: 'mock/embed', input: ['a', 'bb', 'ccc'] });
    expect(r.outcome.ok).toBe(true);
    expect(r.response.data).toHaveLength(3);
    expect(r.response.data.map((d) => d.index)).toEqual([0, 1, 2]);
  });

  it('Mock provider：同一文本产生确定性向量（可重现）', async () => {
    const mock = new MockProvider(cfg, cred);
    const r1 = await mock.embed({ model: 'mock/embed', input: '确定性测试' });
    const r2 = await mock.embed({ model: 'mock/embed', input: '确定性测试' });
    expect((r1.response.data[0]!.embedding as number[])).toEqual(
      r2.response.data[0]!.embedding,
    );
  });

  it('Mock provider：dimensions 参数控制向量长度', async () => {
    const mock = new MockProvider(cfg, cred);
    const r = await mock.embed({ model: 'mock/embed', input: 'x', dimensions: 128 });
    expect((r.response.data[0]!.embedding as number[]).length).toBe(128);
  });

  it('Mock provider：usage.prompt_tokens 反映输入长度', async () => {
    const mock = new MockProvider(cfg, cred);
    const r = await mock.embed({ model: 'mock/embed', input: 'x'.repeat(40) });
    expect(r.response.usage.prompt_tokens).toBeGreaterThanOrEqual(10);
  });

  it('BaseProvider 默认实现：未支持 embeddings 返回 unsupported_capability', async () => {
    class Stub extends BaseProvider {
      async checkHealth() {
        return { ok: true, status: 'active' as const };
      }
      async fetchBalance() {
        return null;
      }
      async listModels() {
        return [];
      }
      async complete() {
        return {
          response: {
            id: 'x',
            object: 'chat.completion',
            created: 0,
            model: 'x',
            choices: [],
          } satisfies import('../src/types.js').ChatCompletionResponse,
          outcome: { ok: true, durationMs: 0, status: 200 },
        };
      }
      async stream() {
        return this.streamFromComplete({ model: 'x', messages: [] });
      }
    }
    const stub = new Stub({ ...cfg, slug: 'stub' }, cred);
    const r = await stub.embed({ model: 'stub/x', input: 'y' });
    expect(r.outcome.ok).toBe(false);
    expect(r.outcome.errorKind).toBe('unsupported_capability');
    expect(r.response.data).toHaveLength(0);
  });
});

describe('EmbeddingResponse shape (Tick 17)', () => {
  it('符合 OpenAI 响应形态 (object: list / model / usage)', async () => {
    const mock = new MockProvider(cfg, cred);
    const r = await mock.embed({ model: 'mock/x', input: 'hello' });
    const res: EmbeddingResponse = r.response;
    expect(res.object).toBe('list');
    expect(res.model).toBe('mock/x');
    expect(res.usage).toMatchObject({ prompt_tokens: expect.any(Number), total_tokens: expect.any(Number) });
  });
});
