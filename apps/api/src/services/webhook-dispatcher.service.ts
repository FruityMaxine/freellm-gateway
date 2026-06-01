/**
 * Webhook 出站投递 dispatcher（Tick 26 v1.6.1.0）。
 *
 * 监听 `globalEventBus.onAny()`，按 topic 找匹配订阅，逐个 fire-and-forget 发 POST。
 * 失败走 3 次指数退避重试（300ms → 1200ms → 4800ms），最终失败记入 error_events
 * 且更新订阅的 totalFailures + lastErrorMessage 字段。
 *
 * 设计要点：
 * - dispatch 完全 async fire-and-forget；不阻塞 emit 调用方
 * - 单次失败不影响其他订阅
 * - secret 仅用于签名，永不出现在 payload 中（与 webhook-signer.ts 一致）
 * - 投递头：
 *     X-FreeLLM-Signature: t=<unix>,v1=<hex>
 *     X-FreeLLM-Delivery:  <uuid>
 *     X-FreeLLM-Event:     <topic>
 *     Content-Type:        application/json
 */
import type { PrismaClient, WebhookSubscription } from '@prisma/client';
import { EventBus } from './event-bus.js';
import { WebhookSubscriptionService } from './webhook-subscription.service.js';
import { signWebhook } from '../lib/webhook-signer.js';

export interface WebhookDispatcherOptions {
  /** 总重试次数（首次不算重试），默认 3。 */
  maxAttempts?: number;
  /** 重试基础间隔毫秒，默认 300。指数倍增 300/1200/4800。 */
  baseBackoffMs?: number;
  /** 单次请求超时（毫秒），默认 10000。 */
  timeoutMs?: number;
  /** 单元测试钩子：覆盖 fetch 实现。 */
  fetchImpl?: typeof fetch;
}

