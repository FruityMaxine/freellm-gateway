/**
 * Abstract `Provider` contract.
 *
 * Every upstream integration extends `BaseProvider`. The class deliberately
 * holds no Prisma references — `apps/api` injects credentials via
 * `ProviderCredential` so the package is host-agnostic and trivially
 * unit-testable.
 */
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatStreamChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  ProviderBalance,
  ProviderCallOutcome,
  ProviderCredential,
  ProviderHealthReport,
  ProviderListModelsResult,
} from './types.js';
import type { ProviderConfig } from './config-schema.js';

export interface CompletionResult {
  response: ChatCompletionResponse;
  outcome: ProviderCallOutcome;
}

export interface StreamResult {
  iter: AsyncIterable<ChatStreamChunk>;
  outcome: () => ProviderCallOutcome;
}

export interface EmbeddingResult {
  response: EmbeddingResponse;
  outcome: ProviderCallOutcome;
}

export abstract class BaseProvider {
  readonly config: ProviderConfig;
  readonly credential: ProviderCredential;

  constructor(config: ProviderConfig, credential: ProviderCredential) {
    this.config = config;
    this.credential = credential;
  }

  get slug(): string {
    return this.config.slug;
  }

  get kind(): string {
    return this.config.kind;
  }

  /** Smoke-test the upstream is reachable and credentials are valid. */
  abstract checkHealth(): Promise<ProviderHealthReport>;

  /** Optional — only providers that publish balance info return non-null. */
  abstract fetchBalance(): Promise<ProviderBalance | null>;

  /** List models the upstream currently offers. */
  abstract listModels(): Promise<ProviderListModelsResult[]>;

  /** Non-streaming chat completion. */
  abstract complete(req: ChatCompletionRequest): Promise<CompletionResult>;

  /** Streaming chat completion. */
  abstract stream(req: ChatCompletionRequest): Promise<StreamResult>;

  /**
   * Embeddings 接口（Tick 17 v1.1.0.0 引入）。
   * 默认实现：返回 `unsupported_capability` 形态的 outcome，让上层路由换下一候选。
   * 真实支持 embeddings 的 provider 应 override 此方法。
   */
  async embed(req: EmbeddingRequest): Promise<EmbeddingResult> {
    return {
      response: {
        object: 'list',
        data: [],
        model: req.model,
        usage: { prompt_tokens: 0, total_tokens: 0 },
      },
      outcome: {
        ok: false,
        durationMs: 0,
        status: null,
        errorKind: 'unsupported_capability',
        errorMessage: `provider ${this.slug} 暂不支持 embeddings`,
        upstreamModel: req.model,
      },
    };
  }

  /** Convenience: providers that don't natively support streaming may return
   * the non-streaming result as a single chunk. The default implementation
   * here does exactly that, which is the right behaviour for the mock and
   * any future text-only adapters. Real adapters override `stream`. */
  protected async streamFromComplete(req: ChatCompletionRequest): Promise<StreamResult> {
    const { response, outcome } = await this.complete({ ...req, stream: false });
    let firstYielded = false;
    const iter: AsyncIterable<ChatStreamChunk> = {
      async *[Symbol.asyncIterator]() {
        for (const choice of response.choices) {
          firstYielded = true;
          yield {
            id: response.id,
            object: 'chat.completion.chunk',
            created: response.created,
            model: response.model,
            choices: [
              {
                index: choice.index,
                delta: { role: 'assistant', content: choice.message.content },
                finish_reason: null,
              },
            ],
          };
          yield {
            id: response.id,
            object: 'chat.completion.chunk',
            created: response.created,
            model: response.model,
            choices: [
              {
                index: choice.index,
                delta: {},
                finish_reason: choice.finish_reason,
              },
            ],
            ...(response.usage ? { usage: response.usage } : {}),
          };
        }
      },
    };
    return {
      iter,
      outcome: () => ({ ...outcome, firstTokenMs: firstYielded ? 0 : outcome.firstTokenMs }),
    };
  }
}

