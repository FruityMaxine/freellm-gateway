/**
 * Admin: request log inspection.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { FreeLLMError } from '@freellm/shared';
import { getPrisma } from '../../lib/prisma.js';

const listQuery = z.object({
  virtualKeyId: z.string().optional(),
  upstreamProvider: z.string().optional(),
  upstreamModel: z.string().optional(),
  status: z.coerce.number().optional(),
  errorKind: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  // Tick 25 v1.6.0.0：全文搜索关键字。命中 requestId / upstreamModel / upstreamProvider /
  // modelAlias / errorKind / clientIp / userAgent / promptDigest 八个字段任一即返回。
  q: z.string().min(1).max(200).optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/logs', async (req) => {
    const q = listQuery.parse(req.query ?? {});
    const where: Record<string, unknown> = {};
    // Tick 55 v1.7.27.0：user role 限制只看自己 VK 的日志(Q2=B)
    const session = req.adminSession;
    if (session?.role === 'user') {
      const ownedVks = await getPrisma().virtualKey.findMany({
        where: { ownerId: session.userId },
        select: { id: true },
      });
      where.virtualKeyId = { in: ownedVks.map((v) => v.id) };
    }
    if (q.virtualKeyId) where.virtualKeyId = q.virtualKeyId;
    if (q.upstreamProvider) where.upstreamProvider = q.upstreamProvider;
    if (q.upstreamModel) where.upstreamModel = q.upstreamModel;
    if (q.status !== undefined) where.status = q.status;
    if (q.errorKind) where.errorKind = q.errorKind;
    // Tick 25 v1.6.0.0：全文搜索 —— 用 OR 跨多列 LIKE 匹配。
    // 兼容 SQLite + PostgreSQL（无须 FTS5 / tsvector 也能用，性能在 50W 行内可接受）。
    if (q.q) {
      const term = q.q.trim();
      where.OR = [
        { requestId: { contains: term } },
        { upstreamModel: { contains: term } },
        { upstreamProvider: { contains: term } },
        { modelAlias: { contains: term } },
        { errorKind: { contains: term } },
        { clientIp: { contains: term } },
        { userAgent: { contains: term } },
        { promptDigest: { contains: term } },
      ];
    }
    const prisma = getPrisma();
    const [rows, total] = await Promise.all([
      prisma.requestLog.findMany({ where, take: q.limit, orderBy: { startedAt: 'desc' } }),
      prisma.requestLog.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id,
        requestId: r.requestId,
        virtualKeyId: r.virtualKeyId,
        upstreamProvider: r.upstreamProvider,
        upstreamModel: r.upstreamModel,
        modelAlias: r.modelAlias,
        routingMode: r.routingMode,
        streaming: r.streaming,
        status: r.status,
        errorKind: r.errorKind,
        attempts: r.attempts,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        totalTokens: r.totalTokens,
        promptDigest: r.promptDigest,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        durationMs: r.durationMs,
        firstTokenMs: r.firstTokenMs,
        clientIp: r.clientIp,
      })),
      total,
      limit: q.limit,
    };
  });

  app.get('/admin/logs/:requestId', async (req) => {
    const params = z.object({ requestId: z.string().min(1) }).parse(req.params);
    const prisma = getPrisma();
    const row = await prisma.requestLog.findUnique({
      where: { requestId: params.requestId },
      include: {
        attemptsList: {
          orderBy: { ordinal: 'asc' },
          include: {
            provider: { select: { slug: true, name: true } },
            model: { select: { upstreamId: true, displayName: true } },
          },
        },
      },
    });
    if (!row) throw new FreeLLMError('not_found', `请求 ${params.requestId} 未找到`);
    // Tick 42 v1.7.14.0：扁平化 attemptsList，把 provider/model 关系字段展平
    // 方便前端瀑布图直接渲染。所有 attempt 字段含 startedAt/finishedAt（绝对时间）
    // 用于计算相对于 request.startedAt 的时间偏移条。
    return {
      ...row,
      attemptsList: row.attemptsList.map((a) => ({
        ordinal: a.ordinal,
        upstreamModel: a.upstreamModel,
        startedAt: a.startedAt,
        finishedAt: a.finishedAt,
        durationMs: a.durationMs,
        firstTokenMs: a.firstTokenMs,
        status: a.status,
        errorKind: a.errorKind,
        errorMessage: a.errorMessage,
        bytesIn: a.bytesIn,
        bytesOut: a.bytesOut,
        cooldownTriggered: a.cooldownTriggered,
        notes: a.notes,
        providerSlug: a.provider?.slug ?? null,
        providerName: a.provider?.name ?? null,
        modelDisplayName: a.model?.displayName ?? null,
      })),
    };
  });
};

export default plugin;
