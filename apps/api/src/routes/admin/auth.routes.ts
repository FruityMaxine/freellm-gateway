/**
 * Admin auth — POST /admin/auth/login, POST /admin/auth/logout, GET /admin/auth/me
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { FreeLLMError } from '@freellm/shared';
import { AdminUserService } from '../../services/admin-user.service.js';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from '../../plugins/admin-auth.js';
import { getPrisma } from '../../lib/prisma.js';

const loginBody = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(200),
});

const plugin: FastifyPluginAsync = async (app) => {
  app.post('/admin/auth/login', async (req, reply) => {
    const body = loginBody.parse(req.body);
    const svc = new AdminUserService(getPrisma());
    const result = await svc.login(body.username, body.password, {
      ip: req.ip ?? null,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    });
    if (!result.ok) {
      if (result.reason === 'locked') {
        throw new FreeLLMError(
          'forbidden',
          `账户已锁定至 ${result.lockedUntil?.toISOString()}`,
        );
      }
      // 审计 P1-A：不泄露用户名是否存在，避免账户枚举。
      throw new FreeLLMError('unauthorized', '用户名或密码错误');
    }
    setSessionCookie(reply, result.sessionToken, result.expiresAt);
    return { ok: true, userId: result.userId, expiresAt: result.expiresAt };
  });

  app.post('/admin/auth/logout', async (req, reply) => {
    const token = readSessionCookie(req);
    if (token) {
      const svc = new AdminUserService(getPrisma());
      await svc.logout(token);
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/admin/auth/me', async (req) => {
    if (!req.adminSession) throw new FreeLLMError('unauthorized', '需要管理员登录会话');
    return {
      userId: req.adminSession.userId,
      username: req.adminSession.username,
      sessionId: req.adminSession.sessionId,
      // Tick 55 v1.7.27.0：返 role 给前端 Sidebar 切换 NAV
      role: req.adminSession.role,
    };
  });
};

export default plugin;
