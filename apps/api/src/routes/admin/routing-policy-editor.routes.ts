/**
 * 路由策略可视化编辑器端点（组 6 Tick 5 v1.19.0.0）。
 *   GET  /admin/routing-policy-editor —— 当前默认策略 + 默认权重 + top3 样本模型 9 维（实时预览用）
 *   PUT  /admin/routing-policy/:name  —— upsert 策略（routing_policies 表可能为空，故用 upsert 而非 PATCH）
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import { requireAdmin } from '../../plugins/admin-auth.js';

// 与 scorer.ts RoutingPolicyWeights 对齐的 8 维权重键（无 capability）。
const WEIGHT_KEYS = [
  'availability',
  'latency',
  'rateLimit',
  'quality',
  'context',
  'freshness',
  'cost',
  'stability',
] as const;

const DEFAULT_WEIGHTS: Record<string, number> = {
  availability: 0.3,
  latency: 0.15,
  rateLimit: 0.2,
  quality: 0.15,
  context: 0.1,
  freshness: 0.05,
  cost: 0,
  stability: 0.05,
};

const MODES = [
  'auto-best-free',
  'round-robin-free',
  'weighted-free',
  'openrouter-free-router',
  'prefer-model-fallback',
  'provider-specific',
  'paid-allowed',
] as const;

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/routing-policy-editor', async (req) => {
    requireAdmin(req);
    const prisma = getPrisma();
    const policy =
      (await prisma.routingPolicy.findFirst({ where: { isDefault: true } })) ??
      (await prisma.routingPolicy.findFirst());
    const sampleRows = await prisma.modelScore.findMany({
      orderBy: { composite: 'desc' },
      take: 3,
      include: { model: { select: { upstreamId: true } } },
    });
    const sampleModels = sampleRows.map((s) => ({
      upstreamId: s.model.upstreamId,
      scores: {
        availability: s.availabilityScore,
        latency: s.latencyScore,
        rateLimit: s.rateLimitScore,
        quality: s.qualityScore,
        context: s.contextScore,
        freshness: s.freshnessScore,
        cost: s.costScore,
        stability: s.stabilityScore,
      },
    }));
    return {
      policy: policy
        ? { name: policy.name, mode: policy.mode, weights: JSON.parse(policy.weightsJson || '{}') }
        : null,
      defaultWeights: DEFAULT_WEIGHTS,
      weightKeys: WEIGHT_KEYS,
      modes: MODES,
      sampleModels,
    };
  });

  app.put('/admin/routing-policy/:name', async (req) => {
    requireAdmin(req);
    const params = z.object({ name: z.string().min(1).max(60) }).parse(req.params);
    const body = z
      .object({
        mode: z.enum(MODES).optional(),
        weights: z.record(z.number()).optional(),
        isDefault: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    const prisma = getPrisma();
    const policy = await prisma.routingPolicy.upsert({
      where: { name: params.name },
      create: {
        name: params.name,
        mode: body.mode ?? 'weighted-free',
        weightsJson: JSON.stringify(body.weights ?? DEFAULT_WEIGHTS),
        isDefault: body.isDefault ?? true,
      },
      update: {
        ...(body.mode ? { mode: body.mode } : {}),
        ...(body.weights ? { weightsJson: JSON.stringify(body.weights) } : {}),
        ...(body.isDefault != null ? { isDefault: body.isDefault } : {}),
      },
    });
    return {
      ok: true,
      policy: { name: policy.name, mode: policy.mode, weights: JSON.parse(policy.weightsJson) },
    };
  });
};

export default plugin;
