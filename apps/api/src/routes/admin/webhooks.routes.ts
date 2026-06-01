/**
 * Admin: webhook 工具端点（Tick 25 v1.6.0.0 引入）。
 *
 * `POST /admin/webhooks/sign-test` —— 给定 secret + payload，返回签名头与
 * 验签结果，供管理员在前端验证下游集成是否正确。
 *
 * `POST /admin/webhooks/verify` —— 同上但只做验签，方便接 Stripe / GitHub 风格的
 * 客户端做集成自检。
 *
 * 真正的事件出站投递（注册 webhook + EventBus 触发推送）留 v1.7.x。
 * 本 tick 仅落「签名能力 + 自检端点」，让下游开发者可以提前对接。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { FreeLLMError } from '@freellm/shared';
import { signWebhook, verifyWebhook } from '../../lib/webhook-signer.js';
import { WebhookSubscriptionService } from '../../services/webhook-subscription.service.js';
import { WebhookDispatcherService } from '../../services/webhook-dispatcher.service.js';
import { globalEventBus } from '../../services/event-bus.js';
import { getPrisma } from '../../lib/prisma.js';

const signBody = z.object({
  secret: z.string().min(8).max(256),
  payload: z.string().min(1).max(64 * 1024),
  /** 可选时间戳（毫秒），不传则用当前。便于测试可复现性。 */
  now: z.number().int().optional(),
});

const verifyBody = z.object({
  secret: z.string().min(8).max(256),
  payload: z.string().min(1).max(64 * 1024),
  signatureHeader: z.string().min(8).max(512),
  toleranceSeconds: z.number().int().min(1).max(3600).optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.post('/admin/webhooks/sign-test', async (req) => {
    const body = signBody.parse(req.body);
    const result = signWebhook(body.secret, body.payload, body.now ?? Date.now());
    return {
      ok: true,
      signatureHeader: result.signatureHeader,
      deliveryId: result.deliveryId,
      timestamp: result.timestamp,
      // 帮文档生成方便：给个 curl 示例骨架
      curlSnippet: [
        `curl -X POST https://your-downstream.example.com/webhook \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -H 'X-FreeLLM-Signature: ${result.signatureHeader}' \\`,
        `  -H 'X-FreeLLM-Delivery: ${result.deliveryId}' \\`,
        `  -H 'X-FreeLLM-Event: <event-topic>' \\`,
        `  -d '<json payload>'`,
      ].join('\n'),
    };
  });

  app.post('/admin/webhooks/verify', async (req) => {
    const body = verifyBody.parse(req.body);
    const result = verifyWebhook(body.secret, body.payload, body.signatureHeader, {
      toleranceSeconds: body.toleranceSeconds,
    });
    return {
      valid: result.valid,
      reason: result.reason ?? null,
    };
  });

  // ───── Tick 26 v1.6.1.0：订阅 CRUD ─────
  const createSubBody = z.object({
    url: z.string().url().max(500),
    secret: z.string().min(8).max(256),
    eventTopics: z.array(z.string().min(1).max(64)).max(32).optional(),
    enabled: z.boolean().optional(),
    description: z.string().max(500).nullish(),
  });

  const patchSubBody = z.object({
    url: z.string().url().max(500).optional(),
    secret: z.string().min(8).max(256).optional(),
    eventTopics: z.array(z.string().min(1).max(64)).max(32).optional(),
    enabled: z.boolean().optional(),
    description: z.string().max(500).nullish().optional(),
  });

  app.get('/admin/webhooks', async () => {
    const svc = new WebhookSubscriptionService(getPrisma());
    const rows = await svc.list();
    return {
      data: rows.map((r) => ({
        id: r.id,
        url: r.url,
        // secret 仅显示前后片段，不全文返回
        secretPreview: `${r.secret.slice(0, 4)}…${r.secret.slice(-4)}`,
        eventTopics: safeJsonArray(r.eventTopicsJson),
        enabled: r.enabled,
        description: r.description,
        createdAt: r.createdAt,
        lastSuccessAt: r.lastSuccessAt,
        lastErrorAt: r.lastErrorAt,
        lastErrorMessage: r.lastErrorMessage,
        totalDeliveries: r.totalDeliveries,
        totalFailures: r.totalFailures,
      })),
    };
  });

  app.post('/admin/webhooks', async (req) => {
    const body = createSubBody.parse(req.body);
    const svc = new WebhookSubscriptionService(getPrisma());
    const sub = await svc.create({
      url: body.url,
      secret: body.secret,
      ...(body.eventTopics ? { eventTopics: body.eventTopics } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      ...(req.adminSession ? { createdBy: req.adminSession.userId } : {}),
    });
    return { ok: true, subscription: { id: sub.id, url: sub.url } };
  });

  app.patch('/admin/webhooks/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = patchSubBody.parse(req.body ?? {});
    const svc = new WebhookSubscriptionService(getPrisma());
    const sub = await svc.update(params.id, {
      ...(body.url !== undefined ? { url: body.url } : {}),
      ...(body.secret !== undefined ? { secret: body.secret } : {}),
      ...(body.eventTopics !== undefined ? { eventTopics: body.eventTopics } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
    });
    return { ok: true, subscription: { id: sub.id, enabled: sub.enabled } };
  });

  app.delete('/admin/webhooks/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const svc = new WebhookSubscriptionService(getPrisma());
    const sub = await svc.findById(params.id);
    if (!sub) throw new FreeLLMError('not_found', `Webhook 订阅 ${params.id} 不存在`);
    await svc.delete(params.id);
    return { ok: true };
  });

  // 组 5 Tick 4 v1.14.0.0：投递历史明细 + 失败重试。
  app.get('/admin/webhooks/:id/deliveries', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).optional() })
      .parse(req.query);
    const rows = await getPrisma().webhookDelivery.findMany({
      where: { subscriptionId: params.id },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 30,
      select: {
        id: true,
        topic: true,
        ok: true,
        httpStatus: true,
        attempts: true,
        durationMs: true,
        errorMessage: true,
        createdAt: true,
      },
    });
    return { data: rows, total: rows.length };
  });

  app.post('/admin/webhooks/deliveries/:id/retry', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const dispatcher = new WebhookDispatcherService(getPrisma(), globalEventBus);
    const result = await dispatcher.retryDelivery(params.id);
    return { ok: true, result };
  });
};

function safeJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export default plugin;
