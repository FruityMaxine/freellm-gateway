/**
 * OpenRouter adapter.
 *
 * OpenRouter speaks OpenAI Chat shape with a richer `/api/v1/models` payload
 * (pricing, architecture, top_provider, supported_parameters). We override
 * `mapModel` to extract that detail, and add a `fetchBalance` implementation
 * that hits `/api/v1/key`.
 */
import { OpenAICompatProvider } from '../openai-compat.js';
import type {
  ProviderBalance,
  ProviderListModelsResult,
} from '../types.js';
import type { ProviderConfig } from '../config-schema.js';
import type { ProviderCredential } from '../types.js';
import type { ProviderFactory } from '../registry.js';

export class OpenRouterProvider extends OpenAICompatProvider {
  constructor(config: ProviderConfig, credential: ProviderCredential) {
    super(config, credential);
    this.hooks = {
      modelsPath: '/models',
      mapModel: (entry) => this.mapOpenRouterModel(entry),
      extraHeaders: () => ({
        // OpenRouter looks for these to attribute traffic; harmless to send.
        'HTTP-Referer': 'https://freellm.local/',
        'X-Title': 'FreeLLM',
      }),
    };
  }

  mapOpenRouterModel(entry: unknown): ProviderListModelsResult | null {
    if (typeof entry !== 'object' || entry === null) return null;
    const e = entry as Record<string, unknown>;
    const upstreamId = typeof e.id === 'string' ? e.id : null;
    if (!upstreamId) return null;

    const arch = (e.architecture ?? {}) as Record<string, unknown>;
    const modality = typeof arch.modality === 'string' ? arch.modality : '';
    const pricing = (e.pricing ?? undefined) as
      | { prompt?: string; completion?: string; request?: string; image?: string }
      | undefined;
    const topProviderObj = (e.top_provider ?? {}) as Record<string, unknown>;
    const params = Array.isArray(e.supported_parameters)
      ? (e.supported_parameters.filter((p) => typeof p === 'string') as string[])
      : undefined;

    const supportsTools = params?.includes('tools') ?? false;
    const supportsJson = params?.includes('response_format') ?? false;
    const supportsVision = modality.includes('image');
    const supportsAudio = modality.includes('audio');

    return {
      upstreamId,
      displayName: typeof e.name === 'string' ? e.name : upstreamId,
      contextLength:
        typeof e.context_length === 'number'
          ? e.context_length
          : typeof topProviderObj.context_length === 'number'
            ? topProviderObj.context_length
            : 0,
      ...(pricing !== undefined ? { pricing } : {}),
      capabilities: {
        stream: true,
        json: supportsJson,
        tools: supportsTools,
        vision: supportsVision,
        audio: supportsAudio,
        reasoning: /reason|o1|o3/i.test(upstreamId),
        longContext:
          (typeof e.context_length === 'number' && e.context_length >= 100_000) ||
          (typeof topProviderObj.context_length === 'number' && topProviderObj.context_length >= 100_000),
      },
      ...(params !== undefined ? { paramsSupported: params } : {}),
      ...(typeof topProviderObj.context_length === 'number'
        ? {
            topProvider:
              typeof topProviderObj.is_moderated === 'boolean'
                ? `openrouter:moderated=${topProviderObj.is_moderated}`
                : 'openrouter',
          }
        : { topProvider: 'openrouter' }),
      ...(typeof e.description === 'string' ? { description: e.description } : {}),
      raw: entry,
    };
  }

  override async fetchBalance(): Promise<ProviderBalance | null> {
    if (!this.credential.apiKey) {
      return { asOf: new Date().toISOString(), balanceRaw: { skipped: 'no api key' } };
    }
    const url = `${this.effectiveBaseUrl}/key`;
    try {
      const res = await fetch(url, { method: 'GET', headers: this.buildHeaders() });
      if (!res.ok) {
        return {
          asOf: new Date().toISOString(),
          balanceRaw: { error: `key endpoint returned ${res.status}` },
        };
      }
      const json = (await res.json()) as { data?: Record<string, unknown> };
      const data = json.data ?? {};
      return {
        asOf: new Date().toISOString(),
        balanceRaw: data,
        ...(typeof data.usage === 'number' ? { usage: data.usage } : {}),
        ...(typeof data.limit_remaining === 'number' ? { limitRemaining: data.limit_remaining } : {}),
      };
    } catch (err) {
      return {
        asOf: new Date().toISOString(),
        balanceRaw: { error: (err as Error).message },
      };
    }
  }
}

export const openrouterFactory: ProviderFactory = (config, credential) => {
  return new OpenRouterProvider(config, credential);
};
