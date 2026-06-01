/**
 * In-process provider registry.
 *
 * The api server boots once, queries the DB for all `Provider` rows, hands
 * each to a factory keyed by `kind`, and installs the resulting instances
 * here. Routing, discovery, and health-check loops read providers exclusively
 * from this registry, never from the DB directly.
 */
import type { BaseProvider } from './base.js';
import { MockProvider } from './base.js';
import type { ProviderConfig } from './config-schema.js';
import type { ProviderCredential } from './types.js';

export type ProviderFactory = (config: ProviderConfig, credential: ProviderCredential) => BaseProvider;

const builtinFactories: Record<string, ProviderFactory> = {
  mock: (config, credential) => new MockProvider(config, credential),
};

export class ProviderRegistry {
  private providers = new Map<string, BaseProvider>();
  private factories: Record<string, ProviderFactory> = { ...builtinFactories };

  /** Register a factory for a `kind`. Concrete adapters (openrouter, openai,
   * anthropic, …) call this at module load time. */
  registerFactory(kind: string, factory: ProviderFactory): void {
    this.factories[kind] = factory;
  }

  /** Reset every registered provider. Useful for tests / hot-reload. */
  clear(): void {
    this.providers.clear();
  }

  has(slug: string): boolean {
    return this.providers.has(slug);
  }

  get(slug: string): BaseProvider | undefined {
    return this.providers.get(slug);
  }

  list(): BaseProvider[] {
    return Array.from(this.providers.values());
  }

  /** Idempotent install — if the slug exists already, replace it. */
  install(config: ProviderConfig, credential: ProviderCredential): BaseProvider {
    const factory = this.factories[config.kind];
    if (!factory) {
      throw new Error(`No factory registered for provider kind '${config.kind}'`);
    }
    const provider = factory(config, credential);
    this.providers.set(config.slug, provider);
    return provider;
  }

  remove(slug: string): boolean {
    return this.providers.delete(slug);
  }
}

/** Process-wide default registry. Tests should construct their own to stay isolated. */
export const globalRegistry: ProviderRegistry = new ProviderRegistry();
