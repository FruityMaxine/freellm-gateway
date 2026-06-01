/**
 * Admin: routing policy + cooldown management.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { FreeLLMError } from '@freellm/shared';
import { getPrisma } from '../../lib/prisma.js';
import { PrismaCooldownStore } from '../../services/prisma-cooldown-store.js';
import { CooldownEngine } from '@freellm/routing-core';

const updatePolicyBody = z.object({
  name: z.string().optional(),
  mode: z
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
  weights: z
    .object({
      availability: z.number().min(0).max(1).optional(),
      latency: z.number().min(0).max(1).optional(),
      rateLimit: z.number().min(0).max(1).optional(),
      quality: z.number().min(0).max(1).optional(),
      context: z.number().min(0).max(1).optional(),
      freshness: z.number().min(0).max(1).optional(),
      cost: z.number().min(0).max(1).optional(),
      stability: z.number().min(0).max(1).optional(),
    })
    .partial()
    .optional(),
  params: z.record(z.unknown()).optional(),
  isDefault: z.boolean().optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  // GET /admin/routing-policies
  app.get('/admin/routing-policies', async () => {
    const prisma = getPrisma();
    return prisma.routingPolicy.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
  });

  // PATCH /admin/routing-policy/:name — edit weights / mode / params
  app.patch('/admin/routing-policy/:name', async (req) => {
    const params = z.object({ name: z.string().min(1) }).parse(req.params);
    const body = updatePolicyBody.parse(req.body ?? {});
    const prisma = getPrisma();
    const existing = await prisma.routingPolicy.findUnique({ where: { name: params.name } });
    if (!existing) throw new FreeLLMError('not_found', `策略 ${params.name} 不存在`);

    const mergedWeights = body.weights
      ? { ...safeParse(existing.weightsJson, {}), ...body.weights }
      : safeParse(existing.weightsJson, {});

    const updated = await prisma.routingPolicy.update({
      where: { name: params.name },
      data: {
        ...(body.mode ? { mode: body.mode } : {}),
        weightsJson: JSON.stringify(mergedWeights),
        ...(body.params ? { paramsJson: JSON.stringify(body.params) } : {}),
        ...(body.isDefault ? { isDefault: body.isDefault } : {}),
      },
    });
    return { ok: true, policy: updated };
  });

  // GET /admin/cooldowns
  app.get('/admin/cooldowns', async (req) => {
    const q = z.object({ scope: z.enum(['model', 'provider']).optional() }).parse(req.query ?? {});
    const prisma = getPrisma();
    const store = new PrismaCooldownStore(prisma);
    const records = await store.list(q.scope);
    return {
      data: await Promise.all(
        records.map(async (r) => {
          let label = r.key;
          if (r.scope === 'model') {
            const m = await prisma.model.findUnique({
              where: { id: r.key },
              select: { upstreamId: true, provider: { select: { slug: true } } },
            });
            if (m) label = `${m.provider.slug}/${m.upstreamId}`;
          } else if (r.scope === 'provider') {
            const p = await prisma.provider.findUnique({ where: { id: r.key } });
            if (p) label = p.slug;
          }
          return {
            id: r.id,
            scope: r.scope,
            key: r.key,
            label,
            reason: r.reason,
            attempts: r.attempts,
            backoffMs: r.backoffMs,
            expiresAt: r.expiresAt,
            halfOpen: r.halfOpen,
            createdAt: r.createdAt,
            remainingMs: Math.max(0, r.expiresAt.getTime() - Date.now()),
          };
        }),
      ),
      total: records.length,
    };
  });

  // POST /admin/cooldowns/:id/reset — manual recovery
  app.post('/admin/cooldowns/:id/reset', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const prisma = getPrisma();
    const engine = new CooldownEngine(new PrismaCooldownStore(prisma));
    const records = await engine.listActive();
    const target = records.find((r) => r.id === params.id);
    if (!target) throw new FreeLLMError('not_found', `冷却记录 ${params.id} 不存在`);
    await new PrismaCooldownStore(prisma).reset(target.id);
    return { ok: true, id: target.id };
  });
};

export default plugin;

function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
