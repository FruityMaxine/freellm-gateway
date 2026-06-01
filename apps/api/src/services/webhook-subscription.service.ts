/**
 * WebhookSubscriptionService (Tick 26 v1.6.1.0)。
 *
 * CRUD + 列表 + topic 匹配。topic 匹配规则：
 * - eventTopicsJson 为空数组 → 订阅所有 topic
 * - 否则按字面相等匹配（model:added != model:removed）
 */
import type { PrismaClient, WebhookSubscription } from '@prisma/client';
import { FreeLLMError } from '@freellm/shared';

export interface CreateWebhookInput {
  url: string;
  secret: string;
  eventTopics?: string[];
  enabled?: boolean;
  description?: string | null;
  createdBy?: string | null;
}

export interface UpdateWebhookInput {
  url?: string;
  secret?: string;
  eventTopics?: string[];
  enabled?: boolean;
  description?: string | null;
}

const URL_PATTERN = /^https?:\/\/[^\s]+$/i;

export class WebhookSubscriptionService {
  constructor(private readonly prisma: PrismaClient) {}

  validateUrl(url: string): void {
    if (!URL_PATTERN.test(url)) {
      throw new FreeLLMError('bad_request', 'Webhook URL 必须以 http:// 或 https:// 开头');
    }
  }

  validateSecret(secret: string): void {
    if (secret.length < 8) {
      throw new FreeLLMError('bad_request', 'Webhook secret 长度需 ≥ 8');
    }
  }

  async list(): Promise<WebhookSubscription[]> {
    return this.prisma.webhookSubscription.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findById(id: string): Promise<WebhookSubscription | null> {
    return this.prisma.webhookSubscription.findUnique({ where: { id } });
  }

  async create(input: CreateWebhookInput): Promise<WebhookSubscription> {
    this.validateUrl(input.url);
    this.validateSecret(input.secret);
    return this.prisma.webhookSubscription.create({
      data: {
        url: input.url,
        secret: input.secret,
        eventTopicsJson: JSON.stringify(input.eventTopics ?? []),
        enabled: input.enabled ?? true,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      },
    });
  }

  async update(id: string, input: UpdateWebhookInput): Promise<WebhookSubscription> {
    if (input.url !== undefined) this.validateUrl(input.url);
    if (input.secret !== undefined) this.validateSecret(input.secret);
    const data: Record<string, unknown> = {};
    if (input.url !== undefined) data.url = input.url;
    if (input.secret !== undefined) data.secret = input.secret;
    if (input.eventTopics !== undefined) data.eventTopicsJson = JSON.stringify(input.eventTopics);
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.description !== undefined) data.description = input.description;
    return this.prisma.webhookSubscription.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.webhookSubscription.delete({ where: { id } });
  }

  /**
   * 给定 topic，找出所有匹配的已启用订阅。
   * eventTopicsJson 为空数组 → 订阅所有 topic。
   */
  async findMatching(topic: string): Promise<WebhookSubscription[]> {
    const all = await this.prisma.webhookSubscription.findMany({
      where: { enabled: true },
    });
    return all.filter((sub) => {
      let topics: string[] = [];
      try {
        topics = JSON.parse(sub.eventTopicsJson);
      } catch {
        return false;
      }
      if (!Array.isArray(topics) || topics.length === 0) return true;
      return topics.includes(topic);
    });
  }

  async recordDelivery(id: string, success: boolean, errorMessage?: string): Promise<void> {
    const data: Record<string, unknown> = {
      totalDeliveries: { increment: 1 },
    };
    if (success) {
      data.lastSuccessAt = new Date();
    } else {
      data.lastErrorAt = new Date();
      data.totalFailures = { increment: 1 };
      if (errorMessage) data.lastErrorMessage = errorMessage.slice(0, 500);
    }
    await this.prisma.webhookSubscription.update({ where: { id }, data });
  }
}