export class WebhookDispatcherService {
  private detach: (() => void) | null = null;
  private readonly opts: Required<WebhookDispatcherOptions>;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly bus: EventBus,
    opts: WebhookDispatcherOptions = {},
  ) {
    this.opts = {
      maxAttempts: opts.maxAttempts ?? 3,
      baseBackoffMs: opts.baseBackoffMs ?? 300,
      timeoutMs: opts.timeoutMs ?? 10_000,
      fetchImpl: opts.fetchImpl ?? globalThis.fetch,
    };
  }

  /** 启动监听。返回 detach 函数；同一实例 attach 多次只生效一次。 */
  attach(): () => void {
    if (this.detach) return this.detach;
    const svc = new WebhookSubscriptionService(this.prisma);
    this.detach = this.bus.onAny(({ topic, payload }) => {
      // 异步触发，不 await：避免 emit 调用方因任一 webhook 慢而被拖
      void this.handleEvent(svc, topic, payload).catch((err) => {
        console.warn('[webhook-dispatcher] handleEvent 顶层异常：', (err as Error).message);
      });
    });
    return this.detach;
  }

  private async handleEvent(
    svc: WebhookSubscriptionService,
    topic: string,
    payload: unknown,
  ): Promise<void> {
    const subs = await svc.findMatching(topic);
    if (subs.length === 0) return;
    const body = JSON.stringify({ topic, payload, deliveredAt: new Date().toISOString() });

    // 并发投递所有订阅；单订阅失败不影响其他订阅。
    await Promise.allSettled(
      subs.map((sub) => this.deliverWithRetry(svc, sub, topic, body)),
    );
  }

  private async deliverWithRetry(
    svc: WebhookSubscriptionService,
    sub: WebhookSubscription,
    topic: string,
    body: string,
  ): Promise<void> {
    const start = Date.now();
    let lastError: Error | null = null;
    let lastStatus: number | null = null;
    let usedAttempts = 0;
    for (let attempt = 0; attempt < this.opts.maxAttempts; attempt++) {
      usedAttempts = attempt + 1;
      try {
        const { ok, status } = await this.deliverOnce(sub, topic, body);
        lastStatus = status;
        if (ok) {
          await svc.recordDelivery(sub.id, true);
          await this.recordDeliveryRow({
            subscriptionId: sub.id,
            topic,
            ok: true,
            httpStatus: status,
            attempts: usedAttempts,
            durationMs: Date.now() - start,
            errorMessage: null,
            requestBody: body,
          });
          return;
        }
      } catch (err) {
        lastError = err as Error;
      }
      // 指数退避：300ms / 1200ms / 4800ms
      if (attempt < this.opts.maxAttempts - 1) {
        const delay = this.opts.baseBackoffMs * Math.pow(4, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    const errorMsg = lastError?.message ?? `非 2xx 响应（重试 ${this.opts.maxAttempts} 次仍失败）`;
    await svc.recordDelivery(sub.id, false, errorMsg);
    await this.recordDeliveryRow({
      subscriptionId: sub.id,
      topic,
      ok: false,
      httpStatus: lastStatus,
      attempts: usedAttempts,
      durationMs: Date.now() - start,
      errorMessage: errorMsg,
      requestBody: body,
    });
    // 失败也落 error_events 表，给运维定位
    try {
      await this.prisma.errorEvent.create({
        data: {
          kind: 'webhook_delivery_failed',
          message: `投递 webhook 失败：${errorMsg}`.slice(0, 500),
          severity: 'warn',
          detailsJson: JSON.stringify({
            subscriptionId: sub.id,
            url: sub.url,
            topic,
            attempts: this.opts.maxAttempts,
          }),
        },
      });
    } catch {
      /* error_events 写入失败不应反过来影响 dispatcher */
    }
  }

  private async deliverOnce(
    sub: WebhookSubscription,
    topic: string,
    body: string,
  ): Promise<{ ok: boolean; status: number }> {
    const signed = signWebhook(sub.secret, body);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs);
    try {
      const res = await this.opts.fetchImpl(sub.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-FreeLLM-Signature': signed.signatureHeader,
          'X-FreeLLM-Delivery': signed.deliveryId,
          'X-FreeLLM-Event': topic,
        },
        body,
        signal: ctrl.signal,
      });
      return { ok: res.ok, status: res.status };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 组 5 Tick 4：逐条投递历史落库（明细，写入失败不反向影响投递本身）。 */
  private async recordDeliveryRow(input: {
    subscriptionId: string;
    topic: string;
    ok: boolean;
    httpStatus: number | null;
    attempts: number;
    durationMs: number;
    errorMessage: string | null;
    requestBody: string;
  }): Promise<void> {
    try {
      await this.prisma.webhookDelivery.create({
        data: {
          subscriptionId: input.subscriptionId,
          topic: input.topic,
          ok: input.ok,
          httpStatus: input.httpStatus,
          attempts: input.attempts,
          durationMs: input.durationMs,
          errorMessage: input.errorMessage?.slice(0, 500) ?? null,
          requestBody: input.requestBody.slice(0, 8000),
        },
      });
    } catch {
      /* delivery 明细写入失败不应反过来影响投递 */
    }
  }

  /**
   * 组 5 Tick 4：重投一条历史投递（用原 payload 重新发到订阅 url），落一条新 delivery 记录。
   * 端点 POST /admin/webhooks/deliveries/:id/retry 调用；不依赖 EventBus attach。
   */
  async retryDelivery(deliveryId: string): Promise<{ ok: boolean; attempts: number }> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { subscription: true },
    });
    if (!delivery) throw new Error('投递记录不存在');
    const sub = delivery.subscription;
    const svc = new WebhookSubscriptionService(this.prisma);
    const body =
      delivery.requestBody ??
      JSON.stringify({ topic: delivery.topic, retriedAt: new Date().toISOString() });
    await this.deliverWithRetry(svc, sub, delivery.topic, body);
    const latest = await this.prisma.webhookDelivery.findFirst({
      where: { subscriptionId: sub.id },
      orderBy: { createdAt: 'desc' },
    });
    return { ok: latest?.ok ?? false, attempts: latest?.attempts ?? 0 };
  }
}
