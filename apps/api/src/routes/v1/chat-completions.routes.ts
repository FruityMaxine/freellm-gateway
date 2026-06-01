/**
 * POST /v1/chat/completions — OpenAI-compatible.
 *
 * Resolves the virtual-key permissions (set by the virtual-key-auth plugin),
 * routes the request through the executor, streams or returns the response,
 * and writes telemetry. Streaming honours the "first-token-wins" rule — once
 * a chunk has reached the downstream we never silently switch upstream.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { FreeLLMError, type VirtualKeyPermissions } from '@freellm/shared';
import { getPrisma } from '../../lib/prisma.js';
import { getConfig } from '../../config.js';
import { resolveModel } from '../../lib/model-alias.js';
import { getCachedPool } from '../../lib/pool-cache.js';
import { RouteExecutorService } from '../../services/route-executor.service.js';
import { RetryPolicyService } from '../../services/retry-policy.service.js';
import { PrismaCooldownStore } from '../../services/prisma-cooldown-store.js';
import { ScoreUpdaterService } from '../../services/score-updater.service.js';
import { RequestLoggerService } from '../../services/request-logger.service.js';
import { VirtualKeyService } from '../../services/virtual-key.service.js';
import { recordTokenUsage } from '../../plugins/virtual-key-auth.js';

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([
    z.string(),
    z.array(
      z.object({
        type: z.enum(['text', 'image_url', 'input_audio', 'tool_result']),
        text: z.string().optional(),
        image_url: z
        .object({ url: z.string(), detail: z.enum(['auto', 'low', 'high']).optional() })
        .optional(),
      }),
    ),
  ]),
  name: z.string().optional(),
});

const requestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  stream: z.boolean().optional().default(false),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  top_p: z.number().optional(),
  presence_penalty: z.number().optional(),
  frequency_penalty: z.number().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  response_format: z.unknown().optional(),
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.unknown().optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.post('/v1/chat/completions', async (req, reply) => {
    const cfg = getConfig();
    const vk = req.virtualKey;
    if (!vk) throw new FreeLLMError('unauthorized', '需要虚拟密钥');

    const body = requestSchema.parse(req.body);
    const wantsStream = body.stream === true;
    if (wantsStream && vk.permissions.allowStreaming === false) {
      throw new FreeLLMError('forbidden', '该虚拟密钥已关闭流式传输');
    }

    const resolved = resolveModel(body.model);
    const prisma = getPrisma();

    // 池 + 策略：池走 5 秒 TTL 缓存，热路径无需每次重建。
    const pool = await getCachedPool(prisma);
    const policyRow = await prisma.routingPolicy.findFirst({
      where: { isDefault: true, enabled: true },
    });
    const weights = parseJSON<Record<string, number>>(policyRow?.weightsJson, {});
    const params = parseJSON<Record<string, unknown>>(policyRow?.paramsJson ?? null, {});
    const policyMode = (policyRow?.mode ?? 'auto-best-free') as
      | 'auto-best-free'
      | 'round-robin-free'
      | 'weighted-free'
      | 'openrouter-free-router'
      | 'prefer-model-fallback'
      | 'provider-specific'
      | 'paid-allowed';

    const requireCapabilities = {
      ...(wantsStream ? { stream: true } : {}),
      ...(body.tools?.length ? { tools: true } : {}),
      ...(resolved.hints.requireLargeContext ? { minContextLength: 100_000 } : {}),
    };

    // Tick 48 v1.7.20.0：加载运行时 RetryPolicy；缺失时退回 env 默认。
    const retryPolicy = await new RetryPolicyService(prisma).getPolicy();
    const executor = new RouteExecutorService({
      prisma,
      registry: app.registry,
      cooldownStore: new PrismaCooldownStore(prisma),
      scoreUpdater: new ScoreUpdaterService(prisma),
      maxAttempts: cfg.env.FREELLM_MAX_ROUTE_ATTEMPTS,
      retryPolicy,
    });

    const logger = new RequestLoggerService(prisma, {
      keepDigest: cfg.env.FREELLM_LOG_PROMPT_DIGEST,
      keepFull: cfg.env.FREELLM_LOG_FULL_PROMPT,
    });

    // Start the log row before routing so admin/logs sees pending requests too.
    const provisionalRequestId = req.requestId;
    await logger.start({
      requestId: provisionalRequestId,
      virtualKeyId: vk.id,
      ...(resolved.alias ? { modelAlias: resolved.alias } : {}),
      routingMode: policyMode,
      streaming: wantsStream,
      messages: body.messages as never,
      clientIp: req.ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      ...(vk.organizationId ? { organizationId: vk.organizationId } : {}),
      ...(vk.projectId ? { projectId: vk.projectId } : {}),
    });

    const ctx = {
      alias: resolved.alias,
      ...(resolved.explicitUpstreamId ? { explicitModel: resolved.explicitUpstreamId } : {}),
      requireCapabilities,
      permissions: vk.permissions satisfies VirtualKeyPermissions,
      policy: {
        name: policyRow?.name ?? 'default-auto-best-free',
        mode: policyMode,
        weights,
        params,
      },
      maxCandidates: cfg.env.FREELLM_MAX_ROUTE_ATTEMPTS,
    };

    const upstreamReq = {
      model: resolved.explicitUpstreamId ?? body.model,
      messages: body.messages as never,
      ...(body.stream !== undefined ? { stream: body.stream } : {}),
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
      ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
      ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
      ...(body.presence_penalty !== undefined ? { presence_penalty: body.presence_penalty } : {}),
      ...(body.frequency_penalty !== undefined ? { frequency_penalty: body.frequency_penalty } : {}),
      ...(body.stop !== undefined ? { stop: body.stop } : {}),
      ...(body.response_format !== undefined
        ? { response_format: body.response_format as never }
        : {}),
      ...(body.tools !== undefined ? { tools: body.tools as never } : {}),
      ...(body.tool_choice !== undefined ? { tool_choice: body.tool_choice as never } : {}),
    };

    const tStart = Date.now();
    const result = await executor.execute({
      request: upstreamReq,
      ctx,
      pool,
      streaming: wantsStream,
      metadata: { virtualKeyId: vk.id, clientIp: req.ip ?? null },
      requestId: provisionalRequestId,
    });

    setResponseHeaders(reply, {
      requestId: result.requestId,
      upstreamProvider: result.ok ? (result as { upstreamProvider: string }).upstreamProvider : undefined,
      upstreamModel: result.ok ? (result as { upstreamModel: string }).upstreamModel : undefined,
      attempts: result.attempts.length,
      cacheHit: false,
    });

    if (!result.ok) {
      await logger.finish({
        requestId: result.requestId,
        status: result.error.httpStatus,
        errorKind: result.error.kind,
        attempts: result.attempts.length,
        durationMs: Date.now() - tStart,
      });
      throw result.error;
    }

    const upstreamProvider = (result as { upstreamProvider: string }).upstreamProvider;
    const upstreamModel = (result as { upstreamModel: string }).upstreamModel;

    if (wantsStream && 'stream' in result) {
      await streamResponse(reply, result.stream, {
        requestId: result.requestId,
        upstreamProvider,
        upstreamModel,
        attempts: result.attempts.length,
      });
      const totalTokens = approximateTokensFromStream(result.attempts);
      recordTokenUsage(vk.id, totalTokens);
      await new VirtualKeyService(prisma).touchUsage(vk.id, req.ip ?? null, BigInt(totalTokens));
      await logger.finish({
        requestId: result.requestId,
        status: 200,
        upstreamProvider,
        upstreamModel,
        attempts: result.attempts.length,
        totalTokens,
        durationMs: Date.now() - tStart,
      });
      return reply;
    }

    const response = (result as { response: import('@freellm/provider-core').ChatCompletionResponse })
      .response;
    // Upstreams sometimes report fractional token counts (mock provider uses len/4)
    // — coerce to integer before passing to BigInt() / int columns.
    const promptTokens = Math.round(response.usage?.prompt_tokens ?? 0);
    const completionTokens = Math.round(response.usage?.completion_tokens ?? 0);
    const totalTokens = Math.round(response.usage?.total_tokens ?? 0);
    recordTokenUsage(vk.id, totalTokens);
    await new VirtualKeyService(prisma).touchUsage(vk.id, req.ip ?? null, BigInt(totalTokens));
    await logger.finish({
      requestId: result.requestId,
      status: 200,
      upstreamProvider,
      upstreamModel,
      attempts: result.attempts.length,
      promptTokens,
      completionTokens,
      totalTokens,
      durationMs: Date.now() - tStart,
    });
    return reply.send(response);
  });
};

export default plugin;

function setResponseHeaders(
  reply: import('fastify').FastifyReply,
  info: {
    requestId: string;
    upstreamProvider?: string;
    upstreamModel?: string;
    attempts: number;
    cacheHit: boolean;
  },
): void {
  reply.header('x-freellm-request-id', info.requestId);
  if (info.upstreamProvider) reply.header('x-freellm-upstream-provider', info.upstreamProvider);
  if (info.upstreamModel) reply.header('x-freellm-upstream-model', info.upstreamModel);
  reply.header('x-freellm-route-attempts', String(info.attempts));
  reply.header('x-freellm-cache-hit', info.cacheHit ? 'true' : 'false');
}

async function streamResponse(
  reply: import('fastify').FastifyReply,
  iter: AsyncIterable<import('@freellm/provider-core').ChatStreamChunk>,
  meta: { requestId: string; upstreamProvider: string; upstreamModel: string; attempts: number },
): Promise<void> {
  reply.raw.statusCode = 200;
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.setHeader('x-freellm-request-id', meta.requestId);
  reply.raw.setHeader('x-freellm-upstream-provider', meta.upstreamProvider);
  reply.raw.setHeader('x-freellm-upstream-model', meta.upstreamModel);
  reply.raw.setHeader('x-freellm-route-attempts', String(meta.attempts));
  reply.raw.setHeader('x-freellm-cache-hit', 'false');
  reply.hijack();
  try {
    for await (const chunk of iter) {
      reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    reply.raw.write('data: [DONE]\n\n');
  } catch (err) {
    // Mid-stream failure — write a final SSE event so the client doesn't hang.
    reply.raw.write(
      `data: ${JSON.stringify({
        error: {
          message: (err as Error).message,
          type: 'api_error',
          code: 'stream_aborted',
        },
      })}\n\n`,
    );
  } finally {
    reply.raw.end();
  }
}

function approximateTokensFromStream(_attempts: unknown[]): number {
  // Streaming usage roll-up is upstream-specific; we count nothing here and
  // rely on per-attempt scoring. A future tick can attach a tokeniser.
  return 0;
}

function parseJSON<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
