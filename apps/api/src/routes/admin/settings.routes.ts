/**
 * Admin: live settings get/patch.
 *
 * The `settings` table is the source of truth at runtime; env vars are
 * the boot-time default.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import { RetentionPolicyService } from '../../services/retention-policy.service.js';
import { RetryPolicyService } from '../../services/retry-policy.service.js';

const patchBody = z.record(z.unknown());

// Tick 46 v1.7.18.0：数据保留策略 zod schema
const retentionPolicyBody = z.object({
  adminAuditRetentionDays: z.number().int().min(0).max(3650).optional(),
  playgroundSessionRetentionDays: z.number().int().min(0).max(3650).optional(),
  errorEventRetentionDays: z.number().int().min(0).max(3650).optional(),
});

// Tick 48 v1.7.20.0：重试策略 zod schema
const retryPolicyBody = z.object({
  maxAttempts: z.number().int().min(1).max(10).optional(),
  initialBackoffMs: z.number().int().min(0).max(60_000).optional(),
  maxBackoffMs: z.number().int().min(0).max(60_000).optional(),
  jitterRatio: z.number().min(0).max(1).optional(),
  retryOnStatusCodes: z.array(z.number().int().min(100).max(599)).max(20).optional(),
  retryOnErrorKinds: z.array(z.string().min(1).max(64)).max(20).optional(),
});
const previewQuery = z.object({
  maxAttempts: z.coerce.number().int().min(1).max(10).optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/settings', async () => {
    const rows = await getPrisma().setting.findMany({ orderBy: { key: 'asc' } });
    const data: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        data[r.key] = JSON.parse(r.value);
      } catch {
        data[r.key] = r.value;
      }
    }
    return { data, total: rows.length };
  });

  app.patch('/admin/settings', async (req) => {
    const body = patchBody.parse(req.body);
    const prisma = getPrisma();
    const updated: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      const stored = JSON.stringify(value);
      await prisma.setting.upsert({
        where: { key },
        update: { value: stored },
        create: { key, value: stored },
      });
      updated[key] = value;
    }
    return { ok: true, updated };
  });

  // Tick 46 v1.7.18.0：数据保留策略读写
  app.get('/admin/settings/retention', async () => {
    const svc = new RetentionPolicyService(getPrisma());
    return svc.getPolicy();
  });

  app.patch('/admin/settings/retention', async (req) => {
    const body = retentionPolicyBody.parse(req.body);
    const svc = new RetentionPolicyService(getPrisma());
    return svc.setPolicy(body);
  });

  // Tick 46 v1.7.18.0：手动触发一次清扫
  app.post('/admin/settings/retention/purge', async () => {
    const svc = new RetentionPolicyService(getPrisma());
    return svc.runPurge();
  });

  // Tick 48 v1.7.20.0：重试/退避策略 GET/PATCH + backoff preview
  app.get('/admin/settings/retry-policy', async () => {
    const svc = new RetryPolicyService(getPrisma());
    return svc.getPolicy();
  });

  app.patch('/admin/settings/retry-policy', async (req) => {
    const body = retryPolicyBody.parse(req.body);
    const svc = new RetryPolicyService(getPrisma());
    return svc.setPolicy(body);
  });

  app.get('/admin/settings/retry-policy/preview', async (req) => {
    const q = previewQuery.parse(req.query ?? {});
    const svc = new RetryPolicyService(getPrisma());
    const data = await svc.previewBackoffs(q.maxAttempts);
    return { data, total: data.length };
  });
};

export default plugin;
