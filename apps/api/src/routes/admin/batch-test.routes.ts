/**
 * 批量模型测试台端点（组 7 Tick 4 v1.22.0.0）。
 *
 * 区别于 test-chat（单 prompt 单模型单次）：本端点对 2-6 个模型**并发**发同一 prompt，
 * 各以 provider-specific 模式锁定该模型，返回每模型的响应/延迟/token，供前端并排对比。
 * 复用 test-chat 的 RouteExecutorService 调用样板（同构造参数 + execute 形状）。
 * 单模型失败各自 try/catch 捕获，不阻断其他模型（Promise.all + 容错返回）。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import { getConfig } from '../../config.js';
import { getCachedPool } from '../../lib/pool-cache.js';
import { RouteExecutorService } from '../../services/route-executor.service.js';
import { RetryPolicyService } from '../../services/retry-policy.service.js';
import { PrismaCooldownStore } from '../../services/prisma-cooldown-store.js';
import { ScoreUpdaterService } from '../../services/score-updater.service.js';
import { requireAdmin } from '../../plugins/admin-auth.js';

const body = z.object({
  modelIds: z.array(z.string().min(1)).min(2).max(6),
  prompt: z.string().min(1).max(8000),
});

interface BatchResult {
  modelId: string;
  upstreamId: string;
  providerSlug?: string;
  success: boolean;
  responseText?: string;
  error?: string;
  latencyMs: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.post('/admin/batch-test', async (req) => {
    requireAdmin(req);
    const input = body.parse(req.body);
    const prisma = getPrisma();
    const cfg = getConfig();
    const pool = await getCachedPool(prisma);
    const retryPolicy = await new RetryPolicyService(prisma).getPolicy();

    const models = await prisma.model.findMany({
      where: { id: { in: input.modelIds } },
      include: { provider: { select: { slug: true } } },
    });
    const modelMap = new Map(models.map((m) => [m.id, m]));

    const results: BatchResult[] = await Promise.all(
      input.modelIds.map(async (modelId): Promise<BatchResult> => {
        const m = modelMap.get(modelId);
        if (!m) {
          return { modelId, upstreamId: modelId, success: false, error: '模型不存在', latencyMs: 0 };
        }
        const started = Date.now();
        try {
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
              model: m.upstreamId,
              messages: [{ role: 'user', content: input.prompt }],
            },
            ctx: {
              explicitModel: m.upstreamId,
              permissions: { allowPaidModels: true, allowStreaming: false },
              policy: { name: 'batch-test', mode: 'provider-specific', weights: undefined },
              maxCandidates: cfg.env.FREELLM_MAX_ROUTE_ATTEMPTS,
            },
            pool,
            streaming: false,
          });
          const latencyMs = Date.now() - started;
          if (!result.ok) {
            const ej = (result.error.toJSON?.() ?? {}) as Record<string, unknown>;
            return {
              modelId,
              upstreamId: m.upstreamId,
              providerSlug: m.provider.slug,
              success: false,
              error: String(ej.message ?? ej.kind ?? '执行失败'),
              latencyMs,
            };
          }
          const r = result as { response?: unknown };
          const resp = r.response as
            | {
                choices?: Array<{ message?: { content?: unknown } }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number };
              }
            | undefined;
          const raw = resp?.choices?.[0]?.message?.content;
          const responseText = typeof raw === 'string' ? raw : raw == null ? '' : JSON.stringify(raw);
          return {
            modelId,
            upstreamId: m.upstreamId,
            providerSlug: m.provider.slug,
            success: true,
            responseText,
            latencyMs,
            promptTokens: resp?.usage?.prompt_tokens ?? null,
            completionTokens: resp?.usage?.completion_tokens ?? null,
          };
        } catch (e) {
          return {
            modelId,
            upstreamId: m.upstreamId,
            providerSlug: m.provider.slug,
            success: false,
            error: (e as Error).message,
            latencyMs: Date.now() - started,
          };
        }
      }),
    );

    return { results };
  });
};

export default plugin;
