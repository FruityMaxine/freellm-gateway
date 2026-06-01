/**
 * Admin: virtual key CRUD + rotate + revoke.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { FreeLLMError } from '@freellm/shared';
import { VirtualKeyService, rowPermissions } from '../../services/virtual-key.service.js';
import { VirtualKeyCostService } from '../../services/virtual-key-cost.service.js';
import {
  VkSpendLeaderboardService,
  type VkSpendLeaderboardPayload,
} from '../../services/vk-spend-leaderboard.service.js';
import { VirtualKeyReportService } from '../../services/virtual-key-report.service.js';
import { VkUsageAlertService } from '../../services/vk-usage-alert.service.js';
import { VkUsageWeeklyReportService } from '../../services/vk-usage-weekly-report.service.js';
import { getPrisma } from '../../lib/prisma.js';

const permissionsSchema = z.object({
  allowedModels: z.array(z.string()).optional(),
  deniedModels: z.array(z.string()).optional(),
  allowedProviders: z.array(z.string()).optional(),
  maxRequestsPerMinute: z.number().int().min(1).max(100_000).nullable().optional(),
  maxRequestsPerDay: z.number().int().min(1).max(10_000_000).nullable().optional(),
  maxTokensPerDay: z.number().int().min(1).nullable().optional(),
  maxCostUsdPerDay: z.number().min(0).max(100_000).nullable().optional(),
  allowPaidModels: z.boolean().default(false),
  allowStreaming: z.boolean().default(true),
  reasoningEffort: z.enum(['none', 'low', 'medium', 'high']).optional(),
  allowReasoning: z.boolean().optional(),
});

const createBody = z.object({
  label: z.string().min(1).max(120),
  environment: z.enum(['live', 'test']).optional(),
  permissions: permissionsSchema,
  expiresAt: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
  notes: z.string().max(1000).optional(),
  tags: z.array(z.string().max(40)).optional(),
  // Tick 19 v1.3.0.0：归属项目（可选，缺省则由 seed/default project 兜底）。
  projectId: z.string().min(1).optional(),
});

const patchBody = z.object({
  label: z.string().optional(),
  enabled: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
  tags: z.array(z.string().max(40)).optional(),
  permissions: permissionsSchema.partial().optional(),
  expiresAt: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .transform((s) => (s === null ? null : s ? new Date(s) : undefined)),
});

// Tick 51 v1.7.23.0：spend-leaderboard 5s TTL 缓存（按 scope:limit 组合键）
interface LeaderboardCacheEntry {
  value: VkSpendLeaderboardPayload;
  expiresAt: number;
}
const leaderboardCache = new Map<string, LeaderboardCacheEntry>();

export function invalidateLeaderboardCache(): void {
  leaderboardCache.clear();
}

/**
 * Tick 55 v1.7.27.0：VK 所有权校验 — user role 只能动自己 owned 的 VK。
 * admin role 直接放过。
 */
