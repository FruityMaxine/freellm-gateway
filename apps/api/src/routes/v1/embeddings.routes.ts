/**
 * POST /v1/embeddings —— OpenAI 兼容 embeddings 端点（Tick 17 v1.1.0.0 引入）。
 *
 * 形态：
 *   {
 *     "model": "<alias|upstreamId>",
 *     "input": "string" | ["s1","s2",...],
 *     "encoding_format"?: "float" | "base64",
 *     "dimensions"?: number,
 *     "user"?: string
 *   }
 *
 * 鉴权 + 限额：
 * - virtual-key-auth plugin 完成 Bearer 校验、RPM、日请求 / 日 Token 限额。
 * - 本路由额外校验 `maxEmbeddingsPerDay` 限额。
 *
 * 路由策略（v1.1 简化版）：
 * - 解析 model（alias / upstream id）
 * - 走当前池找到首个 `isFree` + `capabilities.json`（约定支持 embeddings 的标志位）
 *   且未被冷却的候选；若 model 指定 upstream id 直接锁定。
 * - 失败 fallback 下一个候选；全部失败抛 all_attempts_failed。
 *
 * 后续 Tick 可扩展独立的 EmbeddingsExecutor 复用 RouteExecutor 思路。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { FreeLLMError } from '@freellm/shared';
import type { EmbeddingResult } from '@freellm/provider-core';
import { getPrisma } from '../../lib/prisma.js';
import { resolveModel } from '../../lib/model-alias.js';
import { getCachedPool } from '../../lib/pool-cache.js';
import { enforceDailyEmbeddings, recordTokenUsage } from '../../plugins/virtual-key-auth.js';

const requestSchema = z.object({
  model: z.string().min(1),
  input: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(2048)]),
  encoding_format: z.enum(['float', 'base64']).optional(),
  dimensions: z.number().int().positive().max(8192).optional(),
  user: z.string().max(256).optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.post('/v1/embeddings', async (req, reply) => {
    const vk = req.virtualKey;
    if (!vk) throw new FreeLLMError('unauthorized', '需要虚拟密钥');

    const body = requestSchema.parse(req.body);

    // 日 embeddings 限额（独立于普通请求 / Token 限额）。
    if (!enforceDailyEmbeddings(vk.id, vk.permissions.maxEmbeddingsPerDay)) {
      throw new FreeLLMError('rate_limited', '虚拟密钥日 embeddings 额度已用尽', {
        context: { requestId: req.requestId },
      });
    }

    const resolved = resolveModel(body.model);
    const prisma = getPrisma();
    const pool = await getCachedPool(prisma);
    const perm = vk.permissions;

    // 候选筛选：尊重虚拟密钥黑白名单 + 状态过滤；优先指定 upstream，否则 isFree + json capability。
    const candidates = pool
      .filter((m) => m.status !== 'disabled' && m.status !== 'removed')
      .filter((m) => !m.blacklisted)
      .filter((m) => {
        if (perm.deniedModels?.includes(m.upstreamId)) return false;
        if (perm.allowedModels?.length && !perm.allowedModels.includes(m.upstreamId)) return false;
        if (perm.allowedProviders?.length && !perm.allowedProviders.includes(m.providerSlug)) return false;
        if (!perm.allowPaidModels && !m.isFree) return false;
        return true;
      })
      .filter((m) => {
        if (resolved.explicitUpstreamId) return m.upstreamId === resolved.explicitUpstreamId;
        // 约定：embeddings provider 需带 json 能力（OpenAI / OpenRouter / DeepSeek 的 embedding 模型都对齐）。
        return m.isFree && m.capabilities.json;
      })
      .slice(0, 4);

    if (candidates.length === 0) {
      // free 池无真实 embedding 模型（OpenRouter free 全是 chat 模型，无 embedding 端点）→
      // fallback 到本地确定性 mock embedding，让端点真实可用（OpenAI 兼容格式），并用响应头
      // 显式标注 mock 来源，绝不静默冒充真实 embedding（组 4 Tick 4 v1.10.0.0）。
      const mock = app.registry.get('mock');
      if (mock) {
        const out = await mock.embed({
          model: body.model,
          input: body.input,
          ...(body.dimensions ? { dimensions: body.dimensions } : {}),
        });
        if (out.outcome.ok) {
          recordTokenUsage(vk.id, out.response.usage?.prompt_tokens ?? 0);
          reply.header('x-freellm-upstream-provider', 'mock');
          reply.header('x-freellm-mock-embedding', 'true');
          reply.header('x-freellm-request-id', req.requestId);
          // 组 4 Tick 5 P2：body 也标注 mock（model 改可辨识值 + _freellm_mock 字段），
          // 让只读响应 body 的 OpenAI SDK 客户端也能察觉这是确定性 mock 向量而非真实 embedding，
          // 避免把假向量灌进向量库做语义检索而不自知。
          return { ...out.response, model: 'mock-embedding', _freellm_mock: true };
        }
      }
      throw new FreeLLMError('no_route_available', '没有候选 embedding 模型通过过滤条件（mock fallback 亦不可用）', {
        context: { requestId: req.requestId },
      });
    }

    let result: EmbeddingResult | null = null;
    let lastErr: { kind?: string; message?: string } | null = null;

    for (const cand of candidates) {
      const provider = app.registry.get(cand.providerSlug);
      if (!provider) continue;
      const out = await provider.embed({
        model: cand.upstreamId,
        input: body.input,
        ...(body.encoding_format ? { encoding_format: body.encoding_format } : {}),
        ...(body.dimensions ? { dimensions: body.dimensions } : {}),
        ...(body.user ? { user: body.user } : {}),
      });
      if (out.outcome.ok) {
        result = out;
        // 计入 Token 用量（embeddings 也按 prompt_tokens 计费）。
        recordTokenUsage(vk.id, out.response.usage?.prompt_tokens ?? 0);
        // 响应头标注真实上游
        reply.header('x-freellm-upstream-provider', cand.providerSlug);
        reply.header('x-freellm-upstream-model', cand.upstreamId);
        reply.header('x-freellm-request-id', req.requestId);
        break;
      }
      lastErr = { ...(out.outcome.errorKind ? { kind: out.outcome.errorKind } : {}), ...(out.outcome.errorMessage ? { message: out.outcome.errorMessage } : {}) };
    }

    if (!result) {
      throw new FreeLLMError('all_attempts_failed', `全部 ${candidates.length} 个候选 embedding 均失败`, {
        context: { requestId: req.requestId, attempts: candidates.length, upstreamErrorPayload: lastErr },
      });
    }

    return result.response;
  });
};

export default plugin;
