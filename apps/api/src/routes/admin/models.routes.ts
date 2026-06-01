/**
 * Admin: model management endpoints.
 *
 * Auth is intentionally lax in v0.2.0.0 (Tick 3) — the admin-auth plugin
 * lands in Tick 5. For now these endpoints are mounted under `/admin/` and
 * are not exposed by the reverse proxy in production until Tick 5.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { FreeLLMError } from '@freellm/shared';
import { getPrisma } from '../../lib/prisma.js';
import { ModelDiscoveryService } from '../../services/model-discovery.service.js';
import { ModelAutoBlacklistService } from '../../services/model-auto-blacklist.service.js';
import { invalidatePoolCache } from '../../lib/pool-cache.js';
import { invalidateMetricsCache } from './metrics.routes.js';

const listQuery = z.object({
  providerSlug: z.string().optional(),
  status: z.string().optional(),
  free: z.enum(['true', 'false']).optional(),
  search: z.string().optional(),
  // Tick 57 v1.7.29.0：limit 改可配置, 默认 1000 (OpenRouter 现 358 个, 留余量未来增长)
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});

const patchBody = z.object({
  manualOverride: z.enum(['force_enabled', 'force_disabled']).nullish(),
  weightAdj: z.number().min(-1).max(1).optional(),
  blacklisted: z.boolean().optional(),
  whitelisted: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  // GET /admin/models — paginated list with simple filters.
  app.get('/admin/models', async (req) => {
    const q = listQuery.parse(req.query ?? {});
    const prisma = getPrisma();
    const where: Record<string, unknown> = {};
    if (q.providerSlug) where.provider = { slug: q.providerSlug };
    if (q.status) where.status = q.status;
    if (q.free === 'true') where.isFree = true;
    if (q.free === 'false') where.isFree = false;
    if (q.search) {
      where.OR = [
        { upstreamId: { contains: q.search } },
        { displayName: { contains: q.search } },
        { family: { contains: q.search } },
      ];
    }
    const effectiveLimit = q.limit ?? 1000;
    const [rows, total] = await Promise.all([
      prisma.model.findMany({
        where,
        include: { provider: { select: { slug: true, name: true } }, scores: true },
        orderBy: [{ status: 'asc' }, { upstreamId: 'asc' }],
        take: effectiveLimit,
      }),
      prisma.model.count({ where }),
    ]);
    return {
      data: rows.map((m) => ({
        id: m.id,
        providerSlug: m.provider.slug,
        providerName: m.provider.name,
        upstreamId: m.upstreamId,
        displayName: m.displayName,
        family: m.family,
        contextLength: m.contextLength,
        isFree: m.isFree,
        status: m.status,
        weightAdj: m.weightAdj,
        blacklisted: m.blacklisted,
        whitelisted: m.whitelisted,
        firstSeenAt: m.firstSeenAt,
        lastSeenAt: m.lastSeenAt,
        composite: m.scores?.composite ?? null,
        // Tick 34 v1.7.6.0：透传 manualOverride / notes 让 Web 可识别自动黑名单标记
        manualOverride: m.manualOverride,
        notes: m.notes,
        autoBlacklisted: m.notes?.startsWith('auto-blacklisted:') ?? false,
      })),
      total,
      limit: effectiveLimit,
    };
  });

  // GET /admin/models/:id — detail + last 10 snapshots + Tick 44 v1.7.16.0：近 20 条 ErrorEvent
  app.get('/admin/models/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const prisma = getPrisma();
    const model = await prisma.model.findUnique({
      where: { id: params.id },
      include: {
        provider: true,
        scores: true,
        snapshots: { take: 10, orderBy: { takenAt: 'desc' } },
        errorEvents: {
          take: 20,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            kind: true,
            severity: true,
            message: true,
            createdAt: true,
            resolvedAt: true,
          },
        },
      },
    });
    if (!model) throw new FreeLLMError('not_found', `模型 ${params.id} 不存在`);
    return model;
  });

  // PATCH /admin/models/:id — manual overrides
  app.patch('/admin/models/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = patchBody.parse(req.body ?? {});
    const prisma = getPrisma();
    const update: Record<string, unknown> = {};
    if (body.manualOverride !== undefined) update.manualOverride = body.manualOverride;
    if (body.weightAdj !== undefined) update.weightAdj = body.weightAdj;
    if (body.blacklisted !== undefined) update.blacklisted = body.blacklisted;
    if (body.whitelisted !== undefined) update.whitelisted = body.whitelisted;
    if (body.notes !== undefined) update.notes = body.notes;

    if (body.manualOverride === 'force_disabled') update.status = 'disabled';
    if (body.manualOverride === 'force_enabled') update.status = 'active';

    const model = await prisma.model.update({ where: { id: params.id }, data: update });
    invalidatePoolCache();
    invalidateMetricsCache();
    return { ok: true, model };
  });

  // POST /admin/models/refresh — manually trigger a discovery cycle
  app.post('/admin/models/refresh', async (req) => {
    const body = z
      .object({ providerSlug: z.string().optional() })
      .parse(req.body ?? {});
    const prisma = getPrisma();
    const svc = new ModelDiscoveryService({ prisma, registry: app.registry });
    const reports = body.providerSlug
      ? [await svc.refreshSlug(body.providerSlug)]
      : await svc.refreshAll();
    return {
      ok: reports.every((r) => r.ok),
      reports: reports.map((r) => ({
        providerSlug: r.providerSlug,
        ok: r.ok,
        durationMs: r.durationMs,
        discovered: r.discovered,
        events: r.events.length,
        ...(r.error ? { error: r.error } : {}),
      })),
    };
  });

  // Tick 34 v1.7.6.0：手动触发自动黑名单评估（cron 同样会定期跑）。
  app.post('/admin/models/auto-blacklist/evaluate', async () => {
    const svc = new ModelAutoBlacklistService(getPrisma());
    const report = await svc.evaluateAll();
    if (report.blacklisted.length > 0) {
      invalidatePoolCache();
      invalidateMetricsCache();
    }
    return report;
  });

  app.get('/admin/models/auto-blacklist/recent', async (req) => {
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(200).optional() })
      .parse(req.query);
    const svc = new ModelAutoBlacklistService(getPrisma());
    const data = await svc.listRecentlyAutoBlacklisted(query.limit ?? 20);
    return { data, total: data.length };
  });

  // Tick 35 v1.7.7.0：模型批量管理 —— 一次操作 ≤ 500 个 model。
  // action='blacklist' → blacklisted=true + manualOverride=force_disabled
  // action='whitelist' → whitelisted=true + manualOverride=force_enabled
  // action='enable'    → manualOverride=force_enabled, blacklisted=false
  // action='disable'   → manualOverride=force_disabled
  // action='reset'     → manualOverride=null, blacklisted=false, whitelisted=false
  app.post('/admin/models/bulk', async (req) => {
    const body = z
      .object({
        ids: z.array(z.string().min(1)).min(1).max(500),
        action: z.enum(['blacklist', 'whitelist', 'enable', 'disable', 'reset']),
        notes: z.string().max(500).optional(),
      })
      .parse(req.body ?? {});
    const prisma = getPrisma();
    const update: Record<string, unknown> = {};
    switch (body.action) {
      case 'blacklist':
        update.blacklisted = true;
        update.whitelisted = false;
        update.manualOverride = 'force_disabled';
        update.status = 'disabled';
        break;
      case 'whitelist':
        update.whitelisted = true;
        update.blacklisted = false;
        update.manualOverride = 'force_enabled';
        update.status = 'active';
        break;
      case 'enable':
        update.manualOverride = 'force_enabled';
        update.blacklisted = false;
        update.status = 'active';
        break;
      case 'disable':
        update.manualOverride = 'force_disabled';
        update.status = 'disabled';
        break;
      case 'reset':
        update.manualOverride = null;
        update.blacklisted = false;
        update.whitelisted = false;
        update.notes = null;
        break;
    }
    if (body.notes !== undefined && body.action !== 'reset') {
      update.notes = body.notes;
    }
    const result = await prisma.model.updateMany({
      where: { id: { in: body.ids } },
      data: update,
    });
    invalidatePoolCache();
    invalidateMetricsCache();
    return {
      ok: true,
      action: body.action,
      requested: body.ids.length,
      modified: result.count,
    };
  });

  // Tick 35 v1.7.7.0：导出黑/白名单 + 手动覆盖配置为 JSON（便于灾备 / 跨环境迁移）。
  app.get('/admin/models/export', async () => {
    const prisma = getPrisma();
    const rows = await prisma.model.findMany({
      where: {
        OR: [
          { blacklisted: true },
          { whitelisted: true },
          { manualOverride: { not: null } },
        ],
      },
      include: { provider: { select: { slug: true } } },
      orderBy: { upstreamId: 'asc' },
    });
    return {
      exportedAt: new Date().toISOString(),
      total: rows.length,
      models: rows.map((m) => ({
        providerSlug: m.provider.slug,
        upstreamId: m.upstreamId,
        blacklisted: m.blacklisted,
        whitelisted: m.whitelisted,
        manualOverride: m.manualOverride,
        notes: m.notes,
        weightAdj: m.weightAdj,
      })),
    };
  });

  // Tick 35 v1.7.7.0：导入黑/白名单 JSON（按 providerSlug + upstreamId 复合键匹配）。
  // 找不到的 model 跳过并计入 skipped。
  app.post('/admin/models/import', async (req) => {
    const body = z
      .object({
        models: z
          .array(
            z.object({
              providerSlug: z.string().min(1),
              upstreamId: z.string().min(1),
              blacklisted: z.boolean().optional(),
              whitelisted: z.boolean().optional(),
              manualOverride: z.enum(['force_enabled', 'force_disabled']).nullable().optional(),
              notes: z.string().max(500).nullable().optional(),
              weightAdj: z.number().min(-1).max(1).optional(),
            }),
          )
          .min(1)
          .max(1000),
      })
      .parse(req.body ?? {});
    const prisma = getPrisma();
    let modified = 0;
    let skipped = 0;
    for (const entry of body.models) {
      const m = await prisma.model.findFirst({
        where: { upstreamId: entry.upstreamId, provider: { slug: entry.providerSlug } },
        select: { id: true },
      });
      if (!m) {
        skipped += 1;
        continue;
      }
      const update: Record<string, unknown> = {};
      if (entry.blacklisted !== undefined) update.blacklisted = entry.blacklisted;
      if (entry.whitelisted !== undefined) update.whitelisted = entry.whitelisted;
      if (entry.manualOverride !== undefined) {
        update.manualOverride = entry.manualOverride;
        if (entry.manualOverride === 'force_disabled') update.status = 'disabled';
        if (entry.manualOverride === 'force_enabled') update.status = 'active';
      }
      if (entry.notes !== undefined) update.notes = entry.notes;
      if (entry.weightAdj !== undefined) update.weightAdj = entry.weightAdj;
      if (Object.keys(update).length > 0) {
        await prisma.model.update({ where: { id: m.id }, data: update });
        modified += 1;
      }
    }
    invalidatePoolCache();
    invalidateMetricsCache();
    return { ok: true, requested: body.models.length, modified, skipped };
  });

  // ===== Tick 54 v1.7.26.0：模型用量端点 =====
  // GET /admin/models/:id/usage?days=7
  //   → 24h / 7d / 30d 三档窗口的总请求 / 成功 / 失败 / 总 cost / 平均延迟
  app.get('/admin/models/:id/usage', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const query = z
      .object({ days: z.coerce.number().int().min(1).max(90).optional() })
      .parse(req.query);
    const prisma = getPrisma();
    const model = await prisma.model.findUnique({
      where: { id: params.id },
      select: { id: true, upstreamId: true, provider: { select: { slug: true } } },
    });
    if (!model) throw new FreeLLMError('not_found', `模型 ${params.id} 不存在`);

    const days = query.days ?? 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);
    const where = {
      upstreamModel: model.upstreamId,
      upstreamProvider: model.provider.slug,
      startedAt: { gte: since },
    };
    const [agg, success, failed, costAgg] = await Promise.all([
      prisma.requestLog.aggregate({ where, _count: { _all: true }, _avg: { durationMs: true } }),
      prisma.requestLog.count({ where: { ...where, status: { lt: 400 } } }),
      prisma.requestLog.count({ where: { ...where, status: { gte: 400 } } }),
      prisma.requestLog.aggregate({
        where: { ...where, estimatedCostUsd: { not: null } },
        _sum: { estimatedCostUsd: true },
      }),
    ]);
    const total = agg._count._all;
    return {
      modelId: model.id,
      upstreamId: model.upstreamId,
      provider: model.provider.slug,
      windowDays: days,
      totalRequests: total,
      successfulRequests: success,
      failedRequests: failed,
      successRate: total > 0 ? Math.round((success / total) * 10000) / 10000 : 0,
      avgLatencyMs: agg._avg.durationMs != null ? Math.round(agg._avg.durationMs) : null,
      totalCostUsd: Math.round((costAgg._sum.estimatedCostUsd ?? 0) * 1_000_000) / 1_000_000,
      generatedAt: new Date().toISOString(),
    };
  });
};

export default plugin;
