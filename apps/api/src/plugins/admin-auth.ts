/**
 * Cookie-based admin auth.
 *
 * Token lives in an HttpOnly + SameSite=Lax cookie set by `/admin/auth/login`.
 * Only the hash is persisted (`Session.tokenHash`). 5 failed attempts within
 * the lockout window puts the user in `locked` state for 10 min — enforced
 * by `AdminUserService`.
 */
import fp from 'fastify-plugin';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { FreeLLMError } from '@freellm/shared';
import { AdminUserService } from '../services/admin-user.service.js';
import { getPrisma } from '../lib/prisma.js';

declare module 'fastify' {
  interface FastifyRequest {
    // Tick 55 v1.7.27.0：加 role 字段供 RBAC 中间件判定
    adminSession?: { userId: string; sessionId: string; username: string; role: 'admin' | 'user' };
  }
}

/**
 * Tick 55 v1.7.27.0：admin-only 路由组守门。
 * 路由处理器内部第一行调 `requireAdmin(req)` — 普通 user role 抛 403。
 * 不直接做成 hook 因为有些端点对 user 也开放(/admin/auth/me, /admin/virtual-keys 自己的)。
 */
export function requireAdmin(req: FastifyRequest): void {
  if (!req.adminSession) {
    throw new FreeLLMError('unauthorized', '需要管理员登录会话');
  }
  if (req.adminSession.role !== 'admin') {
    throw new FreeLLMError('forbidden', '本接口仅 admin 角色可访问');
  }
}

const COOKIE_NAME = 'freellm_admin_session';
const PUBLIC_ADMIN_PREFIXES = ['/admin/auth/login', '/admin/auth/logout'];

/**
 * Tick 55 v1.7.27.0：admin-only 路径前缀(role !== admin 直接 403)。
 * /admin/auth/me + /admin/virtual-keys + /admin/playground 是 user 也能访问的(自己的资源)。
 * 其他 admin-* 路径全锁给 admin role。
 */
const ADMIN_ONLY_PREFIXES = [
  '/admin/providers',
  '/admin/settings',
  '/admin/audit',
  '/admin/alerts',
  '/admin/webhooks',
  '/admin/system',
  '/admin/cron',
  '/admin/users',
  '/admin/sessions',
  '/admin/organizations',
  '/admin/projects',
  '/admin/metrics',
  // '/admin/logs' 不锁 — user role 也可见, 但服务层按 ownerId 过滤(只看自己 VK 的日志, Q2=B)
  '/admin/models',
  '/admin/routing-policies',
  '/admin/routing-policy',
  '/admin/cooldowns',
  '/admin/events',
  '/admin/test-chat',
  // 组 4 Tick 5 P1 修复：usage 聚合/查询端点补 admin-only（与 /admin/metrics 同类全局数据，
  // 防 user 角色越权读跨 VK 用量 + 触发无授权重算 DoS）。
  '/admin/usage',
];

function isAdminOnly(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return ADMIN_ONLY_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`));
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const piece of header.split(';')) {
    const [k, ...rest] = piece.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

// 审计 P0-1：cookie 加固 — 生产模式追加 Secure，SameSite 全程 Strict
// （管理后台无需跨站携带 cookie，可拒绝所有跨站请求）。
function isProd(): boolean {
  return process.env.FREELLM_NODE_ENV === 'production';
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  const maxAge = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const secure = isProd() ? '; Secure' : '';
  reply.header(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=${maxAge}`,
  );
}

export function clearSessionCookie(reply: FastifyReply): void {
  const secure = isProd() ? '; Secure' : '';
  reply.header('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=0`);
}

export function readSessionCookie(req: FastifyRequest): string | undefined {
  return parseCookie(req.headers['cookie'], COOKIE_NAME);
}

const plugin: FastifyPluginCallback = (app, _opts, done) => {
  const svc = new AdminUserService(getPrisma());

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/admin/')) return;
    if (PUBLIC_ADMIN_PREFIXES.some((p) => req.url === p || req.url.startsWith(`${p}?`))) return;
    const token = readSessionCookie(req);
    if (!token) {
      throw new FreeLLMError('unauthorized', '需要管理员登录会话', {
        context: { requestId: req.requestId },
      });
    }
    const session = await svc.resolveSession(token);
    if (!session) {
      throw new FreeLLMError('unauthorized', '管理员会话无效或已过期', {
        context: { requestId: req.requestId },
      });
    }
    req.adminSession = {
      userId: session.userId,
      sessionId: session.id,
      username: session.user.username,
      role: (session.user.role === 'admin' ? 'admin' : 'user') as 'admin' | 'user',
    };

    // Tick 55 v1.7.27.0：admin-only 路径前缀 — role !== admin 直接 403
    if (req.adminSession.role !== 'admin' && isAdminOnly(req.url)) {
      throw new FreeLLMError('forbidden', `本接口仅 admin 角色可访问 (${req.url})`, {
        context: { requestId: req.requestId },
      });
    }
  });

  done();
};

export default fp(plugin, { name: 'admin-auth' });