async function assertVkOwnership(req: FastifyRequest, vkId: string): Promise<void> {
  const session = req.adminSession;
  if (!session) throw new FreeLLMError('unauthorized', '需要登录');
  if (session.role === 'admin') return;
  const row = await getPrisma().virtualKey.findUnique({ where: { id: vkId }, select: { ownerId: true } });
  if (!row) throw new FreeLLMError('not_found', `VK ${vkId} 不存在`);
  if (row.ownerId !== session.userId) {
    throw new FreeLLMError('forbidden', '只能操作你自己创建的虚拟密钥');
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/virtual-keys', async (req) => {
    const svc = new VirtualKeyService(getPrisma());
    // Tick 55 v1.7.27.0：user role 只看自己 owned 的; admin 看全部
    const session = req.adminSession;
    const rows =
      session?.role === 'user'
        ? await svc.listByOwner(session.userId)
        : await svc.listAll();
    return {
      data: rows.map((r) => ({
        id: r.id,
        label: r.label,
        environment: r.environment,
        prefix: r.prefix,
        enabled: r.enabled,
        expiresAt: r.expiresAt,
        lastUsedAt: r.lastUsedAt,
        totalRequests: r.totalRequests,
        totalTokens: r.totalTokens.toString(),
        permissions: rowPermissions(r),
        createdAt: r.createdAt,
        revokedAt: r.revokedAt,
        // Tick 19 v1.3.0.0：返回项目归属（前端用于显示 / 筛选）。
        projectId: r.projectId ?? null,
      })),
      total: rows.length,
    };
  });

  app.post('/admin/virtual-keys', async (req) => {
    const body = createBody.parse(req.body);
    const svc = new VirtualKeyService(getPrisma());
    const created = await svc.create({
      label: body.label,
      ...(body.environment !== undefined ? { environment: body.environment } : {}),
      permissions: { ...body.permissions, allowedModels: body.permissions.allowedModels ?? [], deniedModels: body.permissions.deniedModels ?? [] },
      ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
      ...(body.notes ? { notes: body.notes } : {}),
      ...(body.tags ? { tags: body.tags } : {}),
      ...(req.adminSession ? { createdBy: req.adminSession.userId } : {}),
      // Tick 55 v1.7.27.0：自动绑当前 admin user 为 owner
      ...(req.adminSession ? { ownerId: req.adminSession.userId } : {}),
      ...(body.projectId ? { projectId: body.projectId } : {}),
    });
    return { ok: true, key: created };
  });

  app.patch('/admin/virtual-keys/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    await assertVkOwnership(req, params.id);
    const body = patchBody.parse(req.body);
    const svc = new VirtualKeyService(getPrisma());
    const merged = body.permissions
      ? {
          permissions: {
            allowPaidModels: body.permissions.allowPaidModels ?? false,
            allowStreaming: body.permissions.allowStreaming ?? true,
            ...(body.permissions.allowedModels ? { allowedModels: body.permissions.allowedModels } : {}),
            ...(body.permissions.deniedModels ? { deniedModels: body.permissions.deniedModels } : {}),
            ...(body.permissions.allowedProviders ? { allowedProviders: body.permissions.allowedProviders } : {}),
            ...(body.permissions.maxRequestsPerMinute !== undefined
              ? { maxRequestsPerMinute: body.permissions.maxRequestsPerMinute }
              : {}),
            ...(body.permissions.maxRequestsPerDay !== undefined
              ? { maxRequestsPerDay: body.permissions.maxRequestsPerDay }
              : {}),
            ...(body.permissions.maxTokensPerDay !== undefined
              ? { maxTokensPerDay: body.permissions.maxTokensPerDay }
              : {}),
            ...(body.permissions.maxCostUsdPerDay !== undefined
              ? { maxCostUsdPerDay: body.permissions.maxCostUsdPerDay }
              : {}),
            ...(body.permissions.reasoningEffort !== undefined
              ? { reasoningEffort: body.permissions.reasoningEffort }
              : {}),
            ...(body.permissions.allowReasoning !== undefined
              ? { allowReasoning: body.permissions.allowReasoning }
              : {}),
          },
        }
      : {};
    const updated = await svc.patch(params.id, {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt as Date | null } : {}),
      ...merged,
    });
    return { ok: true, key: { id: updated.id, label: updated.label } };
  });

  app.post('/admin/virtual-keys/:id/rotate', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    await assertVkOwnership(req, params.id);
    const svc = new VirtualKeyService(getPrisma());
    const rotated = await svc.rotate(params.id);
    return { ok: true, key: rotated };
  });

  app.delete('/admin/virtual-keys/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    await assertVkOwnership(req, params.id);
    const svc = new VirtualKeyService(getPrisma());
    const revoked = await svc.revoke(params.id);
    return { ok: true, key: { id: revoked.id, enabled: revoked.enabled } };
  });

  // Tick 33 v1.7.5.0：单 VK 成本与 top 模型
  app.get('/admin/virtual-keys/:id/cost', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const query = z
      .object({ days: z.coerce.number().int().min(1).max(90).optional() })
      .parse(req.query);
    const svc = new VirtualKeyCostService(getPrisma());
    return svc.compute(params.id, query.days ?? 7);
  });

  // Tick 51 v1.7.23.0：VK Spend Top-N 排行（day/week/month）
  app.get('/admin/virtual-keys/spend-leaderboard', async (req) => {
    const query = z
      .object({
        scope: z.enum(['day', 'week', 'month']).default('month'),
        limit: z.coerce.number().int().min(1).max(50).optional(),
      })
      .parse(req.query);
    const now = Date.now();
    const cacheKey = `${query.scope}:${query.limit ?? 10}`;
    const hit = leaderboardCache.get(cacheKey);
    if (hit && hit.expiresAt > now) return hit.value;
    const svc = new VkSpendLeaderboardService(getPrisma());
    const payload = await svc.build(query.scope, query.limit ?? 10);
    leaderboardCache.set(cacheKey, { value: payload, expiresAt: now + 5_000 });
    return payload;
  });

  // Tick 33 v1.7.5.0：所有 VK 7 天总 cost（用于列表 "成本" 列一次性拉完）
  app.get('/admin/virtual-keys/costs', async (req) => {
    const query = z
      .object({ days: z.coerce.number().int().min(1).max(90).optional() })
      .parse(req.query);
    const svc = new VirtualKeyCostService(getPrisma());
    const data = await svc.listAllCosts(query.days ?? 7);
    return { data, windowDays: query.days ?? 7 };
  });

  // Tick 39 v1.7.11.0：VK 用量预警 - 单 VK 今日用量快照
  app.get('/admin/virtual-keys/:id/usage', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const svc = new VkUsageAlertService(getPrisma());
    const snapshot = await svc.getUsageSnapshot(params.id);
    if (!snapshot) {
      throw new Error(`VK ${params.id} 不存在`);
    }
    return snapshot;
  });

  // Tick 39 v1.7.11.0：手动触发全 VK 用量预警扫描
  app.post('/admin/virtual-keys/alerts/check', async () => {
    const svc = new VkUsageAlertService(getPrisma());
    return svc.checkAll();
  });

  // Tick 39 v1.7.11.0：近 N 条 vk_usage_alert ErrorEvent
  app.get('/admin/virtual-keys/alerts/recent', async (req) => {
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(200).optional() })
      .parse(req.query);
    const svc = new VkUsageAlertService(getPrisma());
    const data = await svc.listRecentAlerts(query.limit ?? 20);
    return { data, total: data.length };
  });

  // Tick 41 v1.7.13.0：VK 用量周报 - 预览（不发送）
  app.get('/admin/virtual-keys/weekly-report', async () => {
    const svc = new VkUsageWeeklyReportService(getPrisma());
    const report = await svc.generate();
    const lastSentAt = await svc.getLastSentAt();
    return { report, lastSentAt: lastSentAt?.toISOString() ?? null };
  });

  // Tick 41 v1.7.13.0：VK 用量周报 - 强制发送（emit webhook + 更新 lastSentAt）
  app.post('/admin/virtual-keys/weekly-report/send', async () => {
    const svc = new VkUsageWeeklyReportService(getPrisma());
    const report = await svc.forceSend();
    return { ok: true, report };
  });

  // Tick 38 v1.7.10.0：VK 月度报告（JSON）
  app.get('/admin/virtual-keys/:id/report', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const query = z
      .object({
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/, '月份格式应为 YYYY-MM'),
      })
      .parse(req.query);
    const [yStr, mStr] = query.month.split('-');
    const svc = new VirtualKeyReportService(getPrisma());
    return svc.buildMonthlyReport(params.id, Number(yStr), Number(mStr));
  });

  // Tick 38 v1.7.10.0：VK 月度报告（CSV 下载）
  app.get('/admin/virtual-keys/:id/report.csv', async (req, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const query = z
      .object({
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/, '月份格式应为 YYYY-MM'),
      })
      .parse(req.query);
    const [yStr, mStr] = query.month.split('-');
    const svc = new VirtualKeyReportService(getPrisma());
    const report = await svc.buildMonthlyReport(params.id, Number(yStr), Number(mStr));
    const csv = svc.formatAsCsv(report);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header(
      'Content-Disposition',
      `attachment; filename="vk-report-${params.id}-${query.month}.csv"`,
    );
    return csv;
  });
};

export default plugin;
