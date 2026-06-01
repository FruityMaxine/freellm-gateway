/**
 * Admin: 管理员账号 + 会话管理（Tick 53 v1.7.25.0 引入）。
 *
 * GET    /admin/users            列出全部管理员（含 lockedUntil / lastLoginAt 等）
 * POST   /admin/users            新建管理员（username + password）
 * PATCH  /admin/users/:id        改 enabled / unlock / 重置密码 (按 body 字段决定动作)
 * DELETE /admin/users/:id        删除管理员（防 self / 防删光）
 * GET    /admin/sessions         列出未撤销 + 未过期的会话
 * POST   /admin/sessions/:id/revoke  强制下线某个会话
 *
 * 全部受 admin-auth 守门（adminSession 必须有）。
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { FreeLLMError } from '@freellm/shared';
import { getPrisma } from '../../lib/prisma.js';
import { AdminUserService } from '../../services/admin-user.service.js';

const createUserBody = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(8).max(128),
  // Tick 55 v1.7.27.0：默认 user role (Q3=A)
  role: z.enum(['admin', 'user']).optional(),
});

const patchUserBody = z.object({
  enabled: z.boolean().optional(),
  unlock: z.boolean().optional(),
  newPassword: z.string().min(8).max(128).optional(),
  role: z.enum(['admin', 'user']).optional(),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/users', async () => {
    const svc = new AdminUserService(getPrisma());
    const data = await svc.listUsers();
    return { data, total: data.length };
  });

  app.post('/admin/users', async (req) => {
    const body = createUserBody.parse(req.body);
    const svc = new AdminUserService(getPrisma());
    const r = await svc.createUser(body.username, body.password, body.role ?? 'user');
    if ('error' in r) throw new FreeLLMError('bad_request', r.error);
    return { ok: true, id: r.id };
  });

  app.patch('/admin/users/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = patchUserBody.parse(req.body ?? {});
    const svc = new AdminUserService(getPrisma());
    const results: Record<string, unknown> = {};

    if (body.enabled !== undefined) {
      const ok = await svc.setEnabled(params.id, body.enabled);
      if (!ok) throw new FreeLLMError('not_found', '用户不存在');
      results.enabled = body.enabled;
    }
    if (body.unlock) {
      const ok = await svc.unlock(params.id);
      if (!ok) throw new FreeLLMError('not_found', '用户不存在');
      results.unlocked = true;
    }
    if (body.newPassword) {
      const r = await svc.resetPassword(params.id, body.newPassword);
      if ('error' in r) throw new FreeLLMError('bad_request', r.error);
      results.passwordReset = true;
    }
    if (body.role !== undefined) {
      const r = await svc.setRole(params.id, body.role);
      if ('error' in r) throw new FreeLLMError('bad_request', r.error);
      results.role = body.role;
    }
    if (Object.keys(results).length === 0) {
      throw new FreeLLMError('bad_request', '至少提供 enabled / unlock / newPassword 一个字段');
    }
    return { ok: true, ...results };
  });

  app.delete('/admin/users/:id', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const currentUserId = req.adminSession?.userId;
    if (!currentUserId) throw new FreeLLMError('unauthorized', '未登录');
    const svc = new AdminUserService(getPrisma());
    const r = await svc.deleteUser(params.id, currentUserId);
    if ('error' in r) throw new FreeLLMError('bad_request', r.error);
    return { ok: true };
  });

  app.get('/admin/sessions', async () => {
    const svc = new AdminUserService(getPrisma());
    const data = await svc.listSessions();
    return { data, total: data.length };
  });

  app.post('/admin/sessions/:id/revoke', async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const svc = new AdminUserService(getPrisma());
    const ok = await svc.revokeSession(params.id);
    if (!ok) throw new FreeLLMError('not_found', '会话不存在');
    return { ok: true };
  });
};

export default plugin;
