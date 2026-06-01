/**
 * Zod-validated config schema for provider instances.
 *
 * The admin UI writes raw JSON into the `Provider` row; this schema validates
 * and normalises it before the runtime registers the provider with the registry.
 */
import { z } from 'zod';

export const providerKindSchema = z.enum([
  'openrouter',
  'openai',
  'anthropic',
  'deepseek',
  'google',
  'openai-compat',
  'mock',
]);

export const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(8).default(3),
  backoffMs: z.number().int().min(0).max(60_000).default(500),
  jitterMs: z.number().int().min(0).max(10_000).default(250),
});

export const providerConfigSchema = z.object({
  slug: z.string().regex(/^[a-z0-9_-]{2,40}$/),
  kind: providerKindSchema,
  name: z.string().min(1).max(80),
  baseUrl: z.string().url(),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(1000).default(100),
  rpmLimit: z.number().int().positive().nullable().optional(),
  dailyLimit: z.number().int().positive().nullable().optional(),
  timeoutMs: z.number().int().min(1000).max(600_000).default(60_000),
  retryPolicy: retryPolicySchema.default({ maxAttempts: 3, backoffMs: 500, jitterMs: 250 }),
  supportsStreaming: z.boolean().default(true),
  compatibleMode: z.enum(['openai', 'anthropic', 'google']).default('openai'),
  headerOverrides: z.record(z.string()).optional(),
  region: z.string().optional(),
  /** Identifier the SecretStore will use to resolve the upstream key. */
  apiKeyRef: z.string().min(1).optional(),
  /** Notes shown only in admin UI. */
  notes: z.string().max(500).optional(),
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;

/** Convenience helper — parses & throws with a clean message. */
export function parseProviderConfig(input: unknown): ProviderConfig {
  const result = providerConfigSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid provider config: ${issues}`);
  }
  return result.data;
}
