/**
 * Reusable HTTP scaffolding for providers that speak the OpenAI Chat API
 * (OpenRouter, OpenAI itself, DeepSeek, custom OpenAI-compat). Concrete
 * adapters subclass this and override only what differs (e.g. extra headers,
 * model-listing endpoint shape).
 */
import { BaseProvider, type EmbeddingResult } from './base.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatStreamChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  ProviderBalance,
  ProviderCallOutcome,
  ProviderHealthReport,
  ProviderListModelsResult,
} from './types.js';
import { classifyProviderError } from './errors.js';

const ENCODER = new TextDecoder('utf-8');

export interface OpenAICompatHooks {
  /** Modify the outgoing JSON body before stringify. */
  shapeRequestBody?: (body: Record<string, unknown>) => Record<string, unknown>;
  /** Map upstream JSON to our `ChatCompletionResponse` (default = identity). */
  shapeResponse?: (json: unknown) => ChatCompletionResponse;
  /** Endpoint path for the model list (default `/models`). */
  modelsPath?: string;
  /** Map a single entry from the models endpoint to our shape. */
  mapModel?: (entry: unknown) => ProviderListModelsResult | null;
  /** Extra headers, evaluated lazily so credentials may be refreshed. */
  extraHeaders?: () => Record<string, string>;
  /** Optional `Authorization` formatter (default `Bearer <key>`). */
  authHeader?: (apiKey: string | null) => Record<string, string>;
}

export abstract class OpenAICompatProvider extends BaseProvider {
  protected hooks: OpenAICompatHooks;

  constructor(...args: ConstructorParameters<typeof BaseProvider>) {
    super(...args);
    this.hooks = {};
  }

  protected get effectiveBaseUrl(): string {
    return this.credential.baseUrl.replace(/\/+$/, '');
  }