/** Minimal `Mock` provider used by tests and `MOCK` mode demos. */
export class MockProvider extends BaseProvider {
  async checkHealth(): Promise<ProviderHealthReport> {
    return { ok: true, status: 'active', latencyMs: 1, message: 'mock provider always healthy' };
  }
  async fetchBalance(): Promise<ProviderBalance | null> {
    return { asOf: new Date().toISOString(), balanceRaw: null };
  }
  async listModels(): Promise<ProviderListModelsResult[]> {
    return [
      {
        upstreamId: 'mock/echo:free',
        displayName: 'Mock Echo (free)',
        contextLength: 32_000,
        pricing: { prompt: '0', completion: '0', request: '0' },
        capabilities: { stream: true, json: true, tools: false, vision: false, audio: false },
        paramsSupported: ['temperature', 'max_tokens', 'top_p'],
        topProvider: 'mock',
        description: 'Synthetic model that echoes the last user turn. Always free.',
        raw: { upstream: 'mock' },
      },
      {
        upstreamId: 'mock/fast:free',
        displayName: 'Mock Fast (free)',
        contextLength: 8_000,
        pricing: { prompt: '0', completion: '0', request: '0' },
        capabilities: { stream: true, json: false, tools: false, vision: false, audio: false },
        topProvider: 'mock',
        description: 'Low-latency synthetic model used to exercise fallback latency scoring.',
        raw: { upstream: 'mock' },
      },
    ];
  }
  async complete(req: ChatCompletionRequest): Promise<CompletionResult> {
    const start = Date.now();
    const last = req.messages[req.messages.length - 1];
    const content =
      typeof last?.content === 'string'
        ? last.content
        : Array.isArray(last?.content)
          ? last!.content.map((c) => c.text ?? '').join('')
          : '';
    const reply = `[mock:${req.model}] ${content.slice(0, 800)}`;
    const created = Math.floor(Date.now() / 1000);
    return {
      response: {
        id: `chatcmpl-mock-${created}`,
        object: 'chat.completion',
        created,
        model: req.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: reply },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: Math.max(1, content.length / 4),
          completion_tokens: Math.max(1, reply.length / 4),
          total_tokens: Math.max(2, (content.length + reply.length) / 4),
        },
        providerMeta: { provider: 'mock' },
      },
      outcome: {
        ok: true,
        durationMs: Date.now() - start,
        firstTokenMs: 0,
        status: 200,
        upstreamModel: req.model,
      },
    };
  }
  async stream(req: ChatCompletionRequest): Promise<StreamResult> {
    return this.streamFromComplete(req);
  }

  /**
   * Mock embeddings：基于 sha256(input) 派生确定性 32 维向量，
   * 同一文本永远返回同一向量，便于测试与本地开发。
   */
  override async embed(req: EmbeddingRequest): Promise<EmbeddingResult> {
    const start = Date.now();
    const inputs = Array.isArray(req.input) ? req.input : [req.input];
    const dims = req.dimensions ?? 32;
    const data: EmbeddingResponse['data'] = inputs.map((text, index) => ({
      object: 'embedding' as const,
      index,
      embedding: deterministicEmbedding(String(text), dims),
    }));
    const promptTokens = inputs.reduce((acc, t) => acc + Math.max(1, Math.ceil(String(t).length / 4)), 0);
    return {
      response: {
        object: 'list',
        data,
        model: req.model,
        usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
      },
      outcome: {
        ok: true,
        durationMs: Date.now() - start,
        status: 200,
        upstreamModel: req.model,
      },
    };
  }
}

/**
 * 基于 sha256(text) 的确定性 [-1, 1] 浮点向量生成。
 * 同 text 永远输出同向量；语义化质量不保证（mock 仅供测试）。
 */
function deterministicEmbedding(text: string, dims: number): number[] {
  // 用 djb2 hash 多轮派生 32 位整数序列，再归一到 [-1, 1]。
  const out = new Array<number>(dims);
  let h1 = 5381 ^ text.length;
  let h2 = 52711 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) >>> 0;
    h2 = ((h2 << 5) - h2 + c) >>> 0;
  }
  for (let i = 0; i < dims; i++) {
    const v = ((h1 + i * 2654435761) ^ (h2 * (i + 1))) >>> 0;
    out[i] = (v / 0xffffffff) * 2 - 1;
  }
  return out;
}
