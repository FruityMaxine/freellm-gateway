/**
 * 请求成本核算服务（Tick 30 v1.7.2.0 引入）。
 *
 * 读取 `Model.pricingJson`（OpenRouter 格式：`{ prompt: '<USD/token>', completion: '<USD/token>',
 * request: '<USD/request>' }` 字段全是字符串编码的小数），按已知 token 数累乘出请求级 USD 估算成本。
 *
 * 内存缓存 (providerSlug, upstreamId) → pricing 数据（5 分钟 TTL），避免热路径每次都打 DB。
 * 缓存失败 / 模型不存在 / pricingJson 缺失 / 解析失败均静默回落为 null，
 * 失败绝不阻塞 request_logs 写入；上层把 null 视为"无 cost 数据"。
 */
import type { PrismaClient } from '@prisma/client';

export interface ModelPricing {
  /** USD per prompt token（OpenRouter 字段是字符串小数）。 */
  prompt: number;
  /** USD per completion token。 */
  completion: number;
  /** USD per request（per-call 固定费用，绝大多数模型为 0）。 */
  request: number;
}

export interface CostBreakdown {
  totalUsd: number;
  promptUsd: number;
  completionUsd: number;
  requestUsd: number;
  pricing: ModelPricing;
}

export interface ComputeCostInput {
  providerSlug: string;
  upstreamModelId: string;
  promptTokens: number;
  completionTokens: number;
}

const CACHE_TTL_MS = 5 * 60_000;

/** OpenRouter 一般给字符串如 "0.00000014"。null / 非数 → 默认 0。 */
export function parsePriceString(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== 'string') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** 解析 pricingJson 字符串到 ModelPricing。null / 解析失败 → null。 */
export function parsePricingJson(json: string | null | undefined): ModelPricing | null {
  if (!json) return null;
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    return {
      prompt: parsePriceString(obj.prompt),
      completion: parsePriceString(obj.completion),
      request: parsePriceString(obj.request),
    };
  } catch {
    return null;
  }
}

/** 计算 cost：cost = promptTokens × prompt + completionTokens × completion + 1 × request。 */
export function computeCost(
  pricing: ModelPricing,
  promptTokens: number,
  completionTokens: number,
): CostBreakdown {
  const safe = (n: number) => (Number.isFinite(n) && n >= 0 ? n : 0);
  const promptUsd = safe(promptTokens) * safe(pricing.prompt);
  const completionUsd = safe(completionTokens) * safe(pricing.completion);
  const requestUsd = safe(pricing.request);
  return {
    totalUsd: promptUsd + completionUsd + requestUsd,
    promptUsd,
    completionUsd,
    requestUsd,
    pricing,
  };
}

interface PricingCacheEntry {
  value: ModelPricing | null;
  expiresAt: number;
}

export class RequestCostService {
  private readonly pricingCache = new Map<string, PricingCacheEntry>();

  constructor(private readonly prisma: PrismaClient) {}

  /** 仅测试用：重置缓存。 */
  _resetCache(): void {
    this.pricingCache.clear();
  }

  /**
   * 查 (providerSlug, upstreamId) 对应 model 的 pricingJson 并缓存。
   * 未找到 → 缓存 null（防止反复打 DB）。
   */
  async getPricing(providerSlug: string, upstreamModelId: string): Promise<ModelPricing | null> {
    const key = `${providerSlug}:${upstreamModelId}`;
    const now = Date.now();
    const hit = this.pricingCache.get(key);
    if (hit && hit.expiresAt > now) return hit.value;
    try {
      const model = await this.prisma.model.findFirst({
        where: { upstreamId: upstreamModelId, provider: { slug: providerSlug } },
        select: { pricingJson: true },
      });
      const pricing = parsePricingJson(model?.pricingJson ?? null);
      this.pricingCache.set(key, { value: pricing, expiresAt: now + CACHE_TTL_MS });
      return pricing;
    } catch (err) {
      console.warn('[request-cost] 查 model pricing 失败：', (err as Error).message);
      return null;
    }
  }

  /**
   * 综合接口：拿 pricing + 算 cost。null = 无 pricing 数据。
   */
  async estimate(input: ComputeCostInput): Promise<CostBreakdown | null> {
    const pricing = await this.getPricing(input.providerSlug, input.upstreamModelId);
    if (!pricing) return null;
    return computeCost(pricing, input.promptTokens, input.completionTokens);
  }
}