  protected buildHeaders(): Record<string, string> {
    const auth = this.hooks.authHeader
      ? this.hooks.authHeader(this.credential.apiKey)
      : this.credential.apiKey
        ? { Authorization: `Bearer ${this.credential.apiKey}` }
        : {};
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...auth,
      ...(this.credential.headerOverrides ?? {}),
      ...(this.hooks.extraHeaders ? this.hooks.extraHeaders() : {}),
    };
  }

  async checkHealth(): Promise<ProviderHealthReport> {
    const start = Date.now();
    try {
      const list = await this.listModels();
      return {
        ok: true,
        status: 'active',
        latencyMs: Date.now() - start,
        message: `discovered ${list.length} models`,
      };
    } catch (err) {
      return {
        ok: false,
        status: 'degraded',
        latencyMs: Date.now() - start,
        message: (err as Error).message,
      };
    }
  }

  async fetchBalance(): Promise<ProviderBalance | null> {
    // OpenAI-compat does not expose a portable balance endpoint; OpenRouter
    // override implements its own. Returning null is the safe default.
    return null;
  }

  async listModels(): Promise<ProviderListModelsResult[]> {
    const path = this.hooks.modelsPath ?? '/models';
    const url = `${this.effectiveBaseUrl}${path}`;
    const res = await fetch(url, { method: 'GET', headers: this.buildHeaders() });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw Object.assign(new Error(`listModels ${res.status}: ${body.slice(0, 200)}`), {
        status: res.status,
      });
    }
    const json = (await res.json()) as { data?: unknown[] };
    const entries = Array.isArray(json.data) ? json.data : [];
    const mapped: ProviderListModelsResult[] = [];
    const mapFn = this.hooks.mapModel ?? this.defaultMapModel.bind(this);
    for (const entry of entries) {
      const m = mapFn(entry);
      if (m) mapped.push(m);
    }
    return mapped;
  }

  /** Sane default for plain OpenAI-shaped `/models` responses. */
  protected defaultMapModel(entry: unknown): ProviderListModelsResult | null {
    if (typeof entry !== 'object' || entry === null) return null;
    const e = entry as Record<string, unknown>;
    const upstreamId = typeof e.id === 'string' ? e.id : null;
    if (!upstreamId) return null;
    return {
      upstreamId,
      displayName: typeof e.name === 'string' ? e.name : upstreamId,
      contextLength:
        typeof e.context_length === 'number'
          ? e.context_length
          : typeof e.context_window === 'number'
            ? e.context_window
            : 0,
      capabilities: {
        stream: true,
        json: true,
        tools: false,
        vision: false,
        audio: false,
      },
      raw: entry,
    };
  }

  async complete(req: ChatCompletionRequest): Promise<{ response: ChatCompletionResponse; outcome: ProviderCallOutcome }> {
    const start = Date.now();
    const url = `${this.effectiveBaseUrl}/chat/completions`;
    const body = this.serialiseBody({ ...req, stream: false });
    const ctrl = req.signal ? undefined : new AbortController();
    const timeoutMs = req.timeoutMs ?? this.config.timeoutMs;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: req.signal ?? ctrl?.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const kind = classifyProviderError({ status: res.status, message: text });
        return {
          response: {
            id: 'err',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: req.model,
            choices: [],
          },
          outcome: {
            ok: false,
            durationMs: Date.now() - start,
            status: res.status,
            errorKind: kind,
            errorMessage: text.slice(0, 500),
            upstreamModel: req.model,
          },
        };
      }
      const json = (await res.json()) as unknown;
      const response = this.hooks.shapeResponse
        ? this.hooks.shapeResponse(json)
        : (json as ChatCompletionResponse);
      return {
        response,
        outcome: {
          ok: true,
          durationMs: Date.now() - start,
          status: res.status,
          upstreamModel: response.model ?? req.model,
        },
      };
    } catch (err) {
      const kind = classifyProviderError({
        status: null,
        message: (err as Error).message,
        causeName: (err as Error).name,
      });
      return {
        response: {
          id: 'err',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: req.model,
          choices: [],
        },
        outcome: {
          ok: false,
          durationMs: Date.now() - start,
          status: null,
          errorKind: kind,
          errorMessage: (err as Error).message,
          upstreamModel: req.model,
        },
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async stream(req: ChatCompletionRequest): Promise<{
    iter: AsyncIterable<ChatStreamChunk>;
    outcome: () => ProviderCallOutcome;
  }> {
    const start = Date.now();
    const url = `${this.effectiveBaseUrl}/chat/completions`;
    const body = this.serialiseBody({ ...req, stream: true });
    const ctrl = req.signal ? undefined : new AbortController();
    const timeoutMs = req.timeoutMs ?? this.config.timeoutMs;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let firstTokenMs: number | undefined;
    let status: number | null = null;
    let errorKind: string | undefined;
    let errorMessage: string | undefined;
    const self = this;

    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.buildHeaders(), Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: req.signal ?? ctrl?.signal,
    });
    status = res.status;
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      errorKind = classifyProviderError({ status: res.status, message: text });
      errorMessage = text.slice(0, 500);
      if (timer) clearTimeout(timer);
      return {
        iter: emptyAsync<ChatStreamChunk>(),
        outcome: () => ({
          ok: false,
          durationMs: Date.now() - start,
          status,
          errorKind,
          errorMessage,
          upstreamModel: req.model,
        }),
      };
    }

    const iter = (async function* () {
      try {
        const reader = res.body!.getReader();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (firstTokenMs === undefined) firstTokenMs = Date.now() - start;
          buf += ENCODER.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line || !line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') return;
            try {
              const chunk = JSON.parse(payload) as ChatStreamChunk;
              yield chunk;
            } catch (parseErr) {
              // Audit P0-8: corrupt chunk → terminate the stream so downstream
              // never sees a torn / partially-decoded sequence.
              errorKind = 'invalid_response';
              errorMessage = `bad stream chunk: ${(parseErr as Error).message}`;
              return;
            }
          }
        }
      } catch (err) {
        errorKind = classifyProviderError({
          status: null,
          message: (err as Error).message,
          causeName: (err as Error).name,
        });
        errorMessage = (err as Error).message;
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();

    return {
      iter,
      outcome: () => ({
        ok: !errorKind,
        durationMs: Date.now() - start,
        ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
        status,
        ...(errorKind ? { errorKind } : {}),
        ...(errorMessage ? { errorMessage } : {}),
        upstreamModel: req.model,
      }),
    };
    // The unused `self` reference above intentionally documents that the
    // generator captures the provider instance through closure, not via `this`.
    void self;
  }

  /**
   * Tick 17 v1.1.0.0：OpenAI 兼容 embeddings 实现。
   * 路径 `/embeddings`，请求体含 model / input / encoding_format / dimensions / user。
   * 响应直接透传上游 JSON（OpenAI 形态本身就是网关期望的输出）。
   */
  override async embed(req: EmbeddingRequest): Promise<EmbeddingResult> {
    const start = Date.now();
    const url = `${this.effectiveBaseUrl}/embeddings`;
    const ctrl = req.signal ? undefined : new AbortController();
    const timeoutMs = req.timeoutMs ?? this.config.timeoutMs;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    const body: Record<string, unknown> = {
      model: req.model,
      input: req.input,
    };
    if (req.encoding_format !== undefined) body.encoding_format = req.encoding_format;
    if (req.dimensions !== undefined) body.dimensions = req.dimensions;
    if (req.user !== undefined) body.user = req.user;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: req.signal ?? ctrl?.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const kind = classifyProviderError({ status: res.status, message: text });
        return {
          response: {
            object: 'list',
            data: [],
            model: req.model,
            usage: { prompt_tokens: 0, total_tokens: 0 },
          },
          outcome: {
            ok: false,
            durationMs: Date.now() - start,
            status: res.status,
            errorKind: kind,
            errorMessage: text.slice(0, 500),
            upstreamModel: req.model,
          },
        };
      }
      const json = (await res.json()) as EmbeddingResponse;
      return {
        response: json,
        outcome: {
          ok: true,
          durationMs: Date.now() - start,
          status: res.status,
          upstreamModel: json.model ?? req.model,
        },
      };
    } catch (err) {
      const kind = classifyProviderError({
        status: null,
        message: (err as Error).message,
        causeName: (err as Error).name,
      });
      return {
        response: {
          object: 'list',
          data: [],
          model: req.model,
          usage: { prompt_tokens: 0, total_tokens: 0 },
        },
        outcome: {
          ok: false,
          durationMs: Date.now() - start,
          status: null,
          errorKind: kind,
          errorMessage: (err as Error).message,
          upstreamModel: req.model,
        },
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  protected serialiseBody(req: ChatCompletionRequest): Record<string, unknown> {
    const raw: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: req.stream ?? false,
    };
    if (req.temperature !== undefined) raw.temperature = req.temperature;
    if (req.max_tokens !== undefined) raw.max_tokens = req.max_tokens;
    if (req.top_p !== undefined) raw.top_p = req.top_p;
    if (req.presence_penalty !== undefined) raw.presence_penalty = req.presence_penalty;
    if (req.frequency_penalty !== undefined) raw.frequency_penalty = req.frequency_penalty;
    if (req.stop !== undefined) raw.stop = req.stop;
    if (req.response_format !== undefined) raw.response_format = req.response_format;
    if (req.tools !== undefined) raw.tools = req.tools;
    if (req.tool_choice !== undefined) raw.tool_choice = req.tool_choice;
    return this.hooks.shapeRequestBody ? this.hooks.shapeRequestBody(raw) : raw;
  }
}

async function* emptyAsync<T>(): AsyncIterable<T> {
  // yields nothing
}
