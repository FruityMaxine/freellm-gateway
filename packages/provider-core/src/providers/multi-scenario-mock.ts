/**
 * Programmable mock provider used by tests and admin Test-Chat demos.
 *
 * Configure the upcoming behaviour by mutating the public fields. Subsequent
 * calls to `complete()` / `stream()` will honour the configured scenario.
 *
 * Supported scenarios:
 *   - 'success'          → 200 with an echoed assistant reply
 *   - 'rate_limited'     → 429 with the requested retry-after hint
 *   - 'provider_outage'  → 503
 *   - 'timeout'          → simulated timeout (no response)
 *   - 'streaming'        → success but as SSE chunks (default for stream())
 *   - 'partial_failure'  → starts streaming, then errors mid-stream
 *   - 'content_filter'   → 451 with content_policy body
 *   - 'context_overflow' → 413
 *   - 'balance_low'      → 402
 */
import { BaseProvider } from '../base.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatStreamChunk,
  ProviderCallOutcome,
} from '../types.js';

export type MultiMockScenario =
  | 'success'
  | 'rate_limited'
  | 'provider_outage'
  | 'timeout'
  | 'streaming'
  | 'partial_failure'
  | 'content_filter'
  | 'context_overflow'
  | 'balance_low';

export class MultiScenarioMockProvider extends BaseProvider {
  scenario: MultiMockScenario = 'success';
  /** Forced first-token latency in ms (only applies to stream/success cases). */
  firstTokenLatencyMs = 5;
  /** Forced total duration in ms (only applies to success cases). */
  durationMs = 30;
  /** When >0, this many calls run their currently-set scenario then revert to 'success'. */
  scenarioTtl = 0;

  private consumeScenarioTick(): MultiMockScenario {
    const s = this.scenario;
    if (this.scenarioTtl > 0) {
      this.scenarioTtl -= 1;
      if (this.scenarioTtl === 0) this.scenario = 'success';
    }
    return s;
  }

  async checkHealth() {
    return { ok: true, status: 'active' as const, latencyMs: 1, message: 'multi-scenario mock' };
  }
  async fetchBalance() {
    return { asOf: new Date().toISOString(), balanceRaw: { scenario: this.scenario } };
  }
  async listModels() {
    return [
      {
        upstreamId: 'multi-mock/echo:free',
        displayName: 'Multi-Scenario Mock Echo',
        contextLength: 16_000,
        pricing: { prompt: '0', completion: '0', request: '0' },
        capabilities: { stream: true, json: true, tools: false, vision: false, audio: false },
        topProvider: 'multi-mock',
        raw: { kind: 'multi-mock' },
      },
    ];
  }

