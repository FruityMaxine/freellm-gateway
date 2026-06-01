/**
 * Offline OpenRouter — same surface as `OpenRouterProvider`, but answers
 * model listings from the fixture and chat calls from `MockProvider` echo
 * logic. Lets CI and `pnpm dev:api` run end-to-end without an OpenRouter key.
 */
import type {
  ChatCompletionRequest,
  ProviderBalance,
  ProviderHealthReport,
  ProviderListModelsResult,
} from '../types.js';
import { OpenRouterProvider } from './openrouter.js';
import { MockProvider } from '../base.js';
import {
  FIXTURE_OPENROUTER_KEY_RESPONSE,
  FIXTURE_OPENROUTER_MODELS,
} from './openrouter-fixtures.js';
import type { ProviderConfig } from '../config-schema.js';
import type { ProviderCredential } from '../types.js';
import type { ProviderFactory } from '../registry.js';

export class MockOpenRouterProvider extends OpenRouterProvider {
  /** Optional override — tests can mutate this to alter discovery. */
  fixtureModels: unknown[] = [...FIXTURE_OPENROUTER_MODELS.data];

  /** Hook tests use to simulate 429 / 5xx / network errors on listModels. */
  listModelsFault: 'none' | 'rate_limited' | 'unavailable' | 'timeout' = 'none';

  /** Hook tests use to alter the chat completion response. */
  private inner = new MockProvider(this.config, this.credential);

  override async listModels(): Promise<ProviderListModelsResult[]> {
    if (this.listModelsFault !== 'none') {
      const status =
        this.listModelsFault === 'rate_limited' ? 429 : this.listModelsFault === 'unavailable' ? 502 : 504;
      throw Object.assign(new Error(`mock fault: ${this.listModelsFault}`), { status });
    }
    const mapper =
      this.hooks.mapModel ?? ((e: unknown) => this.mapOpenRouterModel(e));
    const out: ProviderListModelsResult[] = [];
    for (const entry of this.fixtureModels) {
      const m = mapper(entry);
      if (m) out.push(m);
    }
    return out;
  }

  override async fetchBalance(): Promise<ProviderBalance | null> {
    return {
      asOf: new Date().toISOString(),
      balanceRaw: FIXTURE_OPENROUTER_KEY_RESPONSE.data,
      ...(typeof FIXTURE_OPENROUTER_KEY_RESPONSE.data.usage === 'number'
        ? { usage: FIXTURE_OPENROUTER_KEY_RESPONSE.data.usage }
        : {}),
    };
  }

  override async checkHealth(): Promise<ProviderHealthReport> {
    return {
      ok: this.listModelsFault === 'none',
      status: this.listModelsFault === 'none' ? 'active' : 'degraded',
      latencyMs: 1,
      message: `mock-openrouter ${this.listModelsFault === 'none' ? 'healthy' : `fault=${this.listModelsFault}`}`,
    };
  }

  override async complete(req: ChatCompletionRequest) {
    return this.inner.complete(req);
  }

  override async stream(req: ChatCompletionRequest) {
    return this.inner.stream(req);
  }
}

export const mockOpenRouterFactory: ProviderFactory = (
  config: ProviderConfig,
  credential: ProviderCredential,
) => new MockOpenRouterProvider(config, credential);
