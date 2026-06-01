/**
 * Admin: Organization + Project CRUD（Tick 19 v1.3.0.0）。
 *
 * 路径：
 *   GET    /admin/organizations             —— 列表（支持 ?include=projects）
 *   POST   /admin/organizations             —— 创建
 *   GET    /admin/organizations/:id         —— 详情
 *   PATCH  /admin/organizations/:id         —— 更新 name / slug / billingEmail
 *   DELETE /admin/organizations/:id         —— 删除（cascade 删 Project，VK projectId 改 null）
 *
 *   GET    /admin/projects                  —— 列表（支持 ?organizationId=...）
 *   POST   /admin/projects                  —— 创建（需 organizationId）
 *   GET    /admin/projects/:id              —— 详情
 *   PATCH  /admin/projects/:id              —— 更新 name / slug
 *   DELETE /admin/projects/:id              —— 删除（VK projectId 改 null）
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { FreeLLMError } from '@freellm/shared';
import { getPrisma } from '../../lib/prisma.js';
import { OrganizationService } from '../../services/organization.service.js';
import { ProjectService } from '../../services/project.service.js';

const createOrgBody = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(2).max(48),
  billingEmail: z.string().email().nullish(),
  // Tick 20 v1.3.1.0：组织级 RPM 限额（null/缺省 = 无限制）。
  rpmLimit: z.number().int().min(1).max(100_000).nullish(),
});

const patchOrgBody = z.object({
  name: z.string().min(1).max(120).optional(),
  slug: z.string().min(2).max(48).optional(),
  billingEmail: z.string().email().nullish().optional(),
  rpmLimit: z.number().int().min(1).max(100_000).nullish().optional(),
});

const createProjectBody = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1).max(120),
  slug: z.string().min(2).max(48),
});

const patchProjectBody = z.object({
  name: z.string().min(1).max(120).optional(),
  slug: z.string().min(2).max(48).optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  // ───── Organizations ─────
  app.get('/admin/organizations', async (req) => {
    const q = z.object({ include: z.enum(['projects']).optional() }).parse(req.query ?? {});
    const svc = new OrganizationService(getPrisma());
    const data = q.include === 'projects' ? await svc.listWithProjects() : await svc.list();
    return { data };
  });

  app.post('/admin/organizations', async (req) => {
    const body = createOrgBody.parse(req.body);
    const svc = new OrganizationService(getPrisma());
    const organization = await svc.create({
      name: body.name,
      slug: body.slug,
      billingEmail: body.billingEmail ?? null,
      ...(body.rpmLimit !== undefined ? { rpmLimit: body.rpmLimit ?? null } : {}),
    });
    return { ok: true, organization };
  });

  app.get('/admin/organizations/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const svc = new OrganizationService(getPrisma());
    const organization = await svc.findById(params.id);
    if (!organization) throw new FreeLLMError('not_found', `组织 ${params.id} 不存在`);
    return organization;
  });

  app.patch('/admin/organizations/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = patchOrgBody.parse(req.body ?? {});
    const svc = new OrganizationService(getPrisma());
    const organization = await svc.update(params.id, body);
    return { ok: true, organization };
  });

  app.delete('/admin/organizations/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const svc = new OrganizationService(getPrisma());
    await svc.delete(params.id);
    return { ok: true };
  });

  // ───── Projects ─────
  app.get('/admin/projects', async (req) => {
    const q = z.object({ organizationId: z.string().optional() }).parse(req.query ?? {});
    const svc = new ProjectService(getPrisma());
    const data = await svc.list(q.organizationId ? { organizationId: q.organizationId } : undefined);
    return { data };
  });

  app.post('/admin/projects', async (req) => {
    const body = createProjectBody.parse(req.body);
    const svc = new ProjectService(getPrisma());
    const project = await svc.create(body);
    return { ok: true, project };
  });

  app.get('/admin/projects/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const svc = new ProjectService(getPrisma());
    const project = await svc.findById(params.id);
    if (!project) throw new FreeLLMError('not_found', `项目 ${params.id} 不存在`);
    return project;
  });

  app.patch('/admin/projects/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = patchProjectBody.parse(req.body ?? {});
    const svc = new ProjectService(getPrisma());
    const project = await svc.update(params.id, body);
    return { ok: true, project };
  });

  app.delete('/admin/projects/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const svc = new ProjectService(getPrisma());
    await svc.delete(params.id);
    return { ok: true };
  });
};

export default plugin;