  async complete(req: ChatCompletionRequest): Promise<{ response: ChatCompletionResponse; outcome: ProviderCallOutcome }> {
    const scenario = this.consumeScenarioTick();
    const start = Date.now();
    const errOutcome = (status: number, kind: string, message: string): ProviderCallOutcome => ({
      ok: false,
      durationMs: Date.now() - start,
      status,
      errorKind: kind,
      errorMessage: message,
      upstreamModel: req.model,
    });
    const errResp = (): ChatCompletionResponse => ({
      id: 'err',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: req.model,
      choices: [],
    });
    switch (scenario) {
      case 'rate_limited':
        return { response: errResp(), outcome: errOutcome(429, 'rate_limited', 'rate_limited mock') };
      case 'provider_outage':
        return { response: errResp(), outcome: errOutcome(503, 'provider_unavailable', '503 mock') };
      case 'timeout': {
        await new Promise((r) => setTimeout(r, Math.min(100, this.durationMs)));
        return { response: errResp(), outcome: errOutcome(408, 'timeout', 'timeout mock') };
      }
      case 'content_filter':
        return {
          response: errResp(),
          outcome: errOutcome(451, 'content_filter', 'content_policy violation mock'),
        };
      case 'context_overflow':
        return { response: errResp(), outcome: errOutcome(413, 'context_overflow', 'maximum tokens exceeded mock') };
      case 'balance_low':
        return { response: errResp(), outcome: errOutcome(402, 'balance_insufficient', 'insufficient_balance mock') };
      case 'success':
      case 'streaming':
      case 'partial_failure':
      default: {
        const last = req.messages[req.messages.length - 1];
        const content =
          typeof last?.content === 'string'
            ? last.content
            : Array.isArray(last?.content)
              ? last!.content.map((c) => c.text ?? '').join('')
              : '';
        const reply = `[multi-mock:${req.model}] ${content.slice(0, 600)}`;
        const created = Math.floor(Date.now() / 1000);
        if (this.durationMs > 0) await new Promise((r) => setTimeout(r, this.durationMs));
        return {
          response: {
            id: `chatcmpl-multimock-${created}`,
            object: 'chat.completion',
            created,
            model: req.model,
            choices: [
              { index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' },
            ],
            usage: {
              prompt_tokens: Math.max(1, Math.round(content.length / 4)),
              completion_tokens: Math.max(1, Math.round(reply.length / 4)),
              total_tokens: Math.max(2, Math.round((content.length + reply.length) / 4)),
            },
          },
          outcome: {
            ok: true,
            durationMs: Date.now() - start,
            firstTokenMs: this.firstTokenLatencyMs,
            status: 200,
            upstreamModel: req.model,
          },
        };
      }
    }
  }

  async stream(req: ChatCompletionRequest): Promise<{
    iter: AsyncIterable<ChatStreamChunk>;
    outcome: () => ProviderCallOutcome;
  }> {
    const scenario = this.consumeScenarioTick();
    const start = Date.now();
    const self = this;

    if (
      scenario === 'rate_limited' ||
      scenario === 'provider_outage' ||
      scenario === 'timeout' ||
      scenario === 'content_filter' ||
      scenario === 'context_overflow' ||
      scenario === 'balance_low'
    ) {
      const { outcome } = await this.complete({ ...req, stream: false });
      return {
        iter: emptyAsync<ChatStreamChunk>(),
        outcome: () => outcome,
      };
    }

    const last = req.messages[req.messages.length - 1];
    const content =
      typeof last?.content === 'string'
        ? last.content
        : Array.isArray(last?.content)
          ? last!.content.map((c) => c.text ?? '').join('')
          : '';
    const reply = `[multi-mock-stream:${req.model}] ${content.slice(0, 600)}`;
    const tokens = reply.match(/.{1,8}/g) ?? [reply];
    const created = Math.floor(Date.now() / 1000);
    const id = `chatcmpl-multimock-${created}`;
    let firstTokenMs: number | undefined;
    let failed = false;

    const iter: AsyncIterable<ChatStreamChunk> = {
      async *[Symbol.asyncIterator]() {
        let i = 0;
        for (const token of tokens) {
          await new Promise((r) => setTimeout(r, self.firstTokenLatencyMs));
          if (firstTokenMs === undefined) firstTokenMs = Date.now() - start;
          yield {
            id,
            object: 'chat.completion.chunk',
            created,
            model: req.model,
            choices: [
              {
                index: 0,
                delta: { role: i === 0 ? 'assistant' : undefined, content: token },
                finish_reason: null,
              },
            ],
          };
          i += 1;
          if (scenario === 'partial_failure' && i === Math.max(1, Math.floor(tokens.length / 2))) {
            failed = true;
            return;
          }
        }
        yield {
          id,
          object: 'chat.completion.chunk',
          created,
          model: req.model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: Math.max(1, Math.round(content.length / 4)),
            completion_tokens: Math.max(1, Math.round(reply.length / 4)),
            total_tokens: Math.max(2, Math.round((content.length + reply.length) / 4)),
          },
        };
      },
    };

    return {
      iter,
      outcome: () => ({
        ok: !failed,
        durationMs: Date.now() - start,
        ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
        status: failed ? 502 : 200,
        ...(failed ? { errorKind: 'invalid_response', errorMessage: 'partial_failure mock' } : {}),
        upstreamModel: req.model,
      }),
    };
  }
}

async function* emptyAsync<T>(): AsyncIterable<T> {
  // yields nothing
}
