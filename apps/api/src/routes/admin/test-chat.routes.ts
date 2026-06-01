/**
 * Admin Routing Lab endpoint.
 *
 * Runs an OpenAI-shaped request through the executor without touching a
 * virtual key — used by the Routing Lab page to demonstrate routing /
 * scoring / fallback in real time.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import { getConfig } from '../../config.js';
import { resolveModel } from '../../lib/model-alias.js';
import { getCachedPool } from '../../lib/pool-cache.js';
import { RouteExecutorService } from '../../services/route-executor.service.js';
import { RetryPolicyService } from '../../services/retry-policy.service.js';
import { PrismaCooldownStore } from '../../services/prisma-cooldown-store.js';
import { ScoreUpdaterService } from '../../services/score-updater.service.js';

const body = z.object({
  model: z.string().default('free/auto'),
  prompt: z.string().min(1).max(8000),
  stream: z.boolean().default(false),
  routingMode: z
    .enum([
      'auto-best-free',
      'round-robin-free',
      'weighted-free',
      'openrouter-free-router',
      'prefer-model-fallback',
      'provider-specific',
      'paid-allowed',
    ])
    .optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.post('/admin/test-chat', async (req) => {
    const input = body.parse(req.body);
    const prisma = getPrisma();
    const cfg = getConfig();
    const resolved = resolveModel(input.model);
    const pool = await getCachedPool(prisma);
    const policyRow = await prisma.routingPolicy.findFirst({ where: { isDefault: true } });
    const policyMode = input.routingMode ?? (policyRow?.mode ?? 'auto-best-free') as
      | 'auto-best-free'
      | 'round-robin-free'
      | 'weighted-free'
      | 'openrouter-free-router'
      | 'prefer-model-fallback'
      | 'provider-specific'
      | 'paid-allowed';
    // Tick 48 v1.7.20.0：加载运行时 RetryPolicy（管理员后台 test-chat 同样应用）。
    const retryPolicy = await new RetryPolicyService(prisma).getPolicy();
    const executor = new RouteExecutorService({
      prisma,
      registry: app.registry,
      cooldownStore: new PrismaCooldownStore(prisma),
      scoreUpdater: new ScoreUpdaterService(prisma),
      maxAttempts: cfg.env.FREELLM_MAX_ROUTE_ATTEMPTS,
      retryPolicy,
    });
    const result = await executor.execute({
      request: {
        model: resolved.explicitUpstreamId ?? input.model,
        messages: [{ role: 'user', content: input.prompt }],
      },
      ctx: {
        ...(resolved.alias ? { alias: resolved.alias } : {}),
        ...(resolved.explicitUpstreamId ? { explicitModel: resolved.explicitUpstreamId } : {}),
        permissions: {
          allowPaidModels: policyMode === 'paid-allowed',
          allowStreaming: input.stream,
        },
        policy: { name: 'admin-test', mode: policyMode, weights: undefined },
        maxCandidates: cfg.env.FREELLM_MAX_ROUTE_ATTEMPTS,
      },
      pool,
      streaming: false,
    });
    if (!result.ok) {
      return {
        ok: false,
        requestId: result.requestId,
        error: result.error.toJSON(),
        attempts: result.attempts,
      };
    }
    const r = result as Extract<typeof result, { response: unknown }>;
    return {
      ok: true,
      requestId: result.requestId,
      attempts: result.attempts,
      upstreamProvider: (result as { upstreamProvider: string }).upstreamProvider,
      upstreamModel: (result as { upstreamModel: string }).upstreamModel,
      response: r.response,
    };
  });
};

export default plugin;
