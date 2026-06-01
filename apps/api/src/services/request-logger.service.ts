/**
 * Logs each downstream request and ties together the executor's
 * `route_attempts` rows with the `request_logs` row downstream UIs read.
 * Honors the project secrecy policy: prompt text is digested by default and
 * only retained verbatim when the operator explicitly opts in.
 */
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { ChatMessage } from '@freellm/provider-core';
import { globalEventBus } from './event-bus.js';
import { invalidateMetricsCache } from '../routes/admin/metrics.routes.js';
import { invalidatePromMetricsCache } from '../routes/admin/metrics-prometheus.routes.js';
import { RequestCostService } from './request-cost.service.js';

export interface LogRequestStartInput {
  requestId: string;
  virtualKeyId?: string | null;
  modelAlias?: string;
  routingMode?: string;
  streaming: boolean;
  messages: ChatMessage[];
  clientIp?: string | null;
  userAgent?: string | null;
  // Tick 20 v1.3.1.0：租户切片字段（鉴权链同步落地）。
  organizationId?: string | null;
  projectId?: string | null;
}

export interface LogRequestEndInput {
  requestId: string;
  status: number;
  errorKind?: string;
  upstreamProvider?: string;
  upstreamModel?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  firstTokenMs?: number;
  durationMs?: number;
  attempts?: number;
}

export class RequestLoggerService {
  // Tick 30 v1.7.2.0：成本核算服务（每 logger 实例共享一个，命中 5 分钟内存缓存）。
  private readonly costSvc: RequestCostService;
  constructor(
    private prisma: PrismaClient,
    private opts: { keepDigest: boolean; keepFull: boolean },
  ) {
    this.costSvc = new RequestCostService(prisma);
  }

  async start(input: LogRequestStartInput): Promise<void> {
    const promptText = serialiseMessages(input.messages);
    const digest = this.opts.keepDigest ? sha256_12(promptText) : null;
    const fullPrompt = this.opts.keepFull ? promptText.slice(0, 8000) : null;
    await this.prisma.requestLog.upsert({
      where: { requestId: input.requestId },
      update: {},
      create: {
        requestId: input.requestId,
        ...(input.virtualKeyId ? { virtualKeyId: input.virtualKeyId } : {}),
        ...(input.modelAlias ? { modelAlias: input.modelAlias } : {}),
        ...(input.routingMode ? { routingMode: input.routingMode } : {}),
        streaming: input.streaming,
        startedAt: new Date(),
        ...(input.clientIp ? { clientIp: input.clientIp } : {}),
        ...(input.userAgent ? { userAgent: input.userAgent } : {}),
        ...(digest ? { promptDigest: digest } : {}),
        ...(fullPrompt ? { promptText: fullPrompt } : {}),
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
      },
    });
  }

  async finish(input: LogRequestEndInput): Promise<void> {
    // Tick 30 v1.7.2.0：成本核算 —— 仅 status < 400 且 token 量已知时估算。
    // 失败请求不入累计（避免重试相加导致成本失真）。
    let estimatedCostUsd: number | null = null;
    if (
      input.status < 400 &&
      input.upstreamProvider &&
      input.upstreamModel &&
      input.promptTokens !== undefined &&
      input.completionTokens !== undefined
    ) {
      try {
        const cost = await this.costSvc.estimate({
          providerSlug: input.upstreamProvider,
          upstreamModelId: input.upstreamModel,
          promptTokens: input.promptTokens,
          completionTokens: input.completionTokens,
        });
        if (cost) estimatedCostUsd = cost.totalUsd;
      } catch (err) {
        console.warn('[request-logger] 成本估算失败：', (err as Error).message);
      }
    }

    await this.prisma.requestLog.update({
      where: { requestId: input.requestId },
      data: {
        status: input.status,
        ...(input.errorKind ? { errorKind: input.errorKind } : {}),
        ...(input.upstreamProvider ? { upstreamProvider: input.upstreamProvider } : {}),
        ...(input.upstreamModel ? { upstreamModel: input.upstreamModel } : {}),
        ...(input.promptTokens !== undefined ? { promptTokens: input.promptTokens } : {}),
        ...(input.completionTokens !== undefined ? { completionTokens: input.completionTokens } : {}),
        ...(input.totalTokens !== undefined ? { totalTokens: input.totalTokens } : {}),
        ...(input.firstTokenMs !== undefined ? { firstTokenMs: input.firstTokenMs } : {}),
        ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
        ...(input.attempts !== undefined ? { attempts: input.attempts } : {}),
        ...(estimatedCostUsd !== null ? { estimatedCostUsd } : {}),
        finishedAt: new Date(),
      },
    });

    // Tick 18 v1.2.0.0：把请求完成事件推到 EventBus，让 /admin/events SSE 实时通知前端。
    // EventBus.emit 内部已 try/catch 隔离单 listener 故障；这里不再包裹。
    try {
      await globalEventBus.emit('request:complete', {
        requestId: input.requestId,
        status: input.status ?? null,
        errorKind: input.errorKind ?? null,
        upstreamProvider: input.upstreamProvider ?? null,
        upstreamModel: input.upstreamModel ?? null,
        durationMs: input.durationMs ?? null,
        attempts: input.attempts ?? null,
        finishedAt: new Date().toISOString(),
      });
    } catch (err) {
      // 事件发送失败不应让请求失败；只记一行 warn。
      console.warn('[request-logger] EventBus emit 失败：', (err as Error).message);
    }
    // 失效 Dashboard / Prom 缓存让下一次抓取立即反映新请求。
    invalidateMetricsCache();
    invalidatePromMetricsCache();
  }
}

function serialiseMessages(msgs: ChatMessage[]): string {
  return msgs
    .map((m) => `${m.role}:${typeof m.content === 'string' ? m.content : m.content.map((c) => c.text ?? '').join('')}`)
    .join('\n');
}

function sha256_12(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
}
